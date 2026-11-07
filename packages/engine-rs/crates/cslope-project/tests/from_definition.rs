//! A project made from an engine definition (feature `write`, the browser
//! page's `.cslp` download, issue #107), on the web templates' fixture
//! documents (a level water table, free water or not): the model is the
//! app's `modelFromDefinition` of the definition with the document's
//! options, the result is current (its input hash is the model's), the
//! colours of the layers are kept, the same input gives the same bytes,
//! and the reader (feature `native`) opens the file. (That the model's
//! analysis gives the page's F is the desktop app's test,
//! packages/desktop/src/features/project/web-project.test.ts.)
#![cfg(feature = "write")]

use cslope_engine::types::SlopeDefinition;
use cslope_project::archive::{project_from_definition, DefinitionProject, Writer};
use cslope_project::project::EngineInfo;
use cslope_project::DefinitionModelInfo;
use serde_json::{json, Map, Value};
use std::path::PathBuf;

fn fixtures() -> Vec<(String, Value)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../web/src/templates/fixtures");
    let mut out = Vec::new();
    for sub in ["", "embankment"] {
        let mut files: Vec<_> = std::fs::read_dir(dir.join(sub))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "json") && !p.ends_with("expected.json"))
            .collect();
        files.sort();
        for f in files {
            let doc: Value = serde_json::from_slice(&std::fs::read(&f).unwrap()).unwrap();
            out.push((f.file_name().unwrap().to_string_lossy().into_owned(), doc));
        }
    }
    assert!(out.len() >= 20, "the web fixtures: {}", out.len());
    out
}

/// A result of the engine's shape (the hash, not the numbers, is tested).
fn result() -> Value {
    json!({ "minFOS": 1.2, "maxFOS": 2.0, "allSurfaces": [], "criticalSlices": [], "criticalSurface": null, "method": "Morgenstern-Price", "elapsedMs": 1 })
}

fn writer() -> Writer {
    Writer {
        app_version: "0.1.0".into(),
        generator: "cSlope web 0.1.0".into(),
        modified: Some("2026-11-07T12:00:00.000Z".into()),
    }
}

/// The definition with a colour for each material (as the page writes them).
fn coloured(doc: &Value) -> SlopeDefinition {
    let mut def = doc["definition"].clone();
    let colors = [
        "#8d6e63", "#4f7d4a", "#c9a227", "#5b7fa6", "#a0522d", "#708090",
    ];
    for (i, m) in def["materials"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .enumerate()
    {
        m["color"] = json!(colors[i % colors.len()]);
    }
    serde_json::from_value(def).unwrap()
}

fn project(doc: &Value, result: Option<Value>) -> DefinitionProject {
    DefinitionProject {
        info: DefinitionModelInfo {
            id: "model-1".into(),
            name: "Excavation".into(),
            options: doc["options"]
                .as_object()
                .cloned()
                .or_else(|| Some(Map::new())),
        },
        date: Some("2026-11-07".into()),
        result,
        engine: EngineInfo {
            version: "0.1.0".into(),
            source_hash: "abc".into(),
        },
    }
}

#[test]
fn the_result_of_every_template_example_is_current() {
    for (name, doc) in fixtures() {
        // (the layers without a colour too: the model gives them the app's)
        let plain: SlopeDefinition = serde_json::from_value(doc["definition"].clone()).unwrap();
        let (_, report) =
            project_from_definition(&plain, &project(&doc, Some(result())), &writer())
                .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(
            report.dropped_results.is_empty(),
            "{name} without colours: the result was left out"
        );
        let def = coloured(&doc);
        let (bytes, report) =
            project_from_definition(&def, &project(&doc, Some(result())), &writer())
                .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(
            report.dropped_results.is_empty(),
            "{name}: the result was left out"
        );
        assert_eq!(&bytes[..4], b"PK\x03\x04", "{name}");
        // the same input, the same bytes (format version 1 is deterministic)
        let again =
            project_from_definition(&def, &project(&doc, Some(result())), &writer()).unwrap();
        assert!(again.0 == bytes, "{name}: two writes differ");
    }
}

#[test]
fn without_a_result_the_project_has_none() {
    let (_, doc) = &fixtures()[0];
    let (bytes, report) =
        project_from_definition(&coloured(doc), &project(doc, None), &writer()).unwrap();
    assert!(report.dropped_results.is_empty());
    assert!(!bytes.is_empty());
}

#[test]
fn a_definition_the_app_cannot_take_is_refused() {
    let (_, doc) = &fixtures()[0];
    let mut def = doc["definition"].clone();
    def["waterTable"] = json!({ "mode": "height", "height": 1 });
    let def: SlopeDefinition = serde_json::from_value(def).unwrap();
    let e = project_from_definition(&def, &project(doc, None), &writer()).unwrap_err();
    assert!(e.contains("Water table mode"), "{e}");
}

#[cfg(feature = "native")]
mod read_back {
    use super::*;
    use cslope_project::archive::read_project;
    use cslope_project::input_hash;
    use cslope_project::project::ProjectReadOptions;

    #[test]
    fn the_reader_opens_it_with_the_model_its_colours_and_its_current_result() {
        for (name, doc) in fixtures() {
            let def = coloured(&doc);
            let (bytes, _) =
                project_from_definition(&def, &project(&doc, Some(result())), &writer()).unwrap();
            let p = read_project(bytes, &ProjectReadOptions::default())
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(p.models.len(), 1);
            assert_eq!(p.active_model_id, "model-1");
            assert_eq!(p.manifest.generator, "cSlope web 0.1.0");
            assert_eq!(p.manifest.created, "2026-11-07T12:00:00.000Z");
            let m = &p.models[0];
            assert_eq!(m.model.name, "Excavation");
            assert_eq!(m.model.project_info.date, "2026-11-07");
            let colours: Vec<_> = m.model.materials.iter().map(|x| x.color.clone()).collect();
            let given: Vec<_> = def
                .materials
                .iter()
                .map(|x| x.color.clone().unwrap())
                .collect();
            assert_eq!(colours, given, "{name}");
            assert_eq!(m.model.coordinates, def.coordinates, "{name}");
            let r = m
                .result
                .as_ref()
                .unwrap_or_else(|| panic!("{name}: no result"));
            assert_eq!(r.run_state, "done");
            assert_eq!(
                r.input_hash,
                input_hash(&m.model).unwrap(),
                "{name}: the result is out of date"
            );
            assert_eq!(r.engine.source_hash, "abc");
            assert_eq!(r.result.as_ref().unwrap()["minFOS"], json!(1.2));
        }
    }
}
