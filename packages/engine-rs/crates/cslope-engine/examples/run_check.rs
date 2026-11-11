//! Runs the verification analyses of one problem natively (a debugging
//! aid): `cargo run --release --example run_check -- V050b [filter]`, the
//! filter a substring of the check's options. With `--all` instead of a
//! problem, every check runs (one analysis per thread) and is printed as a
//! TSV line: id, label, method, slices, published, publishedBy, tolerance,
//! F; for comparing engine settings check by check.
use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::slope::AnalysisOptionsPatch;
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::SlopeDefinition;
use serde_json::Value;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

fn analyse(c: &Value, k: &Value) -> (Result<Option<f64>, String>, usize) {
    let def: SlopeDefinition = serde_json::from_value(c["definition"].clone()).unwrap();
    let mut slope = build_slope(&to_canonical_slope_definition(&def, None).unwrap()).unwrap();
    let patch: AnalysisOptionsPatch = serde_json::from_value(k["options"].clone()).unwrap();
    slope.update_analysis_options(&patch).unwrap();
    let fos = analyse_slope(&mut slope, &mut RunCtx::default()).map_err(|e| e.message);
    (fos, slope.search().len())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let id = &args[1];
    let filter = args.get(2).cloned().unwrap_or_default();
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../golden/verification.json"
    );
    let mut golden: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases: Vec<Value> = serde_json::from_value(golden["cases"].take()).unwrap();
    if id == "--all" {
        let jobs: Vec<(&Value, &Value)> = cases
            .iter()
            .flat_map(|c| c["checks"].as_array().unwrap().iter().map(move |k| (c, k)))
            .collect();
        let next = AtomicUsize::new(0);
        let out = Mutex::new(Vec::new());
        let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
        std::thread::scope(|scope| {
            for _ in 0..threads {
                scope.spawn(|| loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(&(c, k)) = jobs.get(i) else { break };
                    let (fos, _) = analyse(c, k);
                    let f = match fos {
                        Ok(Some(f)) => f.to_string(),
                        Ok(None) => "NaN".to_string(),
                        Err(e) => format!("error: {e}"),
                    };
                    let line = format!(
                        "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                        c["id"].as_str().unwrap(),
                        k["label"].as_str().unwrap(),
                        k["method"].as_str().unwrap(),
                        k["options"]["slices"],
                        k["published"],
                        k["publishedBy"].as_str().unwrap(),
                        k["tolerance"],
                        f
                    );
                    out.lock().unwrap().push((i, line));
                });
            }
        });
        let mut lines = out.into_inner().unwrap();
        lines.sort_by_key(|(i, _)| *i);
        println!("id\tlabel\tmethod\tslices\tpublished\tpublishedBy\ttolerance\tfos");
        for (_, line) in lines {
            println!("{line}");
        }
        return;
    }
    if id == "--slices" {
        // A job file {definition, options}: the analysis's F and the critical
        // surface's slices, as JSON, for comparing slice by slice.
        let job: Value = serde_json::from_str(&std::fs::read_to_string(&filter).unwrap()).unwrap();
        let def: SlopeDefinition = serde_json::from_value(job["definition"].clone()).unwrap();
        let mut slope = build_slope(&to_canonical_slope_definition(&def, None).unwrap()).unwrap();
        let patch: AnalysisOptionsPatch = serde_json::from_value(job["options"].clone()).unwrap();
        slope.update_analysis_options(&patch).unwrap();
        let fos = analyse_slope(&mut slope, &mut RunCtx::default());
        let search = slope.search();
        let plane = search.iter().find(|p| p.fos.is_some());
        let slices: Vec<Value> = plane
            .and_then(|p| p.slices.as_ref())
            .map(|ss| {
                ss.iter()
                    .map(|s| {
                        serde_json::json!({
                            "x": s.x, "xl": s.x_left, "xr": s.x_right, "yt": s.y_top,
                            "y0t": s.y0_top, "y1t": s.y1_top,
                            "yb": s.y_bottom, "y0b": s.y0_bottom, "y1b": s.y1_bottom,
                            "alpha": s.alpha, "bl": s.base_length, "W": s.weight,
                            "dx": s.dx, "R": s.r, "u": s.u, "c": s.cohesion,
                            "cu": s.cohesion_undrained, "phi": s.phi, "udl": s.udl, "ll": s.ll,
                            "wl": s.water_load, "h": s.h_force, "em": s.extra_moment,
                            "combined": s.is_combined, "suction": s.suction_strength,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        println!(
            "{}",
            serde_json::json!({
                "fos": fos.as_ref().ok().copied().flatten(),
                "error": fos.as_ref().err().map(|e| e.message.clone()),
                "planes": search.len(),
                "slices": slices,
            })
        );
        return;
    }
    let c = cases
        .iter()
        .find(|c| c["id"] == id.as_str())
        .expect("the problem");
    for k in c["checks"].as_array().unwrap() {
        if !k["options"].to_string().contains(&filter) {
            continue;
        }
        let t0 = Instant::now();
        let (fos, planes) = analyse(c, k);
        println!(
            "{id} {}: {:?} (published {}, tolerance {}) {} planes, {:.0} ms",
            k["label"],
            fos,
            k["published"],
            k["tolerance"],
            planes,
            t0.elapsed().as_secs_f64() * 1000.0
        );
    }
}
