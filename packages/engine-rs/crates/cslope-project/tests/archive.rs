//! The `.cslp` reader and writer (feature `native`) on files the app wrote
//! (the desktop app's project fixtures and the Python tests' app-saved
//! project): opened and saved again, every JSON entry is the app's but the
//! manifest's `modified`, `appVersion` and `generator`; the results stay
//! (their input is unchanged), and the save policy drops a result, and the
//! thumbnail, once the model's input changes. (A text size the fixtures
//! hold in annotation px, `fontSize`, is written as `fontSizePx`, px of the
//! F label's unit: docs/file-format.md.)
#![cfg(feature = "native")]

use cslope_project::archive::{read_project, write_project, Writer};
use cslope_project::canonical::canonical_json;
use cslope_project::project::{EngineInfo, ProjectReadOptions, SavedResult};
use cslope_project::{input_hash, ModelEntry};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::path::PathBuf;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn fixture(rel: &str) -> Option<Vec<u8>> {
    std::fs::read(repo().join(rel)).ok()
}

const FIXTURES: [&str; 3] = [
    "desktop/src/features/project/fixtures/cslp-v1.cslp",
    "desktop/src/features/project/fixtures/cslp-v1-drawings.cslp",
    "engine-rs/crates/cslope-py/tests/data/app-results.cslp",
];

fn options() -> ProjectReadOptions {
    ProjectReadOptions {
        today: "1970-01-01".into(),
    }
}

fn writer() -> Writer {
    Writer {
        app_version: "test".into(),
        generator: "cslope test".into(),
        modified: Some("2026-11-07T12:00:00.000Z".into()),
    }
}

/// A text size in annotation px (the first form, `fontSize`) as px of the
/// F label's unit, as docs/file-format.md gives it: x (210 / 600 mm) /
/// (10 / 12 pt x 0.3528 mm), to 6 decimals.
fn text_px(annotation_px: f64) -> f64 {
    let factor = (210.0 / 600.0) / ((10.0 / 12.0) * 0.3528);
    cslope_engine::js::math::round(annotation_px * factor * 1e6) / 1e6
}

/// A model.json as the app saved it, with its annotations' and plot
/// styles' text sizes of the first form (`fontSize`) in px (`fontSizePx`),
/// as it is saved now: canonical, as the app writes it. Whether any was.
fn with_text_px(app: &[u8]) -> (Vec<u8>, bool) {
    let mut v = as_json(app);
    let mut converted = false;
    let mut convert = |o: &mut serde_json::Map<String, Value>| {
        if o.contains_key("fontSizePx") {
            return;
        }
        if let Some(px) = o.remove("fontSize").and_then(|s| s.as_f64()) {
            o.insert("fontSizePx".into(), json!(text_px(px)));
            converted = true;
        }
    };
    if let Some(annos) = v
        .pointer_mut("/resultViewSettings/annotations")
        .and_then(Value::as_array_mut)
    {
        for a in annos.iter_mut().filter_map(Value::as_object_mut) {
            if a.get("type").and_then(Value::as_str) == Some("reference") {
                continue;
            }
            convert(a);
            if let Some(style) = a.get_mut("plotStyle").and_then(Value::as_object_mut) {
                convert(style);
            }
        }
    }
    (canonical_json(&v).into_bytes(), converted)
}

/// Every entry of an archive: name, bytes and whether it is deflated.
fn entries(bytes: &[u8]) -> Vec<(String, Vec<u8>, bool)> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut f = zip.by_index(i).unwrap();
            let mut data = Vec::new();
            f.read_to_end(&mut data).unwrap();
            let deflated = f.compression() == zip::CompressionMethod::Deflated;
            (f.name().unwrap().into_owned(), data, deflated)
        })
        .collect()
}

fn as_json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap()
}

#[test]
fn app_files_save_to_the_same_entries() {
    let mut seen = 0;
    let mut text_sizes = 0;
    for rel in FIXTURES {
        let Some(bytes) = fixture(rel) else { continue };
        seen += 1;
        let mut project =
            read_project(bytes.clone(), &options()).unwrap_or_else(|e| panic!("{rel}: {e}"));
        let (out, report) = write_project(&mut project, &writer()).unwrap();
        assert!(report.dropped_results.is_empty(), "{rel}: {report:?}");
        let before = entries(&bytes);
        let after = entries(&out);
        let names =
            |e: &[(String, Vec<u8>, bool)]| e.iter().map(|(n, ..)| n.clone()).collect::<Vec<_>>();
        assert_eq!(
            names(&after),
            names(&before),
            "{rel}: the entries and their order"
        );
        for ((name, a, deflated), (_, b, was_deflated)) in after.iter().zip(&before) {
            assert_eq!(deflated, was_deflated, "{rel}: {name} stored or deflated");
            if name == "manifest.json" {
                let (mut a, mut b) = (as_json(a), as_json(b));
                for k in ["modified", "appVersion", "generator"] {
                    a.as_object_mut().unwrap().remove(k);
                    b.as_object_mut().unwrap().remove(k);
                }
                assert_eq!(a, b, "{rel}: manifest.json");
                continue;
            }
            // backgrounds of the first form are written in the current one
            let legacy = name.ends_with("backgrounds.json")
                && String::from_utf8_lossy(b).contains("originX");
            if legacy {
                continue;
            }
            // text sizes of the first form are written in px
            let converted = name.ends_with("model.json").then(|| with_text_px(b));
            let b = match &converted {
                Some((now, true)) => {
                    text_sizes += 1;
                    now
                }
                _ => b,
            };
            assert!(
                a == b,
                "{rel}: {name} differs:\n--- written\n{}\n--- app\n{}",
                String::from_utf8_lossy(a),
                String::from_utf8_lossy(b)
            );
        }
        // and what was written reads back as the same project
        let again = read_project(out.clone(), &options()).unwrap();
        assert_eq!(again, project, "{rel}: read back");
    }
    assert!(seen >= 2, "the fixtures are not in this checkout");
    // (the fixtures were saved with text sizes in annotation px)
    assert!(text_sizes >= 2, "no text size of the first form converted");
}

#[test]
fn a_result_whose_input_changed_is_dropped_with_the_thumbnail() {
    let bytes = fixture(FIXTURES[0]).expect("fixture");
    let mut project = read_project(bytes, &options()).unwrap();
    assert!(project.thumbnail.is_some());
    let m = &mut project.models[0];
    assert!(m.result.is_some());
    // the unit weight of the first material, as one would edit it in Python
    let mut model = m.model.to_json();
    let unit_weight = model["materials"][0]["model"]["unitWeight"]
        .as_f64()
        .unwrap();
    model["materials"][0]["model"]["unitWeight"] = json!(unit_weight + 1.0);
    m.model = ModelEntry::from_json(model).unwrap();
    let (out, report) = write_project(&mut project, &writer()).unwrap();
    assert_eq!(report.dropped_results, vec!["model-1".to_owned()]);
    // (the thumbnail shows the active model, model-2, whose result stays)
    assert!(!report.dropped_thumbnail);
    let names: Vec<String> = entries(&out).into_iter().map(|(n, ..)| n).collect();
    assert!(
        !names.contains(&"models/model-1/result.json".to_owned()),
        "{names:?}"
    );
    assert!(names.contains(&"models/model-2/result.json".to_owned()));
    assert!(names.contains(&"thumbnail.png".to_owned()));
    // the active model changed: its result and the thumbnail go
    let mut model = project.models[1].model.to_json();
    model["materials"][0]["model"]["unitWeight"] = json!(30);
    project.models[1].model = ModelEntry::from_json(model).unwrap();
    let (out, report) = write_project(&mut project, &writer()).unwrap();
    assert_eq!(report.dropped_results, vec!["model-2".to_owned()]);
    assert!(report.dropped_thumbnail);
    assert!(!entries(&out)
        .into_iter()
        .any(|(n, ..)| n == "thumbnail.png"));
}

/// The archive with the uncompressed size its central directory declares
/// for `name` set to `size`.
fn declare_size(mut bytes: Vec<u8>, name: &str, size: u32) -> Vec<u8> {
    let mut at = 0;
    while let Some(p) = bytes[at..].windows(4).position(|w| w == b"PK\x01\x02") {
        let p = at + p;
        let len = u16::from_le_bytes([bytes[p + 28], bytes[p + 29]]) as usize;
        if &bytes[p + 46..p + 46 + len] == name.as_bytes() {
            bytes[p + 24..p + 28].copy_from_slice(&size.to_le_bytes());
            return bytes;
        }
        at = p + 4;
    }
    panic!("no entry {name}");
}

#[test]
fn archives_that_declare_too_much_are_refused_before_reading() {
    use std::io::Write;
    // six deflated attachments declaring 90 MB each: 540 MB together
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let deflated = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in [("manifest.json", "{}"), ("project.json", "{}")] {
        zip.start_file(name, deflated).unwrap();
        zip.write_all(data.as_bytes()).unwrap();
    }
    for i in 0..6 {
        zip.start_file(format!("assets/a{i}.png"), deflated)
            .unwrap();
        zip.write_all(&[0u8; 64]).unwrap();
    }
    let mut bytes = zip.finish().unwrap().into_inner();
    for i in 0..6 {
        bytes = declare_size(bytes, &format!("assets/a{i}.png"), 90 * 1024 * 1024);
    }
    let err = read_project(bytes, &options()).unwrap_err();
    assert!(err.contains("more than 500 MB"), "{err}");
    // and one entry above 100 MB
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file("manifest.json", deflated).unwrap();
    zip.write_all(b"{}").unwrap();
    let bytes = declare_size(
        zip.finish().unwrap().into_inner(),
        "manifest.json",
        150 * 1024 * 1024,
    );
    let err = read_project(bytes, &options()).unwrap_err();
    assert!(err.contains("too large (150 MB unpacked"), "{err}");
}

#[test]
fn a_model_run_again_keeps_its_result() {
    let bytes = fixture(FIXTURES[0]).expect("fixture");
    let mut project = read_project(bytes, &options()).unwrap();
    let mut model = project.models[0].model.to_json();
    model["name"] = json!("Renamed");
    model["materials"][0]["model"]["unitWeight"] = json!(21);
    let model = ModelEntry::from_json(model).unwrap();
    let result = project.models[0].result.clone().unwrap().result.unwrap();
    project.models[0].model = model.clone();
    let engine = EngineInfo {
        version: "0.1.0".into(),
        source_hash: String::new(),
    };
    project
        .set_result(
            "model-1",
            SavedResult::done(&model, result, engine).unwrap(),
        )
        .unwrap();
    let (out, report) = write_project(&mut project, &writer()).unwrap();
    assert!(report.dropped_results.is_empty());
    let saved = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/result.json")
        .map(|(_, b, _)| as_json(&b))
        .unwrap();
    assert_eq!(saved["inputHash"], json!(input_hash(&model).unwrap()));
    assert_eq!(
        saved["engine"],
        json!({ "version": "0.1.0", "sourceHash": "" })
    );
}

/// An archive of the fixture with one JSON entry changed.
fn edited(rel: &str, name: &str, edit: &dyn Fn(&mut Value)) -> Vec<u8> {
    use std::io::Write;
    let bytes = fixture(rel).expect("fixture");
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (n, data, _) in entries(&bytes) {
        let data = if n == name {
            let mut v = as_json(&data);
            edit(&mut v);
            serde_json::to_vec(&v).unwrap()
        } else {
            data
        };
        zip.start_file(n.as_str(), zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&data).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

#[test]
fn unknown_members_and_entries_are_refused_with_their_path() {
    let rel = FIXTURES[0];
    let cases: Vec<(Vec<u8>, &str)> = vec![
        (
            edited(rel, "models/model-1/model.json", &|v| {
                v["udls"][0]["foo"] = json!(1);
            }),
            "models/model-1/model.json: unknown member udls[0].foo",
        ),
        (
            edited(rel, "manifest.json", &|v| v["signature"] = json!("x")),
            "unknown field `signature`",
        ),
        (
            edited(rel, "project.json", &|v| v["settings"]["grid"] = json!(1)),
            "unknown field `grid`",
        ),
        (
            edited(rel, "assets/index.json", &|v| v[0]["license"] = json!("x")),
            "unknown field `license`",
        ),
    ];
    for (bytes, expected) in cases {
        let err = read_project(bytes, &options()).expect_err(expected);
        assert!(err.contains(expected), "{err} (expected {expected})");
    }
}

#[test]
fn a_result_this_reader_cannot_read_is_left_out_with_a_warning() {
    // (a newer cSlope may add a member to a result: the model still opens)
    let rel = FIXTURES[0];
    for (name, edit, expected) in [
        (
            "models/model-2/result.json",
            &(|v: &mut Value| v["note"] = json!("x")) as &dyn Fn(&mut Value),
            "unknown field `note`",
        ),
        (
            "models/model-1/result.json",
            &|v: &mut Value| v["result"]["glow"] = json!(1),
            "unknown member result.glow",
        ),
    ] {
        let project = read_project(edited(rel, name, edit), &options()).unwrap();
        let id = name.split('/').nth(1).unwrap();
        // (model-2 is the active model: its result shows in the thumbnail)
        assert_eq!(project.thumbnail.is_none(), id == "model-2");
        assert!(project.model(id).unwrap().result.is_none());
        assert_eq!(project.warnings.len(), 1);
        assert!(
            project.warnings[0].contains(id) && project.warnings[0].contains(expected),
            "{:?}",
            project.warnings
        );
    }
}

#[test]
fn older_and_newer_files_are_refused_with_a_message() {
    let rel = FIXTURES[0];
    let older = edited(rel, "project.json", &|v| v["version"] = json!(2));
    let err = read_project(older, &options()).unwrap_err();
    assert!(
        err.contains("earlier cSlope") && err.contains("open it in the cSlope app and save it"),
        "{err}"
    );
    let newer = edited(rel, "project.json", &|v| v["version"] = json!(4));
    assert!(read_project(newer, &options())
        .unwrap_err()
        .contains("newer cSlope"));
    let newer_layout = edited(rel, "manifest.json", &|v| {
        v["formatVersion"] = json!(2);
        v["minReaderVersion"] = json!(2);
    });
    let err = read_project(newer_layout, &options()).unwrap_err();
    assert!(err.contains("newer cSlope (cSlope 0.1.0-beta.2)"), "{err}");
    for (rel, what) in [
        (
            "desktop/src/features/project/fixtures/cslp-3file.cslp",
            "first .cslp layout",
        ),
        (
            "desktop/src/features/project/fixtures/legacy-json-v3.json",
            "a JSON project",
        ),
    ] {
        if let Some(bytes) = fixture(rel) {
            let err = read_project(bytes, &options()).unwrap_err();
            assert!(
                err.contains(what) && err.contains("open it in the cSlope app"),
                "{rel}: {err}"
            );
        }
    }
}

#[test]
fn the_document_form_round_trips() {
    // (the Python binding's form: JSON and the attachments' bytes apart)
    for rel in FIXTURES {
        let Some(bytes) = fixture(rel) else { continue };
        let project = read_project(bytes, &options()).unwrap();
        let data: BTreeMap<String, Vec<u8>> = project
            .assets
            .iter()
            .map(|a| (a.id.clone(), a.data.clone()))
            .collect();
        let back = cslope_project::project::Project::from_document(
            &project.to_document(),
            data,
            project.thumbnail.clone(),
        )
        .unwrap();
        assert_eq!(back, project, "{rel}");
    }
}

#[test]
fn a_plot_style_reads_and_writes_back() {
    // (a slice plot styled in Properties › Plot, as the app writes it; bad
    // members, defaults and a style on another annotation are dropped)
    let rel = FIXTURES[0];
    let style = json!({
        "color": "#cc0000", "line": "dashed", "lineWidthPx": 5, "marker": "plus",
        "markerSizePx": 30, "markerOpen": true, "showTitle": false, "showAxisTitle": false,
        "showGrid": false, "showBorder": false, "fontSizePx": 14,
        "xMin": 1, "xMax": 9.5, "yMin": -5, "yMax": 100
    });
    let bytes = edited(rel, "models/model-1/model.json", &|v| {
        v["resultViewSettings"]["annotations"] = json!([
            { "id": "p", "type": "plot", "x": 0.3, "y": 0.3, "fontSize": 12.0, "plotAxisX": "x", "plotAxisY": "porePressure", "plotStyle": style.clone() },
            { "id": "q", "type": "plot", "x": 0.6, "y": 0.3, "plotStyle": { "color": "red", "line": "solid", "marker": "circle", "lineWidthPx": 90.0, "showGrid": true } },
            { "id": "t", "type": "text", "x": 0.1, "y": 0.1, "text": "T", "plotStyle": { "color": "#cc0000" } },
            { "id": "o", "type": "plot", "x": 0.1, "y": 0.6, "fontSize": 12.0, "plotAxisX": "slice", "plotAxisY": "shearStrength" }
        ]);
    });
    let mut project = read_project(bytes, &options()).unwrap();
    let (out, _) = write_project(&mut project, &writer()).unwrap();
    let model = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/model.json")
        .map(|(_, data, _)| as_json(&data))
        .unwrap();
    let annos = model["resultViewSettings"]["annotations"]
        .as_array()
        .unwrap();
    assert_eq!(annos[0]["plotStyle"], style);
    assert!(annos[1].get("plotStyle").is_none());
    assert!(annos[2].get("plotStyle").is_none());
    // a plot saved before the style is written as it was, its (unused)
    // text size in px of the F label's unit
    assert_eq!(
        annos[3],
        json!({ "id": "o", "type": "plot", "x": 0.1, "y": 0.6, "fontSizePx": 14.285714, "plotAxisX": "slice", "plotAxisY": "shearStrength" })
    );
    // written back, it reads as the same project, and writes the same again
    let mut again = read_project(out.clone(), &options()).unwrap();
    assert_eq!(again, project);
    let (out2, _) = write_project(&mut again, &writer()).unwrap();
    assert_eq!(entries(&out2), entries(&out));
}

#[test]
fn text_sizes_in_annotation_px_read_as_px_of_the_f_label_and_write_once() {
    // (`fontSize` in annotation px, the paper's shorter side / 600, as files
    // saved before the sizes were fixed: read as px of the F label's unit,
    // x (210 / 600) / (10 / 12 x 0.3528), the same size on A4, as the app
    // reads them; a px member comes first; only `fontSizePx` is written, so
    // a file saved again is not converted twice)
    let bytes = edited(FIXTURES[0], "models/model-1/model.json", &|v| {
        v["resultViewSettings"]["annotations"] = json!([
            { "id": "t", "type": "text", "x": 0.1, "y": 0.1, "text": "T", "fontSize": 24.0 },
            { "id": "m", "type": "material-table", "x": 0.9, "y": 0.1, "fontSize": 6.0 },
            { "id": "u", "type": "text", "x": 0.1, "y": 0.2, "text": "U", "fontSizePx": 17.0, "fontSize": 40.0 },
            { "id": "w", "type": "text", "x": 0.1, "y": 0.3, "text": "W", "fontSizePx": "big", "fontSize": 12.0 },
            { "id": "p", "type": "plot", "x": 0.3, "y": 0.6, "plotStyle": { "fontSize": 9.0 } },
            { "id": "q", "type": "plot", "x": 0.6, "y": 0.6, "plotStyle": { "fontSizePx": 11.0, "fontSize": 30.0 } },
            { "id": "r", "type": "plot", "x": 0.6, "y": 0.3, "plotStyle": { "fontSizePx": 60.0, "fontSize": 12.0 } }
        ]);
    });
    let mut project = read_project(bytes, &options()).unwrap();
    let (out, _) = write_project(&mut project, &writer()).unwrap();
    let model = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/model.json")
        .map(|(_, data, _)| as_json(&data))
        .unwrap();
    let annos = model["resultViewSettings"]["annotations"]
        .as_array()
        .unwrap();
    assert_eq!(
        annos[0],
        json!({ "id": "t", "type": "text", "x": 0.1, "y": 0.1, "text": "T", "fontSizePx": 28.571429 })
    );
    assert_eq!(
        annos[1],
        json!({ "id": "m", "type": "material-table", "x": 0.9, "y": 0.1, "fontSizePx": 7.142857 })
    );
    assert_eq!(annos[2]["fontSizePx"], json!(17));
    assert!(annos[3].get("fontSizePx").is_none() && annos[3].get("fontSize").is_none());
    assert_eq!(annos[4]["plotStyle"], json!({ "fontSizePx": 10.714286 }));
    assert_eq!(annos[5]["plotStyle"], json!({ "fontSizePx": 11 }));
    assert!(annos[6].get("plotStyle").is_none());
    let mut again = read_project(out.clone(), &options()).unwrap();
    assert_eq!(again, project);
    let (out2, _) = write_project(&mut again, &writer()).unwrap();
    assert_eq!(entries(&out2), entries(&out));
}

#[test]
fn a_plot_style_of_a_development_build_in_mm_reads_as_px() {
    // (`lineWidth` and `markerSize` in mm, the sizes' first form: read as
    // px, 1 px = 0.1 mm, as the app reads them; a px member comes first)
    let bytes = edited(FIXTURES[0], "models/model-1/model.json", &|v| {
        v["resultViewSettings"]["annotations"] = json!([
            { "id": "p", "type": "plot", "x": 0.3, "y": 0.3, "plotStyle": { "lineWidth": 0.35, "markerSize": 1.26 } },
            { "id": "q", "type": "plot", "x": 0.6, "y": 0.3, "plotStyle": { "lineWidthPx": 2.0, "lineWidth": 0.5, "markerSize": 3.0 } }
        ]);
    });
    let mut project = read_project(bytes, &options()).unwrap();
    let (out, _) = write_project(&mut project, &writer()).unwrap();
    let model = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/model.json")
        .map(|(_, data, _)| as_json(&data))
        .unwrap();
    let annos = model["resultViewSettings"]["annotations"]
        .as_array()
        .unwrap();
    assert_eq!(
        annos[0]["plotStyle"],
        json!({ "lineWidthPx": 3.5, "markerSizePx": 12.6 })
    );
    assert_eq!(
        annos[1]["plotStyle"],
        json!({ "lineWidthPx": 2, "markerSizePx": 30 })
    );
    let mut again = read_project(out.clone(), &options()).unwrap();
    assert_eq!(again, project);
    let (out2, _) = write_project(&mut again, &writer()).unwrap();
    assert_eq!(entries(&out2), entries(&out));
}

#[test]
fn an_unknown_member_of_a_plot_style_is_refused_with_its_path() {
    let bytes = edited(FIXTURES[0], "models/model-1/model.json", &|v| {
        v["resultViewSettings"]["annotations"] = json!([
            { "id": "p", "type": "plot", "x": 0.3, "y": 0.3, "plotStyle": { "legend": true } }
        ]);
    });
    let e = read_project(bytes, &options()).unwrap_err();
    assert!(e.contains("annotations[0].plotStyle.legend"), "{e}");
}

#[test]
fn a_hidden_table_and_bar_and_surfaces_off_read_and_write_back() {
    // (a material table and a color bar turned off, every surface off and
    // an order that names the critical surface's old layer, as the app
    // writes them; a second color bar of an older file is dropped)
    let rel = FIXTURES[0];
    let bytes = edited(rel, "models/model-1/model.json", &|v| {
        let view = &mut v["resultViewSettings"];
        view["showSurfaces"] = json!(false);
        view["annotations"] = json!([
            { "id": "t", "type": "text", "x": 0.1, "y": 0.1, "text": "T" },
            { "id": "m", "type": "material-table", "x": 0.7, "y": 0.2, "hidden": true, "tableColumns": ["model"] },
            { "id": "c", "type": "color-bar", "x": 0.9, "y": 0.4, "hidden": true, "scaleMode": "fixed", "scaleMin": 1.0, "scaleMax": 2.0 },
            { "id": "c2", "type": "color-bar", "x": 0.5, "y": 0.5 },
            { "id": "t2", "type": "text", "x": 0.1, "y": 0.2, "text": "U", "hidden": true }
        ]);
        view["layerOrder"] = json!([
            "soilColor",
            "criticalSurface",
            "slices",
            "surfaces",
            "m",
            "c",
            "t"
        ]);
    });
    let mut project = read_project(bytes, &options()).unwrap();
    let (out, _) = write_project(&mut project, &writer()).unwrap();
    let model = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/model.json")
        .map(|(_, data, _)| as_json(&data))
        .unwrap();
    let view = &model["resultViewSettings"];
    assert_eq!(view["showSurfaces"], json!(false));
    assert_eq!(
        view["layerOrder"],
        json!(["soilColor", "surfaces", "slices", "m", "c", "t"])
    );
    let annos = view["annotations"].as_array().unwrap();
    let ids: Vec<&str> = annos.iter().map(|a| a["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["t", "m", "c", "t2"]);
    assert_eq!(annos[1]["hidden"], json!(true));
    assert_eq!(annos[1]["tableColumns"], json!(["model"]));
    assert_eq!(annos[2]["hidden"], json!(true));
    assert_eq!(annos[2]["scaleMax"], json!(2));
    // only a table or a bar is turned off
    assert!(annos[3].get("hidden").is_none());
    // written back, it reads as the same project, and writes the same again
    let mut again = read_project(out.clone(), &options()).unwrap();
    assert_eq!(again, project);
    let (out2, _) = write_project(&mut again, &writer()).unwrap();
    assert_eq!(entries(&out2), entries(&out));
}

#[test]
fn a_grid_layer_style_and_order_read_and_write_back() {
    // (the grid off, its style with minor lines, a fixed spacing and the
    // grid's key in the layer order, as the app writes them)
    let rel = FIXTURES[0];
    let bytes = edited(rel, "models/model-1/model.json", &|v| {
        let view = &mut v["resultViewSettings"];
        view["showGrid"] = json!(false);
        view["gridLineSpacing"] = json!(2.5);
        view["layerOrder"] = json!(["soilColor", "surfaces", "grid", "slices"]);
        view["layerStyles"] = json!({
            "grid": { "color": "#336699", "width": 2.0, "subdivisions": 4.0, "minorWidth": 0.5 }
        });
    });
    let mut project = read_project(bytes, &options()).unwrap();
    let (out, _) = write_project(&mut project, &writer()).unwrap();
    let model = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/model.json")
        .map(|(_, data, _)| as_json(&data))
        .unwrap();
    let view = &model["resultViewSettings"];
    assert_eq!(view["showGrid"], json!(false));
    assert_eq!(view["gridLineSpacing"], json!(2.5));
    assert_eq!(
        view["layerOrder"],
        json!(["soilColor", "surfaces", "grid", "slices"])
    );
    assert_eq!(
        view["layerStyles"],
        json!({ "grid": { "color": "#336699", "width": 2, "subdivisions": 4, "minorWidth": 0.5 } })
    );
    // written back, it reads as the same project, and writes the same again
    let mut again = read_project(out.clone(), &options()).unwrap();
    assert_eq!(again, project);
    let (out2, _) = write_project(&mut again, &writer()).unwrap();
    assert_eq!(entries(&out2), entries(&out));
}

#[test]
fn a_frame_layer_its_style_and_order_read_and_write_back() {
    // (the frame off, its style, the ticks and the frame's key in the layer
    // order, as the app writes them)
    let rel = FIXTURES[0];
    let bytes = edited(rel, "models/model-1/model.json", &|v| {
        let view = &mut v["resultViewSettings"];
        view["paperFrame"]["showFrame"] = json!(false);
        view["gridSpacing"] = json!(5.0);
        view["minorTicks"] = json!(4.0);
        view["layerOrder"] = json!(["soilColor", "surfaces", "fosLabel", "frame"]);
        view["layerStyles"] = json!({
            "frame": { "color": "#cc0000", "width": 6.0, "fontSize": 11.0, "labels": false }
        });
    });
    let mut project = read_project(bytes, &options()).unwrap();
    let (out, _) = write_project(&mut project, &writer()).unwrap();
    let model = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/model.json")
        .map(|(_, data, _)| as_json(&data))
        .unwrap();
    let view = &model["resultViewSettings"];
    assert_eq!(view["paperFrame"]["showFrame"], json!(false));
    assert_eq!(view["gridSpacing"], json!(5));
    assert_eq!(view["minorTicks"], json!(4));
    assert_eq!(
        view["layerOrder"],
        json!(["soilColor", "surfaces", "fosLabel", "frame"])
    );
    assert_eq!(
        view["layerStyles"],
        json!({ "frame": { "color": "#cc0000", "width": 6, "fontSize": 11, "labels": false } })
    );
    // written back, it reads as the same project, and writes the same again
    let mut again = read_project(out.clone(), &options()).unwrap();
    assert_eq!(again, project);
    let (out2, _) = write_project(&mut again, &writer()).unwrap();
    assert_eq!(entries(&out2), entries(&out));
}

#[test]
fn a_frame_style_out_of_bounds_is_dropped_and_an_unknown_field_refused() {
    let rel = FIXTURES[0];
    let bytes = edited(rel, "models/model-1/model.json", &|v| {
        v["resultViewSettings"]["layerStyles"] = json!({
            "frame": { "width": 50.0, "fontSize": 2.0, "color": "red", "labels": "no" }
        });
    });
    let mut project = read_project(bytes, &options()).unwrap();
    let (out, _) = write_project(&mut project, &writer()).unwrap();
    let model = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/model.json")
        .map(|(_, data, _)| as_json(&data))
        .unwrap();
    assert!(model["resultViewSettings"].get("layerStyles").is_none());
    let bytes = edited(rel, "models/model-1/model.json", &|v| {
        v["resultViewSettings"]["layerStyles"] = json!({ "frame": { "dash": "dotted" } });
    });
    let e = read_project(bytes, &options()).unwrap_err();
    assert!(e.contains("layerStyles.frame.dash"), "{e}");
}

#[test]
fn a_grid_style_out_of_bounds_is_dropped() {
    let rel = FIXTURES[0];
    let bytes = edited(rel, "models/model-1/model.json", &|v| {
        v["resultViewSettings"]["layerStyles"] = json!({
            "grid": { "subdivisions": 1.0, "minorWidth": 50.0, "color": "red" }
        });
    });
    let mut project = read_project(bytes, &options()).unwrap();
    let (out, _) = write_project(&mut project, &writer()).unwrap();
    let model = entries(&out)
        .into_iter()
        .find(|(n, ..)| n == "models/model-1/model.json")
        .map(|(_, data, _)| as_json(&data))
        .unwrap();
    assert!(model["resultViewSettings"].get("layerStyles").is_none());
}
