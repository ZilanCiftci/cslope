//! Measures acadrust on DWG files (the evaluation of the DWG import):
//!
//!   cargo run --release --example dwg_stats -- OUT_DIR FILE.dwg...
//!
//! Per file, one JSON object on stdout (version, read time, entity counts by
//! type in model space and in the whole file, what `read_dwg` returns) and
//! OUT_DIR/<n>.points.json with reference points by entity type, to compare
//! coordinates with a DXF conversion of the same file.

use std::collections::BTreeMap;
use std::io::Cursor;
use std::time::Instant;

use acadrust::entities::EntityType;
use acadrust::io::dwg::DwgReadOptions;
use acadrust::DwgReader;
use serde_json::json;

fn points(e: &EntityType) -> Vec<[f64; 2]> {
    match e {
        EntityType::Line(l) => vec![[l.start.x, l.start.y], [l.end.x, l.end.y]],
        EntityType::LwPolyline(p) => p
            .vertices
            .iter()
            .map(|v| [v.location.x, v.location.y])
            .collect(),
        EntityType::Polyline2D(p) => p
            .vertices
            .iter()
            .map(|v| [v.location.x, v.location.y])
            .collect(),
        EntityType::Polyline(p) => p
            .vertices
            .iter()
            .map(|v| [v.location.x, v.location.y])
            .collect(),
        EntityType::Polyline3D(p) => p
            .vertices
            .iter()
            .map(|v| [v.position.x, v.position.y])
            .collect(),
        EntityType::Circle(c) => vec![[c.center.x, c.center.y]],
        EntityType::Arc(a) => vec![[a.center.x, a.center.y]],
        EntityType::Ellipse(a) => vec![[a.center.x, a.center.y]],
        EntityType::Point(p) => vec![[p.location.x, p.location.y]],
        EntityType::Text(t) => vec![[t.insertion_point.x, t.insertion_point.y]],
        EntityType::MText(t) => vec![[t.insertion_point.x, t.insertion_point.y]],
        EntityType::Insert(i) => vec![[i.insert_point.x, i.insert_point.y]],
        EntityType::Spline(s) => s.control_points.iter().map(|v| [v.x, v.y]).collect(),
        _ => vec![],
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out_dir = &args[0];
    for (n, file) in args[1..].iter().enumerate() {
        let bytes = std::fs::read(file).expect("read file");
        let t0 = Instant::now();
        let strict = std::panic::catch_unwind(|| {
            DwgReader::from_stream_with_options(Cursor::new(&bytes[..]), DwgReadOptions::default())
                .read_with_stats()
        });
        let strict_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (mode, outcome) = match strict {
            Ok(Ok(o)) => ("strict", Ok(o)),
            Ok(Err(e)) => {
                let fs = DwgReader::from_stream_with_options(
                    Cursor::new(&bytes[..]),
                    DwgReadOptions::failsafe(),
                )
                .read_with_stats();
                (
                    "failsafe",
                    fs.map_err(|f| format!("strict: {e}; failsafe: {f}")),
                )
            }
            Err(_) => ("panic", Err("panic".to_string())),
        };
        let t1 = Instant::now();
        let wrapper = cslope_dwg::read_dwg(&bytes);
        let wrapper_ms = t1.elapsed().as_secs_f64() * 1000.0;
        let mut rec = json!({ "file": file, "bytes": bytes.len(), "mode": mode, "strictMs": strict_ms, "wrapperMs": wrapper_ms });
        match outcome {
            Err(e) => rec["error"] = json!(e),
            Ok(o) => {
                let doc = &o.document;
                let mut model: BTreeMap<String, usize> = BTreeMap::new();
                let mut pts: BTreeMap<String, Vec<[f64; 2]>> = BTreeMap::new();
                for e in doc.model_space_entities() {
                    let t = e.as_entity().entity_type().to_string();
                    *model.entry(t.clone()).or_default() += 1;
                    pts.entry(t).or_default().extend(points(e));
                }
                let mut all: BTreeMap<String, usize> = BTreeMap::new();
                for e in doc.entities() {
                    *all.entry(e.as_entity().entity_type().to_string())
                        .or_default() += 1;
                }
                let paper: usize = doc
                    .block_records
                    .names()
                    .filter(|n| n.to_ascii_lowercase().starts_with("*paper_space"))
                    .map(|n| doc.entities_in_block(n).count())
                    .sum();
                rec["version"] = json!(doc.version.as_str());
                rec["insunits"] = json!(doc.header.insertion_units);
                rec["model"] = json!(model);
                rec["all"] = json!(all);
                rec["paper"] = json!(paper);
                rec["layers"] = json!(doc.layers.len());
                rec["diagnostics"] = json!(o.stats.diagnostics.len());
                rec["diagnosticCodes"] = json!(o
                    .stats
                    .diagnostics
                    .iter()
                    .take(5)
                    .map(|d| format!("{}: {}", d.code, d.message))
                    .collect::<Vec<_>>());
                let path = format!("{out_dir}/{n}.points.json");
                std::fs::write(&path, serde_json::to_string(&pts).unwrap()).unwrap();
                rec["points"] = json!(path);
            }
        }
        match wrapper {
            Ok(d) => {
                rec["wrapper"] = json!({ "polylines": d.polylines.len(), "segments": d.segments.len(), "skipped": d.skipped, "bulged": d.bulged_polylines, "warnings": d.warnings.len() })
            }
            Err(e) => rec["wrapperError"] = json!(e),
        }
        println!("{rec}");
    }
}
