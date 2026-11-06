//! The JSON schemas of the engine's input and result (issue #55), derived
//! from the serde types with `schemars`: the definition, the analysis
//! options, the analysis document that holds both, the result, a material
//! model, the finite element settings and the reliability options.
//!
//! The schemas are deliberately stricter than the engine (each says so in
//! its `description`): the engine reads its input as the TypeScript engine
//! did (a missing number is NaN, a string option of another value takes
//! the default, unknown keys are ignored), the schema accepts only what the
//! engine reads as meant: JSON numbers, the documented strings, integers
//! for counts, and no unknown keys (`additionalProperties: false`).
//!
//! `tools/schema.ts` writes them (`generate`) to packages/engine/schema and
//! generates the TypedDicts of the Python package from them; the engine
//! carries those files (`schema`), and `validate_definition`
//! (types/validate_definition.rs) checks a definition against them.

use crate::model::reliability::{RandomVariable, ReliabilityOptions};
use crate::model::slope::AnalysisOptionsPatch;
use crate::types::analysis::{AnalysisResult, FemAnalysisSettings};
use crate::types::material_models::MaterialModel;
use crate::types::slope_definition::SlopeDefinition;
use schemars::transform::{transform_subschemas, Transform};
use schemars::{JsonSchema, Schema};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// The version of the schemas: the engine's version. Each schema's `$id`
/// carries it.
pub const SCHEMA_VERSION: &str = env!("CARGO_PKG_VERSION");

/// `format` of an analysis document.
pub const DOCUMENT_FORMAT: &str = "cslope-analysis";

/// `formatVersion` of an analysis document.
pub const DOCUMENT_FORMAT_VERSION: u32 = 1;

/// The schemas by name (the file names in packages/engine/schema, without
/// `.json`).
pub const SCHEMA_NAMES: [&str; 10] = [
    "analysis-document",
    "slope-definition",
    "analysis-options",
    "analysis-result",
    "material-model",
    "fem-analysis-settings",
    "reliability-options",
    "random-variables",
    "result-summary",
    "validation-issues",
];

/// The `format` of an analysis document: always "cslope-analysis".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum DocumentFormat {
    #[serde(rename = "cslope-analysis")]
    CslopeAnalysis,
}

/// An analysis as one JSON document: the model and the options it is
/// analysed with. The engine also takes the definition and the options
/// apart; this is the file an agent or the command line writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisDocument {
    /// Always "cslope-analysis".
    pub format: DocumentFormat,
    /// The version of this document format: 1.
    #[schemars(range(min = 1, max = 1))]
    pub format_version: u32,
    /// The slope model.
    pub definition: SlopeDefinition,
    /// The analysis options; absent fields take the defaults (in Python and
    /// on the command line the app's defaults: Morgenstern-Price, 30
    /// slices, 1000 + 500 trial surfaces, composite surfaces).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<AnalysisOptionsPatch>,
}

/// Every object schema with `properties` gets `additionalProperties:
/// false` (unknown keys are errors), unless it says otherwise; and a
/// property marked `x-required` (a number the engine reads as NaN when it
/// is missing, so serde gives it a default) is required.
#[derive(Debug, Clone)]
struct StrictObjects;

impl Transform for StrictObjects {
    fn transform(&mut self, schema: &mut Schema) {
        if let Some(o) = schema.as_object_mut() {
            if o.contains_key("properties") && !o.contains_key("additionalProperties") {
                o.insert("additionalProperties".into(), Value::Bool(false));
            }
            let mut marked: Vec<String> = Vec::new();
            if let Some(Value::Object(props)) = o.get_mut("properties") {
                for (k, p) in props.iter_mut() {
                    if let Some(p) = p.as_object_mut() {
                        if p.remove("x-required").is_some() {
                            marked.push(k.clone());
                        }
                    }
                }
            }
            if !marked.is_empty() {
                let req = o
                    .entry("required")
                    .or_insert_with(|| Value::Array(Vec::new()));
                if let Value::Array(r) = req {
                    for k in marked {
                        if !r.iter().any(|v| v.as_str() == Some(&k)) {
                            r.push(Value::String(k));
                        }
                    }
                }
            }
        }
        transform_subschemas(self, schema);
    }
}

const STRICTER: &str = "The schema is stricter than the engine: the engine also reads values of another type as the app's earlier TypeScript engine did (a number of another type as no number, an unknown option as the default) and ignores unknown keys, while this schema accepts only JSON numbers, the documented strings, integers for counts, and known keys. cslope.validate (validate_definition) checks a document against it and adds the rules of the model (regions, boundaries, ranges).";

fn root<T: JsonSchema>(name: &str, title: &str) -> Value {
    let input = !matches!(
        name,
        "analysis-result" | "result-summary" | "validation-issues"
    );
    let settings = schemars::generate::SchemaSettings::draft2020_12()
        .for_deserialize()
        .with_transform(StrictObjects);
    let mut schema = settings.into_generator().into_root_schema_for::<T>();
    let o = schema.as_object_mut().expect("a root schema is an object");
    o.insert(
        "$id".into(),
        Value::String(format!("urn:cslope:schema:{name}:{SCHEMA_VERSION}")),
    );
    o.insert("title".into(), Value::String(title.into()));
    let own = o
        .get("description")
        .and_then(Value::as_str)
        .map(|d| format!("{d}\n\n"))
        .unwrap_or_default();
    if input {
        o.insert(
            "description".into(),
            Value::String(format!("{own}{STRICTER}")),
        );
    }
    o.insert(
        "x-cslope-schema-version".into(),
        Value::String(SCHEMA_VERSION.into()),
    );
    schema.to_value()
}

/// The schemas generated from the types now (schemars), by name: what
/// tools/schema.ts writes to packages/engine/schema. Not used at run time
/// (the WebAssembly engine would carry the generator: about 1 MB); the
/// engine reads the committed files (`schema`).
pub fn generate() -> BTreeMap<&'static str, Value> {
    let mut m = BTreeMap::new();
    m.insert(
        "analysis-document",
        root::<AnalysisDocument>("analysis-document", "cSlope analysis document"),
    );
    m.insert(
        "slope-definition",
        root::<SlopeDefinition>("slope-definition", "cSlope slope definition"),
    );
    m.insert(
        "analysis-options",
        root::<AnalysisOptionsPatch>("analysis-options", "cSlope analysis options"),
    );
    m.insert(
        "analysis-result",
        root::<AnalysisResult>("analysis-result", "cSlope analysis result"),
    );
    m.insert(
        "material-model",
        root::<MaterialModel>("material-model", "cSlope material model"),
    );
    m.insert(
        "fem-analysis-settings",
        root::<FemAnalysisSettings>("fem-analysis-settings", "cSlope finite element settings"),
    );
    m.insert(
        "reliability-options",
        root::<ReliabilityOptions>("reliability-options", "cSlope reliability options"),
    );
    m.insert(
        "random-variables",
        root::<Vec<RandomVariable>>("random-variables", "cSlope random variables"),
    );
    m.insert(
        "result-summary",
        root::<crate::api::summary::ResultSummary>("result-summary", "cSlope result summary"),
    );
    m.insert(
        "validation-issues",
        root::<Vec<crate::types::validate_definition::Issue>>(
            "validation-issues",
            "cSlope validation issues",
        ),
    );
    m
}

/// The analysis document schema as the engine carries it for
/// `validate_definition`: without its descriptions, on one line
/// (analysis-document.min.json beside this file, written by
/// tools/schema.ts from packages/engine/schema/analysis-document.json,
/// whose `$defs` hold the definition and the options too). The other
/// schemas are files; the Python package carries them all. CI checks it is
/// what `generate` gives (tools/schema.ts --check, and a test).
const DOCUMENT: &str = include_str!("analysis-document.min.json");

/// The analysis document schema, parsed once.
pub fn document_schema() -> &'static Value {
    static SCHEMA: OnceLock<Value> = OnceLock::new();
    SCHEMA
        .get_or_init(|| serde_json::from_str(DOCUMENT).expect("analysis-document.min.json is JSON"))
}

/// A schema without its `description`s (the properties keep their names),
/// as the engine carries it (`document_schema`).
pub fn without_descriptions(v: &Value) -> Value {
    fn strip(v: &Value, in_properties: bool) -> Value {
        match v {
            Value::Object(o) => Value::Object(
                o.iter()
                    .filter(|(k, _)| in_properties || k.as_str() != "description")
                    .map(|(k, x)| (k.clone(), strip(x, !in_properties && k == "properties")))
                    .collect(),
            ),
            Value::Array(a) => Value::Array(a.iter().map(|x| strip(x, false)).collect()),
            other => other.clone(),
        }
    }
    strip(v, false)
}
