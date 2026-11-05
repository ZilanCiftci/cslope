//! DWG reading for the cSlope desktop app (prototype).
//!
//! [`read_dwg`] reads a DWG drawing with acadrust and returns the neutral
//! drawing structure the app's DXF importer builds from a DXF file
//! (`RawDrawing` in packages/desktop/src/utils/dxf.ts): the model space's
//! polylines and lines with their layers, the entity types that are not
//! read, and `$INSUNITS`. Unit scaling, chaining of lines and the choice of
//! the outline are the app's, shared with the DXF import.
//!
//! The WebAssembly export is `readDwg(bytes) -> string` (JSON). A malformed
//! file is an error, never a crash: natively a panic in acadrust is caught
//! and returned as an error; in WebAssembly (panic = abort) it traps, and
//! the app's loader reports it and discards the instance.

use std::collections::BTreeMap;
use std::io::Cursor;

use acadrust::entities::EntityType;
use acadrust::io::dwg::DwgReadOptions;
use acadrust::{CadDocument, DwgReader};
use serde::Serialize;

pub mod vectors;
pub use vectors::{read_dwg_vectors, read_dwg_vectors_json, VectorDrawing};

/// The most decompressed data one read may allocate (acadrust charges each
/// section's declared size against it before allocating), so that a
/// malformed or hostile file fails instead of exhausting memory.
const MAX_DECOMPRESSED_BYTES: usize = 1 << 30;

/// A point in drawing units (x, y).
pub type Pt = [f64; 2];

/// A polyline of the model space.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Polyline {
    pub layer: String,
    pub points: Vec<Pt>,
    pub closed: bool,
}

/// A LINE of the model space (the app chains lines into polylines).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Segment {
    pub layer: String,
    pub a: Pt,
    pub b: Pt,
}

/// What [`read_dwg`] returns (serialized with camelCase keys).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drawing {
    /// The file's version, e.g. "AC1032".
    pub version: String,
    /// `$INSUNITS` (0 unitless, 4 mm, 6 m, …).
    pub insunits: i16,
    pub polylines: Vec<Polyline>,
    pub segments: Vec<Segment>,
    /// Model-space entities that are not read, by DXF type name.
    pub skipped: BTreeMap<String, usize>,
    /// Polylines whose arc segments (bulges) were read as straight lines.
    pub bulged_polylines: usize,
    /// Entities in paper space (layouts), which are not read.
    pub paper_space_entities: usize,
    /// The layer names of the drawing.
    pub layers: Vec<String>,
    /// Problems acadrust recovered from (the file was read in failsafe mode).
    pub warnings: Vec<String>,
}

/// Reads a DWG file's bytes. Never panics: a panic in the reader becomes an
/// error (natively; see the module comment for WebAssembly).
pub fn read_dwg(bytes: &[u8]) -> Result<Drawing, String> {
    match std::panic::catch_unwind(|| read_dwg_inner(bytes)) {
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

fn read_dwg_inner(bytes: &[u8]) -> Result<Drawing, String> {
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
    // Strict first; a file with errors is read again in failsafe mode, which
    // keeps what it can and says what it skipped.
    let strict = match read(false) {
        Ok(outcome) => return Ok(convert(&outcome.document, Vec::new())),
        Err(e) => e.to_string(),
    };
    let unreadable = || {
        if strict.contains("Unsupported CAD version") {
            format!("This DWG version is not supported: only drawings from AutoCAD Release 11 (1990) or later can be read ({strict}).")
        } else {
            format!("The DWG file could not be read: {strict}")
        }
    };
    let outcome = read(true).map_err(|_| unreadable())?;
    // Failsafe mode returns an empty document when even the file header is
    // unreadable: that is a failure, not an empty drawing.
    if outcome.document.model_space_entities().next().is_none() {
        return Err(unreadable());
    }
    let mut warnings = vec![format!(
        "The file has errors and was read in recovery mode ({strict})."
    )];
    warnings.extend(
        outcome
            .stats
            .diagnostics
            .iter()
            .take(20)
            .map(|d| format!("{}: {}", d.code, d.message)),
    );
    Ok(convert(&outcome.document, warnings))
}

/// The drawing structure of a document read by acadrust.
pub fn convert(doc: &CadDocument, warnings: Vec<String>) -> Drawing {
    let mut out = Drawing {
        version: doc.version.as_str().to_string(),
        insunits: doc.header.insertion_units,
        layers: doc.layers.names().map(str::to_string).collect(),
        warnings,
        ..Drawing::default()
    };
    for entity in doc.model_space_entities() {
        add_entity(&mut out, entity);
    }
    out.paper_space_entities = doc
        .block_records
        .names()
        .filter(|n| n.to_ascii_lowercase().starts_with("*paper_space"))
        .map(|n| doc.entities_in_block(n).count())
        .sum();
    out
}

/// A point of an entity's object coordinate system in world coordinates,
/// for the common cases: the default normal (0, 0, 1), and (0, 0, -1) of a
/// mirrored entity, whose x runs the other way (the arbitrary axis
/// algorithm). Other normals (entities drawn in a tilted plane) keep their
/// coordinates.
fn ocs_to_wcs(x: f64, y: f64, normal_z: f64) -> Pt {
    if normal_z < -0.999_999 {
        [-x, y]
    } else {
        [x, y]
    }
}

fn add_entity(out: &mut Drawing, entity: &EntityType) {
    let layer = entity.common().layer.clone();
    match entity {
        EntityType::Line(line) => out.segments.push(Segment {
            layer,
            a: [line.start.x, line.start.y],
            b: [line.end.x, line.end.y],
        }),
        EntityType::LwPolyline(p) => {
            if p.vertices.iter().any(|v| v.bulge != 0.0) {
                out.bulged_polylines += 1;
            }
            out.polylines.push(Polyline {
                layer,
                points: p
                    .vertices
                    .iter()
                    .map(|v| ocs_to_wcs(v.location.x, v.location.y, p.normal.z))
                    .collect(),
                closed: p.is_closed,
            });
        }
        EntityType::Polyline2D(p) => {
            if p.vertices.iter().any(|v| v.bulge != 0.0) {
                out.bulged_polylines += 1;
            }
            out.polylines.push(Polyline {
                layer,
                points: p
                    .vertices
                    .iter()
                    .map(|v| ocs_to_wcs(v.location.x, v.location.y, p.normal.z))
                    .collect(),
                closed: p.is_closed(),
            });
        }
        // 3D polylines: their projection on the x-y plane, as in the DXF import.
        EntityType::Polyline(p) => out.polylines.push(Polyline {
            layer,
            points: p
                .vertices
                .iter()
                .map(|v| [v.location.x, v.location.y])
                .collect(),
            closed: p.is_closed(),
        }),
        EntityType::Polyline3D(p) => out.polylines.push(Polyline {
            layer,
            points: p
                .vertices
                .iter()
                .map(|v| [v.position.x, v.position.y])
                .collect(),
            closed: p.is_closed(),
        }),
        other => {
            // DXF's names: acadrust names dimensions by kind (DIMENSION_LINEAR, …).
            let name = match other.as_entity().entity_type() {
                n if n.starts_with("DIMENSION") => "DIMENSION",
                n => n,
            };
            *out.skipped.entry(name.to_string()).or_insert(0) += 1;
        }
    }
}

/// The drawing as JSON (camelCase keys).
pub fn read_dwg_json(bytes: &[u8]) -> Result<String, String> {
    let drawing = read_dwg(bytes)?;
    serde_json::to_string(&drawing).map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = console, js_name = error)]
        fn console_error(message: &str);
    }

    /// The panic hook: the message is the only trace of a trap.
    #[wasm_bindgen(start)]
    fn start() {
        std::panic::set_hook(Box::new(|info| {
            console_error(&format!("cSlope DWG reader panicked: {info}"))
        }));
    }

    /// Reads a DWG file: the drawing as JSON, or an error with the reason.
    #[wasm_bindgen(js_name = readDwg)]
    pub fn read_dwg(bytes: &[u8]) -> Result<String, JsError> {
        super::read_dwg_json(bytes).map_err(|e| JsError::new(&e))
    }

    /// Reads a DWG file's line work (an underlay): JSON, or an error.
    #[wasm_bindgen(js_name = readDwgVectors)]
    pub fn read_dwg_vectors(bytes: &[u8]) -> Result<String, JsError> {
        super::read_dwg_vectors_json(bytes).map_err(|e| JsError::new(&e))
    }
}
