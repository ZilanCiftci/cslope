//! What the app does to a model when it opens a project (`normalizeModelEntry`
//! and its helpers in packages/desktop/src/store/persistence.ts, the result
//! sheet's normalizers in features/results and features/annotations, the
//! locks' in store/canvas-selection.ts), ported field by field: a model
//! saved by the app may lack fields that were added later (a file of
//! 2026-10 has no `compositeSurfaces`, which the app then reads as false),
//! and a hand-made one may hold values the app drops or clamps; read
//! without this, such a model would differ from the one the app runs and
//! writes back.
//!
//! Two ways of reading ([`ReadOptions`]):
//!
//! - lenient (`strict: false`, the app's own way, `cslope export`): a
//!   member the app does not know is dropped without a word;
//! - strict (`strict: true`, the `.cslp` reader): an unknown member is an
//!   error naming its path, as docs/file-format.md section 2.1 asks of a
//!   writer that cannot carry it over. The known members are those the
//!   app's normalizer reads; inside a material model and an earlier stage
//!   they are the engine's (its JSON schema decides).
//!
//! In either way the result is the shape the app holds after opening and
//! writes back ([`crate::model::ModelEntry`]). For a project of schema
//! version 3 (the current one): the migrations of older versions are the
//! app's.
//!
//! The differences from the app, all for files the app did not write:
//! where the app gives a missing id a random one (`nextId`), this gives
//! `<prefix>-<n>` (a boundary's id orders the boundaries, so a hand-made
//! file with boundaries without ids may order them differently); a piezo
//! line's `name` and `color`, a paper annotation's members and the result
//! sheet's display switches are kept only with the type the app's types
//! give them, where the app keeps whatever the file holds; the date of a
//! missing title block is `today` of the options.

use crate::convert::ConvertError;
use crate::model::{ModelEntry, MATERIAL_COLORS};
use crate::options::app_default_options;
use cslope_engine::model::canonical::{resolve_orientation, SlopeOrientation};
use cslope_engine::types::{
    default_fem_settings, supports_anisotropy, supports_suction_strength, swedish_partial_factors,
    try_validate_material_model, MaterialModel, SwedishFactorBasis, ITERATIONS_RANGE,
    REFINED_ITERATIONS_RANGE, SLICES_RANGE,
};
use serde_json::{json, Map, Value};
use std::cell::{Cell, RefCell};

/// The app's tolerance range (`TOLERANCE_RANGE`, store/defaults.ts).
const TOLERANCE_RANGE: (f64, f64) = (0.001, 0.1);
/// `DEFAULT_MODEL_NAME`.
const DEFAULT_MODEL_NAME: &str = "Untitled";

type Obj = Map<String, Value>;

fn err<T>(m: impl Into<String>) -> Result<T, ConvertError> {
    Err(ConvertError(m.into()))
}

/// How a model is read.
#[derive(Debug, Clone, Copy)]
pub struct ReadOptions<'a> {
    /// An unknown member is an error (the `.cslp` reader) instead of
    /// being dropped (the app).
    pub strict: bool,
    /// The date (YYYY-MM-DD) of a title block the file lacks
    /// (`createDefaultProjectInfo`).
    pub today: &'a str,
}

/// Today's date (UTC) as YYYY-MM-DD, as `new Date().toISOString()` starts.
/// In WebAssembly (no clock without JavaScript) 1970-01-01: it dates only a
/// title block a model lacks, which no analysis reads.
pub fn today() -> String {
    if cfg!(target_arch = "wasm32") {
        return "1970-01-01".into();
    }
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Howard Hinnant's civil_from_days
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// `typeof v === "number" && isFinite(v)`: JSON numbers are finite.
fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// `finiteOr(v, fallback)`.
fn finite_or(v: Option<&Value>, fallback: f64) -> f64 {
    num(v).unwrap_or(fallback)
}

/// `!!v && typeof v === "object"` (arrays included).
fn is_object(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Object(_)) | Some(Value::Array(_)))
}

fn obj(v: Option<&Value>) -> Option<&Obj> {
    v.and_then(Value::as_object)
}

fn str_of(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str)
}

fn bool_of(v: Option<&Value>) -> Option<bool> {
    v.and_then(Value::as_bool)
}

fn point(x: f64, y: f64) -> Value {
    json!([x, y])
}

/// `normalizePoints`: the finite [x, y] pairs.
fn points(v: Option<&Value>) -> Vec<Value> {
    let Some(Value::Array(a)) = v else {
        return Vec::new();
    };
    a.iter()
        .filter_map(|p| match p {
            Value::Array(q) => match (num(q.first()), num(q.get(1))) {
                (Some(x), Some(y)) => Some(point(x, y)),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

/// `pointOrUndefined`.
fn point_of(v: Option<&Value>) -> Option<Value> {
    match v {
        Some(Value::Array(q)) => match (num(q.first()), num(q.get(1))) {
            (Some(x), Some(y)) => Some(point(x, y)),
            _ => None,
        },
        _ => None,
    }
}

/// `isFinitePair`: an array of exactly two numbers.
fn is_finite_pair(v: &Value) -> bool {
    matches!(v, Value::Array(q) if q.len() == 2 && q.iter().all(Value::is_number))
}

/// `positiveOrUndefined`: a finite number that is not negative.
fn positive_of(v: Option<&Value>) -> Option<Value> {
    num(v).filter(|x| *x >= 0.0).map(|x| json!(x))
}

/// The items of an array, none for anything else.
fn array(v: Option<&Value>) -> impl Iterator<Item = &Value> {
    v.and_then(Value::as_array).into_iter().flatten()
}

/// JavaScript truthiness of a JSON value.
fn js_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// `Math.max` / `Math.min`.
fn jmax(a: f64, b: f64) -> f64 {
    cslope_engine::js::math::max(a, b)
}

fn jmin(a: f64, b: f64) -> f64 {
    cslope_engine::js::math::min(a, b)
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    jmax(lo, jmin(hi, v))
}

/// A JSON pointer ("/udls/0/foo") as a member path ("udls[0].foo").
fn pointer_to_path(pointer: &str) -> String {
    let mut out = String::new();
    for seg in pointer.split('/').skip(1) {
        let seg = seg.replace("~1", "/").replace("~0", "~");
        if !seg.is_empty() && seg.chars().all(|c| c.is_ascii_digit()) {
            out.push_str(&format!("[{seg}]"));
        } else {
            if !out.is_empty() {
                out.push('.');
            }
            out.push_str(&seg);
        }
    }
    out
}

/// The reading in progress: the options, ids for what has none (the app's
/// `nextId`, without its randomness) and the unknown members found.
struct Ctx<'a> {
    strict: bool,
    today: &'a str,
    next_id: Cell<u32>,
    unknown: RefCell<Vec<String>>,
}

impl Ctx<'_> {
    fn next(&self, prefix: &str) -> String {
        let n = self.next_id.get() + 1;
        self.next_id.set(n);
        format!("{prefix}-{n}")
    }

    fn id_of(&self, v: Option<&Value>, prefix: &str) -> String {
        str_of(v)
            .map(str::to_owned)
            .unwrap_or_else(|| self.next(prefix))
    }

    /// Notes the members of `o` (at `path`) that are not in `known`.
    fn keys(&self, path: &str, o: &Obj, known: &[&str]) {
        if !self.strict {
            return;
        }
        for k in o.keys() {
            if !known.contains(&k.as_str()) {
                self.unknown(format!("{path}.{k}"));
            }
        }
    }

    fn unknown(&self, path: String) {
        self.unknown.borrow_mut().push(path);
    }

    /// The unknown keys the engine's schema finds in a definition-shaped
    /// value (a material model wrapped in one, an earlier stage), under
    /// `prefix` in the definition, noted at `path`.
    fn schema_unknown(&self, path: &str, definition: &Value, prefix: &str) {
        if !self.strict {
            return;
        }
        for issue in cslope_engine::types::validate_definition::validate(definition, None) {
            if issue.code == "unknown-key" && issue.path.starts_with(prefix) {
                let rest = pointer_to_path(&issue.path[prefix.len()..]);
                self.unknown(if rest.starts_with('[') || rest.is_empty() {
                    format!("{path}{rest}")
                } else {
                    format!("{path}.{rest}")
                });
            }
        }
    }
}

const MODEL_KEYS: [&str; 32] = [
    "id",
    "name",
    "orientation",
    "projectInfo",
    "coordinates",
    "coordinateExpressions",
    "parameters",
    "materials",
    "materialBoundaries",
    "regionMaterials",
    "piezometricLine",
    "udls",
    "lineLoads",
    "reinforcements",
    "piles",
    "options",
    "analysisLimits",
    "editViewOffset",
    "editViewScale",
    "resultViewOffset",
    "resultViewScale",
    "customSearchPlanes",
    "customPlanesOnly",
    "blockSearchObjects",
    "waternet",
    "earlierStage",
    "importNotes",
    "resultViewSettings",
    "viewOffset",
    "viewScale",
    "mode",
    "locks",
];

/// The members of a model that belong to other entries of the file: the
/// outcome of its run (result.json) and its drawings (backgrounds.json).
/// The app ignores them in model.json; the strict reader refuses them.
const OTHER_ENTRY_KEYS: [&str; 5] = [
    "runState",
    "progress",
    "result",
    "errorMessage",
    "backgrounds",
];

/// A model as the app holds it after opening the project (the app's own
/// lenient reading), from its `model.json` as saved.
pub fn normalize_for_run(raw: &Value) -> Result<ModelEntry, ConvertError> {
    read_model(
        raw,
        &ReadOptions {
            strict: false,
            today: &today(),
        },
    )
}

/// [`normalize_for_run`] as JSON (the app's shape).
pub fn normalize_model_json(raw: &Value) -> Result<Value, ConvertError> {
    read_model_json(
        raw,
        &ReadOptions {
            strict: false,
            today: &today(),
        },
    )
}

/// A model from its `model.json`, read with `options`.
pub fn read_model(raw: &Value, options: &ReadOptions) -> Result<ModelEntry, ConvertError> {
    let value = read_model_json(raw, options)?;
    ModelEntry::from_json(value).map_err(ConvertError)
}

/// [`read_model`] as JSON (the app's shape).
pub fn read_model_json(raw: &Value, options: &ReadOptions) -> Result<Value, ConvertError> {
    let cx = Ctx {
        strict: options.strict,
        today: options.today,
        next_id: Cell::new(100),
        unknown: RefCell::new(Vec::new()),
    };
    let out = model(raw, &cx)?;
    let unknown = cx.unknown.into_inner();
    if let Some(first) = unknown.first() {
        return err(match unknown.len() - 1 {
            0 => format!("unknown member {first}"),
            1 => format!("unknown member {first} (and 1 more)"),
            n => format!("unknown member {first} (and {n} more)"),
        });
    }
    Ok(out)
}

fn model(raw: &Value, cx: &Ctx) -> Result<Value, ConvertError> {
    let Value::Object(model) = raw else {
        return err("Model entry is invalid.");
    };
    let Some(id) = str_of(model.get("id")) else {
        return err("Model entry is missing an id.");
    };
    if !matches!(model.get("coordinates"), Some(Value::Array(c)) if c.len() >= 3) {
        return err(format!("Model {id} must include coordinates."));
    }
    if !matches!(model.get("materials"), Some(Value::Array(m)) if !m.is_empty()) {
        return err(format!("Model {id} must include at least one material."));
    }
    if cx.strict {
        for k in model.keys() {
            if OTHER_ENTRY_KEYS.contains(&k.as_str()) {
                cx.unknown(format!(
                    "{k} (the outcome of a run belongs to result.json, the drawings to backgrounds.json)"
                ));
            } else if !MODEL_KEYS.contains(&k.as_str()) {
                cx.unknown(k.clone());
            }
        }
    }
    let coordinates = coords(&model["coordinates"])?;
    let orientation = resolve_orientation(
        match str_of(model.get("orientation")) {
            Some("ltr") => Some(SlopeOrientation::Ltr),
            Some("rtl") => Some(SlopeOrientation::Rtl),
            _ => None,
        },
        &coordinates,
    );

    let mut out = Obj::new();
    out.insert("id".into(), json!(id));
    out.insert(
        "name".into(),
        json!(str_of(model.get("name")).unwrap_or(DEFAULT_MODEL_NAME)),
    );
    out.insert(
        "orientation".into(),
        serde_json::to_value(orientation).unwrap(),
    );
    out.insert(
        "projectInfo".into(),
        project_info(model.get("projectInfo"), cx),
    );
    out.insert(
        "coordinates".into(),
        Value::Array(coordinates.iter().map(|c| point(c[0], c[1])).collect()),
    );
    if let Some(e) = coordinate_expressions(
        model.get("coordinateExpressions"),
        coordinates.len(),
        "coordinateExpressions",
        cx,
    ) {
        out.insert("coordinateExpressions".into(), e);
    }
    if let Some(p) = parameters(model.get("parameters"), cx) {
        out.insert("parameters".into(), p);
    }
    out.insert(
        "materials".into(),
        Value::Array(
            model["materials"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
                .map(|(i, m)| material(m, i, cx))
                .collect(),
        ),
    );
    out.insert(
        "materialBoundaries".into(),
        Value::Array(
            array(model.get("materialBoundaries"))
                .enumerate()
                .filter(|(_, b)| is_object(Some(b)))
                .map(|(i, b)| {
                    let path = format!("materialBoundaries[{i}]");
                    if let Some(o) = b.as_object() {
                        cx.keys(&path, o, &["id", "coordinates", "coordinateExpressions"]);
                    }
                    let coordinates = points(b.get("coordinates"));
                    let mut row = Obj::new();
                    row.insert("id".into(), json!(cx.id_of(b.get("id"), "bnd")));
                    if let Some(e) = coordinate_expressions(
                        b.get("coordinateExpressions"),
                        coordinates.len(),
                        &format!("{path}.coordinateExpressions"),
                        cx,
                    ) {
                        row.insert("coordinateExpressions".into(), e);
                    }
                    row.insert("coordinates".into(), Value::Array(coordinates));
                    Value::Object(row)
                })
                .collect(),
        ),
    );
    out.insert(
        "regionMaterials".into(),
        Value::Array(
            array(model.get("regionMaterials"))
                .enumerate()
                .filter_map(|(i, a)| {
                    if let Some(o) = a.as_object() {
                        cx.keys(
                            &format!("regionMaterials[{i}]"),
                            o,
                            &["point", "materialId"],
                        );
                    }
                    let p = point_of(a.get("point"))?;
                    let m = str_of(a.get("materialId"))?;
                    Some(json!({ "point": p, "materialId": m }))
                })
                .collect(),
        ),
    );
    out.insert(
        "piezometricLine".into(),
        piezo(model.get("piezometricLine"), cx),
    );
    out.insert(
        "udls".into(),
        Value::Array(
            array(model.get("udls"))
                .enumerate()
                .filter_map(|(i, u)| udl(u, i, cx))
                .collect(),
        ),
    );
    out.insert(
        "lineLoads".into(),
        Value::Array(
            array(model.get("lineLoads"))
                .enumerate()
                .filter_map(|(i, l)| line_load(l, i, cx))
                .collect(),
        ),
    );
    if let Some(Value::Array(rows)) = model.get("reinforcements") {
        out.insert(
            "reinforcements".into(),
            Value::Array(
                rows.iter()
                    .enumerate()
                    .filter_map(|(i, r)| reinforcement(r, i, cx))
                    .collect(),
            ),
        );
    }
    if let Some(Value::Array(rows)) = model.get("piles") {
        out.insert(
            "piles".into(),
            Value::Array(
                rows.iter()
                    .enumerate()
                    .filter_map(|(i, p)| pile(p, i, cx))
                    .collect(),
            ),
        );
    }
    out.insert(
        "options".into(),
        Value::Object(match model.get("options") {
            Some(o) if js_truthy(o) => analysis_options(o, cx),
            _ => app_default_options(),
        }),
    );
    out.insert(
        "analysisLimits".into(),
        analysis_limits(model.get("analysisLimits"), cx),
    );
    // the views: the edit and result views fall back to the one view of
    // older files (`??`: when the field is absent or null)
    let or_view = |key: &str, fallback: &str| match model.get(key) {
        Some(v) if !v.is_null() => Some(v),
        _ => model.get(fallback),
    };
    if let Some(p) = point_of(or_view("editViewOffset", "viewOffset")) {
        out.insert("editViewOffset".into(), p);
    }
    if let Some(s) = positive_of(or_view("editViewScale", "viewScale")) {
        out.insert("editViewScale".into(), s);
    }
    if let Some(p) = point_of(or_view("resultViewOffset", "viewOffset")) {
        out.insert("resultViewOffset".into(), p);
    }
    if let Some(s) = positive_of(or_view("resultViewScale", "viewScale")) {
        out.insert("resultViewScale".into(), s);
    }
    out.insert(
        "customSearchPlanes".into(),
        Value::Array(
            array(model.get("customSearchPlanes"))
                .enumerate()
                .filter_map(|(i, p)| custom_plane(p, i, cx))
                .collect(),
        ),
    );
    out.insert(
        "customPlanesOnly".into(),
        json!(model.get("customPlanesOnly") == Some(&Value::Bool(true))),
    );
    if let Some(Value::Array(objects)) = model.get("blockSearchObjects") {
        out.insert(
            "blockSearchObjects".into(),
            Value::Array(
                objects
                    .iter()
                    .enumerate()
                    .filter(|(_, o)| is_object(Some(o)))
                    .map(|(i, o)| {
                        if let Some(ob) = o.as_object() {
                            cx.keys(&format!("blockSearchObjects[{i}]"), ob, &["id", "points"]);
                        }
                        json!({ "id": cx.id_of(o.get("id"), "bso"), "points": points(o.get("points")) })
                    })
                    .collect(),
            ),
        );
    }
    if let Some(w) = waternet(model.get("waternet"), cx) {
        out.insert("waternet".into(), w);
    }
    if let Some(s) = earlier_stage(model.get("earlierStage"), cx) {
        out.insert("earlierStage".into(), s);
    }
    if let Some(Value::Array(notes)) = model.get("importNotes") {
        out.insert(
            "importNotes".into(),
            Value::Array(notes.iter().filter(|n| n.is_string()).cloned().collect()),
        );
    }
    out.insert(
        "resultViewSettings".into(),
        result_view(model.get("resultViewSettings"), cx),
    );
    if let Some(p) = point_of(model.get("viewOffset")) {
        out.insert("viewOffset".into(), p);
    }
    if let Some(s) = positive_of(model.get("viewScale")) {
        out.insert("viewScale".into(), s);
    }
    if let Some(m) = str_of(model.get("mode")).filter(|m| matches!(*m, "edit" | "result")) {
        out.insert("mode".into(), json!(m));
    }
    if let Some(l) = locks(model.get("locks"), &out, cx) {
        out.insert("locks".into(), l);
    }
    Ok(Value::Object(out))
}

/// `normalizeCoords`.
fn coords(raw: &Value) -> Result<Vec<[f64; 2]>, ConvertError> {
    let a = raw.as_array().expect("checked");
    a.iter()
        .enumerate()
        .map(|(i, pair)| {
            let Some(q) = pair.as_array().filter(|q| q.len() >= 2) else {
                return err(format!("Coordinate #{} is invalid.", i + 1));
            };
            match (num(q.first()), num(q.get(1))) {
                (Some(x), Some(y)) => Ok([x, y]),
                _ => err(format!("Coordinate #{} must be numbers.", i + 1)),
            }
        })
        .collect()
}

/// `normalizeProjectInfo`.
fn project_info(raw: Option<&Value>, cx: &Ctx) -> Value {
    let base = crate::model::ProjectInfo::default_for(cx.today);
    let Some(info) = raw.filter(|v| is_object(Some(v))) else {
        return serde_json::to_value(base).unwrap();
    };
    if let Some(o) = info.as_object() {
        cx.keys(
            "projectInfo",
            o,
            &[
                "title",
                "subtitle",
                "client",
                "projectNumber",
                "revision",
                "author",
                "checker",
                "date",
                "description",
                "canvasWidth",
                "canvasHeight",
            ],
        );
    }
    let text = |k: &str, fallback: &str| json!(str_of(info.get(k)).unwrap_or(fallback));
    json!({
        "title": text("title", &base.title),
        "subtitle": text("subtitle", &base.subtitle),
        "client": text("client", &base.client),
        "projectNumber": text("projectNumber", &base.project_number),
        "revision": text("revision", &base.revision),
        "author": text("author", &base.author),
        "checker": text("checker", &base.checker),
        "date": text("date", &base.date),
        "description": text("description", &base.description),
        "canvasWidth": finite_or(info.get("canvasWidth"), base.canvas_width),
        "canvasHeight": finite_or(info.get("canvasHeight"), base.canvas_height),
    })
}

/// `normalizeCoordinateExpressions(raw, length, true)`: absent stays
/// absent; else one entry per point, `x` and `y` when they are strings.
fn coordinate_expressions(
    raw: Option<&Value>,
    length: usize,
    path: &str,
    cx: &Ctx,
) -> Option<Value> {
    let Some(Value::Array(items)) = raw else {
        return None;
    };
    Some(Value::Array(
        (0..length)
            .map(|i| {
                let mut e = Obj::new();
                if let Some(o) = items.get(i).and_then(Value::as_object) {
                    cx.keys(&format!("{path}[{i}]"), o, &["x", "y"]);
                    for key in ["x", "y"] {
                        if let Some(s) = str_of(o.get(key)) {
                            e.insert(key.into(), json!(s));
                        }
                    }
                }
                Value::Object(e)
            })
            .collect(),
    ))
}

/// `normalizeParameters(raw, true)`.
fn parameters(raw: Option<&Value>, cx: &Ctx) -> Option<Value> {
    let Some(Value::Array(items)) = raw else {
        return None;
    };
    Some(Value::Array(
        items
            .iter()
            .enumerate()
            .filter_map(|(i, p)| {
                let o = p.as_object()?;
                cx.keys(
                    &format!("parameters[{i}]"),
                    o,
                    &["id", "name", "expression"],
                );
                let (id, name, expression) = (
                    str_of(o.get("id"))?,
                    str_of(o.get("name"))?,
                    str_of(o.get("expression"))?,
                );
                Some(json!({ "id": id, "name": name, "expression": expression }))
            })
            .collect(),
    ))
}

// ── Materials ───────────────────────────────────────────────────

/// `normalizeMaterial`.
fn material(raw: &Value, index: usize, cx: &Ctx) -> Value {
    let id_default = format!("mat-{}", index + 1);
    let Value::Object(m) = raw else {
        // DEFAULT_MATERIAL (its expressions: none)
        return json!({
            "id": id_default,
            "name": "Clay",
            "color": "#d4a373",
            "model": { "kind": "mohr-coulomb", "unitWeight": 18, "frictionAngle": 0, "cohesion": 12 },
            "modelExpressions": {},
        });
    };
    let path = format!("materials[{index}]");
    cx.keys(
        &path,
        m,
        &[
            "id",
            "name",
            "color",
            "depthRange",
            "model",
            "modelExpressions",
            // the flat fields of a file without a model
            "unitWeight",
            "frictionAngle",
            "cohesion",
        ],
    );
    let name = str_of(m.get("name")).unwrap_or("Clay");
    let color = str_of(m.get("color"))
        .filter(|c| !c.is_empty())
        .unwrap_or(MATERIAL_COLORS[index % MATERIAL_COLORS.len()]);
    let depth_range = match m.get("depthRange") {
        Some(Value::Array(d)) if d.len() >= 2 && d[0].is_number() && d[1].is_number() => {
            Some(json!([d[0], d[1]]))
        }
        _ => None,
    };
    let model = match m.get("model") {
        Some(Value::Object(mm)) if mm.contains_key("kind") => {
            let mut mm = mm.clone();
            if mm.contains_key("unitWeightSat") {
                let ok = num(mm.get("unitWeightSat")).is_some_and(|g| g > 0.0 && g <= 500.0);
                if !ok {
                    mm.remove("unitWeightSat");
                }
            }
            if str_of(mm.get("kind")) == Some("shear-normal")
                && !matches!(mm.get("points"), Some(Value::Array(_)))
            {
                mm.insert("points".into(), json!([]));
            }
            let sanitized = Value::Object(sanitize_material_model(mm, 0));
            material_model_keys(&format!("{path}.model"), &sanitized, cx);
            sanitized
        }
        _ => {
            // a file without a model: Mohr-Coulomb from the flat fields
            json!({
                "kind": "mohr-coulomb",
                "unitWeight": jmax(finite_or(m.get("unitWeight"), 18.0), 0.1),
                "frictionAngle": jmax(finite_or(m.get("frictionAngle"), 0.0), 0.0),
                "cohesion": jmax(finite_or(m.get("cohesion"), 0.0), 0.0),
            })
        }
    };
    let mut out = Obj::new();
    out.insert(
        "id".into(),
        json!(str_of(m.get("id")).map(str::to_owned).unwrap_or(id_default)),
    );
    out.insert("name".into(), json!(name));
    out.insert("color".into(), json!(color));
    if let Some(d) = depth_range {
        out.insert("depthRange".into(), d);
    }
    out.insert("model".into(), model);
    // `normalizeModelExpressions(raw, true)`: absent stays absent, else the
    // string-valued entries
    if let Some(Value::Object(e)) = m.get("modelExpressions") {
        let kept: Obj = e
            .iter()
            .filter(|(_, v)| v.is_string())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        out.insert("modelExpressions".into(), Value::Object(kept));
    }
    Value::Object(out)
}

/// The members of a material model the engine does not know, by its
/// schema (strict reading only).
fn material_model_keys(path: &str, model: &Value, cx: &Ctx) {
    if !cx.strict {
        return;
    }
    let wrapped = json!({
        "coordinates": [[0, 0], [10, 0], [10, 10]],
        "materials": [{ "name": "m", "model": model }],
    });
    cx.schema_unknown(path, &wrapped, "/materials/0/model");
}

/// `sanitizeMaterialModel`.
fn sanitize_material_model(model: Obj, depth: u32) -> Obj {
    let mut out = sanitize_drawdown(sanitize_b_bar(sanitize_suction(sanitize_strength_options(
        model,
    ))));
    if let Some(above) = out.get("aboveWater").cloned() {
        match above {
            Value::Object(a) if depth == 0 && a.get("kind").is_some_and(Value::is_string) => {
                out.insert(
                    "aboveWater".into(),
                    Value::Object(sanitize_material_model(a, depth + 1)),
                );
            }
            _ => {
                out.remove("aboveWater");
            }
        }
    }
    out
}

fn kind(m: &Obj) -> &str {
    str_of(m.get("kind")).unwrap_or("")
}

/// `sanitizeStrengthOptions`.
fn sanitize_strength_options(mut m: Obj) -> Obj {
    let k = kind(&m).to_owned();
    if !matches!(
        k.as_str(),
        "s-f-depth" | "s-f-datum" | "undrained" | "lime-cement-columns" | "shansep"
    ) {
        return m;
    }
    if m.contains_key("suMax") && !num(m.get("suMax")).is_some_and(|v| v > 0.0) {
        m.remove("suMax");
    }
    if m.contains_key("anisotropy") {
        let ok = matches!(m.get("anisotropy"), Some(Value::Array(a)) if !a.is_empty())
            && supports_anisotropy(&k);
        if !ok {
            m.remove("anisotropy");
        }
    }
    if k == "shansep" {
        for key in ["ocrByElevation", "suByStress"] {
            if m.contains_key(key) && !matches!(m.get(key), Some(Value::Array(a)) if !a.is_empty())
            {
                m.remove(key);
            }
        }
        if m.contains_key("suMin") && !num(m.get("suMin")).is_some_and(|v| v >= 0.0) {
            m.remove("suMin");
        }
    }
    if k == "s-f-depth"
        && m.contains_key("depthReference")
        && !matches!(
            str_of(m.get("depthReference")),
            Some("ground" | "layer-top")
        )
    {
        m.remove("depthReference");
    }
    m
}

/// `sanitizeBBar`.
fn sanitize_b_bar(mut m: Obj) -> Obj {
    if !m.contains_key("bBar") && !m.contains_key("bBarLoad") && !m.contains_key("ru") {
        return m;
    }
    if !num(m.get("ru")).is_some_and(|r| (0.0..1.0).contains(&r)) {
        m.remove("ru");
    }
    if !num(m.get("bBar")).is_some_and(|b| (0.0..=1.5).contains(&b)) {
        m.remove("bBar");
    }
    if m.get("bBarLoad") != Some(&Value::Bool(true)) {
        m.remove("bBarLoad");
    }
    m
}

/// `sanitizeDrawdown`.
fn sanitize_drawdown(mut m: Obj) -> Obj {
    if !m.contains_key("drawdownStrength") {
        return m;
    }
    let r = m.get("drawdownStrength");
    let c = num(r.and_then(|r| r.get("cohesion")));
    let phi = num(r.and_then(|r| r.get("frictionAngle")));
    match (kind(&m) == "mohr-coulomb", c, phi) {
        (true, Some(c), Some(phi)) if c >= 0.0 && (0.0..90.0).contains(&phi) => {
            m.insert(
                "drawdownStrength".into(),
                json!({ "cohesion": c, "frictionAngle": phi }),
            );
        }
        _ => {
            m.remove("drawdownStrength");
        }
    }
    m
}

/// `sanitizeSuction`.
fn sanitize_suction(mut m: Obj) -> Obj {
    if !m.contains_key("phiB") && !m.contains_key("maxSuction") {
        return m;
    }
    let supports = supports_suction_strength(kind(&m));
    if !(supports && num(m.get("phiB")).is_some_and(|p| (0.0..90.0).contains(&p))) {
        m.remove("phiB");
    }
    if !(supports && num(m.get("maxSuction")).is_some_and(|s| s > 0.0)) {
        m.remove("maxSuction");
    }
    m
}

// ── Water ───────────────────────────────────────────────────────

/// `normalizePiezo`.
fn piezo(raw: Option<&Value>, cx: &Ctx) -> Value {
    let default =
        json!({ "enabled": false, "lines": [], "activeLineId": null, "materialAssignment": {} });
    let Some(Value::Object(p)) = raw else {
        return default;
    };
    cx.keys(
        "piezometricLine",
        p,
        &[
            "enabled",
            "lines",
            "activeLineId",
            "materialAssignment",
            "freeWater",
            "mainLineId",
            "rapidDrawdown",
        ],
    );
    let lines: Vec<Value> = array(p.get("lines"))
        .enumerate()
        .filter(|(_, l)| is_object(Some(l)))
        .map(|(i, l)| {
            let path = format!("piezometricLine.lines[{i}]");
            let src = l.as_object().cloned().unwrap_or_default();
            cx.keys(
                &path,
                &src,
                &[
                    "id",
                    "name",
                    "color",
                    "coordinates",
                    "coordinateExpressions",
                ],
            );
            let mut line = Obj::new();
            line.insert("id".into(), json!(cx.id_of(src.get("id"), "piezo")));
            // the display fields as the model types read them
            for key in ["name", "color"] {
                if let Some(s) = str_of(src.get(key)) {
                    line.insert(key.into(), json!(s));
                }
            }
            let coordinates = points(src.get("coordinates"));
            if let Some(e) = coordinate_expressions(
                src.get("coordinateExpressions"),
                coordinates.len(),
                &format!("{path}.coordinateExpressions"),
                cx,
            ) {
                line.insert("coordinateExpressions".into(), e);
            }
            line.insert("coordinates".into(), Value::Array(coordinates));
            Value::Object(line)
        })
        .collect();
    let has_line = |id: Option<&str>| id.is_some_and(|id| lines.iter().any(|l| l["id"] == id));
    let active = str_of(p.get("activeLineId"))
        .filter(|id| has_line(Some(id)))
        .map(|s| json!(s))
        .or_else(|| lines.first().map(|l| l["id"].clone()))
        .unwrap_or(Value::Null);
    let mut assignment = Obj::new();
    if let Some(Value::Object(a)) = p.get("materialAssignment") {
        for (k, v) in a {
            if v.is_string() {
                assignment.insert(k.clone(), v.clone());
            }
        }
    }
    let mut out = Obj::new();
    // `piezo.enabled ?? false` (a boolean here)
    out.insert(
        "enabled".into(),
        json!(p.get("enabled") == Some(&Value::Bool(true))),
    );
    if let Some(Value::Bool(f)) = p.get("freeWater") {
        out.insert("freeWater".into(), json!(f));
    }
    if let Some(main) = str_of(p.get("mainLineId")).filter(|id| has_line(Some(id))) {
        out.insert("mainLineId".into(), json!(main));
    }
    out.insert("lines".into(), Value::Array(lines));
    out.insert("activeLineId".into(), active);
    out.insert("materialAssignment".into(), Value::Object(assignment));
    // `normalizeRapidDrawdown`: two or more finite points with x increasing
    if let Some(Value::Object(r)) = p.get("rapidDrawdown") {
        cx.keys("piezometricLine.rapidDrawdown", r, &["waterBefore"]);
        if let Some(Value::Array(pts)) = r.get("waterBefore") {
            let ok = pts.len() >= 2
                && pts.iter().all(is_finite_pair)
                && pts.windows(2).all(|w| w[1][0].as_f64() > w[0][0].as_f64());
            if ok {
                out.insert("rapidDrawdown".into(), json!({ "waterBefore": pts }));
            }
        }
    }
    Value::Object(out)
}

/// `normalizeWaternet`.
fn waternet(raw: Option<&Value>, cx: &Ctx) -> Option<Value> {
    let Some(Value::Object(w)) = raw else {
        return None;
    };
    cx.keys(
        "waternet",
        w,
        &["headLines", "referenceLines", "phreaticLineId"],
    );
    let (Some(Value::Array(heads)), Some(Value::Array(refs))) =
        (w.get("headLines"), w.get("referenceLines"))
    else {
        return None;
    };
    let head_lines: Vec<Value> = heads
        .iter()
        .enumerate()
        .filter_map(|(i, h)| {
            if let Some(o) = h.as_object() {
                cx.keys(&format!("waternet.headLines[{i}]"), o, &["id", "points"]);
            }
            let id = str_of(h.get("id"))?;
            Some(json!({ "id": id, "points": points(h.get("points")) }))
        })
        .collect();
    let reference_lines: Vec<Value> = refs
        .iter()
        .enumerate()
        .filter(|(_, r)| is_object(Some(r)))
        .map(|(i, r)| {
            if let Some(o) = r.as_object() {
                cx.keys(
                    &format!("waternet.referenceLines[{i}]"),
                    o,
                    &["points", "topHeadLineId", "bottomHeadLineId"],
                );
            }
            let mut o = Obj::new();
            o.insert("points".into(), Value::Array(points(r.get("points"))));
            for key in ["topHeadLineId", "bottomHeadLineId"] {
                if let Some(s) = str_of(r.get(key)) {
                    o.insert(key.into(), json!(s));
                }
            }
            Value::Object(o)
        })
        .collect();
    let mut out = Obj::new();
    out.insert("headLines".into(), Value::Array(head_lines));
    out.insert("referenceLines".into(), Value::Array(reference_lines));
    if let Some(s) = str_of(w.get("phreaticLineId")) {
        out.insert("phreaticLineId".into(), json!(s));
    }
    Some(Value::Object(out))
}

// ── Loads, reinforcement, piles ─────────────────────────────────

/// `normalizeLoadExpressions`: the string-valued entries of the allowed
/// keys, or nothing.
fn load_expressions(raw: Option<&Value>, allowed: &[&str], path: &str, cx: &Ctx) -> Option<Value> {
    let e = obj(raw)?;
    cx.keys(path, e, allowed);
    let kept: Obj = e
        .iter()
        .filter(|(k, v)| allowed.contains(&k.as_str()) && v.is_string())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    (!kept.is_empty()).then_some(Value::Object(kept))
}

/// `normalizeUdl`.
fn udl(raw: &Value, index: usize, cx: &Ctx) -> Option<Value> {
    let u = raw.as_object()?;
    let path = format!("udls[{index}]");
    cx.keys(
        &path,
        u,
        &[
            "id",
            "magnitude",
            "x1",
            "x2",
            "direction",
            "excessPorePressure",
            "expressions",
        ],
    );
    let id = str_of(u.get("id")).filter(|s| !s.is_empty())?;
    let magnitude = finite_or(u.get("magnitude"), 0.0);
    let x1 = finite_or(u.get("x1"), 0.0);
    let x2 = finite_or(u.get("x2"), 0.0);
    if x1 == x2 {
        return None;
    }
    let mut out = Obj::new();
    out.insert("id".into(), json!(id));
    out.insert("magnitude".into(), json!(magnitude));
    out.insert("x1".into(), json!(x1));
    out.insert("x2".into(), json!(x2));
    if str_of(u.get("direction")) == Some("normal") {
        out.insert("direction".into(), json!("normal"));
    }
    let excess: Vec<Value> = array(u.get("excessPorePressure"))
        .enumerate()
        .filter_map(|(i, e)| {
            if let Some(o) = e.as_object() {
                cx.keys(
                    &format!("{path}.excessPorePressure[{i}]"),
                    o,
                    &["materialId", "ratio"],
                );
            }
            let m = str_of(e.get("materialId"))?;
            let r = num(e.get("ratio")).filter(|r| (0.0..=1.0).contains(r))?;
            Some(json!({ "materialId": m, "ratio": r }))
        })
        .collect();
    if !excess.is_empty() {
        out.insert("excessPorePressure".into(), Value::Array(excess));
    }
    if let Some(e) = load_expressions(
        u.get("expressions"),
        &["magnitude", "x1", "x2"],
        &format!("{path}.expressions"),
        cx,
    ) {
        out.insert("expressions".into(), e);
    }
    Some(Value::Object(out))
}

/// `normalizeLineLoad`.
fn line_load(raw: &Value, index: usize, cx: &Ctx) -> Option<Value> {
    let l = raw.as_object()?;
    let path = format!("lineLoads[{index}]");
    cx.keys(
        &path,
        l,
        &["id", "magnitude", "x", "angle", "y", "expressions"],
    );
    let id = str_of(l.get("id")).filter(|s| !s.is_empty())?;
    let mut out = Obj::new();
    out.insert("id".into(), json!(id));
    out.insert(
        "magnitude".into(),
        json!(finite_or(l.get("magnitude"), 0.0)),
    );
    out.insert("x".into(), json!(finite_or(l.get("x"), 0.0)));
    if let Some(a) = num(l.get("angle")).filter(|a| *a != 0.0 && a.abs() <= 180.0) {
        out.insert("angle".into(), json!(a));
    }
    if let Some(y) = num(l.get("y")) {
        out.insert("y".into(), json!(y));
    }
    if let Some(e) = load_expressions(
        l.get("expressions"),
        &["magnitude", "x"],
        &format!("{path}.expressions"),
        cx,
    ) {
        out.insert("expressions".into(), e);
    }
    Some(Value::Object(out))
}

/// `reinforcementPreset` of a type: (tensile capacity, spacing, pullout,
/// bond strength, bonded length, interface friction, end 1 capacity,
/// direction, application).
fn reinforcement_preset(
    kind: &str,
) -> (
    f64,
    f64,
    &'static str,
    f64,
    f64,
    f64,
    f64,
    &'static str,
    &'static str,
) {
    match kind {
        "anchor" => (200.0, 2.0, "none", 0.0, 0.0, 0.0, 0.0, "axial", "active"),
        "tieback" => (300.0, 2.0, "bond", 60.0, 5.0, 0.0, 300.0, "axial", "active"),
        "nail" => (100.0, 1.5, "bond", 15.0, 0.0, 0.0, 50.0, "axial", "passive"),
        _ => (
            50.0,
            1.0,
            "interface",
            0.0,
            0.0,
            20.0,
            0.0,
            "tangent",
            "passive",
        ),
    }
}

fn pick<'a>(v: Option<&'a Value>, allowed: &[&'a str], fallback: &'a str) -> &'a str {
    match str_of(v) {
        Some(s) if allowed.contains(&s) => allowed.iter().find(|a| **a == s).copied().unwrap(),
        _ => fallback,
    }
}

/// `sanitizeReinforcement`.
fn reinforcement(raw: &Value, index: usize, cx: &Ctx) -> Option<Value> {
    let r = raw.as_object()?;
    cx.keys(
        &format!("reinforcements[{index}]"),
        r,
        &[
            "id",
            "label",
            "type",
            "x1",
            "y1",
            "x2",
            "y2",
            "tensileCapacity",
            "spacing",
            "pullout",
            "developmentLength1",
            "developmentLength2",
            "bondStrength",
            "bondedLength",
            "prestress",
            "adhesion",
            "interfaceFriction",
            "end1Capacity",
            "end2Capacity",
            "direction",
            "application",
        ],
    );
    let kind = str_of(r.get("type"))
        .filter(|t| matches!(*t, "anchor" | "tieback" | "nail" | "geosynthetic"))?;
    let (x1, y1, x2, y2) = (
        num(r.get("x1"))?,
        num(r.get("y1"))?,
        num(r.get("x2"))?,
        num(r.get("y2"))?,
    );
    let (tensile, spacing, pullout, bond, bonded, friction, end1, direction, application) =
        reinforcement_preset(kind);
    let at_least =
        |k: &str, fallback: f64, min: f64| num(r.get(k)).filter(|v| *v >= min).unwrap_or(fallback);
    let mut out = Obj::new();
    out.insert(
        "id".into(),
        json!(str_of(r.get("id"))
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| cx.next("reinf"))),
    );
    if let Some(l) = str_of(r.get("label")) {
        out.insert("label".into(), json!(l));
    }
    out.insert("type".into(), json!(kind));
    out.insert("x1".into(), json!(x1));
    out.insert("y1".into(), json!(y1));
    out.insert("x2".into(), json!(x2));
    out.insert("y2".into(), json!(y2));
    out.insert(
        "tensileCapacity".into(),
        json!(at_least("tensileCapacity", tensile, 0.0)),
    );
    out.insert(
        "spacing".into(),
        json!(num(r.get("spacing"))
            .filter(|s| *s > 0.0)
            .unwrap_or(spacing)),
    );
    out.insert(
        "pullout".into(),
        json!(pick(
            r.get("pullout"),
            &["none", "bond", "interface", "development"],
            pullout
        )),
    );
    if r.contains_key("developmentLength1") || r.contains_key("developmentLength2") {
        out.insert(
            "developmentLength1".into(),
            json!(at_least("developmentLength1", 0.0, 0.0)),
        );
        out.insert(
            "developmentLength2".into(),
            json!(at_least("developmentLength2", 0.0, 0.0)),
        );
    }
    out.insert(
        "bondStrength".into(),
        json!(at_least("bondStrength", bond, 0.0)),
    );
    out.insert(
        "bondedLength".into(),
        json!(at_least("bondedLength", bonded, 0.0)),
    );
    if let Some(p) = num(r.get("prestress")).filter(|p| *p > 0.0) {
        out.insert("prestress".into(), json!(p));
    }
    out.insert("adhesion".into(), json!(at_least("adhesion", 0.0, 0.0)));
    out.insert(
        "interfaceFriction".into(),
        json!(num(r.get("interfaceFriction"))
            .filter(|f| (0.0..90.0).contains(f))
            .unwrap_or(friction)),
    );
    out.insert(
        "end1Capacity".into(),
        json!(at_least("end1Capacity", end1, 0.0)),
    );
    out.insert(
        "end2Capacity".into(),
        json!(at_least("end2Capacity", 0.0, 0.0)),
    );
    out.insert(
        "direction".into(),
        json!(pick(
            r.get("direction"),
            &["axial", "tangent", "bisector"],
            direction
        )),
    );
    // a geosynthetic saved without an application was active
    let app_fallback = if kind == "geosynthetic" {
        "active"
    } else {
        application
    };
    out.insert(
        "application".into(),
        json!(pick(
            r.get("application"),
            &["active", "passive"],
            app_fallback
        )),
    );
    Some(Value::Object(out))
}

/// `sanitizePile`.
fn pile(raw: &Value, index: usize, cx: &Ctx) -> Option<Value> {
    let p = raw.as_object()?;
    cx.keys(
        &format!("piles[{index}]"),
        p,
        &[
            "id",
            "label",
            "type",
            "x1",
            "y1",
            "x2",
            "y2",
            "mode",
            "force",
            "diameter",
            "spacing",
            "shearCapacity",
            "momentCapacity",
            "bendingStiffness",
            "angle",
            "direction",
            "application",
            "location",
        ],
    );
    let kind = str_of(p.get("type")).filter(|t| matches!(*t, "pile" | "sheet-pile"))?;
    let (x1, y1, x2, y2) = (
        num(p.get("x1"))?,
        num(p.get("y1"))?,
        num(p.get("x2"))?,
        num(p.get("y2"))?,
    );
    // pilePreset: (mode, spacing, application)
    let (mode, spacing, application) = if kind == "pile" {
        ("ito-matsui", 2.0, "passive")
    } else {
        ("force", 1.0, "active")
    };
    let checked = |k: &str, fallback: f64, ok: &dyn Fn(f64) -> bool| {
        num(p.get(k)).filter(|v| ok(*v)).unwrap_or(fallback)
    };
    let mut out = Obj::new();
    out.insert(
        "id".into(),
        json!(str_of(p.get("id"))
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| cx.next("pile"))),
    );
    if let Some(l) = str_of(p.get("label")) {
        out.insert("label".into(), json!(l));
    }
    out.insert("type".into(), json!(kind));
    out.insert("x1".into(), json!(x1));
    out.insert("y1".into(), json!(y1));
    out.insert("x2".into(), json!(x2));
    out.insert("y2".into(), json!(y2));
    out.insert(
        "mode".into(),
        json!(pick(p.get("mode"), &["force", "ito-matsui"], mode)),
    );
    out.insert(
        "force".into(),
        json!(checked("force", 100.0, &|v| v >= 0.0)),
    );
    out.insert(
        "diameter".into(),
        json!(checked("diameter", 0.6, &|v| v > 0.0)),
    );
    out.insert(
        "spacing".into(),
        json!(checked("spacing", spacing, &|v| v > 0.0)),
    );
    out.insert(
        "shearCapacity".into(),
        json!(checked("shearCapacity", 0.0, &|v| v >= 0.0)),
    );
    out.insert(
        "momentCapacity".into(),
        json!(checked("momentCapacity", 0.0, &|v| v >= 0.0)),
    );
    if let Some(e) = num(p.get("bendingStiffness")).filter(|e| *e > 0.0) {
        out.insert("bendingStiffness".into(), json!(e));
    }
    out.insert(
        "angle".into(),
        json!(checked("angle", 0.0, &|v| v.abs() < 90.0)),
    );
    if let Some(d) =
        str_of(p.get("direction")).filter(|d| matches!(*d, "tangent" | "perpendicular" | "angle"))
    {
        out.insert("direction".into(), json!(d));
    }
    out.insert(
        "application".into(),
        json!(pick(
            p.get("application"),
            &["active", "passive"],
            application
        )),
    );
    if let Some(l) = str_of(p.get("location")).filter(|l| matches!(*l, "centroid" | "slip-surface"))
    {
        out.insert("location".into(), json!(l));
    }
    Some(Value::Object(out))
}

// ── Search ──────────────────────────────────────────────────────

/// `normalizeAnalysisLimits`: a file without limits searches the whole slope.
fn analysis_limits(raw: Option<&Value>, cx: &Ctx) -> Value {
    let d = crate::model::DEFAULT_ANALYSIS_LIMITS;
    let Some(a) = raw.filter(|a| is_object(Some(a))) else {
        return json!({ "enabled": false, "entryLeftX": d.entry_left_x, "entryRightX": d.entry_right_x, "exitLeftX": d.exit_left_x, "exitRightX": d.exit_right_x });
    };
    if let Some(o) = a.as_object() {
        cx.keys(
            "analysisLimits",
            o,
            &[
                "enabled",
                "entryLeftX",
                "entryRightX",
                "exitLeftX",
                "exitRightX",
            ],
        );
    }
    json!({
        "enabled": bool_of(a.get("enabled")).unwrap_or(d.enabled),
        "entryLeftX": finite_or(a.get("entryLeftX"), d.entry_left_x),
        "entryRightX": finite_or(a.get("entryRightX"), d.entry_right_x),
        "exitLeftX": finite_or(a.get("exitLeftX"), d.exit_left_x),
        "exitRightX": finite_or(a.get("exitRightX"), d.exit_right_x),
    })
}

/// A custom search plane as the app reads it.
fn custom_plane(raw: &Value, index: usize, cx: &Ctx) -> Option<Value> {
    let p = raw.as_object()?;
    cx.keys(
        &format!("customSearchPlanes[{index}]"),
        p,
        &["id", "cx", "cy", "radius", "points"],
    );
    if let Some(Value::Array(_)) = p.get("points") {
        return Some(
            json!({ "id": cx.id_of(p.get("id"), "plane"), "cx": 0, "cy": 0, "radius": 0, "points": points(p.get("points")) }),
        );
    }
    let (cx_, cy, radius) = (num(p.get("cx"))?, num(p.get("cy"))?, num(p.get("radius"))?);
    if radius <= 0.0 {
        return None;
    }
    Some(json!({ "id": cx.id_of(p.get("id"), "plane"), "cx": cx_, "cy": cy, "radius": radius }))
}

// ── Options ─────────────────────────────────────────────────────

const OPTION_KEYS: [&str; 29] = [
    "slices",
    "iterations",
    "refinedIterations",
    "minFailureDist",
    "tolerance",
    "maxIterations",
    "method",
    "janbuCorrection",
    "intersliceFunction",
    "intersliceDataPoints",
    "porePressureHead",
    "tensionCrackDepth",
    "tensionCrackWater",
    "tensionCrackAuto",
    "tensionCrackAngle",
    "compositeSurfaces",
    "compositeBase",
    "seismicHorizontal",
    "seismicVertical",
    "partialFactors",
    "bothDirections",
    "nonCircularOptimization",
    "searchMethod",
    "blockActiveAngle",
    "blockPassiveAngle",
    "minSlipDepth",
    "minSlipArea",
    "fem",
    "sgi3d",
];

/// `normalizeAnalysisOptions`: the app's defaults with each saved field
/// checked; unknown fields dropped.
fn analysis_options(raw: &Value, cx: &Ctx) -> Obj {
    let mut out = app_default_options();
    let Some(o) = raw.as_object() else { return out };
    cx.keys("options", o, &OPTION_KEYS);
    let base = out.clone();
    let b = |k: &str| num(base.get(k)).unwrap_or(0.0);
    let set = |out: &mut Obj, k: &str, v: Value| {
        out.insert(k.into(), v);
    };

    if let Some(f) = str_of(o.get("intersliceFunction")).filter(|f| {
        matches!(
            *f,
            "constant" | "half-sine" | "clipped-sine" | "trapezoidal" | "data-point-specified"
        )
    }) {
        set(&mut out, "intersliceFunction", json!(f));
    }
    // numbers or numeric text
    let point_value = |v: &Value| match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) if !s.trim().is_empty() => {
            s.trim().parse::<f64>().ok().filter(|x| x.is_finite())
        }
        _ => None,
    };
    if let Some(Value::Array(points)) = o.get("intersliceDataPoints") {
        let kept: Vec<Value> = points
            .iter()
            .filter_map(|p| {
                let q = p.as_array()?;
                Some(json!([point_value(q.first()?)?, point_value(q.get(1)?)?]))
            })
            .collect();
        set(&mut out, "intersliceDataPoints", Value::Array(kept));
    }
    if let Some(Value::Bool(j)) = o.get("janbuCorrection") {
        set(&mut out, "janbuCorrection", json!(j));
    }
    if let Some(m) =
        str_of(o.get("method")).filter(|m| matches!(*m, "Bishop" | "Janbu" | "Morgenstern-Price"))
    {
        set(&mut out, "method", json!(m));
    }
    set(
        &mut out,
        "slices",
        json!(clamp(
            finite_or(o.get("slices"), b("slices")),
            SLICES_RANGE.min,
            SLICES_RANGE.max
        )),
    );
    set(
        &mut out,
        "iterations",
        json!(clamp(
            finite_or(o.get("iterations"), b("iterations")),
            ITERATIONS_RANGE.min,
            ITERATIONS_RANGE.max
        )),
    );
    set(
        &mut out,
        "refinedIterations",
        json!(clamp(
            finite_or(o.get("refinedIterations"), b("refinedIterations")),
            REFINED_ITERATIONS_RANGE.min,
            REFINED_ITERATIONS_RANGE.max
        )),
    );
    set(
        &mut out,
        "minFailureDist",
        json!(jmax(
            finite_or(o.get("minFailureDist"), b("minFailureDist")),
            0.0
        )),
    );
    set(
        &mut out,
        "tolerance",
        json!(clamp(
            finite_or(o.get("tolerance"), b("tolerance")),
            TOLERANCE_RANGE.0,
            TOLERANCE_RANGE.1
        )),
    );
    set(
        &mut out,
        "maxIterations",
        json!(jmax(
            finite_or(o.get("maxIterations"), b("maxIterations")),
            1.0
        )),
    );
    if let Some(pf) = partial_factors(o.get("partialFactors"), cx) {
        set(&mut out, "partialFactors", pf);
    }
    if o.get("bothDirections") == Some(&Value::Bool(true)) {
        set(&mut out, "bothDirections", json!(true));
    }
    // composite surfaces: on for new projects; a project saved before the
    // option existed keeps circles only
    set(
        &mut out,
        "compositeSurfaces",
        json!(o.get("compositeSurfaces") == Some(&Value::Bool(true))),
    );
    for key in [
        "compositeBase",
        "nonCircularOptimization",
        "tensionCrackAuto",
    ] {
        if o.get(key) == Some(&Value::Bool(true)) {
            set(&mut out, key, json!(true));
        }
    }
    if let Some(d) = num(o.get("minSlipDepth")).filter(|d| *d > 0.0) {
        set(&mut out, "minSlipDepth", json!(d));
    }
    if let Some(a) = num(o.get("minSlipArea")).filter(|a| *a >= 0.0) {
        set(&mut out, "minSlipArea", json!(a));
    }
    if let Some(k) = num(o.get("seismicHorizontal")).filter(|k| *k > 0.0 && *k <= 1.0) {
        set(&mut out, "seismicHorizontal", json!(k));
    }
    if let Some(k) = num(o.get("seismicVertical")).filter(|k| *k != 0.0 && k.abs() <= 1.0) {
        set(&mut out, "seismicVertical", json!(k));
    }
    if let Some(a) = num(o.get("tensionCrackAngle")).filter(|a| *a > 0.0 && *a < 90.0) {
        set(&mut out, "tensionCrackAngle", json!(a));
    }
    if str_of(o.get("searchMethod")) == Some("block") {
        set(&mut out, "searchMethod", json!("block"));
    }
    for key in ["blockActiveAngle", "blockPassiveAngle"] {
        if let Some(r) = angle_range(o.get(key)) {
            set(&mut out, key, r);
        }
    }
    set(
        &mut out,
        "tensionCrackDepth",
        json!(jmax(
            finite_or(o.get("tensionCrackDepth"), b("tensionCrackDepth")),
            0.0
        )),
    );
    set(
        &mut out,
        "tensionCrackWater",
        json!(clamp(
            finite_or(o.get("tensionCrackWater"), b("tensionCrackWater")),
            0.0,
            1.0
        )),
    );
    if let Some(h) = str_of(o.get("porePressureHead"))
        .filter(|h| matches!(*h, "vertical" | "phreatic-correction"))
    {
        set(&mut out, "porePressureHead", json!(h));
    }
    if let Some(Value::Object(f)) = o.get("fem") {
        set(&mut out, "fem", fem_settings(f, cx));
    }
    if let Some(Value::Object(s)) = o.get("sgi3d") {
        set(&mut out, "sgi3d", sgi3d_settings(s, cx));
    }
    out
}

/// `angleRangeOrNull`: [min, max] with 0° < min ≤ max < 90°.
fn angle_range(raw: Option<&Value>) -> Option<Value> {
    let a = raw?.as_array().filter(|a| a.len() == 2)?;
    let (lo, hi) = (num(a.first())?, num(a.get(1))?);
    (lo > 0.0 && hi < 90.0 && lo <= hi).then(|| json!([lo, hi]))
}

/// `normalizePartialFactors`.
fn partial_factors(raw: Option<&Value>, cx: &Ctx) -> Option<Value> {
    let f = raw.filter(|v| is_object(Some(v)))?;
    if let Some(o) = f.as_object() {
        cx.keys(
            "options.partialFactors",
            o,
            &["cu", "cohesion", "tanPhi", "variableLoad", "basis"],
        );
        if let Some(b) = obj(o.get("basis")) {
            cx.keys(
                "options.partialFactors.basis",
                b,
                &["safetyClass", "etaCu", "etaDrained", "variableLoadBase"],
            );
        }
    }
    let factor = |k: &str| num(f.get(k)).filter(|v| *v > 0.0).unwrap_or(1.0);
    let mut out = json!({
        "cu": factor("cu"),
        "cohesion": factor("cohesion"),
        "tanPhi": factor("tanPhi"),
        "variableLoad": factor("variableLoad"),
    });
    // how the factors were formed: kept when it gives these factors
    if let Some(basis) = f.get("basis").filter(|b| is_object(Some(b))) {
        if let Ok(basis) = serde_json::from_value::<SwedishFactorBasis>(basis.clone()) {
            if let Ok(formed) = swedish_partial_factors(&basis) {
                let same = [
                    (formed.cu, "cu"),
                    (formed.cohesion, "cohesion"),
                    (formed.tan_phi, "tanPhi"),
                    (formed.variable_load, "variableLoad"),
                ]
                .iter()
                .all(|(v, k)| (v - out[*k].as_f64().unwrap()).abs() < 1e-9);
                if same {
                    out["basis"] = serde_json::to_value(formed.basis).unwrap();
                }
            }
        }
    }
    Some(out)
}

/// `normalizeFemSettings`.
fn fem_settings(f: &Obj, cx: &Ctx) -> Value {
    cx.keys(
        "options.fem",
        f,
        &[
            "enabled",
            "flowRule",
            "youngsModulus",
            "poissonsRatio",
            "dilationAngle",
            "elementSize",
            "tensionCutoff",
            "refinementLevels",
            "porePressure",
            "nonAssociatedSolver",
            "convergence",
            "limitAnalysis",
            "initialStress",
            "k0",
            "originalGroundLevel",
            "materialStages",
        ],
    );
    let d = default_fem_settings();
    let in_range = |k: &str, lo: f64, hi: f64, fallback: f64| {
        num(f.get(k))
            .filter(|v| *v >= lo && *v <= hi)
            .unwrap_or(fallback)
    };
    // LEGACY_FEM_FLOW_RULE without a valid one
    let flow_rule = str_of(f.get("flowRule"))
        .filter(|r| matches!(*r, "associated" | "non-associated" | "davis-b"))
        .unwrap_or("non-associated");
    let mut out = Obj::new();
    out.insert(
        "enabled".into(),
        json!(f.get("enabled") == Some(&Value::Bool(true))),
    );
    out.insert("flowRule".into(), json!(flow_rule));
    out.insert(
        "youngsModulus".into(),
        json!(in_range("youngsModulus", 1.0, 1e9, d.youngs_modulus)),
    );
    out.insert(
        "poissonsRatio".into(),
        json!(in_range("poissonsRatio", 0.0, 0.49, d.poissons_ratio)),
    );
    out.insert(
        "dilationAngle".into(),
        json!(in_range("dilationAngle", 0.0, 60.0, d.dilation_angle)),
    );
    out.insert(
        "elementSize".into(),
        num(f.get("elementSize"))
            .filter(|s| *s > 0.0)
            .map_or(Value::Null, |s| json!(s)),
    );
    out.insert(
        "tensionCutoff".into(),
        json!(f.get("tensionCutoff") == Some(&Value::Bool(true))),
    );
    out.insert(
        "refinementLevels".into(),
        json!(cslope_engine::js::math::round(in_range(
            "refinementLevels",
            0.0,
            3.0,
            d.refinement_levels
        ))),
    );
    for (key, value) in [
        ("porePressure", "seepage"),
        ("nonAssociatedSolver", "newton"),
        ("convergence", "equilibrium"),
        ("initialStress", "k0"),
    ] {
        if str_of(f.get(key)) == Some(value) {
            out.insert(key.into(), json!(value));
        }
    }
    if f.get("limitAnalysis") == Some(&Value::Bool(true)) {
        out.insert("limitAnalysis".into(), json!(true));
    }
    if let Some(k0) = num(f.get("k0")).filter(|k| *k > 0.0 && *k <= 5.0) {
        out.insert("k0".into(), json!(k0));
    }
    if let Some(g) = num(f.get("originalGroundLevel")) {
        out.insert("originalGroundLevel".into(), json!(g));
    }
    // stagesOf: integer stages 0–20 per material name
    if let Some(Value::Object(s)) = f.get("materialStages") {
        let stages: Obj = s
            .iter()
            .filter(|(_, v)| {
                num(Some(v)).is_some_and(|n| n.fract() == 0.0 && (0.0..=20.0).contains(&n))
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        if !stages.is_empty() {
            out.insert("materialStages".into(), Value::Object(stages));
        }
    }
    Value::Object(out)
}

/// `normalizeSgi3dSettings`.
fn sgi3d_settings(s: &Obj, cx: &Ctx) -> Value {
    cx.keys(
        "options.sgi3d",
        s,
        &["enabled", "length", "overstrongF2D", "excludeMaterials"],
    );
    let length = num(s.get("length")).filter(|l| *l > 0.0).unwrap_or(15.0);
    let overstrong = num(s.get("overstrongF2D"))
        .filter(|v| *v > 0.0)
        .map_or(Value::Null, |v| json!(v));
    let mut exclude: Vec<&str> = Vec::new();
    for n in array(s.get("excludeMaterials")).filter_map(Value::as_str) {
        if !exclude.contains(&n) {
            exclude.push(n);
        }
    }
    json!({
        "enabled": s.get("enabled") == Some(&Value::Bool(true)),
        "length": length,
        "overstrongF2D": overstrong,
        "excludeMaterials": exclude,
    })
}

// ── Earlier stage ───────────────────────────────────────────────

/// The fields of an earlier stage besides its outline and materials
/// (`STAGE_FIELDS`).
const STAGE_FIELDS: [&str; 17] = [
    "orientation",
    "waterTable",
    "waterTables",
    "udls",
    "lineLoads",
    "rapidDrawdown",
    "waternet",
    "reinforcements",
    "piles",
    "materialBoundaries",
    "topRegionMaterialName",
    "regionAssignments",
    "analysisLimits",
    "customSearchPlanes",
    "customSurfaces",
    "customPlanesOnly",
    "blockSearchObjects",
];

/// `normalizeEarlierStage`: kept with an outline and valid materials,
/// dropped otherwise.
fn earlier_stage(raw: Option<&Value>, cx: &Ctx) -> Option<Value> {
    let d = raw?.as_object()?;
    if cx.strict {
        for k in d.keys() {
            if k != "coordinates" && k != "materials" && !STAGE_FIELDS.contains(&k.as_str()) {
                cx.unknown(format!("earlierStage.{k}"));
            }
        }
    }
    let (Some(Value::Array(_)), Some(Value::Array(mats))) =
        (d.get("coordinates"), d.get("materials"))
    else {
        return None;
    };
    let coordinates = points(d.get("coordinates"));
    let materials: Vec<Value> = mats
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            let q = m.as_object()?;
            cx.keys(
                &format!("earlierStage.materials[{i}]"),
                q,
                &["name", "model", "color", "waterTableId", "depthRange"],
            );
            let name = str_of(q.get("name"))?;
            let Some(Value::Object(model)) = q.get("model") else {
                return None;
            };
            if !model.get("kind").is_some_and(Value::is_string) {
                return None;
            }
            let model = Value::Object(sanitize_material_model(model.clone(), 0));
            // the app's validateMaterialModel (the wasm's: the model read, then checked)
            let typed = serde_json::from_value::<MaterialModel>(model.clone()).ok()?;
            if !try_validate_material_model(&typed).is_ok_and(|e| e.is_empty()) {
                return None;
            }
            let mut kept = Obj::new();
            kept.insert("name".into(), json!(name));
            kept.insert("model".into(), model);
            if let Some(c) = str_of(q.get("color")) {
                kept.insert("color".into(), json!(c));
            }
            if let Some(w) = str_of(q.get("waterTableId")) {
                kept.insert("waterTableId".into(), json!(w));
            }
            if let Some(r) = point_of(q.get("depthRange")) {
                kept.insert("depthRange".into(), r);
            }
            Some(Value::Object(kept))
        })
        .collect();
    if coordinates.len() < 3 || materials.is_empty() {
        return None;
    }
    let names: Vec<&str> = materials
        .iter()
        .filter_map(|m| m["name"].as_str())
        .collect();
    let mut stage = Obj::new();
    for key in STAGE_FIELDS {
        if let Some(v) = d.get(key) {
            stage.insert(key.into(), v.clone());
        }
    }
    if let Some(b) = stage.get("materialBoundaries").cloned() {
        let kept: Vec<Value> = array(Some(&b))
            .map(|b| {
                let name = str_of(b.get("materialName"))
                    .filter(|n| names.contains(n))
                    .unwrap_or("");
                json!({ "coordinates": points(b.get("coordinates")), "materialName": name })
            })
            .filter(|b| b["coordinates"].as_array().unwrap().len() >= 2)
            .collect();
        stage.insert("materialBoundaries".into(), Value::Array(kept));
    }
    if let Some(a) = stage.get("regionAssignments").cloned() {
        let kept: Vec<Value> = array(Some(&a))
            .filter_map(|a| {
                let p = point_of(a.get("point"))?;
                let n = str_of(a.get("materialName")).filter(|n| names.contains(n))?;
                Some(json!({ "point": p, "materialName": n }))
            })
            .collect();
        stage.insert("regionAssignments".into(), Value::Array(kept));
    }
    if stage.contains_key("topRegionMaterialName")
        && !str_of(stage.get("topRegionMaterialName")).is_some_and(|n| names.contains(&n))
    {
        stage.remove("topRegionMaterialName");
    }
    match stage_water_table(stage.get("waterTable")) {
        Some(w) => {
            stage.insert("waterTable".into(), w);
        }
        None => {
            stage.remove("waterTable");
        }
    }
    if let Some(w) = stage.get("waterTables").cloned() {
        let kept: Vec<Value> = array(Some(&w))
            .filter_map(|w| {
                let id = str_of(w.get("id"))?;
                let c = points(w.get("coordinates"));
                if c.len() < 2 {
                    return None;
                }
                let mut o = json!({ "id": id, "coordinates": c });
                stage_water_flags(w, &mut o);
                Some(o)
            })
            .collect();
        stage.insert("waterTables".into(), Value::Array(kept));
    }
    if let Some(u) = stage.get("udls").cloned() {
        let kept: Vec<Value> = array(Some(&u))
            .filter_map(|u| stage_udl(u, &names))
            .collect();
        stage.insert("udls".into(), Value::Array(kept));
    }
    stage.insert("coordinates".into(), Value::Array(coordinates));
    stage.insert("materials".into(), Value::Array(materials));
    let stage = Value::Object(stage);
    // the members the stage keeps as they are, by the engine's schema
    cx.schema_unknown("earlierStage", &stage, "");
    Some(stage)
}

/// `stageWaterFlags`: `followBoundary` and `freeWater` when booleans (a
/// false one too: the engine's default for a missing one is not false).
fn stage_water_flags(w: &Value, out: &mut Value) {
    for key in ["followBoundary", "freeWater"] {
        if let Some(Value::Bool(b)) = w.get(key) {
            out[key] = json!(b);
        }
    }
}

/// `normalizeStageWaterTable`.
fn stage_water_table(raw: Option<&Value>) -> Option<Value> {
    let w = raw?.as_object()?;
    let mut out = match str_of(w.get("mode")) {
        Some("custom") => {
            let value = points(w.get("value"));
            if value.len() < 2 {
                return None;
            }
            json!({ "mode": "custom", "value": value })
        }
        Some(mode @ ("height" | "depth")) => json!({ "mode": mode, "value": num(w.get("value"))? }),
        _ => return None,
    };
    stage_water_flags(&Value::Object(w.clone()), &mut out);
    Some(out)
}

/// `normalizeStageUdl`.
fn stage_udl(raw: &Value, names: &[&str]) -> Option<Value> {
    let u = raw.as_object()?;
    let (magnitude, x1, x2) = (
        num(u.get("magnitude"))?,
        num(u.get("x1"))?,
        num(u.get("x2"))?,
    );
    if x1 == x2 {
        return None;
    }
    let excess: Vec<Value> = array(u.get("excessPorePressure"))
        .filter_map(|e| {
            let m = str_of(e.get("material")).filter(|m| names.contains(m))?;
            let r = num(e.get("ratio")).filter(|r| (0.0..=1.0).contains(r))?;
            Some(json!({ "material": m, "ratio": r }))
        })
        .collect();
    let mut out = json!({ "magnitude": magnitude, "x1": x1, "x2": x2 });
    if str_of(u.get("direction")) == Some("normal") {
        out["direction"] = json!("normal");
    }
    if !excess.is_empty() {
        out["excessPorePressure"] = Value::Array(excess);
    }
    Some(out)
}

// ── The result sheet ────────────────────────────────────────────

const PAPER_SIZES: [&str; 5] = ["A4", "A3", "A2", "A1", "A0"];

/// `DISPLAY_LAYER_KEYS` (features/results/layers.ts).
const DISPLAY_LAYER_KEYS: [&str; 9] = [
    "soilColor",
    "femMesh",
    "femPlasticZone",
    "surfaces",
    "customSurfaces",
    "criticalSurface",
    "slices",
    "center",
    "fosLabel",
];
const DRAWING_LAYER_PREFIX: &str = "drawing:";

/// `FOS_SCHEME_PRESETS` ids and "custom" (utils/fos-color.ts).
const FOS_SCHEME_IDS: [&str; 6] = [
    "classic",
    "traffic",
    "cool-warm",
    "viridis",
    "greyscale",
    "custom",
];

/// `isHexColor`: "#rrggbb" (either case).
fn is_hex_color(v: Option<&Value>) -> bool {
    str_of(v).is_some_and(|s| {
        s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
    })
}

const PAPER_ANNOTATION_KEYS: [&str; 23] = [
    "id",
    "type",
    "x",
    "y",
    "anchor",
    "width",
    "height",
    "text",
    "fontSize",
    "fontFamily",
    "bold",
    "italic",
    "color",
    "tableColumns",
    "plotAxisX",
    "plotAxisY",
    "scaleMode",
    "scaleMin",
    "scaleMax",
    "scheme",
    "schemeFrom",
    "schemeTo",
    "schemeMid",
];

/// `normalizeResultView`.
fn result_view(raw: Option<&Value>, cx: &Ctx) -> Value {
    let base = crate::model::default_result_view_settings();
    let Some(view) = obj(raw) else {
        return serde_json::to_value(base).unwrap();
    };
    cx.keys(
        "resultViewSettings",
        view,
        &[
            "surfaceDisplay",
            "fosFilterMax",
            "showSlices",
            "showFosLabel",
            "showCentreMarker",
            "showGrid",
            "showSoilColor",
            "showFemPlasticZone",
            "showFemMesh",
            "showCustomSurfaces",
            "gridSpacing",
            "gridLineSpacing",
            "minorTicks",
            "annotations",
            "layerOrder",
            "paperFrame",
            "viewLock",
            "pdfSummaryPages",
            "pdfTitleLine",
            "layerStyles",
        ],
    );
    let frame = obj(view.get("paperFrame"));
    if let Some(f) = frame {
        cx.keys(
            "resultViewSettings.paperFrame",
            f,
            &[
                "paperSize",
                "landscape",
                "showFrame",
                "zoom",
                "offsetX",
                "offsetY",
            ],
        );
    }
    let fget = |k: &str| frame.and_then(|f| f.get(k));
    let paper_frame = json!({
        "paperSize": str_of(fget("paperSize")).filter(|s| PAPER_SIZES.contains(s)).unwrap_or(&base.paper_frame.paper_size),
        "landscape": bool_of(fget("landscape")).unwrap_or(base.paper_frame.landscape),
        "showFrame": bool_of(fget("showFrame")).unwrap_or(base.paper_frame.show_frame),
        "zoom": finite_or(fget("zoom"), base.paper_frame.zoom),
        "offsetX": finite_or(fget("offsetX"), base.paper_frame.offset_x),
        "offsetY": finite_or(fget("offsetY"), base.paper_frame.offset_y),
    });
    let annotations = annotations(view.get("annotations"), cx);
    let annotation_ids: Vec<&str> = annotations
        .iter()
        .filter_map(|a| a["id"].as_str())
        .collect();

    let mut out = Obj::new();
    let flag = |k: &str, fallback: bool| json!(bool_of(view.get(k)).unwrap_or(fallback));
    out.insert(
        "surfaceDisplay".into(),
        json!(str_of(view.get("surfaceDisplay")).unwrap_or(&base.surface_display)),
    );
    out.insert(
        "fosFilterMax".into(),
        json!(finite_or(view.get("fosFilterMax"), base.fos_filter_max)),
    );
    out.insert("showSlices".into(), flag("showSlices", base.show_slices));
    out.insert(
        "showFosLabel".into(),
        flag("showFosLabel", base.show_fos_label),
    );
    out.insert(
        "showCentreMarker".into(),
        flag("showCentreMarker", base.show_centre_marker),
    );
    out.insert("showGrid".into(), flag("showGrid", base.show_grid));
    out.insert(
        "showSoilColor".into(),
        flag("showSoilColor", base.show_soil_color),
    );
    // the finite element display, where it is not the default
    if view.get("showFemPlasticZone") == Some(&Value::Bool(false)) {
        out.insert("showFemPlasticZone".into(), json!(false));
    }
    if view.get("showFemMesh") == Some(&Value::Bool(true)) {
        out.insert("showFemMesh".into(), json!(true));
    }
    if view.get("showCustomSurfaces") == Some(&Value::Bool(true)) {
        out.insert("showCustomSurfaces".into(), json!(true));
    }
    if let Some(g) = num(view.get("gridSpacing")) {
        out.insert("gridSpacing".into(), json!(g));
    }
    if let Some(g) = num(view.get("gridLineSpacing")).filter(|g| *g > 0.0) {
        out.insert("gridLineSpacing".into(), json!(g));
    }
    // A whole number of ticks (`clampMinorTicks`)
    if let Some(t) = num(view.get("minorTicks")) {
        out.insert(
            "minorTicks".into(),
            json!(jmax(0.0, jmin(20.0, cslope_engine::js::math::round(t)))),
        );
    }
    out.insert("annotations".into(), Value::Array(annotations.clone()));
    out.insert("paperFrame".into(), paper_frame);
    if let Some(lock) = obj(view.get("viewLock")) {
        cx.keys(
            "resultViewSettings.viewLock",
            lock,
            &["bottomLeft", "topRight"],
        );
        if let (Some(bl), Some(tr)) = (lock.get("bottomLeft"), lock.get("topRight")) {
            if is_finite_pair(bl) && is_finite_pair(tr) {
                out.insert(
                    "viewLock".into(),
                    json!({ "bottomLeft": bl, "topRight": tr }),
                );
            }
        }
    }
    for key in ["pdfSummaryPages", "pdfTitleLine"] {
        if let Some(Value::Bool(b)) = view.get(key) {
            out.insert(key.into(), json!(b));
        }
    }
    // The layers' order: only the keys of known layers and annotations.
    if let Some(Value::Array(order)) = view.get("layerOrder") {
        let mut kept: Vec<&str> = Vec::new();
        for k in order.iter().filter_map(Value::as_str) {
            if kept.contains(&k) {
                continue;
            }
            let known = DISPLAY_LAYER_KEYS.contains(&k)
                || annotation_ids.contains(&k)
                || (k.starts_with(DRAWING_LAYER_PREFIX) && k.len() > DRAWING_LAYER_PREFIX.len());
            if known {
                kept.push(k);
            }
        }
        if !kept.is_empty() {
            out.insert("layerOrder".into(), json!(kept));
        }
    }
    if let Some(styles) = layer_styles(view.get("layerStyles"), cx) {
        out.insert("layerStyles".into(), styles);
    }
    Value::Object(out)
}

/// `normalizeAnnotations` with `normalizeColorBarScale`.
fn annotations(raw: Option<&Value>, cx: &Ctx) -> Vec<Value> {
    let Some(Value::Array(items)) = raw else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .filter_map(|(i, a)| {
            let o = a.as_object()?;
            let path = format!("resultViewSettings.annotations[{i}]");
            let (id, kind) = (str_of(o.get("id"))?, str_of(o.get("type"))?);
            if kind == "reference" {
                return reference_annotation(o, &path, cx);
            }
            cx.keys(&path, o, &PAPER_ANNOTATION_KEYS);
            let (x, y) = (num(o.get("x"))?, num(o.get("y"))?);
            // kept as it is, each member with the type the app's types
            // give it; the color scale only on a color bar, checked
            let mut out = Obj::new();
            out.insert("id".into(), json!(id));
            out.insert("type".into(), json!(kind));
            out.insert("x".into(), json!(x));
            out.insert("y".into(), json!(y));
            for key in ["width", "height", "fontSize"] {
                if let Some(v) = num(o.get(key)) {
                    out.insert(key.into(), json!(v));
                }
            }
            for key in [
                "anchor",
                "text",
                "fontFamily",
                "color",
                "plotAxisX",
                "plotAxisY",
            ] {
                if let Some(v) = str_of(o.get(key)) {
                    out.insert(key.into(), json!(v));
                }
            }
            for key in ["bold", "italic"] {
                if let Some(Value::Bool(b)) = o.get(key) {
                    out.insert(key.into(), json!(b));
                }
            }
            if let Some(Value::Array(cols)) = o.get("tableColumns") {
                out.insert(
                    "tableColumns".into(),
                    Value::Array(cols.iter().filter(|c| c.is_string()).cloned().collect()),
                );
            }
            if kind == "color-bar" {
                if let Some(m) =
                    str_of(o.get("scaleMode")).filter(|m| matches!(*m, "auto" | "fixed" | "filter"))
                {
                    out.insert("scaleMode".into(), json!(m));
                }
                for key in ["scaleMin", "scaleMax"] {
                    if let Some(v) = num(o.get(key)) {
                        out.insert(key.into(), json!(v));
                    }
                }
                if let Some(s) = str_of(o.get("scheme")).filter(|s| FOS_SCHEME_IDS.contains(s)) {
                    out.insert("scheme".into(), json!(s));
                }
                for key in ["schemeFrom", "schemeTo", "schemeMid"] {
                    if is_hex_color(o.get(key)) {
                        out.insert(key.into(), o[key].clone());
                    }
                }
            }
            Some(Value::Object(out))
        })
        .collect()
}

/// `normalizeReferenceAnnotation` (features/annotations/reference.ts).
fn reference_annotation(o: &Obj, path: &str, cx: &Ctx) -> Option<Value> {
    cx.keys(
        path,
        o,
        &[
            "id",
            "type",
            "label",
            "color",
            "dash",
            "width",
            "showInEdit",
            "shape",
            "points",
            "cx",
            "cy",
            "radius",
            "clip",
        ],
    );
    let mut out = Obj::new();
    out.insert("id".into(), o["id"].clone());
    out.insert("type".into(), json!("reference"));
    for key in ["label", "color"] {
        if let Some(s) = str_of(o.get(key)) {
            out.insert(key.into(), json!(s));
        }
    }
    if let Some(d) = str_of(o.get("dash")).filter(|d| matches!(*d, "solid" | "dashed" | "dotted")) {
        out.insert("dash".into(), json!(d));
    }
    if let Some(w) = num(o.get("width")).filter(|w| *w > 0.0) {
        out.insert("width".into(), json!(w));
    }
    if let Some(Value::Bool(b)) = o.get("showInEdit") {
        out.insert("showInEdit".into(), json!(b));
    }
    match str_of(o.get("shape")) {
        Some("polyline") => {
            // `finitePairs`: every point a finite pair, else none
            let pts = o.get("points")?.as_array()?;
            if pts.len() < 2 || !pts.iter().all(is_finite_pair) {
                return None;
            }
            out.insert("shape".into(), json!("polyline"));
            out.insert("points".into(), Value::Array(pts.clone()));
        }
        Some("circle") => {
            let (cx_, cy, radius) = (
                num(o.get("cx"))?,
                num(o.get("cy"))?,
                num(o.get("radius")).filter(|r| *r > 0.0)?,
            );
            out.insert("shape".into(), json!("circle"));
            out.insert("cx".into(), json!(cx_));
            out.insert("cy".into(), json!(cy));
            out.insert("radius".into(), json!(radius));
            if let Some(c) = str_of(o.get("clip")).filter(|c| matches!(*c, "ground" | "none")) {
                out.insert("clip".into(), json!(c));
            }
        }
        _ => return None,
    }
    Some(Value::Object(out))
}

/// The fields of each layer's style and what each holds
/// (`FIELDS`, features/results/layer-styles.ts).
const LAYER_STYLE_FIELDS: [(&str, &[(&str, &str)]); 9] = [
    ("soilColor", &[("opacity", "opacity")]),
    (
        "femMesh",
        &[
            ("color", "color"),
            ("width", "width"),
            ("opacity", "opacity"),
        ],
    ),
    (
        "femPlasticZone",
        &[("color", "color"), ("opacity", "opacity")],
    ),
    ("surfaces", &[("width", "width"), ("opacity", "opacity")]),
    (
        "customSurfaces",
        &[
            ("color", "color"),
            ("width", "width"),
            ("fontSize", "fontSize"),
        ],
    ),
    ("criticalSurface", &[("color", "color"), ("width", "width")]),
    ("slices", &[("color", "color"), ("width", "width")]),
    (
        "center",
        &[
            ("color", "color"),
            ("size", "size"),
            ("radiusLines", "bool"),
        ],
    ),
    (
        "fosLabel",
        &[
            ("fontSize", "fontSize"),
            ("fontFamily", "fontFamily"),
            ("color", "color"),
            ("bold", "bool"),
            ("decimals", "decimals"),
        ],
    ),
];

/// `validField`: a style field's value if it is a valid one of its kind.
fn layer_style_field(kind: &str, v: Option<&Value>) -> Option<Value> {
    match kind {
        "color" => is_hex_color(v).then(|| json!(str_of(v).unwrap().to_lowercase())),
        "bool" => v.and_then(Value::as_bool).map(|b| json!(b)),
        "fontFamily" => str_of(v)
            .filter(|f| matches!(*f, "sans-serif" | "serif" | "monospace"))
            .map(|f| json!(f)),
        "opacity" => num(v).filter(|x| (0.0..=1.0).contains(x)).map(|x| json!(x)),
        "decimals" => num(v)
            .filter(|x| x.fract() == 0.0 && (0.0..=4.0).contains(x))
            .map(|x| json!(x)),
        "width" => num(v)
            .filter(|x| (0.1..=10.0).contains(x))
            .map(|x| json!(x)),
        "size" => num(v)
            .filter(|x| (0.5..=20.0).contains(x))
            .map(|x| json!(x)),
        "fontSize" => num(v)
            .filter(|x| (4.0..=72.0).contains(x))
            .map(|x| json!(x)),
        _ => None,
    }
}

/// `normalizeLayerStyles`.
fn layer_styles(raw: Option<&Value>, cx: &Ctx) -> Option<Value> {
    let styles = obj(raw)?;
    cx.keys(
        "resultViewSettings.layerStyles",
        styles,
        &LAYER_STYLE_FIELDS.map(|(layer, _)| layer),
    );
    let mut out = Obj::new();
    for (layer, fields) in LAYER_STYLE_FIELDS {
        let Some(style) = obj(styles.get(layer)) else {
            continue;
        };
        cx.keys(
            &format!("resultViewSettings.layerStyles.{layer}"),
            style,
            &fields.iter().map(|(f, _)| *f).collect::<Vec<_>>(),
        );
        let mut clean = Obj::new();
        for (field, kind) in fields {
            if let Some(v) = layer_style_field(kind, style.get(*field)) {
                clean.insert((*field).into(), v);
            }
        }
        if !clean.is_empty() {
            out.insert(layer.into(), Value::Object(clean));
        }
    }
    (!out.is_empty()).then_some(Value::Object(out))
}

// ── Locks ───────────────────────────────────────────────────────

/// `normalizeLocks` with the ids of the normalized model (and `tidyLocks`).
/// Locks of drawings are kept for the archive reader to check against
/// backgrounds.json.
fn locks(raw: Option<&Value>, model: &Obj, cx: &Ctx) -> Option<Value> {
    let r = obj(raw)?;
    cx.keys(
        "locks",
        r,
        &[
            "exterior",
            "searchLimits",
            "boundaries",
            "waterLines",
            "loads",
            "reinforcement",
            "customSurfaces",
            "backgrounds",
            "fromImport",
        ],
    );
    let ids_of = |key: &str| -> Vec<&str> {
        array(model.get(key))
            .filter_map(|x| x["id"].as_str())
            .collect()
    };
    let known: [(&str, Option<Vec<&str>>); 6] = [
        ("boundaries", Some(ids_of("materialBoundaries"))),
        (
            "waterLines",
            Some(
                array(model.get("piezometricLine").and_then(|p| p.get("lines")))
                    .filter_map(|l| l["id"].as_str())
                    .collect(),
            ),
        ),
        (
            "loads",
            Some([ids_of("udls"), ids_of("lineLoads")].concat()),
        ),
        (
            "reinforcement",
            Some([ids_of("reinforcements"), ids_of("piles")].concat()),
        ),
        ("customSurfaces", Some(ids_of("customSearchPlanes"))),
        ("backgrounds", None),
    ];
    let mut out = Obj::new();
    if r.get("exterior") == Some(&Value::Bool(true)) {
        out.insert("exterior".into(), json!(true));
    }
    if r.get("searchLimits") == Some(&Value::Bool(true)) {
        out.insert("searchLimits".into(), json!(true));
    }
    for (key, ids) in &known {
        let Some(Value::Array(v)) = r.get(*key) else {
            continue;
        };
        // (`tidyLocks`: each id once)
        let mut list: Vec<&str> = Vec::new();
        for x in v.iter().filter_map(Value::as_str) {
            let ok = ids.as_ref().is_none_or(|ids| ids.contains(&x));
            if ok && !list.contains(&x) {
                list.push(x);
            }
        }
        if !list.is_empty() {
            out.insert((*key).into(), json!(list));
        }
    }
    if r.get("fromImport") == Some(&Value::Bool(true))
        && (out.contains_key("exterior") || out.contains_key("boundaries"))
    {
        out.insert("fromImport".into(), json!(true));
    }
    (!out.is_empty()).then_some(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn today_is_a_date() {
        let t = today();
        assert_eq!(t.len(), 10);
        assert!(t.starts_with("20"));
    }

    #[test]
    fn pointers_become_member_paths() {
        assert_eq!(pointer_to_path("/udls/0/foo"), "udls[0].foo");
        assert_eq!(
            pointer_to_path("/materials/2/model/x"),
            "materials[2].model.x"
        );
        assert_eq!(pointer_to_path(""), "");
    }
}
