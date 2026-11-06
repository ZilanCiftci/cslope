//! What the app does to a model when it opens a project (`normalizeModelEntry`
//! and its helpers in packages/desktop/src/store/persistence.ts), for the
//! parts that reach the analysis: the definition (`model_to_definition`) and
//! the options a run takes. A model saved by the app may lack fields that
//! were added later (a file of 2026-10 has no `compositeSurfaces`, which the
//! app then reads as false), and a hand-made one may hold values the app
//! drops or clamps; converted without this, such a model would run
//! differently from the app.
//!
//! Ported (the rules of the code, field by field): the outline and its
//! orientation, the materials and their models (`normalizeMaterial`,
//! `sanitizeMaterialModel`), the boundaries, the region assignments, the
//! piezometric lines (`normalizePiezo`), the loads (`normalizeUdl`,
//! `normalizeLineLoad`), reinforcement and piles (`sanitizeReinforcement`,
//! `sanitizePile`), the options (`normalizeAnalysisOptions` with the
//! partial factors, the finite element and the 3D settings), the search
//! limits, the custom surfaces, the block search objects, the waternet and
//! the earlier stage. Left out, as they do not reach the analysis: the
//! project block, the paper and the views, the expressions and parameters
//! (the coordinates hold their values), labels, locks, drawings and the
//! saved run.
//!
//! For a project of schema version 3 (the current one): the migrations of
//! older versions are the app's (`cslope export` refuses older files).
//!
//! The one difference: where the app gives a missing id a random one
//! (`nextId`), this gives `<prefix>-<n>`; a boundary's id orders the
//! boundaries, so a hand-made file with boundaries without ids may order
//! them differently. Files the app saved have every id.

use crate::convert::{app_default_options, ConvertError};
use crate::model::{ModelEntry, MATERIAL_COLORS};
use cslope_engine::model::canonical::{resolve_orientation, SlopeOrientation};
use cslope_engine::types::{
    default_fem_settings, supports_anisotropy, supports_suction_strength, swedish_partial_factors,
    try_validate_material_model, MaterialModel, SwedishFactorBasis, ITERATIONS_RANGE,
    REFINED_ITERATIONS_RANGE, SLICES_RANGE,
};
use serde_json::{json, Map, Value};
use std::cell::Cell;

/// The app's tolerance range (`TOLERANCE_RANGE`, store/defaults.ts).
const TOLERANCE_RANGE: (f64, f64) = (0.001, 0.1);
/// `DEFAULT_MODEL_NAME`.
const DEFAULT_MODEL_NAME: &str = "Untitled";

type Obj = Map<String, Value>;

fn err<T>(m: impl Into<String>) -> Result<T, ConvertError> {
    Err(ConvertError(m.into()))
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

fn str_of(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str)
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

/// Ids for what has none (the app's `nextId`, without its randomness).
struct Ids(Cell<u32>);

impl Ids {
    fn next(&self, prefix: &str) -> String {
        let n = self.0.get() + 1;
        self.0.set(n);
        format!("{prefix}-{n}")
    }
    fn of(&self, v: Option<&Value>, prefix: &str) -> String {
        str_of(v)
            .map(str::to_owned)
            .unwrap_or_else(|| self.next(prefix))
    }
}

/// A model as the app holds it after opening the project (the fields that
/// reach the analysis), from its `model.json` as saved.
pub fn normalize_for_run(raw: &Value) -> Result<ModelEntry, ConvertError> {
    let value = normalize_model_json(raw)?;
    ModelEntry::from_json(value).map_err(ConvertError)
}

/// [`normalize_for_run`] as JSON (the app's shape).
pub fn normalize_model_json(raw: &Value) -> Result<Value, ConvertError> {
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
    let ids = Ids(Cell::new(100));
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
        "coordinates".into(),
        Value::Array(coordinates.iter().map(|c| point(c[0], c[1])).collect()),
    );
    out.insert(
        "materials".into(),
        Value::Array(
            model["materials"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
                .map(|(i, m)| material(m, i))
                .collect(),
        ),
    );
    out.insert(
        "materialBoundaries".into(),
        Value::Array(
            array(model.get("materialBoundaries"))
                .filter(|b| is_object(Some(b)))
                .map(|b| {
                    json!({
                        "id": ids.of(b.get("id"), "bnd"),
                        "coordinates": points(b.get("coordinates")),
                    })
                })
                .collect(),
        ),
    );
    out.insert(
        "regionMaterials".into(),
        Value::Array(
            array(model.get("regionMaterials"))
                .filter_map(|a| {
                    let p = point_of(a.get("point"))?;
                    let m = str_of(a.get("materialId"))?;
                    Some(json!({ "point": p, "materialId": m }))
                })
                .collect(),
        ),
    );
    out.insert(
        "piezometricLine".into(),
        piezo(model.get("piezometricLine"), &ids),
    );
    out.insert(
        "udls".into(),
        Value::Array(array(model.get("udls")).filter_map(udl).collect()),
    );
    out.insert(
        "lineLoads".into(),
        Value::Array(
            array(model.get("lineLoads"))
                .filter_map(line_load)
                .collect(),
        ),
    );
    if let Some(Value::Array(rows)) = model.get("reinforcements") {
        out.insert(
            "reinforcements".into(),
            Value::Array(rows.iter().filter_map(|r| reinforcement(r, &ids)).collect()),
        );
    }
    if let Some(Value::Array(rows)) = model.get("piles") {
        out.insert(
            "piles".into(),
            Value::Array(rows.iter().filter_map(|p| pile(p, &ids)).collect()),
        );
    }
    out.insert(
        "options".into(),
        Value::Object(match model.get("options") {
            Some(o) if js_truthy(o) => analysis_options(o),
            _ => app_default_options(),
        }),
    );
    out.insert(
        "analysisLimits".into(),
        analysis_limits(model.get("analysisLimits")),
    );
    out.insert(
        "customSearchPlanes".into(),
        Value::Array(
            array(model.get("customSearchPlanes"))
                .filter_map(|p| custom_plane(p, &ids))
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
                    .filter(|o| is_object(Some(o)))
                    .map(|o| json!({ "id": ids.of(o.get("id"), "bso"), "points": points(o.get("points")) }))
                    .collect(),
            ),
        );
    }
    if let Some(w) = waternet(model.get("waternet")) {
        out.insert("waternet".into(), w);
    }
    if let Some(s) = earlier_stage(model.get("earlierStage")) {
        out.insert("earlierStage".into(), s);
    }
    Ok(Value::Object(out))
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

// ── Materials ───────────────────────────────────────────────────

/// `normalizeMaterial`.
fn material(raw: &Value, index: usize) -> Value {
    let id_default = format!("mat-{}", index + 1);
    let Value::Object(m) = raw else {
        // DEFAULT_MATERIAL
        return json!({
            "id": id_default,
            "name": "Clay",
            "color": "#d4a373",
            "model": { "kind": "mohr-coulomb", "unitWeight": 18, "frictionAngle": 0, "cohesion": 12 },
        });
    };
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
            Value::Object(sanitize_material_model(mm, 0))
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
    Value::Object(out)
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
fn piezo(raw: Option<&Value>, ids: &Ids) -> Value {
    let default =
        json!({ "enabled": false, "lines": [], "activeLineId": null, "materialAssignment": {} });
    let Some(Value::Object(p)) = raw else {
        return default;
    };
    let lines: Vec<Value> = array(p.get("lines"))
        .filter(|l| is_object(Some(l)))
        .map(|l| {
            let mut line = l.as_object().cloned().unwrap_or_default();
            // the display fields as the model types read them
            for key in ["name", "color"] {
                if !line.get(key).is_some_and(Value::is_string) {
                    line.remove(key);
                }
            }
            line.insert("id".into(), json!(ids.of(l.get("id"), "piezo")));
            line.insert(
                "coordinates".into(),
                Value::Array(points(l.get("coordinates"))),
            );
            line.remove("coordinateExpressions");
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
    // `piezo.enabled ?? false` (display only: a boolean here)
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
    if let Some(Value::Array(pts)) = p.get("rapidDrawdown").and_then(|r| r.get("waterBefore")) {
        let ok = pts.len() >= 2
            && pts.iter().all(is_finite_pair)
            && pts.windows(2).all(|w| w[1][0].as_f64() > w[0][0].as_f64());
        if ok {
            out.insert("rapidDrawdown".into(), json!({ "waterBefore": pts }));
        }
    }
    Value::Object(out)
}

/// `normalizeWaternet`.
fn waternet(raw: Option<&Value>) -> Option<Value> {
    let Some(Value::Object(w)) = raw else {
        return None;
    };
    let (Some(Value::Array(heads)), Some(Value::Array(refs))) =
        (w.get("headLines"), w.get("referenceLines"))
    else {
        return None;
    };
    let head_lines: Vec<Value> = heads
        .iter()
        .filter_map(|h| {
            let id = str_of(h.get("id"))?;
            Some(json!({ "id": id, "points": points(h.get("points")) }))
        })
        .collect();
    let reference_lines: Vec<Value> = refs
        .iter()
        .filter(|r| is_object(Some(r)))
        .map(|r| {
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

/// `normalizeUdl` (the expressions left out).
fn udl(raw: &Value) -> Option<Value> {
    let u = raw.as_object()?;
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
        .filter_map(|e| {
            let m = str_of(e.get("materialId"))?;
            let r = num(e.get("ratio")).filter(|r| (0.0..=1.0).contains(r))?;
            Some(json!({ "materialId": m, "ratio": r }))
        })
        .collect();
    if !excess.is_empty() {
        out.insert("excessPorePressure".into(), Value::Array(excess));
    }
    Some(Value::Object(out))
}

/// `normalizeLineLoad` (the expressions left out).
fn line_load(raw: &Value) -> Option<Value> {
    let l = raw.as_object()?;
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
fn reinforcement(raw: &Value, ids: &Ids) -> Option<Value> {
    let r = raw.as_object()?;
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
            .unwrap_or_else(|| ids.next("reinf"))),
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
fn pile(raw: &Value, ids: &Ids) -> Option<Value> {
    let p = raw.as_object()?;
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
            .unwrap_or_else(|| ids.next("pile"))),
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
fn analysis_limits(raw: Option<&Value>) -> Value {
    let d = crate::model::DEFAULT_ANALYSIS_LIMITS;
    let Some(a) = raw.filter(|a| is_object(Some(a))) else {
        return json!({ "enabled": false, "entryLeftX": d.entry_left_x, "entryRightX": d.entry_right_x, "exitLeftX": d.exit_left_x, "exitRightX": d.exit_right_x });
    };
    json!({
        "enabled": a.get("enabled").and_then(Value::as_bool).unwrap_or(d.enabled),
        "entryLeftX": finite_or(a.get("entryLeftX"), d.entry_left_x),
        "entryRightX": finite_or(a.get("entryRightX"), d.entry_right_x),
        "exitLeftX": finite_or(a.get("exitLeftX"), d.exit_left_x),
        "exitRightX": finite_or(a.get("exitRightX"), d.exit_right_x),
    })
}

/// A custom search plane as the app reads it.
fn custom_plane(raw: &Value, ids: &Ids) -> Option<Value> {
    let p = raw.as_object()?;
    if let Some(Value::Array(_)) = p.get("points") {
        return Some(
            json!({ "id": ids.of(p.get("id"), "plane"), "cx": 0, "cy": 0, "radius": 0, "points": points(p.get("points")) }),
        );
    }
    let (cx, cy, radius) = (num(p.get("cx"))?, num(p.get("cy"))?, num(p.get("radius"))?);
    if radius <= 0.0 {
        return None;
    }
    Some(json!({ "id": ids.of(p.get("id"), "plane"), "cx": cx, "cy": cy, "radius": radius }))
}

// ── Options ─────────────────────────────────────────────────────

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

/// `normalizeAnalysisOptions`: the app's defaults with each saved field
/// checked; unknown fields dropped.
fn analysis_options(raw: &Value) -> Obj {
    let mut out = app_default_options();
    let Some(o) = raw.as_object() else { return out };
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
    if let Some(pf) = partial_factors(o.get("partialFactors")) {
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
        set(&mut out, "fem", fem_settings(f));
    }
    if let Some(Value::Object(s)) = o.get("sgi3d") {
        set(&mut out, "sgi3d", sgi3d_settings(s));
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
fn partial_factors(raw: Option<&Value>) -> Option<Value> {
    let f = raw.filter(|v| is_object(Some(v)))?;
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
fn fem_settings(f: &Obj) -> Value {
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
fn sgi3d_settings(s: &Obj) -> Value {
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
fn earlier_stage(raw: Option<&Value>) -> Option<Value> {
    let d = raw?.as_object()?;
    let (Some(Value::Array(_)), Some(Value::Array(mats))) =
        (d.get("coordinates"), d.get("materials"))
    else {
        return None;
    };
    let coordinates = points(d.get("coordinates"));
    let materials: Vec<Value> = mats
        .iter()
        .filter_map(|m| {
            let q = m.as_object()?;
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
                if w.get("followBoundary") == Some(&Value::Bool(true)) {
                    o["followBoundary"] = json!(true);
                }
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
    Some(Value::Object(stage))
}

/// `normalizeStageWaterTable`.
fn stage_water_table(raw: Option<&Value>) -> Option<Value> {
    let w = raw?.as_object()?;
    let follow = w.get("followBoundary") == Some(&Value::Bool(true));
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
    if follow {
        out["followBoundary"] = json!(true);
    }
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
