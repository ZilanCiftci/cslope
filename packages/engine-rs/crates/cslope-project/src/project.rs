//! A whole project in memory and its JSON entries (docs/file-format.md,
//! sections 2 to 5): `manifest.json`, `project.json`, each model's
//! `model.json`, `result.json` and `backgrounds.json`, `assets/index.json`.
//! Every member is typed; none unknown is read or written (section 2.1).
//! The ZIP container itself is [`crate::archive`] (feature `native`).
//!
//! A project is read as the app reads it (`openProjectArchive` in
//! packages/desktop/src/features/project/cslp.ts with `parseProjectData`
//! and `normalizeBackgrounds`), strictly: a file of the current layout and
//! schema version only (decision B2: an older one is refused with a message
//! pointing to the app, which migrates it), and an unknown member, entry or
//! value of the wrong shape is an error naming where it is, where the app
//! would drop it. What is written is what the app would write after its own
//! normalization.
//!
//! Save policy ([`Project::apply_save_policy`]): a result belongs to the
//! input it was computed for (its `inputHash`, section 5). A model whose
//! input changed since its result keeps no `result.json`, and the project
//! then drops `thumbnail.png` (it shows a result), unless the model was run
//! again ([`Project::set_result`]).

use crate::canonical::canonical_json;
use crate::hash::{input_hash, sha256_hex};
use crate::model::{from_json_typed, ModelEntry};
use crate::normalize::{read_model, ReadOptions};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use cslope_engine::js::math::{max as jmax, min as jmin};

/// The manifest's `format`.
pub const FORMAT: &str = "cslope-project";
/// The archive layout this crate reads and writes (`CSLP_FORMAT_VERSION`
/// in cslp.ts); kept equal to the app's by a CI check.
pub const FORMAT_VERSION: u32 = 1;
/// The oldest reader of what this crate writes (`CSLP_MIN_READER_VERSION`).
pub const MIN_READER_VERSION: u32 = 1;
/// The project schema version this crate reads and writes
/// (`PROJECT_FILE_VERSION` in store/persistence.ts); kept equal to the
/// app's by a CI check.
pub const PROJECT_SCHEMA_VERSION: u32 = 3;

/// Where a file the app migrates is sent.
const OPEN_IN_APP: &str = "open it in the cSlope app and save it";

/// `manifest.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub min_reader_version: u32,
    pub app_version: String,
    pub created: String,
    pub modified: String,
    pub generator: String,
}

/// `project.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectJson {
    pub version: u32,
    pub active_model_id: String,
    pub models: Vec<String>,
    pub units: String,
    /// None defined in format 1: an empty object.
    pub settings: EmptySettings,
}

/// `project.json`'s `settings`: no member is defined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptySettings {}

/// The engine that computed a result.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineInfo {
    pub version: String,
    pub source_hash: String,
}

/// `models/<id>/result.json`: the outcome of the model's last analysis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedResult {
    /// "done" or "error".
    pub run_state: String,
    /// The engine's `AnalysisResult` in model coordinates (when "done"),
    /// kept as its JSON (checked against the engine's schema on read).
    pub result: Option<Value>,
    pub error_message: Option<String>,
    pub input_hash: String,
    pub engine: EngineInfo,
}

/// A point of a drawing and the model point it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PointPair {
    pub source: [f64; 2],
    pub model: [f64; 2],
}

/// A tick on an axis of a drawing with its value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AxisTick {
    pub source: [f64; 2],
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalibrationAxes {
    pub x: Vec<AxisTick>,
    pub y: Vec<AxisTick>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reuse_from: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalibrationScale {
    pub meters_per_unit: f64,
    /// "px", "pt", "mm" or "du".
    pub unit: String,
}

/// How a drawing's transform was found (`DrawingCalibration`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Calibration {
    /// "points", "axes", "scale" or "drawing".
    pub mode: String,
    pub points: Vec<PointPair>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axes: Option<CalibrationAxes>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<CalibrationScale>,
}

/// model = M · source: x = a·u + c·v + e, y = b·u + d·v + f.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Affine {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Crop {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

/// A drawing placed under a model (an entry of `backgrounds.json`,
/// `BackgroundImage`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Background {
    pub id: String,
    pub asset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<Crop>,
    pub calibration: Calibration,
    pub transform: Affine,
    pub opacity: f64,
    pub visible: bool,
    pub order: f64,
    /// Written only as `true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_in_results: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden_layers: Option<Vec<String>>,
    /// Written only as `false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invert_in_dark: Option<bool>,
}

/// An entry of `assets/index.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetEntry {
    pub id: String,
    pub path: String,
    pub mime: String,
    pub bytes: f64,
    pub sha256: String,
    pub original_name: String,
    pub added_at: String,
}

/// An attachment: its index entry's own members and its bytes (the path,
/// size and hash are made from them when written).
#[derive(Debug, Clone, PartialEq)]
pub struct Asset {
    pub id: String,
    pub mime: String,
    pub original_name: String,
    pub added_at: String,
    pub data: Vec<u8>,
}

/// One model of a project with what belongs to it.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectModel {
    pub model: ModelEntry,
    pub result: Option<SavedResult>,
    pub backgrounds: Vec<Background>,
}

/// A project read from (or to be written to) a `.cslp` file.
#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    /// The manifest as read; a write sets `modified`, `appVersion` and
    /// `generator` (and `created` when it is empty).
    pub manifest: Manifest,
    pub active_model_id: String,
    pub models: Vec<ProjectModel>,
    pub assets: Vec<Asset>,
    pub thumbnail: Option<Vec<u8>>,
}

/// What a save did to the results ([`Project::apply_save_policy`]).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SaveReport {
    /// The models whose result was dropped: their input changed since.
    pub dropped_results: Vec<String>,
    /// Whether `thumbnail.png` was dropped.
    pub dropped_thumbnail: bool,
}

/// A model id is a folder name.
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The file extension of an attachment, from its type (`extensionOf`).
pub fn extension_of(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tif",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        "image/vnd.dwg" => "dwg",
        "image/vnd.dxf" => "dxf",
        _ => "bin",
    }
}

fn parse_json(name: &str, bytes: &[u8]) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| format!("{name} is not UTF-8 text"))?;
    serde_json::from_str(text).map_err(|_| format!("The project's {name} is not valid JSON."))
}

/// The canonical bytes of a JSON entry.
pub fn json_entry<T: Serialize>(value: &T) -> Vec<u8> {
    canonical_json(&serde_json::to_value(value).expect("an entry is JSON")).into_bytes()
}

// ── The result's shape ──────────────────────────────────────────

/// The engine's schema of an `AnalysisResult`, with its `$defs`.
fn result_schema() -> &'static Value {
    static SCHEMA: OnceLock<Value> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        cslope_engine::types::schema::generate()
            .remove("analysis-result")
            .expect("the analysis-result schema")
    })
}

/// The object schemas a schema stands for ($ref, anyOf, oneOf, allOf
/// resolved), and the other schemas (arrays) it allows.
fn schema_branches<'a>(root: &'a Value, schema: &'a Value, out: &mut Vec<&'a Value>) {
    if let Some(r) = schema.get("$ref").and_then(Value::as_str) {
        let path = r.trim_start_matches('#');
        if let Some(target) = root.pointer(path) {
            schema_branches(root, target, out);
        }
        return;
    }
    let mut combined = false;
    for key in ["anyOf", "oneOf", "allOf"] {
        if let Some(Value::Array(list)) = schema.get(key) {
            combined = true;
            for s in list {
                schema_branches(root, s, out);
            }
        }
    }
    if !combined || schema.get("properties").is_some() {
        out.push(schema);
    }
}

/// The members of `value` (at `path`) that no branch of `schemas` knows.
fn unknown_by_schema(
    root: &Value,
    schemas: &[&Value],
    value: &Value,
    path: &str,
    out: &mut Vec<String>,
) {
    let mut branches = Vec::new();
    for s in schemas {
        schema_branches(root, s, &mut branches);
    }
    match value {
        Value::Object(o) => {
            let objects: Vec<&Value> = branches
                .iter()
                .copied()
                .filter(|b| b.get("properties").is_some())
                .collect();
            if objects.is_empty() {
                return;
            }
            let closed = objects
                .iter()
                .all(|b| b.get("additionalProperties") == Some(&Value::Bool(false)));
            for (k, v) in o {
                let subs: Vec<&Value> = objects
                    .iter()
                    .filter_map(|b| b["properties"].get(k))
                    .collect();
                let p = format!("{path}.{k}");
                if subs.is_empty() {
                    if closed {
                        out.push(p);
                    }
                } else {
                    unknown_by_schema(root, &subs, v, &p, out);
                }
            }
        }
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                let subs: Vec<&Value> = branches
                    .iter()
                    .filter_map(|b| match b.get("prefixItems").and_then(|p| p.get(i)) {
                        Some(s) => Some(s),
                        None => b.get("items").filter(|s| s.is_object()),
                    })
                    .collect();
                if !subs.is_empty() {
                    unknown_by_schema(root, &subs, item, &format!("{path}[{i}]"), out);
                }
            }
        }
        _ => {}
    }
}

/// The checks of the app's `savedRun` on a saved result: one the app could
/// not show is refused; members the engine does not know are refused.
fn check_result(r: &Value, where_: &str) -> Result<(), String> {
    let o = r
        .as_object()
        .ok_or_else(|| format!("{where_}: the result is not an object"))?;
    let shows = o.get("minFOS").is_some_and(Value::is_number)
        && o.get("allSurfaces").is_some_and(Value::is_array)
        && o.get("criticalSlices").is_some_and(Value::is_array)
        && o.get("criticalSurface")
            .is_some_and(|c| c.is_null() || c.is_object());
    if !shows {
        return Err(format!(
            "{where_}: the result has not the shape the app shows (minFOS, allSurfaces, criticalSlices, criticalSurface)"
        ));
    }
    let root = result_schema();
    let mut unknown = Vec::new();
    unknown_by_schema(root, &[root], r, "result", &mut unknown);
    if let Some(first) = unknown.first() {
        return Err(format!("{where_}: unknown member {first}"));
    }
    Ok(())
}

impl SavedResult {
    /// A result of a run: the result in model coordinates, for the model's
    /// current input.
    pub fn done(
        model: &ModelEntry,
        result: Value,
        engine: EngineInfo,
    ) -> Result<SavedResult, String> {
        check_result(&result, "The result")?;
        Ok(SavedResult {
            run_state: "done".into(),
            result: Some(result),
            error_message: None,
            input_hash: input_hash(model)?,
            engine,
        })
    }

    /// A run that failed, with its message.
    pub fn error(
        model: &ModelEntry,
        message: String,
        engine: EngineInfo,
    ) -> Result<SavedResult, String> {
        Ok(SavedResult {
            run_state: "error".into(),
            result: None,
            error_message: Some(message),
            input_hash: input_hash(model)?,
            engine,
        })
    }

    /// A `result.json` read, as the app would show it.
    fn checked(value: Value, where_: &str) -> Result<SavedResult, String> {
        let r: SavedResult = from_json_typed(where_, value)?;
        let hex = r.input_hash.len() == 64
            && r.input_hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !hex {
            return Err(format!(
                "{where_}: inputHash is not 64 lowercase hex digits"
            ));
        }
        match r.run_state.as_str() {
            "done" => {
                let Some(result) = &r.result else {
                    return Err(format!("{where_}: runState \"done\" without a result"));
                };
                check_result(result, where_)?;
                if r.error_message.is_some() {
                    return Err(format!("{where_}: runState \"done\" with an errorMessage"));
                }
            }
            "error" => {
                if r.result.is_some() || r.error_message.is_none() {
                    return Err(format!(
                        "{where_}: runState \"error\" needs an errorMessage and no result"
                    ));
                }
            }
            other => return Err(format!("{where_}: unknown runState \"{other}\"")),
        }
        Ok(r)
    }
}

// ── backgrounds.json ────────────────────────────────────────────

/// The pixel size of an image from its header (`imageSize`): PNG, GIF,
/// BMP, JPEG and TIFF.
pub fn image_size(bytes: &[u8]) -> Option<(f64, f64)> {
    let n = bytes.len();
    let u16be = |i: usize| u16::from_be_bytes([bytes[i], bytes[i + 1]]) as f64;
    let u32be =
        |i: usize| u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as f64;
    let ok = |w: f64, h: f64| (w > 0.0 && h > 0.0).then_some((w, h));
    if n >= 24 && bytes[..4] == [0x89, 0x50, 0x4e, 0x47] {
        return ok(u32be(16), u32be(20));
    }
    if n >= 10 && bytes[..3] == *b"GIF" {
        let w = u16::from_le_bytes([bytes[6], bytes[7]]) as f64;
        let h = u16::from_le_bytes([bytes[8], bytes[9]]) as f64;
        return ok(w, h);
    }
    if n >= 26 && bytes[..2] == *b"BM" {
        let w =
            i32::from_le_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]).unsigned_abs() as f64;
        let h =
            i32::from_le_bytes([bytes[22], bytes[23], bytes[24], bytes[25]]).unsigned_abs() as f64;
        return ok(w, h);
    }
    if n >= 4 && bytes[0] == 0xff && bytes[1] == 0xd8 {
        let mut i = 2;
        while i + 9 < n {
            if bytes[i] != 0xff {
                return None;
            }
            let marker = bytes[i + 1];
            if marker == 0xff {
                i += 1;
                continue;
            }
            let length = u16be(i + 2) as usize;
            let sof = (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker);
            if sof {
                return ok(u16be(i + 7), u16be(i + 5));
            }
            i += 2 + length;
        }
        return None;
    }
    if n >= 8 && (bytes[..2] == *b"II" || bytes[..2] == *b"MM") {
        let le = bytes[0] == b'I';
        let r16 = |i: usize| {
            let b = [bytes[i], bytes[i + 1]];
            if le {
                u16::from_le_bytes(b)
            } else {
                u16::from_be_bytes(b)
            }
        };
        let r32 = |i: usize| {
            let b = [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
            if le {
                u32::from_le_bytes(b)
            } else {
                u32::from_be_bytes(b)
            }
        };
        let ifd = r32(4) as usize;
        if ifd + 2 > n {
            return None;
        }
        let count = r16(ifd) as usize;
        let (mut w, mut h) = (0.0, 0.0);
        for k in 0..count {
            let at = ifd + 2 + k * 12;
            if at + 12 > n {
                break;
            }
            let tag = r16(at);
            let typ = r16(at + 2);
            let v = if typ == 3 {
                r16(at + 8) as f64
            } else {
                r32(at + 8) as f64
            };
            if tag == 256 {
                w = v;
            }
            if tag == 257 {
                h = v;
            }
        }
        return ok(w, h);
    }
    None
}

fn compose(o: Affine, i: Affine) -> Affine {
    Affine {
        a: o.a * i.a + o.c * i.b,
        b: o.b * i.a + o.d * i.b,
        c: o.a * i.c + o.c * i.d,
        d: o.b * i.c + o.d * i.d,
        e: o.a * i.e + o.c * i.f + o.e,
        f: o.b * i.e + o.d * i.f + o.f,
    }
}

/// `isUsable`: finite and not singular.
fn is_usable(m: &Affine) -> bool {
    let all = [m.a, m.b, m.c, m.d, m.e, m.f];
    if !all.iter().all(|v| v.is_finite()) {
        return false;
    }
    let scale = jmax(m.a.hypot(m.b), m.c.hypot(m.d));
    scale > 0.0 && (m.a * m.d - m.b * m.c).abs() > 1e-9 * scale * scale
}

/// `legacyTransform`: the first form of a placement as the affine transform.
fn legacy_transform(
    origin: (f64, f64),
    s: f64,
    rotation_deg: f64,
    mirrored: bool,
    w: f64,
    h: f64,
) -> Affine {
    let local = if mirrored {
        Affine {
            a: -s,
            b: 0.0,
            c: 0.0,
            d: -s,
            e: s * w,
            f: s * h,
        }
    } else {
        Affine {
            a: s,
            b: 0.0,
            c: 0.0,
            d: -s,
            e: 0.0,
            f: s * h,
        }
    };
    let r = rotation_deg * std::f64::consts::PI / 180.0;
    let (sin, cos) = (r.sin(), r.cos());
    let rotate = Affine {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        e: origin.0,
        f: origin.1,
    };
    let mut m = compose(rotate, local);
    for v in [&mut m.a, &mut m.b, &mut m.c, &mut m.d, &mut m.e, &mut m.f] {
        if *v == 0.0 {
            *v = 0.0;
        }
    }
    m
}

fn fin(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// `readCalibration` of an entry of the current form (strict: the members
/// it has must be of their shape).
fn calibration(raw: Option<&Value>, where_: &str) -> Result<Calibration, String> {
    match raw {
        None => Ok(Calibration {
            mode: "drawing".into(),
            points: Vec::new(),
            axes: None,
            scale: None,
        }),
        Some(v) => {
            let c: Calibration = from_json_typed(where_, v.clone())?;
            if !["points", "axes", "scale", "drawing"].contains(&c.mode.as_str()) {
                return Err(format!("{where_}: unknown calibration mode \"{}\"", c.mode));
            }
            if let Some(s) = &c.scale {
                if s.meters_per_unit.is_nan()
                    || s.meters_per_unit <= 0.0
                    || !["px", "pt", "mm", "du"].contains(&s.unit.as_str())
                {
                    return Err(format!("{where_}: the calibration's scale is not valid"));
                }
            }
            Ok(c)
        }
    }
}

/// `normalizeBackgrounds` of a `backgrounds.json`, strictly: entries of the
/// current form typed (unknown members refused), entries of the first form
/// converted with their image's size, sorted by `order`.
fn read_backgrounds(
    raw: &Value,
    where_: &str,
    size_of: &dyn Fn(&str) -> Option<(f64, f64)>,
) -> Result<Vec<Background>, String> {
    let items = raw
        .as_array()
        .ok_or_else(|| format!("{where_} is not a list"))?;
    let mut out: Vec<Background> = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let at = format!("{where_}[{index}]");
        let o = item
            .as_object()
            .ok_or_else(|| format!("{at} is not an object"))?;
        let asset_id = o
            .get("assetId")
            .and_then(Value::as_str)
            .filter(|a| is_safe_id(a))
            .ok_or_else(|| format!("{at}: no valid assetId"))?
            .to_owned();
        let legacy = o.get("transform").and_then(|t| t.get("originX")).is_some();
        let (transform, calib) = if legacy {
            let t = o["transform"].as_object().unwrap();
            for k in t.keys() {
                if !["originX", "originY", "scale", "rotationDeg", "mirrored"].contains(&k.as_str())
                {
                    return Err(format!("{at}: unknown member transform.{k}"));
                }
            }
            for k in o.keys() {
                if ![
                    "assetId",
                    "transform",
                    "opacity",
                    "visible",
                    "order",
                    "id",
                    "name",
                ]
                .contains(&k.as_str())
                {
                    return Err(format!("{at}: unknown member {k}"));
                }
            }
            let (Some(ox), Some(oy), Some(s)) = (
                fin(t.get("originX")),
                fin(t.get("originY")),
                fin(t.get("scale")),
            ) else {
                return Err(format!(
                    "{at}: a transform of the first form without origin and scale"
                ));
            };
            if s <= 0.0 {
                return Err(format!(
                    "{at}: a transform of the first form with a scale of {s}"
                ));
            }
            let (w, h) = size_of(&asset_id).unwrap_or((0.0, 0.0));
            let m = legacy_transform(
                (ox, oy),
                s,
                fin(t.get("rotationDeg")).unwrap_or(0.0),
                t.get("mirrored") == Some(&Value::Bool(true)),
                w,
                h,
            );
            (
                m,
                Calibration {
                    mode: "drawing".into(),
                    points: Vec::new(),
                    axes: None,
                    scale: None,
                },
            )
        } else {
            let known = [
                "id",
                "assetId",
                "name",
                "page",
                "crop",
                "calibration",
                "transform",
                "opacity",
                "visible",
                "order",
                "showInResults",
                "hiddenLayers",
                "invertInDark",
            ];
            for k in o.keys() {
                if !known.contains(&k.as_str()) {
                    return Err(format!("{at}: unknown member {k}"));
                }
            }
            let m: Affine = from_json_typed(
                &format!("{at}.transform"),
                o.get("transform").cloned().unwrap_or(Value::Null),
            )?;
            (
                m,
                calibration(o.get("calibration"), &format!("{at}.calibration"))?,
            )
        };
        if !is_usable(&transform) {
            return Err(format!("{at}: the transform is singular or not finite"));
        }
        let mut id = o
            .get("id")
            .and_then(Value::as_str)
            .filter(|i| is_safe_id(i))
            .map(str::to_owned)
            .unwrap_or_else(|| format!("drawing-{}", index + 1));
        while ids.contains(&id) {
            id.push_str("-1");
        }
        ids.push(id.clone());
        let opacity = match o.get("opacity") {
            None => 1.0,
            Some(v) => v
                .as_f64()
                .ok_or_else(|| format!("{at}: opacity is not a number"))?
                .clamp(0.0, 1.0),
        };
        let visible = match o.get("visible") {
            None => true,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err(format!("{at}: visible is not a boolean")),
        };
        let order = match o.get("order") {
            None => index as f64,
            Some(v) => v
                .as_f64()
                .ok_or_else(|| format!("{at}: order is not a number"))?,
        };
        let name = match o.get("name") {
            None => None,
            Some(Value::String(s)) => (!s.trim().is_empty()).then(|| s.clone()),
            Some(_) => return Err(format!("{at}: name is not a string")),
        };
        let page = match o.get("page") {
            None => None,
            Some(v) => match v.as_f64() {
                Some(p) if p.fract() == 0.0 && p >= 1.0 => Some(p),
                _ => return Err(format!("{at}: page is not a whole number of 1 or more")),
            },
        };
        let crop = match o.get("crop") {
            None => None,
            Some(v) => {
                let c: Crop = from_json_typed(&format!("{at}.crop"), v.clone())?;
                let c = Crop {
                    x0: jmin(c.x0, c.x1),
                    y0: jmin(c.y0, c.y1),
                    x1: jmax(c.x0, c.x1),
                    y1: jmax(c.y0, c.y1),
                };
                (c.x1 - c.x0 > 0.0 && c.y1 - c.y0 > 0.0).then_some(c)
            }
        };
        let flag = |k: &str| -> Result<Option<bool>, String> {
            match o.get(k) {
                None => Ok(None),
                Some(Value::Bool(b)) => Ok(Some(*b)),
                Some(_) => Err(format!("{at}: {k} is not a boolean")),
            }
        };
        let show_in_results = flag("showInResults")?.filter(|b| *b);
        let invert_in_dark = flag("invertInDark")?.filter(|b| !*b);
        let hidden_layers = match o.get("hiddenLayers") {
            None => None,
            Some(Value::Array(a)) => {
                let mut names: Vec<String> = Vec::new();
                for n in a {
                    let n = n.as_str().ok_or_else(|| {
                        format!("{at}: hiddenLayers holds a value that is not a string")
                    })?;
                    if !names.iter().any(|m| m == n) {
                        names.push(n.to_owned());
                    }
                }
                (!names.is_empty()).then_some(names)
            }
            Some(_) => return Err(format!("{at}: hiddenLayers is not a list")),
        };
        out.push(Background {
            id,
            asset_id,
            name,
            page,
            crop,
            calibration: calib,
            transform,
            opacity,
            visible,
            order,
            show_in_results,
            hidden_layers,
            invert_in_dark,
        });
    }
    // (a stable sort, as JavaScript's)
    out.sort_by(|a, b| {
        a.order
            .partial_cmp(&b.order)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

// ── Reading ─────────────────────────────────────────────────────

/// The entries of an archive, as [`Project::from_entries`] reads them.
pub trait EntrySource {
    /// Every entry's name, in the archive's order.
    fn names(&self) -> Vec<String>;
    /// An entry's bytes.
    fn read(&mut self, name: &str) -> Result<Vec<u8>, String>;
}

/// Reading options: the date of a title block a model lacks.
#[derive(Debug, Clone)]
pub struct ProjectReadOptions {
    pub today: String,
}

impl Default for ProjectReadOptions {
    fn default() -> Self {
        ProjectReadOptions {
            today: crate::normalize::today(),
        }
    }
}

impl Project {
    /// A project from the entries of a `.cslp` archive, read strictly.
    pub fn from_entries(
        src: &mut dyn EntrySource,
        options: &ProjectReadOptions,
    ) -> Result<Project, String> {
        let names = src.names();
        let has = |n: &str| names.iter().any(|m| m == n);
        if !has("manifest.json") {
            return Err(
                "The file is not a cSlope project (the archive has no manifest.json).".into(),
            );
        }
        let raw_manifest = parse_json("manifest.json", &src.read("manifest.json")?)?;
        let Some(m) = raw_manifest.as_object() else {
            return Err(
                "The file is not a cSlope project (its manifest names another format).".into(),
            );
        };
        if m.get("format").and_then(Value::as_str) != Some(FORMAT) {
            return Err(
                "The file is not a cSlope project (its manifest names another format).".into(),
            );
        }
        let generator = m
            .get("generator")
            .and_then(Value::as_str)
            .filter(|g| !g.is_empty())
            .map(str::to_owned)
            .or_else(|| {
                m.get("appVersion")
                    .and_then(Value::as_str)
                    .filter(|v| !v.is_empty())
                    .map(|v| format!("cSlope {v}"))
            })
            .unwrap_or_else(|| "a newer cSlope".into());
        let format_version = m.get("formatVersion").and_then(Value::as_u64);
        let Some(format_version) = format_version.filter(|v| *v >= 1) else {
            return Err("The project's manifest.json is damaged (no valid formatVersion).".into());
        };
        let min_reader = m
            .get("minReaderVersion")
            .and_then(Value::as_u64)
            .filter(|v| *v >= 1)
            .unwrap_or(format_version);
        if min_reader > u64::from(FORMAT_VERSION) || format_version > u64::from(FORMAT_VERSION) {
            return Err(format!(
                "This project was saved by a newer cSlope ({generator}); update cslope to open it."
            ));
        }
        let has_models = names
            .iter()
            .any(|n| n.starts_with("models/") && n.ends_with("/model.json"));
        if !has_models || !m.contains_key("minReaderVersion") {
            return Err(format!("The project was saved by an earlier cSlope (the first .cslp layout); {OPEN_IN_APP}."));
        }
        let manifest: Manifest = from_json_typed("The project's manifest.json", raw_manifest)?;

        if !has("project.json") {
            return Err("The project file is damaged (the archive has no project.json).".into());
        }
        let raw_project = parse_json("project.json", &src.read("project.json")?)?;
        let version = raw_project.get("version").and_then(Value::as_u64);
        match version {
            Some(v) if v == u64::from(PROJECT_SCHEMA_VERSION) => {}
            Some(v) if v > u64::from(PROJECT_SCHEMA_VERSION) => {
                return Err(format!(
                    "The project was saved by a newer cSlope (project schema version {v}, {generator}); update cslope to open it."
                ))
            }
            Some(v) => {
                return Err(format!(
                    "The project was saved by an earlier cSlope (project schema version {v}); {OPEN_IN_APP}."
                ))
            }
            None => return Err(format!("The project was saved by an earlier cSlope (no project schema version); {OPEN_IN_APP}.")),
        }
        if let Some(u) = raw_project
            .get("units")
            .filter(|u| u.as_str() != Some("SI"))
        {
            let u = u.as_str().unwrap_or("unknown");
            return Err(format!(
                "The project is in {u} units; cslope reads SI projects only."
            ));
        }
        let project: ProjectJson = from_json_typed("The project's project.json", raw_project)?;

        // the models: in the order of project.json, then folders it does not
        // name, by name
        let folder_of = |n: &str| -> Option<String> {
            let rest = n.strip_prefix("models/")?;
            let (id, file) = rest.split_once('/')?;
            (file == "model.json" && is_safe_id(id)).then(|| id.to_owned())
        };
        let mut folders: Vec<String> = names.iter().filter_map(|n| folder_of(n)).collect();
        folders.sort();
        for id in &project.models {
            if !is_safe_id(id) {
                return Err(format!(
                    "project.json names a model with an id that is not a folder name: {id}"
                ));
            }
            if !has(&format!("models/{id}/model.json")) {
                return Err(format!(
                    "The project file is damaged (project.json names the model {id}, but models/{id}/model.json is missing)."
                ));
            }
        }
        let mut ids: Vec<String> = Vec::new();
        for id in project.models.iter().chain(folders.iter()) {
            if !ids.contains(id) {
                ids.push(id.clone());
            }
        }

        // the entries: every one must be known
        let asset_index = has("assets/index.json");
        for n in &names {
            if n.ends_with('/') {
                continue;
            }
            let known = matches!(
                n.as_str(),
                "manifest.json" | "project.json" | "thumbnail.png"
            ) || (asset_index && n.starts_with("assets/"))
                || n.strip_prefix("models/")
                    .and_then(|r| r.split_once('/'))
                    .is_some_and(|(id, f)| {
                        ids.iter().any(|i| i == id)
                            && matches!(f, "model.json" | "result.json" | "backgrounds.json")
                    });
            if !known {
                return Err(format!("unknown entry {n}"));
            }
        }

        // the attachments
        let mut assets: Vec<Asset> = Vec::new();
        if asset_index {
            let raw = parse_json("assets/index.json", &src.read("assets/index.json")?)?;
            let entries: Vec<AssetEntry> = from_json_typed("The project's assets/index.json", raw)?;
            for e in entries {
                let at = format!("assets/index.json ({})", e.id);
                if !is_safe_id(&e.id) || assets.iter().any(|a| a.id == e.id) {
                    return Err(format!("{at}: not a valid id, or a repeated one"));
                }
                let ext_ok = e
                    .path
                    .strip_prefix("assets/")
                    .and_then(|p| p.split_once('.'))
                    .is_some_and(|(id, ext)| {
                        id == e.id
                            && !ext.is_empty()
                            && ext.bytes().all(|b| b.is_ascii_alphanumeric())
                    });
                if !ext_ok || !has(&e.path) {
                    return Err(format!(
                        "{at}: path {} is not assets/<id>.<ext> of an entry",
                        e.path
                    ));
                }
                let data = src.read(&e.path)?;
                if data.len() as f64 != e.bytes {
                    return Err(format!(
                        "{at}: {} bytes declared, {} in the archive",
                        e.bytes,
                        data.len()
                    ));
                }
                if sha256_hex(&data) != e.sha256 {
                    return Err(format!(
                        "The project file is damaged (the attachment {} does not match its hash).",
                        if e.original_name.is_empty() {
                            &e.path
                        } else {
                            &e.original_name
                        }
                    ));
                }
                assets.push(Asset {
                    id: e.id,
                    mime: e.mime,
                    original_name: e.original_name,
                    added_at: e.added_at,
                    data,
                });
            }
            for n in &names {
                if n.starts_with("assets/") && n != "assets/index.json" && !n.ends_with('/') {
                    let listed = n
                        .strip_prefix("assets/")
                        .and_then(|p| p.split_once('.'))
                        .is_some_and(|(id, _)| assets.iter().any(|a| a.id == id));
                    if !listed {
                        return Err(format!("unknown entry {n} (not in assets/index.json)"));
                    }
                }
            }
        }
        let sizes: HashMap<String, Option<(f64, f64)>> = assets
            .iter()
            .map(|a| (a.id.clone(), image_size(&a.data)))
            .collect();
        let size_of = |id: &str| sizes.get(id).copied().flatten();

        let read_options = ReadOptions {
            strict: true,
            today: &options.today,
        };
        let mut models = Vec::new();
        for id in &ids {
            let dir = format!("models/{id}/");
            let mut raw = parse_json(
                &format!("{dir}model.json"),
                &src.read(&format!("{dir}model.json"))?,
            )?;
            // the folder names the model
            if let Some(o) = raw.as_object_mut() {
                o.insert("id".into(), json!(id));
            }
            let mut model = read_model(&raw, &read_options)
                .map_err(|e| format!("models/{id}/model.json: {}", e.0))?;
            let result = if has(&format!("{dir}result.json")) {
                let raw = parse_json(
                    &format!("{dir}result.json"),
                    &src.read(&format!("{dir}result.json"))?,
                )?;
                Some(SavedResult::checked(
                    raw,
                    &format!("models/{id}/result.json"),
                )?)
            } else {
                None
            };
            let backgrounds = if has(&format!("{dir}backgrounds.json")) {
                let raw = parse_json(
                    &format!("{dir}backgrounds.json"),
                    &src.read(&format!("{dir}backgrounds.json"))?,
                )?;
                let all =
                    read_backgrounds(&raw, &format!("models/{id}/backgrounds.json"), &size_of)?;
                for b in &all {
                    if !assets.iter().any(|a| a.id == b.asset_id) {
                        return Err(format!(
                            "models/{id}/backgrounds.json: the drawing {} places the attachment {}, which assets/index.json does not list",
                            b.id, b.asset_id
                        ));
                    }
                }
                all
            } else {
                Vec::new()
            };
            // locks of drawings the model does not have are dropped
            if let Some(locks) = &mut model.locks {
                if let Some(list) = &mut locks.backgrounds {
                    list.retain(|l| backgrounds.iter().any(|b| &b.id == l));
                    if list.is_empty() {
                        locks.backgrounds = None;
                    }
                }
                if *locks == crate::model::ModelLocks::default() {
                    model.locks = None;
                }
            }
            models.push(ProjectModel {
                model,
                result,
                backgrounds,
            });
        }
        let active_model_id = if ids.contains(&project.active_model_id) {
            project.active_model_id
        } else {
            ids[0].clone()
        };
        let thumbnail = if has("thumbnail.png") {
            Some(src.read("thumbnail.png")?)
        } else {
            None
        };
        Ok(Project {
            manifest,
            active_model_id,
            models,
            assets,
            thumbnail,
        })
    }

    /// The model of this id.
    pub fn model(&self, id: &str) -> Option<&ProjectModel> {
        self.models.iter().find(|m| m.model.id == id)
    }

    /// Set a model's result of a run (`done` or `error`), for its current
    /// input.
    pub fn set_result(&mut self, id: &str, result: SavedResult) -> Result<(), String> {
        let m = self
            .models
            .iter_mut()
            .find(|m| m.model.id == id)
            .ok_or_else(|| format!("No model {id}"))?;
        m.result = Some(result);
        if id == self.active_model_id {
            // the picture shows the earlier result
            self.thumbnail = None;
        }
        Ok(())
    }

    /// The save policy: a result whose input changed since is dropped,
    /// and with it the thumbnail.
    pub fn apply_save_policy(&mut self) -> Result<SaveReport, String> {
        let mut report = SaveReport::default();
        for m in &mut self.models {
            if let Some(r) = &m.result {
                if r.input_hash != input_hash(&m.model)? {
                    m.result = None;
                    report.dropped_results.push(m.model.id.clone());
                }
            }
        }
        if !report.dropped_results.is_empty() && self.thumbnail.is_some() {
            self.thumbnail = None;
            report.dropped_thumbnail = true;
        }
        Ok(report)
    }

    /// The JSON entries the app would write for this project, in order, with
    /// the attachments and the thumbnail (`writeProjectArchive`), after the
    /// save policy. `manifest` is the manifest to write.
    pub fn entries(&self, manifest: &Manifest) -> Result<Vec<(String, Vec<u8>, bool)>, String> {
        for m in &self.models {
            if !is_safe_id(&m.model.id) {
                return Err(format!(
                    "A model id must be a folder name ([A-Za-z0-9_-]+): {}",
                    m.model.id
                ));
            }
        }
        if !self
            .models
            .iter()
            .any(|m| m.model.id == self.active_model_id)
        {
            return Err(format!(
                "The active model {} is not in the project",
                self.active_model_id
            ));
        }
        let mut out: Vec<(String, Vec<u8>, bool)> = Vec::new();
        out.push(("manifest.json".into(), json_entry(manifest), true));
        let project = ProjectJson {
            version: PROJECT_SCHEMA_VERSION,
            active_model_id: self.active_model_id.clone(),
            models: self.models.iter().map(|m| m.model.id.clone()).collect(),
            units: "SI".into(),
            settings: EmptySettings {},
        };
        out.push(("project.json".into(), json_entry(&project), true));
        let mut referenced: Vec<&str> = Vec::new();
        for m in &self.models {
            let dir = format!("models/{}/", m.model.id);
            out.push((format!("{dir}model.json"), json_entry(&m.model), true));
            if let Some(r) = &m.result {
                out.push((format!("{dir}result.json"), json_entry(r), true));
            }
            let placed: Vec<&Background> = m
                .backgrounds
                .iter()
                .filter(|b| self.assets.iter().any(|a| a.id == b.asset_id))
                .collect();
            if !placed.is_empty() {
                out.push((format!("{dir}backgrounds.json"), json_entry(&placed), true));
                for b in placed {
                    if !referenced.contains(&b.asset_id.as_str()) {
                        referenced.push(&b.asset_id);
                    }
                }
            }
        }
        if !referenced.is_empty() {
            referenced.sort();
            let mut index = Vec::new();
            let mut files = Vec::new();
            for id in referenced {
                let a = self.assets.iter().find(|a| a.id == id).unwrap();
                let path = format!("assets/{id}.{}", extension_of(&a.mime));
                index.push(AssetEntry {
                    id: id.to_owned(),
                    path: path.clone(),
                    mime: a.mime.clone(),
                    bytes: a.data.len() as f64,
                    sha256: sha256_hex(&a.data),
                    original_name: a.original_name.clone(),
                    added_at: a.added_at.clone(),
                });
                files.push((path, a.data.clone(), false));
            }
            out.push(("assets/index.json".into(), json_entry(&index), true));
            out.extend(files);
        }
        if let Some(t) = self.thumbnail.as_ref().filter(|t| !t.is_empty()) {
            out.push(("thumbnail.png".into(), t.clone(), false));
        }
        Ok(out)
    }

    /// The manifest of a save at `modified` by `app_version` (the
    /// project's `created` kept, or `modified` for a new one).
    pub fn manifest_for_save(
        &self,
        modified: &str,
        app_version: &str,
        generator: &str,
    ) -> Manifest {
        Manifest {
            format: FORMAT.into(),
            format_version: FORMAT_VERSION,
            min_reader_version: MIN_READER_VERSION,
            app_version: app_version.into(),
            created: if self.manifest.created.is_empty() {
                modified.into()
            } else {
                self.manifest.created.clone()
            },
            modified: modified.into(),
            generator: generator.into(),
        }
    }

    // ── As JSON, for the Python binding ─────────────────────────

    /// The project as one JSON document without the attachments' bytes and
    /// the thumbnail: `{manifest, activeModelId, models: [{id, model,
    /// result, backgrounds}], assets: [{id, mime, originalName, addedAt}]}`.
    pub fn to_document(&self) -> Value {
        json!({
            "manifest": self.manifest,
            "activeModelId": self.active_model_id,
            "models": self.models.iter().map(|m| json!({
                "id": m.model.id,
                "model": m.model,
                "result": m.result,
                "backgrounds": m.backgrounds,
            })).collect::<Vec<_>>(),
            "assets": self.assets.iter().map(|a| json!({
                "id": a.id,
                "mime": a.mime,
                "originalName": a.original_name,
                "addedAt": a.added_at,
            })).collect::<Vec<_>>(),
        })
    }

    /// A project from [`Project::to_document`]'s document (edited), the
    /// attachments' bytes by id and the thumbnail. Each model is read
    /// strictly (an unknown member is an error naming it).
    pub fn from_document(
        doc: &Value,
        mut data: BTreeMap<String, Vec<u8>>,
        thumbnail: Option<Vec<u8>>,
    ) -> Result<Project, String> {
        let o = doc.as_object().ok_or("The project is not an object")?;
        for k in o.keys() {
            if !["manifest", "activeModelId", "models", "assets"].contains(&k.as_str()) {
                return Err(format!("unknown member {k} of the project"));
            }
        }
        let manifest: Manifest = from_json_typed(
            "The manifest",
            o.get("manifest").cloned().unwrap_or(Value::Null),
        )?;
        let active_model_id = o
            .get("activeModelId")
            .and_then(Value::as_str)
            .ok_or("The project has no activeModelId")?
            .to_owned();
        let today = crate::normalize::today();
        let read_options = ReadOptions {
            strict: true,
            today: &today,
        };
        let mut models = Vec::new();
        for (i, m) in o
            .get("models")
            .and_then(Value::as_array)
            .ok_or("The project has no models")?
            .iter()
            .enumerate()
        {
            let mo = m
                .as_object()
                .ok_or_else(|| format!("models[{i}] is not an object"))?;
            for k in mo.keys() {
                if !["id", "model", "result", "backgrounds"].contains(&k.as_str()) {
                    return Err(format!("unknown member models[{i}].{k}"));
                }
            }
            let mut raw = mo
                .get("model")
                .cloned()
                .ok_or_else(|| format!("models[{i}] has no model"))?;
            if let (Some(id), Some(ro)) =
                (mo.get("id").and_then(Value::as_str), raw.as_object_mut())
            {
                ro.insert("id".into(), json!(id));
            }
            let model = read_model(&raw, &read_options)
                .map_err(|e| format!("models[{i}].model: {}", e.0))?;
            let result = match mo.get("result") {
                None | Some(Value::Null) => None,
                Some(r) => Some(SavedResult::checked(
                    r.clone(),
                    &format!("models[{i}].result"),
                )?),
            };
            let backgrounds = match mo.get("backgrounds") {
                None | Some(Value::Null) => Vec::new(),
                Some(b) => from_json_typed::<Vec<Background>>(
                    &format!("models[{i}].backgrounds"),
                    b.clone(),
                )?,
            };
            models.push(ProjectModel {
                model,
                result,
                backgrounds,
            });
        }
        if models.is_empty() {
            return Err("The project has no models".into());
        }
        let mut assets = Vec::new();
        for (i, a) in o
            .get("assets")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let ao = a
                .as_object()
                .ok_or_else(|| format!("assets[{i}] is not an object"))?;
            for k in ao.keys() {
                if !["id", "mime", "originalName", "addedAt"].contains(&k.as_str()) {
                    return Err(format!("unknown member assets[{i}].{k}"));
                }
            }
            let s = |k: &str| {
                ao.get(k)
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| format!("assets[{i}].{k} is not a string"))
            };
            let id = s("id")?;
            let bytes = data
                .remove(&id)
                .ok_or_else(|| format!("No bytes for the attachment {id}"))?;
            assets.push(Asset {
                id,
                mime: s("mime")?,
                original_name: s("originalName")?,
                added_at: s("addedAt")?,
                data: bytes,
            });
        }
        Ok(Project {
            manifest,
            active_model_id,
            models,
            assets,
            thumbnail,
        })
    }
}

/// The current time as ISO 8601 with milliseconds (`Date.toISOString`).
pub fn now_iso() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    iso_of(d.as_secs() as i64, d.subsec_millis())
}

/// Seconds since 1970 (UTC) and milliseconds as ISO 8601.
pub fn iso_of(secs: i64, millis: u32) -> String {
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let s = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        s / 3600,
        s % 3600 / 60,
        s % 60
    )
}

/// Year, month, day of a day number since 1970 (Howard Hinnant).
pub(crate) fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// The parts of an ISO 8601 time (`YYYY-MM-DDTHH:MM:SS`), for the ZIP time
/// stamp.
pub fn iso_parts(iso: &str) -> Option<(u16, u8, u8, u8, u8, u8)> {
    let b = iso.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |r: std::ops::Range<usize>| iso.get(r)?.parse::<u16>().ok();
    Some((
        n(0..4)?,
        n(5..7)? as u8,
        n(8..10)? as u8,
        n(11..13)? as u8,
        n(14..16)? as u8,
        n(17..19)? as u8,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_times() {
        assert_eq!(iso_of(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_of(1_762_430_400, 5), "2025-11-06T12:00:00.005Z");
        assert_eq!(
            iso_parts("2026-11-04T10:00:00.000Z"),
            Some((2026, 11, 4, 10, 0, 0))
        );
    }

    #[test]
    fn extensions_of_types() {
        assert_eq!(extension_of("image/PNG"), "png");
        assert_eq!(extension_of("application/x-unknown"), "bin");
    }

    #[test]
    fn a_result_with_an_unknown_member_is_refused() {
        let ok = json!({ "minFOS": 1.2, "maxFOS": 2.0, "allSurfaces": [], "criticalSlices": [], "criticalSurface": null, "method": "Bishop", "elapsedMs": 1 });
        check_result(&ok, "r").unwrap();
        let mut bad = ok.clone();
        bad["glow"] = json!(1);
        assert_eq!(
            check_result(&bad, "r").unwrap_err(),
            "r: unknown member result.glow"
        );
        let shapeless = json!({ "minFOS": 1.2 });
        assert!(check_result(&shapeless, "r").is_err());
    }
}
