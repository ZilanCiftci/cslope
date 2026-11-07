//! The `.cslp` reader and writer (feature `native`) on files the app wrote
//! (the desktop app's project fixtures and the Python tests' app-saved
//! project): opened and saved again, every JSON entry is the app's but the
//! manifest's `modified`, `appVersion` and `generator`; the results stay
//! (their input is unchanged), and the save policy drops a result, and the
//! thumbnail, once the model's input changes.
#![cfg(feature = "native")]

use cslope_project::archive::{read_project, write_project, Writer};
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
    let names: Vec<String> = entries(&out).into_iter().map(|(n, ..)| n).collect();
    assert!(!names.contains(&"thumbnail.png".to_owned()));
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
                v["udls"][0]["foo"] = json!(1)
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
