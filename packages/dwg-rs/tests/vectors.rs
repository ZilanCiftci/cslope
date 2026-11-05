//! The underlay reader (`read_dwg_vectors`) on drawings acadrust writes:
//! arcs and circles as polylines, block references expanded (nested, scaled,
//! rotated), texts, units and layers.

use acadrust::entities::{Arc, Circle, EntityType, Insert, Line, LwPolyline, LwVertex, Text};
use acadrust::tables::BlockRecord;
use acadrust::types::{DxfVersion, Vector2, Vector3};
use acadrust::{CadDocument, DwgWriter, Layer};
use cslope_dwg::{read_dwg_vectors, read_dwg_vectors_json};

/// Adds `entity` to the block `name` only (not to the model space).
fn add_to_block(doc: &mut CadDocument, name: &str, entity: EntityType) {
    let handle = doc.add_entity(entity).unwrap();
    for br in doc.block_records.iter_mut() {
        br.entity_handles.retain(|h| *h != handle);
    }
    doc.block_records
        .get_mut(name)
        .unwrap()
        .entity_handles
        .push(handle);
}

fn new_block(doc: &mut CadDocument, name: &str, base: Vector3) {
    let mut record = BlockRecord::new(name);
    record.handle = doc.allocate_handle();
    record.block_entity_handle = doc.allocate_handle();
    record.block_end_handle = doc.allocate_handle();
    record.base_point = base;
    doc.block_records.add(record).unwrap();
}

fn line(a: [f64; 2], b: [f64; 2], layer: &str) -> EntityType {
    let mut l = Line::from_coords(a[0], a[1], 0.0, b[0], b[1], 0.0);
    l.common.layer = layer.into();
    EntityType::Line(l)
}

/// A drawing with a nested block: "Mark" (a 1 × 1 square from its base
/// point (10, 10)) inside "Pair" (two marks), referenced twice.
fn blocks() -> Vec<u8> {
    let mut doc = CadDocument::with_version(DxfVersion::AC1032);
    doc.header.insertion_units = 4; // mm
    doc.layers.add(Layer::new("marks")).unwrap();
    new_block(&mut doc, "Mark", Vector3::new(10.0, 10.0, 0.0));
    let mut square = LwPolyline::from_points(
        [[10.0, 10.0], [11.0, 10.0], [11.0, 11.0], [10.0, 11.0]]
            .iter()
            .map(|p| Vector2::new(p[0], p[1]))
            .collect(),
    );
    square.is_closed = true;
    add_to_block(&mut doc, "Mark", EntityType::LwPolyline(square));
    new_block(&mut doc, "Pair", Vector3::ZERO);
    add_to_block(
        &mut doc,
        "Pair",
        EntityType::Insert(Insert::new("Mark", Vector3::new(0.0, 0.0, 0.0))),
    );
    add_to_block(
        &mut doc,
        "Pair",
        EntityType::Insert(Insert::new("Mark", Vector3::new(5.0, 0.0, 0.0))),
    );
    // Pair at (100, 0), scaled 2, and at (0, 100), rotated 90°.
    let mut a = Insert::new("Pair", Vector3::new(100.0, 0.0, 0.0));
    a.set_x_scale(2.0);
    a.set_y_scale(2.0);
    a.set_z_scale(2.0);
    a.common.layer = "marks".into();
    doc.add_entity(EntityType::Insert(a)).unwrap();
    let mut b = Insert::new("Pair", Vector3::new(0.0, 100.0, 0.0));
    b.rotation = std::f64::consts::FRAC_PI_2;
    doc.add_entity(EntityType::Insert(b)).unwrap();
    // An arc, a circle, a bulged polyline and a text.
    doc.add_entity(EntityType::Arc(Arc::from_center_radius_angles(
        Vector3::new(0.0, 0.0, 0.0),
        5.0,
        0.0,
        std::f64::consts::PI,
    )))
    .unwrap();
    doc.add_entity(EntityType::Circle(Circle::from_center_radius(
        Vector3::new(50.0, 50.0, 0.0),
        2.0,
    )))
    .unwrap();
    let mut bulged = LwPolyline::new();
    bulged.vertices.push(LwVertex {
        bulge: 1.0,
        ..LwVertex::new(Vector2::new(0.0, -10.0))
    });
    bulged
        .vertices
        .push(LwVertex::new(Vector2::new(4.0, -10.0)));
    doc.add_entity(EntityType::LwPolyline(bulged)).unwrap();
    let mut text = Text::new();
    text.value = "Section A-A".into();
    text.insertion_point = Vector3::new(20.0, 30.0, 0.0);
    text.height = 2.5;
    doc.add_entity(EntityType::Text(text)).unwrap();
    DwgWriter::write_to_vec(&doc).unwrap()
}

fn has_square(d: &cslope_dwg::VectorDrawing, x: f64, y: f64, size: f64) -> bool {
    d.paths.iter().any(|p| {
        p.closed
            && p.points.len() == 4
            && p.points
                .iter()
                .any(|q| (q[0] - x).abs() < 1e-9 && (q[1] - y).abs() < 1e-9)
            && p.points
                .iter()
                .any(|q| (q[0] - x - size).abs() < 1e-9 || (q[0] - x + size).abs() < 1e-9)
    })
}

#[test]
fn block_references_are_expanded_nested_scaled_and_rotated() {
    let d = read_dwg_vectors(&blocks()).unwrap();
    assert_eq!(d.insunits, 4);
    // 2 references of Pair, each 2 Marks: 4 squares, 6 expansions.
    assert_eq!(d.expanded_inserts, 6, "{:?}", d.skipped);
    let squares: Vec<_> = d
        .paths
        .iter()
        .filter(|p| p.closed && p.points.len() == 4)
        .collect();
    assert_eq!(squares.len(), 4);
    // Scaled 2 at (100, 0): the marks at (100, 0) and (110, 0), 2 × 2.
    assert!(has_square(&d, 100.0, 0.0, 2.0), "{squares:?}");
    assert!(has_square(&d, 110.0, 0.0, 2.0), "{squares:?}");
    // Rotated 90° at (0, 100): the second mark at (0, 105), x → y.
    assert!(squares.iter().any(|p| p
        .points
        .iter()
        .any(|q| q[0].abs() < 1e-9 && (q[1] - 105.0).abs() < 1e-9)));
    // A block's entities on layer 0 take the reference's layer.
    assert!(squares.iter().filter(|p| p.layer == "marks").count() == 2);
}

#[test]
fn curves_become_polylines_and_texts_are_read() {
    let d = read_dwg_vectors(&blocks()).unwrap();
    let arc = d
        .paths
        .iter()
        .find(|p| {
            !p.closed
                && p.points
                    .first()
                    .is_some_and(|q| (q[0] - 5.0).abs() < 1e-9 && q[1].abs() < 1e-9)
        })
        .expect("arc");
    let end = arc.points.last().unwrap();
    assert!((end[0] + 5.0).abs() < 1e-9 && end[1].abs() < 1e-9);
    assert!(arc.points.len() > 10);
    let circle = d
        .paths
        .iter()
        .find(|p| p.closed && p.points.len() > 20)
        .expect("circle");
    for q in &circle.points {
        assert!((((q[0] - 50.0).powi(2) + (q[1] - 50.0).powi(2)).sqrt() - 2.0).abs() < 1e-9);
    }
    // The bulge of 1 from (0,-10) to (4,-10): a half circle through (2, -12).
    let bulged = d
        .paths
        .iter()
        .find(|p| p.points.first() == Some(&[0.0, -10.0]))
        .expect("bulged polyline");
    assert!(bulged
        .points
        .iter()
        .any(|q| (q[0] - 2.0).abs() < 1e-6 && (q[1] + 12.0).abs() < 1e-6));
    assert_eq!(d.texts.len(), 1);
    assert_eq!(d.texts[0].text, "Section A-A");
    assert_eq!([d.texts[0].x, d.texts[0].y], [20.0, 30.0]);
    assert!(d.layers.iter().any(|l| l.name == "marks" && !l.off));
}

#[test]
fn json_uses_the_app_names() {
    let json = read_dwg_vectors_json(&blocks()).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    for key in [
        "version",
        "insunits",
        "layers",
        "paths",
        "texts",
        "skipped",
        "expandedInserts",
        "paperSpaceEntities",
        "truncated",
        "warnings",
    ] {
        assert!(v.get(key).is_some(), "missing {key}");
    }
}

#[test]
fn garbage_is_an_error() {
    assert!(read_dwg_vectors(b"not a drawing").is_err());
    assert!(read_dwg_vectors(b"AC1032\0\0\0\0garbage").is_err());
}

/// A drawing of three slope sections side by side (in mm, at 1:1 in
/// meters × 1000), with axes, tick labels and titles, for the app's
/// real-window check: `CSLOPE_DWG_OUT=path cargo test --release -- --ignored write_sections`.
#[test]
#[ignore = "writes a drawing for the app's check"]
fn write_sections() {
    let path = std::env::var("CSLOPE_DWG_OUT").expect("CSLOPE_DWG_OUT");
    let mut doc = CadDocument::with_version(DxfVersion::AC1032);
    doc.header.insertion_units = 4;
    for name in ["ground", "layers", "water", "axes", "text"] {
        doc.layers.add(Layer::new(name)).unwrap();
    }
    let mm = 1000.0;
    for (k, title) in ["Section 1", "Section 2", "Section 3"].iter().enumerate() {
        let ox = k as f64 * 80.0 * mm;
        let rise = 6.0 + 2.0 * k as f64;
        // The outline: a closed polyline (m → mm).
        let outline = [
            [0.0, 0.0],
            [0.0, 10.0],
            [20.0, 10.0],
            [35.0, 10.0 + rise],
            [60.0, 10.0 + rise],
            [60.0, 0.0],
        ];
        let mut p = LwPolyline::from_points(
            outline
                .iter()
                .map(|q| Vector2::new(ox + q[0] * mm, q[1] * mm))
                .collect(),
        );
        p.is_closed = true;
        p.common.layer = "ground".into();
        doc.add_entity(EntityType::LwPolyline(p)).unwrap();
        // A layer boundary as LINEs, the water line.
        for (a, b) in [([0.0, 5.0], [30.0, 6.0]), ([30.0, 6.0], [60.0, 7.0])] {
            doc.add_entity(line(
                [ox + a[0] * mm, a[1] * mm],
                [ox + b[0] * mm, b[1] * mm],
                "layers",
            ))
            .unwrap();
        }
        let mut w = LwPolyline::from_points(vec![
            Vector2::new(ox, 8.0 * mm),
            Vector2::new(ox + 60.0 * mm, 12.0 * mm),
        ]);
        w.common.layer = "water".into();
        doc.add_entity(EntityType::LwPolyline(w)).unwrap();
        // Axes with ticks every 10 m, labels and a title.
        doc.add_entity(line([ox, -3.0 * mm], [ox + 60.0 * mm, -3.0 * mm], "axes"))
            .unwrap();
        doc.add_entity(line(
            [ox - 3.0 * mm, 0.0],
            [ox - 3.0 * mm, 20.0 * mm],
            "axes",
        ))
        .unwrap();
        for i in 0..=6 {
            let x = ox + i as f64 * 10.0 * mm;
            doc.add_entity(line([x, -3.5 * mm], [x, -2.5 * mm], "axes"))
                .unwrap();
            let mut t = Text::new();
            t.value = format!("{}", i * 10);
            t.insertion_point = Vector3::new(x - 0.6 * mm, -5.5 * mm, 0.0);
            t.height = 1.2 * mm;
            t.common.layer = "text".into();
            doc.add_entity(EntityType::Text(t)).unwrap();
        }
        for j in 0..=2 {
            let y = j as f64 * 10.0 * mm;
            doc.add_entity(line([ox - 3.5 * mm, y], [ox - 2.5 * mm, y], "axes"))
                .unwrap();
            let mut t = Text::new();
            t.value = format!("+{}", j * 10);
            t.insertion_point = Vector3::new(ox - 7.5 * mm, y - 0.5 * mm, 0.0);
            t.height = 1.2 * mm;
            t.common.layer = "text".into();
            doc.add_entity(EntityType::Text(t)).unwrap();
        }
        let mut t = Text::new();
        t.value = (*title).into();
        t.insertion_point = Vector3::new(ox + 22.0 * mm, 24.0 * mm, 0.0);
        t.height = 2.0 * mm;
        t.common.layer = "text".into();
        doc.add_entity(EntityType::Text(t)).unwrap();
    }
    std::fs::write(&path, DwgWriter::write_to_vec(&doc).unwrap()).unwrap();
}

/// A large drawing (about 50 000 segments: contour-like polylines and a
/// grid of lines), for measuring the app's drawing speed:
/// `CSLOPE_DWG_OUT=path cargo test --release -- --ignored write_large`.
#[test]
#[ignore = "writes a drawing for the app's check"]
fn write_large() {
    let path = std::env::var("CSLOPE_DWG_OUT").expect("CSLOPE_DWG_OUT");
    let mut doc = CadDocument::with_version(DxfVersion::AC1032);
    doc.header.insertion_units = 6;
    doc.layers.add(Layer::new("contours")).unwrap();
    doc.layers.add(Layer::new("grid")).unwrap();
    // 100 wavy polylines of 400 points: 39 900 segments.
    for k in 0..100 {
        let y0 = k as f64 * 2.0;
        let pts: Vec<Vector2> = (0..400)
            .map(|i| {
                let x = i as f64;
                Vector2::new(x, y0 + (x / 7.0 + k as f64).sin() * 0.8)
            })
            .collect();
        let mut p = LwPolyline::from_points(pts);
        p.common.layer = "contours".into();
        doc.add_entity(EntityType::LwPolyline(p)).unwrap();
    }
    // A grid of 10 100 short lines.
    for i in 0..101 {
        for j in 0..100 {
            let x = i as f64 * 4.0;
            let y = j as f64 * 2.0;
            doc.add_entity(line([x, y], [x + 0.5, y + 0.5], "grid"))
                .unwrap();
        }
    }
    std::fs::write(&path, DwgWriter::write_to_vec(&doc).unwrap()).unwrap();
}
