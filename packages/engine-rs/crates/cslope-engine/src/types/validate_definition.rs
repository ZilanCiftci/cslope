//! Strict validation of a definition and its analysis options (issue #55),
//! for input from anyone but the app (Python, the command line, an agent).
//! Not a port: the engine itself reads its input leniently, as the
//! TypeScript engine did, and the app's own output is correct by
//! construction.
//!
//! Each issue has a JSON pointer to the value (`/materials/1/model/
//! undrainedShearStrength`), a code, a message and a severity: an error is
//! a model that would give a wrong answer or none, a warning one that may
//! be meant but is often a mistake. The checks, in order:
//!
//! 1. The shape, against the JSON schema (types/schema.rs): unknown keys,
//!    missing keys, values of the wrong type or outside their list.
//! 2. The engine's own reading: the paths of values serde cannot read
//!    (`serde_path_to_error`) and of keys it ignores (`serde_ignored`), for
//!    what the schema does not already report.
//! 3. The rules of the model: unique material names, valid material
//!    models, every region with exactly one assignment, interior boundaries
//!    that reach the outline, loads, search limits and water lines within
//!    the model's x range, `unitWeightSat` for materials below a water
//!    line, the deprecated `materialName` and `followBoundary` (D-24), and
//!    a unit weight of water outside 9–11 kN/m³ (a warning).
//! 4. Without errors so far: the engine builds the model and takes the
//!    options; an error it raises is reported.

use crate::math::polygon::{point_in_ring, point_on_ring};
use crate::model::build_slope::build_slope;
use crate::model::canonical::to_canonical_slope_definition;
use crate::model::geometry_ops::{keyhole_ring, polygonize_regions_detailed};
use crate::model::slope::AnalysisOptionsPatch;
use crate::types::slope_definition::{
    material_model_of, SlopeDefinition, WaterTableMode, WaterTableValue,
};
use crate::types::validation::validate_material_model;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

/// How serious an issue is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// The model gives a wrong answer or none.
    Error,
    /// Often a mistake, but it may be meant.
    Warning,
}

/// One finding of the validation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Issue {
    /// JSON pointer to the value ("" for the whole document).
    pub path: String,
    /// A stable code, e.g. "unknown-key", "missing-region-assignments".
    pub code: String,
    /// What is wrong, in a sentence.
    pub message: String,
    pub severity: Severity,
}

impl Issue {
    fn error(path: impl Into<String>, code: &str, message: impl Into<String>) -> Issue {
        Issue {
            path: path.into(),
            code: code.into(),
            message: message.into(),
            severity: Severity::Error,
        }
    }

    fn warning(path: impl Into<String>, code: &str, message: impl Into<String>) -> Issue {
        Issue {
            path: path.into(),
            code: code.into(),
            message: message.into(),
            severity: Severity::Warning,
        }
    }
}

/// Whether an object is an analysis document (`{"format", "definition",
/// "options"}`) rather than a bare definition.
pub fn is_document(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        !o.contains_key("coordinates") && (o.contains_key("format") || o.contains_key("definition"))
    })
}

/// Validate an analysis document or a bare definition. A document's paths
/// start at `/definition` and `/options`; a bare definition's at its root,
/// with `options` (if given) under `/options`. `options` given with a
/// document are laid over the document's own, key by key, as `analyse`
/// takes them.
pub fn validate(doc_or_definition: &Value, options: Option<&Value>) -> Vec<Issue> {
    validate_with(doc_or_definition, options, &StrictReader)
}

/// How step 2 reads the definition and the options as the engine's types.
/// `validate` reads the JSON with `serde_ignored` and `serde_path_to_error`
/// (`StrictReader`); the WebAssembly engine reads the JavaScript values it
/// was given directly, which keeps a second copy of the readers out of it
/// (the schema already reports unknown keys and types with their paths).
pub trait EngineReader {
    /// The definition, or None with an issue (under `prefix`) when it
    /// cannot be read.
    fn definition(
        &self,
        v: &Value,
        prefix: &str,
        issues: &mut Vec<Issue>,
    ) -> Option<SlopeDefinition>;
    /// The options, likewise.
    fn options(
        &self,
        v: &Value,
        prefix: &str,
        issues: &mut Vec<Issue>,
    ) -> Option<AnalysisOptionsPatch>;
}

/// The reader of `validate`: the path of a value serde cannot read
/// (`serde_path_to_error`) and of each key it ignores (`serde_ignored`).
pub struct StrictReader;

impl EngineReader for StrictReader {
    fn definition(
        &self,
        v: &Value,
        prefix: &str,
        issues: &mut Vec<Issue>,
    ) -> Option<SlopeDefinition> {
        read_engine(v, prefix, issues)
    }
    fn options(
        &self,
        v: &Value,
        prefix: &str,
        issues: &mut Vec<Issue>,
    ) -> Option<AnalysisOptionsPatch> {
        read_engine(v, prefix, issues)
    }
}

/// `validate` with another reader of step 2.
pub fn validate_with(
    doc_or_definition: &Value,
    options: Option<&Value>,
    reader: &dyn EngineReader,
) -> Vec<Issue> {
    if is_document(doc_or_definition) {
        let mut doc = doc_or_definition.clone();
        if let (Some(o), Some(opts)) = (doc.as_object_mut(), options) {
            // the given options over the document's, key by key, as
            // `analyse` layers them (a bad key in either is reported)
            let layered = match (o.get("options"), opts) {
                (Some(Value::Object(own)), Value::Object(given)) => {
                    let mut m = own.clone();
                    m.extend(given.iter().map(|(k, v)| (k.clone(), v.clone())));
                    Value::Object(m)
                }
                _ => opts.clone(),
            };
            o.insert("options".into(), layered);
        }
        validate_document(&doc, reader)
    } else {
        validate_definition(doc_or_definition, options, reader)
    }
}

/// Validate an analysis document (`format`, `formatVersion`, `definition`,
/// `options`).
fn validate_document(doc: &Value, reader: &dyn EngineReader) -> Vec<Issue> {
    let schema = super::schema::document_schema();
    let mut issues = SchemaCheck::run(schema, schema, doc, "");
    let blocked = issues.iter().any(|i| i.severity == Severity::Error);
    let (Some(def), opts) = (doc.get("definition"), doc.get("options")) else {
        return issues;
    };
    if !def.is_object() {
        return issues;
    }
    let opts = opts.filter(|o| !o.is_null());
    issues.extend(content_checks(
        def,
        opts,
        "/definition",
        "/options",
        blocked,
        reader,
    ));
    dedupe(issues)
}

/// Validate a bare definition and, optionally, its analysis options (paths
/// under `/options`).
fn validate_definition(
    definition: &Value,
    options: Option<&Value>,
    reader: &dyn EngineReader,
) -> Vec<Issue> {
    let mut issues = SchemaCheck::run(
        super::schema::document_schema(),
        &serde_json::json!({ "$ref": "#/$defs/SlopeDefinition" }),
        definition,
        "",
    );
    let options = options.filter(|o| !o.is_null());
    if let Some(o) = options {
        issues.extend(SchemaCheck::run(
            super::schema::document_schema(),
            &serde_json::json!({ "$ref": "#/$defs/AnalysisOptionsPatch" }),
            o,
            "/options",
        ));
    }
    if !definition.is_object() {
        return issues;
    }
    let blocked = issues.iter().any(|i| i.severity == Severity::Error);
    issues.extend(content_checks(
        definition, options, "", "/options", blocked, reader,
    ));
    dedupe(issues)
}

/// The same issue (path and code) once, in the order found.
fn dedupe(issues: Vec<Issue>) -> Vec<Issue> {
    let mut seen = BTreeSet::new();
    issues
        .into_iter()
        .filter(|i| {
            // (an unknown key is reported by the schema and by serde_ignored)
            let message = if i.code == "unknown-key" {
                String::new()
            } else {
                i.message.clone()
            };
            seen.insert((i.path.clone(), i.code.clone(), message))
        })
        .collect()
}

/// Steps 2–4 (see the module comment). `blocked`: the shape has errors, so
/// the engine is not asked to build the model.
fn content_checks(
    definition: &Value,
    options: Option<&Value>,
    def_prefix: &str,
    opt_prefix: &str,
    blocked: bool,
    reader: &dyn EngineReader,
) -> Vec<Issue> {
    let mut issues = Vec::new();
    let def = reader.definition(definition, def_prefix, &mut issues);
    let opts = match options {
        Some(o) => reader.options(o, opt_prefix, &mut issues),
        None => Some(AnalysisOptionsPatch::default()),
    };
    // γw far from water's: often a unit mistake (kN/m³ expected).
    if let Some(g) = opts.as_ref().and_then(|o| o.water_unit_weight) {
        if g.is_finite() && g > 0.0 && !(9.0..=11.0).contains(&g) {
            issues.push(Issue::warning(
                format!("{opt_prefix}/waterUnitWeight"),
                "unusual-water-unit-weight",
                format!(
                    "The unit weight of water is {} kN/m³, outside 9–11 kN/m³: check the unit (the default is 9.807).",
                    fmt(g)
                ),
            ));
        }
    }
    let Some(def) = def else {
        return issues;
    };
    model_rules(&def, def_prefix, &mut issues);
    let blocked = blocked || issues.iter().any(|i| i.severity == Severity::Error);
    if !blocked {
        if let Some(opts) = opts {
            let built = to_canonical_slope_definition(&def, None)
                .and_then(|c| build_slope(&c))
                .and_then(|mut slope| slope.update_analysis_options(&opts));
            if let Err(e) = built {
                issues.push(Issue::error(def_prefix, "engine-error", e.message));
            }
        }
    }
    issues
}

/// The value read as the engine reads it, with the path of a value it
/// cannot read and of each key it ignores.
fn read_engine<T: serde::de::DeserializeOwned>(
    v: &Value,
    prefix: &str,
    issues: &mut Vec<Issue>,
) -> Option<T> {
    let mut ignored: Vec<String> = Vec::new();
    let r: Result<T, serde_path_to_error::Error<serde_json::Error>> = {
        let mut on_ignored = |p: serde_ignored::Path| ignored.push(ignored_pointer(&p));
        let de = serde_ignored::Deserializer::new(v, &mut on_ignored);
        serde_path_to_error::deserialize(de)
    };
    for p in ignored {
        let key = p
            .rsplit('/')
            .next()
            .unwrap_or("")
            .replace("~1", "/")
            .replace("~0", "~");
        issues.push(Issue::error(
            format!("{prefix}{p}"),
            "unknown-key",
            format!("Unknown key \"{key}\": the engine ignores it."),
        ));
    }
    match r {
        Ok(t) => Some(t),
        Err(e) => {
            let path = path_to_pointer(e.path());
            issues.push(Issue::error(
                format!("{prefix}{path}"),
                "invalid-value",
                format!("The engine cannot read this value: {}", e.inner()),
            ));
            None
        }
    }
}

fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn ignored_pointer(p: &serde_ignored::Path) -> String {
    use serde_ignored::Path;
    match p {
        Path::Root => String::new(),
        Path::Seq { parent, index } => format!("{}/{index}", ignored_pointer(parent)),
        Path::Map { parent, key } => format!("{}/{}", ignored_pointer(parent), escape(key)),
        Path::Some { parent }
        | Path::NewtypeStruct { parent }
        | Path::NewtypeVariant { parent } => ignored_pointer(parent),
    }
}

fn path_to_pointer(p: &serde_path_to_error::Path) -> String {
    use serde_path_to_error::Segment;
    let mut s = String::new();
    for seg in p.iter() {
        match seg {
            Segment::Seq { index } => s.push_str(&format!("/{index}")),
            Segment::Map { key } => s.push_str(&format!("/{}", escape(key))),
            Segment::Enum { variant } => s.push_str(&format!("/{}", escape(variant))),
            Segment::Unknown => {}
        }
    }
    s
}

// ── 1. The shape against the JSON schema ──────────────────────────

/// A check of a value against the schemas schemars writes: `$ref` into
/// `$defs`, `type`, `const`, `enum`, `properties`, `required`,
/// `additionalProperties`, `items`, `prefixItems`, `minItems`, `maxItems`,
/// `minimum`, `maximum`, `anyOf` and `oneOf` (with `kind` as the
/// discriminator where every branch fixes it).
struct SchemaCheck<'a> {
    root: &'a Value,
}

impl<'a> SchemaCheck<'a> {
    /// The issues of `v` against `schema`, whose `$ref`s point into `root`.
    fn run(root: &'a Value, schema: &Value, v: &Value, prefix: &str) -> Vec<Issue> {
        let mut out = Vec::new();
        let check = SchemaCheck { root };
        // (a schema made here is resolved first: `check` keeps references
        // into `root` only)
        let target = check.resolve_ref(schema).unwrap_or(root);
        check.check(target, v, prefix, &mut out);
        out
    }

    /// The definition a `{"$ref": ...}` schema names.
    fn resolve_ref(&self, schema: &Value) -> Option<&'a Value> {
        let r = schema.get("$ref")?.as_str()?;
        if r == "#" {
            return Some(self.root);
        }
        let name = r.strip_prefix("#/$defs/")?;
        self.root.get("$defs")?.get(name)
    }

    fn resolve(&self, schema: &'a Value) -> &'a Value {
        let mut s = schema;
        for _ in 0..32 {
            let Some(r) = s.get("$ref").and_then(Value::as_str) else {
                return s;
            };
            if r == "#" {
                s = self.root;
                continue;
            }
            let Some(name) = r.strip_prefix("#/$defs/") else {
                return s;
            };
            match self.root.get("$defs").and_then(|d| d.get(name)) {
                Some(t) => s = t,
                None => return s,
            }
        }
        s
    }

    fn check(&self, schema: &'a Value, v: &Value, path: &str, out: &mut Vec<Issue>) {
        match schema {
            Value::Bool(true) => return,
            Value::Bool(false) => {
                out.push(Issue::error(
                    path,
                    "not-allowed",
                    "No value is allowed here.",
                ));
                return;
            }
            _ => {}
        }
        if schema.get("$ref").is_some() {
            let target = self.resolve(schema);
            if !std::ptr::eq(target, schema) {
                self.check(target, v, path, out);
            }
        }
        if let Some(branches) = schema
            .get("oneOf")
            .or_else(|| schema.get("anyOf"))
            .and_then(Value::as_array)
        {
            self.check_union(branches, v, path, out);
        }
        if let Some(t) = schema.get("type") {
            if !type_matches(t, v) {
                out.push(Issue::error(
                    path,
                    "type",
                    format!("Expected {}, got {}.", type_words(t), value_words(v)),
                ));
                return;
            }
        }
        if let Some(c) = schema.get("const") {
            if !same_value(c, v) {
                out.push(Issue::error(
                    path,
                    "enum",
                    format!("Expected {}, got {}.", c, short(v)),
                ));
            }
        }
        if let Some(Value::Array(list)) = schema.get("enum") {
            if !list.iter().any(|c| same_value(c, v)) {
                out.push(Issue::error(
                    path,
                    "enum",
                    format!("Expected one of {}, got {}.", join_values(list), short(v)),
                ));
            }
        }
        match v {
            Value::Object(o) => self.check_object(schema, o, path, out),
            Value::Array(a) => self.check_array(schema, a, path, out),
            Value::Number(n) => {
                let x = n.as_f64().unwrap_or(f64::NAN);
                if let Some(min) = schema.get("minimum").and_then(Value::as_f64) {
                    if x < min {
                        out.push(Issue::error(
                            path,
                            "range",
                            format!("Must be at least {min}, got {x}."),
                        ));
                    }
                }
                if let Some(max) = schema.get("maximum").and_then(Value::as_f64) {
                    if x > max {
                        out.push(Issue::error(
                            path,
                            "range",
                            format!("Must be at most {max}, got {x}."),
                        ));
                    }
                }
            }
            _ => {}
        }
    }

    fn check_object(
        &self,
        schema: &'a Value,
        o: &serde_json::Map<String, Value>,
        path: &str,
        out: &mut Vec<Issue>,
    ) {
        let props = schema.get("properties").and_then(Value::as_object);
        if let Some(Value::Array(req)) = schema.get("required") {
            for k in req.iter().filter_map(Value::as_str) {
                if !o.contains_key(k) {
                    out.push(Issue::error(
                        format!("{path}/{}", escape(k)),
                        "missing-key",
                        format!("\"{k}\" is required."),
                    ));
                }
            }
        }
        for (k, val) in o {
            let p = format!("{path}/{}", escape(k));
            match props.and_then(|ps| ps.get(k)) {
                Some(s) => {
                    if s.get("deprecated") == Some(&Value::Bool(true))
                        && k != "followBoundary"
                        && k != "materialName"
                    {
                        out.push(Issue::warning(
                            &p,
                            "deprecated",
                            format!("\"{k}\" is deprecated."),
                        ));
                    }
                    self.check(s, val, &p, out);
                }
                None => match schema.get("additionalProperties") {
                    Some(Value::Bool(false)) => {
                        let known: Vec<&str> = props
                            .map(|ps| ps.keys().map(String::as_str).collect())
                            .unwrap_or_default();
                        out.push(Issue::error(
                            &p,
                            "unknown-key",
                            unknown_key_message(k, &known),
                        ));
                    }
                    Some(s @ Value::Object(_)) => self.check(s, val, &p, out),
                    _ => {}
                },
            }
        }
    }

    fn check_array(&self, schema: &'a Value, a: &[Value], path: &str, out: &mut Vec<Issue>) {
        let min = schema.get("minItems").and_then(Value::as_u64);
        let max = schema.get("maxItems").and_then(Value::as_u64);
        let n = a.len() as u64;
        if min.is_some_and(|m| n < m) || max.is_some_and(|m| n > m) {
            let want = match (min, max) {
                (Some(x), Some(y)) if x == y => format!("{x}"),
                (Some(x), Some(y)) => format!("{x} to {y}"),
                (Some(x), None) => format!("at least {x}"),
                (None, Some(y)) => format!("at most {y}"),
                (None, None) => String::new(),
            };
            out.push(Issue::error(
                path,
                "length",
                format!("Expected {want} values, got {n}."),
            ));
        }
        let prefix = schema.get("prefixItems").and_then(Value::as_array);
        for (i, item) in a.iter().enumerate() {
            let s = prefix
                .and_then(|p| p.get(i))
                .or_else(|| schema.get("items"));
            if let Some(s) = s {
                self.check(s, item, &format!("{path}/{i}"), out);
            }
        }
    }

    fn check_union(&self, branches: &'a [Value], v: &Value, path: &str, out: &mut Vec<Issue>) {
        let mut results: Vec<Vec<Issue>> = Vec::new();
        for b in branches {
            let mut r = Vec::new();
            self.check(b, v, path, &mut r);
            if r.iter().all(|i| i.severity != Severity::Error) {
                out.extend(r);
                return;
            }
            results.push(r);
        }
        // A list of constants: one message with every value allowed.
        let consts: Option<Vec<Value>> = branches
            .iter()
            .map(|b| {
                let b = self.resolve(b);
                b.get("const").cloned().or_else(|| {
                    b.get("enum")
                        .and_then(Value::as_array)
                        .filter(|e| e.len() == 1)
                        .map(|e| e[0].clone())
                })
            })
            .collect();
        if let Some(consts) = consts {
            out.push(Issue::error(
                path,
                "enum",
                format!(
                    "Expected one of {}, got {}.",
                    join_values(&consts),
                    short(v)
                ),
            ));
            return;
        }
        // Branches told apart by the value of one key (`kind`).
        if let Value::Object(o) = v {
            for key in ["kind", "type", "mode", "format"] {
                let tags: Option<Vec<Value>> = branches
                    .iter()
                    .map(|b| {
                        self.resolve(b)
                            .get("properties")
                            .and_then(|p| p.get(key))
                            .and_then(|p| p.get("const"))
                            .cloned()
                    })
                    .collect();
                let Some(tags) = tags else { continue };
                let given = o.get(key);
                match given.and_then(|g| tags.iter().position(|t| same_value(t, g))) {
                    Some(i) => out.extend(results.swap_remove(i)),
                    None => out.push(Issue::error(
                        format!("{path}/{key}"),
                        if given.is_some() {
                            "enum"
                        } else {
                            "missing-key"
                        },
                        format!(
                            "\"{key}\" must be one of {}{}.",
                            join_values(&tags),
                            given
                                .map(|g| format!(", got {}", short(g)))
                                .unwrap_or_default()
                        ),
                    )),
                }
                return;
            }
        }
        // Otherwise the branches of the value's own type, if one: its issues;
        // else a type error that names every type allowed.
        let own: Vec<usize> = (0..results.len())
            .filter(|&i| {
                !results[i]
                    .iter()
                    .any(|e| e.path == path && e.code == "type")
            })
            .collect();
        if let Some(&best) = own.iter().min_by_key(|&&i| results[i].len()) {
            out.extend(results.swap_remove(best));
            return;
        }
        let mut words: Vec<String> = Vec::new();
        for b in branches {
            let b = self.resolve(b);
            let w = match b.get("type") {
                Some(t) => type_words(t),
                None => "an object".into(),
            };
            if !words.contains(&w) {
                words.push(w);
            }
        }
        out.push(Issue::error(
            path,
            "type",
            format!("Expected {}, got {}.", words.join(" or "), value_words(v)),
        ));
    }
}

fn unknown_key_message(k: &str, known: &[&str]) -> String {
    let close: Vec<&&str> = known
        .iter()
        .filter(|c| {
            let (a, b) = (k.to_ascii_lowercase(), c.to_ascii_lowercase());
            a.contains(&b) || b.contains(&a) || edit_distance(&a, &b) <= 2
        })
        .collect();
    let hint = if let Some(c) = close.first() {
        format!(" Did you mean \"{c}\"?")
    } else if known.len() <= 24 {
        format!(" Known keys: {}.", known.join(", "))
    } else {
        String::new()
    };
    format!("Unknown key \"{k}\": the engine would ignore it.{hint}")
}

fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut cur = vec![i; b.len() + 1];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        prev = cur;
    }
    prev[b.len()]
}

fn type_matches(t: &Value, v: &Value) -> bool {
    match t {
        Value::String(s) => one_type_matches(s, v),
        Value::Array(list) => list
            .iter()
            .filter_map(Value::as_str)
            .any(|s| one_type_matches(s, v)),
        _ => true,
    }
}

fn one_type_matches(t: &str, v: &Value) -> bool {
    match t {
        "null" => v.is_null(),
        "boolean" => v.is_boolean(),
        "string" => v.is_string(),
        "array" => v.is_array(),
        "object" => v.is_object(),
        "number" => v.is_number(),
        "integer" => v
            .as_f64()
            .is_some_and(|x| x.is_finite() && x.fract() == 0.0),
        _ => true,
    }
}

fn type_words(t: &Value) -> String {
    let word = |s: &str| {
        match s {
            "null" => "null",
            "boolean" => "true or false",
            "string" => "a string",
            "array" => "a list",
            "object" => "an object",
            "number" => "a number",
            "integer" => "an integer",
            other => other,
        }
        .to_string()
    };
    match t {
        Value::String(s) => word(s),
        Value::Array(list) => list
            .iter()
            .filter_map(Value::as_str)
            .map(word)
            .collect::<Vec<_>>()
            .join(" or "),
        _ => "a value".into(),
    }
}

fn value_words(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => format!("the number {n}"),
        Value::String(s) => format!("the string {:?}", s),
        Value::Array(a) => format!("a list of {}", a.len()),
        Value::Object(_) => "an object".into(),
    }
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.chars().count() > 40 {
        format!("{}…", s.chars().take(40).collect::<String>())
    } else {
        s
    }
}

fn join_values(list: &[Value]) -> String {
    list.iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        _ => a == b,
    }
}

// ── 3. The rules of the model ─────────────────────────────────────

type Pt = [f64; 2];

/// y of a water line at x: linear between its points, level beyond its
/// ends (as the engine extends it); None without points.
fn line_y(points: &[Pt], x: f64) -> Option<f64> {
    // (a line may be drawn either way: its ends are its smallest and
    // largest x, and each segment is read between its own min and max x)
    let left = points
        .iter()
        .copied()
        .reduce(|a, b| if b[0] < a[0] { b } else { a })?;
    let right = points
        .iter()
        .copied()
        .reduce(|a, b| if b[0] > a[0] { b } else { a })?;
    if x <= left[0] {
        return Some(left[1]);
    }
    if x >= right[0] {
        return Some(right[1]);
    }
    for w in points.windows(2) {
        let ([x0, y0], [x1, y1]) = (w[0], w[1]);
        let (lo, hi) = (crate::js::math::min(x0, x1), crate::js::math::max(x0, x1));
        if x >= lo && x <= hi {
            return Some(if hi > lo {
                y0 + (y1 - y0) * (x - x0) / (x1 - x0)
            } else {
                // a vertical step: the lower end
                crate::js::math::min(y0, y1)
            });
        }
    }
    Some(right[1])
}

fn fmt(x: f64) -> String {
    crate::js::num::to_string(crate::js::math::round(x * 1000.0) / 1000.0)
}

/// A point to name a region by: the middle of its vertices, or the first
/// vertex when that lies outside it.
fn region_label(ring: &[Pt]) -> String {
    let n = ring.len().max(1) as f64;
    let c = [
        ring.iter().map(|p| p[0]).sum::<f64>() / n,
        ring.iter().map(|p| p[1]).sum::<f64>() / n,
    ];
    let p = if point_in_ring(c, ring) {
        c
    } else {
        ring.first().copied().unwrap_or(c)
    };
    format!("({}, {})", fmt(p[0]), fmt(p[1]))
}

fn model_rules(def: &SlopeDefinition, pre: &str, out: &mut Vec<Issue>) {
    let coords = &def.coordinates;
    if coords.len() < 3 {
        out.push(Issue::error(
            format!("{pre}/coordinates"),
            "too-few-points",
            "The outline needs at least 3 points.",
        ));
        return;
    }
    if !coords.iter().all(|p| p[0].is_finite() && p[1].is_finite()) {
        return; // (reported by the schema)
    }
    let x_min = coords
        .iter()
        .map(|p| p[0])
        .fold(f64::INFINITY, crate::js::math::min);
    let x_max = coords
        .iter()
        .map(|p| p[0])
        .fold(f64::NEG_INFINITY, crate::js::math::max);
    let y_max = coords
        .iter()
        .map(|p| p[1])
        .fold(f64::NEG_INFINITY, crate::js::math::max);
    let tol = 1e-6 * (1.0 + (x_max - x_min).abs());
    let outside = |x: f64| x < x_min - tol || x > x_max + tol;
    let range = format!("{} to {}", fmt(x_min), fmt(x_max));

    // Materials: at least one, unique names, valid models.
    if def.materials.is_empty() {
        out.push(Issue::error(
            format!("{pre}/materials"),
            "missing-materials",
            "The model needs at least one material.",
        ));
        return;
    }
    let names: Vec<&str> = def.materials.iter().map(|m| m.name.as_str()).collect();
    for (i, m) in def.materials.iter().enumerate() {
        if names[..i].contains(&m.name.as_str()) {
            out.push(Issue::error(
                format!("{pre}/materials/{i}/name"),
                "duplicate-material-name",
                format!(
                    "Material name \"{}\" is used more than once; assignments by name reach only the last.",
                    m.name
                ),
            ));
        }
        match material_model_of(m) {
            Ok(model) => {
                for e in validate_material_model(&model) {
                    out.push(Issue::error(
                        format!("{pre}/materials/{i}/model"),
                        "invalid-material-model",
                        format!("Material \"{}\": {e}", m.name),
                    ));
                }
            }
            Err(e) => out.push(Issue::error(
                format!("{pre}/materials/{i}/model"),
                "missing-key",
                e.message,
            )),
        }
    }

    // Regions: the outline cut by the boundaries.
    let boundaries = def.material_boundaries.as_deref().unwrap_or(&[]);
    let px: Vec<f64> = coords.iter().map(|p| p[0]).collect();
    let py: Vec<f64> = coords.iter().map(|p| p[1]).collect();
    let regions: Vec<Vec<Pt>> = if boundaries.is_empty() {
        vec![coords.clone()]
    } else {
        let lines: Vec<Vec<Pt>> = boundaries.iter().map(|b| b.coordinates.clone()).collect();
        match polygonize_regions_detailed(&px, &py, &lines) {
            Ok(split) if !split.failed => {
                for &i in &split.dangling_boundaries {
                    out.push(Issue::error(
                        format!("{pre}/materialBoundaries/{i}"),
                        "dangling-boundary",
                        format!(
                            "Boundary {} ends inside the model, off the outline and every other boundary: it does not separate the regions on its two sides. Extend it to the outline or to another boundary.",
                            i + 1
                        ),
                    ));
                }
                split
                    .faces
                    .iter()
                    .map(|f| keyhole_ring(&f.outer, &f.holes))
                    .collect()
            }
            Ok(_) | Err(_) => {
                out.push(Issue::error(
                    format!("{pre}/materialBoundaries"),
                    "boundary-split-failed",
                    "The material boundaries could not be split into regions. Check boundaries that touch or nearly touch the outline or each other.",
                ));
                return;
            }
        }
    };
    for (i, b) in boundaries.iter().enumerate() {
        if b.coordinates.len() < 2 {
            out.push(Issue::error(
                format!("{pre}/materialBoundaries/{i}/coordinates"),
                "too-few-points",
                "A boundary needs at least 2 points.",
            ));
        }
    }

    // Assignments: each point in a region of its own, each region one point.
    let assignments = def.region_assignments.as_deref().unwrap_or(&[]);
    let legacy: Vec<usize> = boundaries
        .iter()
        .enumerate()
        .filter(|(_, b)| !b.material_name.is_empty())
        .map(|(i, _)| i)
        .collect();
    // The material of each region (an index into the materials), where known.
    let mut region_material: Vec<Option<usize>> = vec![None; regions.len()];
    if assignments.is_empty() {
        if !legacy.is_empty() {
            for &i in &legacy {
                out.push(Issue::error(
                    format!("{pre}/materialBoundaries/{i}/materialName"),
                    "legacy-region-assignment",
                    "materialName on a boundary is deprecated: without regionAssignments the engine assigns the material to the region below the boundary's midpoint, which is easily the wrong one. Give regionAssignments (a point in each region and its material) and leave materialName out.",
                ));
            }
        } else if regions.len() == 1 && def.materials.len() == 1 {
            region_material[0] = Some(0);
        } else {
            out.push(Issue::error(
                format!("{pre}/regionAssignments"),
                "missing-region-assignments",
                format!(
                    "No regionAssignments: the first material \"{}\" fills all {} region{} of the model{}. Give a point in each region and its material.",
                    def.materials[0].name,
                    regions.len(),
                    if regions.len() == 1 { "" } else { "s" },
                    if def.materials.len() > 1 { ", and the other materials are not used" } else { "" }
                ),
            ));
        }
    } else {
        for &i in &legacy {
            out.push(Issue::warning(
                format!("{pre}/materialBoundaries/{i}/materialName"),
                "deprecated",
                "materialName on a boundary is deprecated and ignored with regionAssignments; leave it out.",
            ));
        }
        let mut owner: Vec<Option<usize>> = vec![None; regions.len()];
        for (j, ra) in assignments.iter().enumerate() {
            let mat = names.iter().rposition(|n| *n == ra.material_name);
            if mat.is_none() {
                out.push(Issue::error(
                    format!("{pre}/regionAssignments/{j}/materialName"),
                    "unknown-material",
                    format!("No material is named \"{}\".", ra.material_name),
                ));
            }
            let inside = regions.iter().position(|r| point_in_ring(ra.point, r));
            // A point on a region's edge is in no region for the engine:
            // the region keeps the first material, which is right only when
            // the point names it.
            let on_edge = inside
                .is_none()
                .then(|| regions.iter().position(|r| point_on_ring(ra.point, r, tol)))
                .flatten();
            let inside = match on_edge {
                Some(r) if mat == Some(0) || names[0] == ra.material_name => {
                    out.push(Issue::warning(
                        format!("{pre}/regionAssignments/{j}/point"),
                        "assignment-on-edge",
                        format!(
                            "The point ({}, {}) lies on the edge of a region, not inside it; the region keeps the first material, which is the one named here. Move the point inside the region.",
                            fmt(ra.point[0]),
                            fmt(ra.point[1])
                        ),
                    ));
                    Some(r)
                }
                _ => inside,
            };
            match inside {
                None => out.push(Issue::error(
                    format!("{pre}/regionAssignments/{j}/point"),
                    "assignment-outside-model",
                    format!(
                        "The point ({}, {}) is not inside any region of the model (a point on an edge is in none).",
                        fmt(ra.point[0]),
                        fmt(ra.point[1])
                    ),
                )),
                Some(r) => match owner[r] {
                    Some(first) => out.push(Issue::error(
                        format!("{pre}/regionAssignments/{j}"),
                        "duplicate-region-assignment",
                        format!(
                            "The point ({}, {}) lies in the same region as assignment {}; the first one wins. Give one point per region.",
                            fmt(ra.point[0]),
                            fmt(ra.point[1]),
                            first + 1
                        ),
                    )),
                    None => {
                        owner[r] = Some(j);
                        region_material[r] = mat;
                    }
                },
            }
        }
        for (r, o) in owner.iter().enumerate() {
            if o.is_none() {
                out.push(Issue::error(
                    format!("{pre}/regionAssignments"),
                    "unassigned-region",
                    format!(
                        "The region at {} has no assignment: it takes the first material \"{}\". Add a point in it to regionAssignments.",
                        region_label(&regions[r]),
                        def.materials[0].name
                    ),
                ));
            }
        }
    }

    // Water: the main line, the lines by id, free water (D-24).
    let mut main_line: Option<Vec<Pt>> = None;
    if let Some(wt) = &def.water_table {
        let p = format!("{pre}/waterTable");
        match (&wt.mode, &wt.value) {
            (WaterTableMode::Height, WaterTableValue::Level(h)) => {
                main_line = Some(vec![[x_min, *h], [x_max, *h]]);
            }
            (WaterTableMode::Depth, WaterTableValue::Level(d)) => {
                main_line = Some(vec![[x_min, y_max - d], [x_max, y_max - d]]);
            }
            (WaterTableMode::Custom, WaterTableValue::Points(points)) if points.len() >= 2 => {
                check_line(points, &format!("{p}/value"), &outside, x_min, x_max, &range, out);
                main_line = Some(points.clone());
            }
            (WaterTableMode::Other(m), _) => out.push(Issue::error(
                format!("{p}/mode"),
                "water-table-ignored",
                if m.is_null() {
                    "The water table has no mode (\"height\", \"depth\" or \"custom\"): the engine leaves it out.".to_string()
                } else {
                    format!("The water table's mode {m} is not \"height\", \"depth\" or \"custom\": the engine leaves it out.")
                },
            )),
            _ => out.push(Issue::error(
                format!("{p}/value"),
                "water-table-value",
                "The value does not fit the mode (a level for \"height\" and \"depth\", at least 2 points for \"custom\"): the engine leaves the water table out.",
            )),
        }
        match (wt.free_water, wt.follow_boundary) {
            (Some(free), Some(follow)) if free == follow => out.push(Issue::error(
                format!("{p}/freeWater"),
                "conflicting-free-water",
                "freeWater and the deprecated followBoundary say the opposite (followBoundary = !freeWater); freeWater is used. Leave followBoundary out.",
            )),
            (None, Some(true)) => out.push(Issue::warning(
                format!("{p}/followBoundary"),
                "follow-boundary-inverted",
                "followBoundary is deprecated and reads the wrong way round: true means no free water (the line is clipped to the ground). Write freeWater: false instead (or freeWater: true for free water above the ground).",
            )),
            _ => {}
        }
    }
    let tables = def.water_tables.as_deref().unwrap_or(&[]);
    for (i, t) in tables.iter().enumerate() {
        let p = format!("{pre}/waterTables/{i}/coordinates");
        if t.coordinates.len() < 2 {
            out.push(Issue::error(
                &p,
                "too-few-points",
                "A water line needs at least 2 points.",
            ));
        } else {
            check_line(&t.coordinates, &p, &outside, x_min, x_max, &range, out);
        }
        if t.free_water.is_none() && t.follow_boundary == Some(true) {
            out.push(Issue::warning(
                format!("{pre}/waterTables/{i}/followBoundary"),
                "follow-boundary-inverted",
                "followBoundary is deprecated and reads the wrong way round: true means no free water. Write freeWater: false instead.",
            ));
        }
    }
    if main_line.is_none() {
        if let Some(wn) = &def.waternet {
            if let Some(id) = &wn.phreatic_line_id {
                main_line = wn
                    .head_lines
                    .iter()
                    .find(|h| &h.id == id)
                    .map(|h| h.points.clone());
            }
        }
    }
    for (i, m) in def.materials.iter().enumerate() {
        // The material's water line (as the engine picks it).
        let own = match &m.water_table_id {
            Some(Some(id)) if !tables.is_empty() => match tables.iter().find(|t| &t.id == id) {
                Some(t) => Some(t.coordinates.clone()),
                None => {
                    out.push(Issue::error(
                        format!("{pre}/materials/{i}/waterTableId"),
                        "unknown-water-table",
                        format!("No entry of waterTables has the id \"{id}\"; the main water table is used."),
                    ));
                    main_line.clone()
                }
            },
            Some(Some(id)) => {
                out.push(Issue::error(
                    format!("{pre}/materials/{i}/waterTableId"),
                    "unknown-water-table",
                    format!("No entry of waterTables has the id \"{id}\"; the main water table is used."),
                ));
                main_line.clone()
            }
            _ => main_line.clone(),
        };
        let Some(line) = own.filter(|l| l.len() >= 2) else {
            continue;
        };
        let Ok(model) = material_model_of(m) else {
            continue;
        };
        if model.base().unit_weight_sat.is_some() || model.kind() == "impenetrable" {
            continue;
        }
        let below = regions.iter().enumerate().any(|(r, ring)| {
            region_material[r] == Some(i)
                && (ring
                    .iter()
                    .any(|p| line_y(&line, p[0]).is_some_and(|w| p[1] < w - 1e-6))
                    || line
                        .iter()
                        .any(|w| point_in_ring([w[0], w[1] - 1e-3], ring)))
        });
        if below {
            out.push(Issue::warning(
                format!("{pre}/materials/{i}/model/unitWeightSat"),
                "missing-unit-weight-sat",
                format!(
                    "Material \"{}\" lies partly below its water line but has no unitWeightSat: its unit weight {} kN/m³ is used below the water too. Give unitWeightSat (equal to unitWeight if that is meant).",
                    m.name,
                    fmt(model.unit_weight())
                ),
            ));
        }
    }

    // Loads and search limits within the model's x range.
    for (i, u) in def.udls.iter().flatten().enumerate() {
        let p = format!("{pre}/udls/{i}");
        let (lo, hi) = (
            crate::js::math::min(u.x1, u.x2),
            crate::js::math::max(u.x1, u.x2),
        );
        if hi < x_min - tol || lo > x_max + tol {
            out.push(Issue::error(
                &p,
                "outside-model",
                format!("The distributed load (x {} to {}) lies outside the model (x {range}): it has no effect.", fmt(lo), fmt(hi)),
            ));
        } else {
            for (k, x) in [("x1", u.x1), ("x2", u.x2)] {
                if outside(x) {
                    out.push(Issue::warning(
                        format!("{p}/{k}"),
                        "outside-model",
                        format!("{k} = {} lies outside the model (x {range}): the load is cut at the model's edge.", fmt(x)),
                    ));
                }
            }
        }
    }
    for (i, l) in def.line_loads.iter().flatten().enumerate() {
        if outside(l.x) {
            out.push(Issue::error(
                format!("{pre}/lineLoads/{i}/x"),
                "outside-model",
                format!(
                    "The line load at x = {} lies outside the model (x {range}).",
                    fmt(l.x)
                ),
            ));
        }
    }
    if let Some(lim) = &def.analysis_limits {
        for (k, x) in [
            ("entryLeftX", lim.entry_left_x),
            ("entryRightX", lim.entry_right_x),
            ("exitLeftX", lim.exit_left_x),
            ("exitRightX", lim.exit_right_x),
        ] {
            if outside(x) {
                out.push(Issue::warning(
                    format!("{pre}/analysisLimits/{k}"),
                    "outside-model",
                    format!("{k} = {} lies outside the model (x {range}): the search is limited to the model.", fmt(x)),
                ));
            }
        }
    }
}

/// A water line's points within the model's x range, and the line across
/// it (the engine extends a short line level to the model's edges).
fn check_line(
    points: &[Pt],
    path: &str,
    outside: &dyn Fn(f64) -> bool,
    x_min: f64,
    x_max: f64,
    range: &str,
    out: &mut Vec<Issue>,
) {
    for (k, p) in points.iter().enumerate() {
        if outside(p[0]) {
            out.push(Issue::warning(
                format!("{path}/{k}"),
                "outside-model",
                format!("The point at x = {} lies outside the model (x {range}): the line is cut at the model's edge.", fmt(p[0])),
            ));
        }
    }
    let lo = points
        .iter()
        .map(|p| p[0])
        .fold(f64::INFINITY, crate::js::math::min);
    let hi = points
        .iter()
        .map(|p| p[0])
        .fold(f64::NEG_INFINITY, crate::js::math::max);
    let tol = 1e-6 * (1.0 + (x_max - x_min).abs());
    if lo > x_min + tol || hi < x_max - tol {
        out.push(Issue::warning(
            path,
            "water-line-short",
            format!(
                "The line spans x {} to {}, not the whole model (x {range}): the engine extends it level to the model's edges.",
                fmt(lo),
                fmt(hi)
            ),
        ));
    }
}
