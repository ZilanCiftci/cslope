//! A DWG drawing as line work, for showing it under a model (an underlay):
//! every visible curve of the model space as a polyline in world
//! coordinates (lines, polylines with their arcs, arcs, circles, ellipses,
//! splines; block references expanded, nested ones too; dimensions,
//! leaders and multilines exploded), and the texts with where they stand.
//!
//! [`read_dwg_vectors`] differs from [`crate::read_dwg`] (the model import),
//! which reads only polylines and lines as they are.
//!
//! Block references are expanded with acadrust's [`Insert::explode`]: the
//! block's entities (taken relative to its base point) are transformed by
//! the reference's insertion point, scale, rotation and array (MINSERT),
//! and a reference inside a block is expanded again, to a depth of
//! [`MAX_DEPTH`]. The model space is read; paper space (layouts) is not.

use std::collections::BTreeMap;
use std::f64::consts::PI;
use std::io::Cursor;

use acadrust::entities::{EntityType, Insert};
use acadrust::io::dwg::DwgReadOptions;
use acadrust::types::{Transform, Vector3};
use acadrust::{CadDocument, DwgReader};
use serde::Serialize;

use crate::Pt;

/// Nested block references are expanded to this depth (deeper ones are
/// left out and counted).
pub const MAX_DEPTH: usize = 12;
/// At most this many points in all; a drawing with more is cut short (and
/// says so), so that a block bomb cannot exhaust memory.
pub const MAX_POINTS: usize = 4_000_000;
const MAX_DECOMPRESSED_BYTES: usize = 1 << 30;

/// A curve of the drawing as a polyline (world coordinates, drawing units).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VectorPath {
    pub layer: String,
    pub points: Vec<Pt>,
    pub closed: bool,
}

/// A text of the drawing (TEXT, MTEXT, an attribute): its insertion point,
/// height (drawing units) and rotation (radians, counter-clockwise).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TextItem {
    pub layer: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub height: f64,
    pub rotation: f64,
}

/// A layer: its name, and whether it is off or frozen in the drawing.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LayerInfo {
    pub name: String,
    pub off: bool,
}

/// What [`read_dwg_vectors`] returns (serialized with camelCase keys).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorDrawing {
    pub version: String,
    /// `$INSUNITS` (0 unitless, 4 mm, 6 m, …).
    pub insunits: i16,
    pub layers: Vec<LayerInfo>,
    pub paths: Vec<VectorPath>,
    pub texts: Vec<TextItem>,
    /// Model-space entities that are not drawn, by DXF type name.
    pub skipped: BTreeMap<String, usize>,
    /// Block references expanded (nested ones included).
    pub expanded_inserts: usize,
    /// Entities in paper space (layouts), which are not read.
    pub paper_space_entities: usize,
    /// The drawing was cut short at [`MAX_POINTS`] or [`MAX_DEPTH`].
    pub truncated: bool,
    pub warnings: Vec<String>,
}

/// Reads a DWG file's line work. Never panics natively (see `read_dwg`).
pub fn read_dwg_vectors(bytes: &[u8]) -> Result<VectorDrawing, String> {
    match std::panic::catch_unwind(|| read_inner(bytes)) {
        Ok(result) => result,
        Err(payload) => {
            let detail = payload
                .downcast_ref::<String>()
                .map(String::as_str)
                .or_else(|| payload.downcast_ref::<&str>().copied())
                .unwrap_or("unknown error");
            Err(format!("The DWG reader failed on this file ({detail})."))
        }
    }
}

fn read_inner(bytes: &[u8]) -> Result<VectorDrawing, String> {
    if bytes.len() < 6 || !bytes.starts_with(b"AC") {
        return Err("Not a DWG file (it does not start with a DWG version code).".into());
    }
    let read = |failsafe: bool| {
        let options = DwgReadOptions {
            failsafe,
            ..DwgReadOptions::default()
        }
        .with_max_decompressed_bytes(MAX_DECOMPRESSED_BYTES);
        DwgReader::from_stream_with_options(Cursor::new(bytes), options).read_with_stats()
    };
    let strict = match read(false) {
        Ok(outcome) => return Ok(vectors_of(&outcome.document, Vec::new())),
        Err(e) => e.to_string(),
    };
    let outcome = read(true).map_err(|_| format!("The DWG file could not be read: {strict}"))?;
    if outcome.document.model_space_entities().next().is_none() {
        return Err(format!("The DWG file could not be read: {strict}"));
    }
    Ok(vectors_of(
        &outcome.document,
        vec![format!(
            "The file has errors and was read in recovery mode ({strict})."
        )],
    ))
}

/// The line work of a document read by acadrust.
pub fn vectors_of(doc: &CadDocument, warnings: Vec<String>) -> VectorDrawing {
    let mut out = VectorDrawing {
        version: doc.version.as_str().to_string(),
        insunits: doc.header.insertion_units,
        layers: doc
            .layers
            .iter()
            .map(|l| LayerInfo {
                name: l.name.clone(),
                off: l.is_off() || l.is_frozen(),
            })
            .collect(),
        warnings,
        ..VectorDrawing::default()
    };
    let mut budget = MAX_POINTS;
    for entity in doc.model_space_entities() {
        emit(doc, &mut out, entity, None, 0, &mut budget);
    }
    out.paper_space_entities = doc
        .block_records
        .names()
        .filter(|n| n.to_ascii_lowercase().starts_with("*paper_space"))
        .map(|n| doc.entities_in_block(n).count())
        .sum();
    out
}

/// A block's entities relative to its base point (as acadrust's
/// `block_entities_from_document`, also for blocks marked not explodable:
/// they are drawn all the same).
fn block_entities(doc: &CadDocument, name: &str) -> Option<Vec<EntityType>> {
    let br = doc.block_records.get(name)?;
    if br.flags.is_xref || br.flags.is_xref_overlay || br.flags.is_external {
        return None;
    }
    let base = match doc.get_entity(br.block_entity_handle) {
        Some(EntityType::Block(block)) => block.base_point,
        _ => br.base_point,
    };
    let to_base = Transform::from_translation(base * -1.0);
    Some(
        doc.entities_in_block(name)
            .map(|e| {
                let mut e = e.clone();
                e.as_entity_mut().apply_transform(&to_base);
                e
            })
            .collect(),
    )
}

/// Points of an entity's object coordinate system in world coordinates, for
/// the default normal and its mirror (0, 0, -1) (see `ocs_to_wcs` in lib.rs).
fn ocs(x: f64, y: f64, normal: &Vector3) -> Pt {
    if normal.z < -0.999_999 {
        [-x, y]
    } else {
        [x, y]
    }
}

/// Points along an arc (centre, radius, start and end angle in radians,
/// counter-clockwise), about one per 5° (at least 4 segments).
fn arc_points(cx: f64, cy: f64, r: f64, a0: f64, a1: f64) -> Vec<[f64; 2]> {
    let mut sweep = a1 - a0;
    while sweep <= 0.0 {
        sweep += 2.0 * PI;
    }
    let n = ((sweep / (2.0 * PI) * 72.0).ceil() as usize).clamp(4, 360);
    (0..=n)
        .map(|i| {
            let a = a0 + sweep * i as f64 / n as f64;
            [cx + r * a.cos(), cy + r * a.sin()]
        })
        .collect()
}

/// The points of a polyline segment from `p` to `q` with `bulge` (the
/// tangent of a quarter of the arc's angle; 0: straight), without `p`.
fn bulge_points(p: [f64; 2], q: [f64; 2], bulge: f64) -> Vec<[f64; 2]> {
    if bulge.abs() < 1e-12 {
        return vec![q];
    }
    let chord = ((q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2)).sqrt();
    if chord < 1e-12 {
        return vec![q];
    }
    let theta = 4.0 * bulge.atan();
    let r = chord / (2.0 * (theta / 2.0).sin()).abs();
    // The centre: on the chord's perpendicular bisector.
    let mx = (p[0] + q[0]) / 2.0;
    let my = (p[1] + q[1]) / 2.0;
    let d = (r * r - chord * chord / 4.0).max(0.0).sqrt();
    let (ux, uy) = ((q[0] - p[0]) / chord, (q[1] - p[1]) / chord);
    // Positive bulge: counter-clockwise, the centre on the left when |θ| < π.
    let side = if (bulge > 0.0) == (theta.abs() < PI) {
        1.0
    } else {
        -1.0
    };
    let (cx, cy) = (mx - uy * d * side, my + ux * d * side);
    let a0 = (p[1] - cy).atan2(p[0] - cx);
    let n = ((theta.abs() / (2.0 * PI) * 72.0).ceil() as usize).clamp(2, 360);
    (1..=n)
        .map(|i| {
            let a = a0 + theta * i as f64 / n as f64;
            [cx + r * a.cos(), cy + r * a.sin()]
        })
        .collect()
}

/// A polyline of vertices with bulges, in the entity's OCS.
fn bulged(vertices: &[([f64; 2], f64)], closed: bool, normal: &Vector3) -> Vec<Pt> {
    let mut pts: Vec<[f64; 2]> = Vec::with_capacity(vertices.len());
    if let Some(first) = vertices.first() {
        pts.push(first.0);
    }
    let n = vertices.len();
    let segments = if closed { n } else { n.saturating_sub(1) };
    for i in 0..segments {
        let (p, b) = vertices[i];
        let (q, _) = vertices[(i + 1) % n];
        pts.extend(bulge_points(p, q, b));
    }
    if closed && pts.len() > 1 {
        // (the closing segment ends where the first began)
        pts.pop();
    }
    pts.into_iter().map(|[x, y]| ocs(x, y, normal)).collect()
}

fn push_path(
    out: &mut VectorDrawing,
    budget: &mut usize,
    layer: &str,
    points: Vec<Pt>,
    closed: bool,
) {
    if points.len() < 2 {
        return;
    }
    if points.len() > *budget {
        out.truncated = true;
        *budget = 0;
        return;
    }
    *budget -= points.len();
    out.paths.push(VectorPath {
        layer: layer.to_string(),
        points,
        closed,
    });
}

fn push_text(
    out: &mut VectorDrawing,
    layer: &str,
    text: String,
    at: Pt,
    height: f64,
    rotation: f64,
) {
    let text = text.trim().to_string();
    if text.is_empty() || !at[0].is_finite() || !at[1].is_finite() {
        return;
    }
    out.texts.push(TextItem {
        layer: layer.to_string(),
        text,
        x: at[0],
        y: at[1],
        height,
        rotation,
    });
}

fn skip(out: &mut VectorDrawing, entity: &EntityType) {
    let name = match entity.as_entity().entity_type() {
        n if n.starts_with("DIMENSION") => "DIMENSION",
        n => n,
    };
    *out.skipped.entry(name.to_string()).or_insert(0) += 1;
}

/// Draws one entity: `inherit` is the layer of the block reference it is
/// part of (an entity of a block on layer "0" takes it, as in CAD).
fn emit(
    doc: &CadDocument,
    out: &mut VectorDrawing,
    entity: &EntityType,
    inherit: Option<&str>,
    depth: usize,
    budget: &mut usize,
) {
    if *budget == 0 {
        out.truncated = true;
        return;
    }
    let own = entity.common().layer.as_str();
    let layer = match inherit {
        Some(parent) if own == "0" || own.is_empty() => parent,
        _ => own,
    }
    .to_string();
    if entity.common().invisible {
        return;
    }
    match entity {
        EntityType::Line(l) => push_path(
            out,
            budget,
            &layer,
            vec![[l.start.x, l.start.y], [l.end.x, l.end.y]],
            false,
        ),
        EntityType::LwPolyline(p) => {
            let v: Vec<([f64; 2], f64)> = p
                .vertices
                .iter()
                .map(|v| ([v.location.x, v.location.y], v.bulge))
                .collect();
            push_path(
                out,
                budget,
                &layer,
                bulged(&v, p.is_closed, &p.normal),
                p.is_closed,
            );
        }
        EntityType::Polyline2D(p) => {
            let v: Vec<([f64; 2], f64)> = p
                .vertices
                .iter()
                .map(|v| ([v.location.x, v.location.y], v.bulge))
                .collect();
            push_path(
                out,
                budget,
                &layer,
                bulged(&v, p.is_closed(), &p.normal),
                p.is_closed(),
            );
        }
        EntityType::Polyline(p) => push_path(
            out,
            budget,
            &layer,
            p.vertices
                .iter()
                .map(|v| [v.location.x, v.location.y])
                .collect(),
            p.is_closed(),
        ),
        EntityType::Polyline3D(p) => push_path(
            out,
            budget,
            &layer,
            p.vertices
                .iter()
                .map(|v| [v.position.x, v.position.y])
                .collect(),
            p.is_closed(),
        ),
        EntityType::Arc(a) => {
            let pts = arc_points(a.center.x, a.center.y, a.radius, a.start_angle, a.end_angle);
            push_path(
                out,
                budget,
                &layer,
                pts.into_iter().map(|[x, y]| ocs(x, y, &a.normal)).collect(),
                false,
            );
        }
        EntityType::Circle(c) => {
            let mut pts = arc_points(c.center.x, c.center.y, c.radius, 0.0, 2.0 * PI);
            pts.pop();
            push_path(
                out,
                budget,
                &layer,
                pts.into_iter().map(|[x, y]| ocs(x, y, &c.normal)).collect(),
                true,
            );
        }
        EntityType::Ellipse(e) => {
            // centre + cos t · major + sin t · minor, minor = ratio · (normal × major).
            let (mx, my) = (e.major_axis.x, e.major_axis.y);
            let sign = if e.normal.z < 0.0 { -1.0 } else { 1.0 };
            let (nx, ny) = (
                -my * sign * e.minor_axis_ratio,
                mx * sign * e.minor_axis_ratio,
            );
            let full = e.is_full();
            let (t0, mut t1) = if full {
                (0.0, 2.0 * PI)
            } else {
                (e.start_parameter, e.end_parameter)
            };
            while t1 <= t0 {
                t1 += 2.0 * PI;
            }
            let n = (((t1 - t0) / (2.0 * PI) * 72.0).ceil() as usize).clamp(4, 360);
            let mut pts: Vec<Pt> = (0..=n)
                .map(|i| {
                    let t = t0 + (t1 - t0) * i as f64 / n as f64;
                    [
                        e.center.x + t.cos() * mx + t.sin() * nx,
                        e.center.y + t.cos() * my + t.sin() * ny,
                    ]
                })
                .collect();
            if full {
                pts.pop();
            }
            push_path(out, budget, &layer, pts, full);
        }
        EntityType::Spline(_) | EntityType::Helix(_) => {
            // Lines along the curve (acadrust's flattening), joined.
            let mut pts: Vec<Pt> = Vec::new();
            for part in entity.flatten() {
                if let EntityType::Line(l) = part {
                    let a = [l.start.x, l.start.y];
                    if pts.last() != Some(&a) {
                        if pts.len() >= 2 {
                            push_path(out, budget, &layer, std::mem::take(&mut pts), false);
                        }
                        pts.clear();
                        pts.push(a);
                    }
                    pts.push([l.end.x, l.end.y]);
                }
            }
            push_path(out, budget, &layer, pts, false);
        }
        EntityType::Solid(s) => {
            // Corners 1-2-4-3 (the DXF order of a SOLID).
            let c = [
                s.first_corner,
                s.second_corner,
                s.fourth_corner,
                s.third_corner,
            ];
            let mut pts: Vec<Pt> = c.iter().map(|v| ocs(v.x, v.y, &s.normal)).collect();
            pts.dedup();
            let closed = pts.len() > 2;
            push_path(out, budget, &layer, pts, closed);
        }
        EntityType::Face3D(f) => {
            let c = [
                f.first_corner,
                f.second_corner,
                f.third_corner,
                f.fourth_corner,
            ];
            let mut pts: Vec<Pt> = c.iter().map(|v| [v.x, v.y]).collect();
            pts.dedup();
            let closed = pts.len() > 2;
            push_path(out, budget, &layer, pts, closed);
        }
        EntityType::Text(t) => {
            let at = ocs(t.insertion_point.x, t.insertion_point.y, &t.normal);
            push_text(out, &layer, t.value.clone(), at, t.height, t.rotation);
        }
        EntityType::MText(t) => {
            let text =
                acadrust::entities::mtext_format::parse_mtext(&t.value, true).to_plain_text();
            push_text(
                out,
                &layer,
                text.replace('\n', " "),
                [t.insertion_point.x, t.insertion_point.y],
                t.height,
                t.rotation,
            );
        }
        EntityType::AttributeEntity(a) => {
            push_text(
                out,
                &layer,
                a.value.clone(),
                [a.insertion_point.x, a.insertion_point.y],
                a.height,
                a.rotation,
            );
        }
        // A block definition's attribute templates are not drawn.
        EntityType::AttributeDefinition(_) => {}
        EntityType::Insert(insert) => expand_insert(doc, out, insert, &layer, depth, budget),
        EntityType::Dimension(d) => {
            // Its geometry is the anonymous block it names (world coordinates).
            let name = d.base().block_name.as_str();
            match (!name.is_empty())
                .then(|| block_entities_raw(doc, name))
                .flatten()
            {
                Some(parts) if depth < MAX_DEPTH => {
                    for part in &parts {
                        emit(doc, out, part, Some(&layer), depth + 1, budget);
                    }
                }
                _ => explode_into(doc, out, entity, &layer, depth, budget),
            }
        }
        EntityType::Leader(_)
        | EntityType::MultiLeader(_)
        | EntityType::MLine(_)
        | EntityType::Table(_) => explode_into(doc, out, entity, &layer, depth, budget),
        other => skip(out, other),
    }
}

/// A block's entities as they are (a dimension's block is in world coordinates).
fn block_entities_raw(doc: &CadDocument, name: &str) -> Option<Vec<EntityType>> {
    doc.block_records.get(name)?;
    Some(doc.entities_in_block(name).cloned().collect())
}

fn explode_into(
    doc: &CadDocument,
    out: &mut VectorDrawing,
    entity: &EntityType,
    layer: &str,
    depth: usize,
    budget: &mut usize,
) {
    let parts = entity.explode();
    if parts.is_empty() || depth >= MAX_DEPTH {
        skip(out, entity);
        return;
    }
    for part in &parts {
        emit(doc, out, part, Some(layer), depth + 1, budget);
    }
}

fn expand_insert(
    doc: &CadDocument,
    out: &mut VectorDrawing,
    insert: &Insert,
    layer: &str,
    depth: usize,
    budget: &mut usize,
) {
    for a in &insert.attributes {
        if !a.common.invisible {
            push_text(
                out,
                layer,
                a.value.clone(),
                [a.insertion_point.x, a.insertion_point.y],
                a.height,
                a.rotation,
            );
        }
    }
    if depth >= MAX_DEPTH {
        out.truncated = true;
        *out.skipped.entry("INSERT".to_string()).or_insert(0) += 1;
        return;
    }
    let Some(entities) = block_entities(doc, &insert.block_name) else {
        *out.skipped.entry("INSERT".to_string()).or_insert(0) += 1;
        return;
    };
    out.expanded_inserts += 1;
    for part in insert.explode(&entities) {
        emit(doc, out, &part, Some(layer), depth + 1, budget);
        if *budget == 0 {
            out.truncated = true;
            return;
        }
    }
}

/// The line work as JSON (camelCase keys).
pub fn read_dwg_vectors_json(bytes: &[u8]) -> Result<String, String> {
    let drawing = read_dwg_vectors(bytes)?;
    serde_json::to_string(&drawing).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bulge_of_one_is_a_half_circle() {
        let pts = bulge_points([0.0, 0.0], [2.0, 0.0], 1.0);
        let last = pts.last().unwrap();
        assert!((last[0] - 2.0).abs() < 1e-9 && last[1].abs() < 1e-9);
        // Counter-clockwise from (0,0) to (2,0): through (1, -1).
        let lowest = pts.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
        assert!((lowest + 1.0).abs() < 1e-3, "{lowest}");
        for p in &pts {
            assert!((((p[0] - 1.0).powi(2) + p[1].powi(2)).sqrt() - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn arc_points_follow_the_angles() {
        let pts = arc_points(0.0, 0.0, 2.0, 0.0, PI / 2.0);
        assert!((pts[0][0] - 2.0).abs() < 1e-12);
        let last = pts.last().unwrap();
        assert!(last[0].abs() < 1e-9 && (last[1] - 2.0).abs() < 1e-9);
    }
}
