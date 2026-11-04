//! Port of packages/engine/src/model/property-helpers.ts
//!
//! Seeded random models and helpers for the property-based (invariant)
//! tests. Test support only (TypeScript does not export it from the
//! engine); `Rng` (mulberry32) is also the block search's generator.
//!
//! Every generated model is a simple slope sliding to the right
//! (left-to-right): crest on the left, toe on the right, with up to two
//! Mohr-Coulomb layers, and a trial circle through the crest and the toe
//! area that stays inside the model.
//!
//! The definitions are built and transformed as JSON (`serde_json::Value`),
//! as TypeScript builds them with object spreads, and read as a
//! `SlopeDefinition` where they are analysed (`definition`).

use crate::api::ctx::RunCtx;
use crate::error::{EngineError, Result};
use crate::js;
use crate::model::build_slope::build_slope;
use crate::model::canonical::to_canonical_slope_definition;
use crate::model::slices::{get_slices, SliceScratch};
use crate::model::slope::AnalysisOptionsPatch;
use crate::model::solvers::{analyse_ordinary, analyse_slope};
use crate::types::SlopeDefinition;
use serde_json::{json, Map, Value};

/// A point `[x, y]`.
pub type Pt = [f64; 2];

/// JavaScript's `ToUint32` (`seed >>> 0`): NaN and ±∞ give 0, else the
/// integer part modulo 2³².
pub fn to_uint32(x: f64) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    let t = x.trunc();
    let m = t.rem_euclid(4294967296.0);
    m as u32
}

/// Small, fast, seedable PRNG (mulberry32), uniform on [0, 1)
/// (TypeScript's `rng(seed)`, a closure; `next()` is a call of it).
#[derive(Debug, Clone)]
pub struct Rng {
    a: u32,
}

impl Rng {
    pub fn new(seed: f64) -> Self {
        Rng { a: to_uint32(seed) }
    }

    /// The next number (`Math.imul` is a wrapping 32-bit product; the sum
    /// of two 32-bit integers taken to 32 bits by `^` is a wrapping sum).
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b79f5);
        let mut t = self.a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

/// `rng(seed)`.
pub fn rng(seed: f64) -> Rng {
    Rng::new(seed)
}

pub fn uniform(r: &mut Rng, lo: f64, hi: f64) -> f64 {
    lo + (hi - lo) * r.next()
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Circle {
    pub cx: f64,
    pub cy: f64,
    pub radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SlopeShape {
    /// Height of the slope face.
    pub h: f64,
    /// Horizontal run of the face.
    pub run: f64,
    /// Crest length (x of the crest edge).
    pub crest: f64,
    /// Toe length.
    pub toe: f64,
    /// Depth of the model below the toe.
    pub depth: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedCase {
    /// The definition as JSON (TypeScript's `SlopeDefinition` object).
    pub def: Value,
    pub circle: Circle,
    pub shape: SlopeShape,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct GenerateOptions {
    /// Second (lower) layer. Default: random.
    pub layers: Option<u8>,
    /// Cohesion range (kPa).
    pub c: Option<[f64; 2]>,
    /// Friction angle range (°).
    pub phi: Option<[f64; 2]>,
    /// Water table through the slope. Default false.
    pub water: bool,
}

pub fn random_shape(r: &mut Rng) -> SlopeShape {
    let h = uniform(r, 5.0, 15.0);
    let run = h * uniform(r, 1.0, 3.0);
    let crest = uniform(r, 8.0, 15.0);
    let toe = uniform(r, 8.0, 15.0);
    let depth = uniform(r, 0.6, 1.2) * h;
    SlopeShape {
        h,
        run,
        crest,
        toe,
        depth,
    }
}

pub fn shape_coordinates(s: &SlopeShape) -> Vec<Pt> {
    let x_toe = s.crest + s.run;
    let x_end = x_toe + s.toe;
    vec![
        [0.0, -s.depth],
        [0.0, s.h],
        [s.crest, s.h],
        [x_toe, 0.0],
        [x_end, 0.0],
        [x_end, -s.depth],
    ]
}

/// Ground elevation of the shape at x.
pub fn ground_y(s: &SlopeShape, x: f64) -> f64 {
    if x <= s.crest {
        return s.h;
    }
    if x >= s.crest + s.run {
        return 0.0;
    }
    s.h * (1.0 - (x - s.crest) / s.run)
}

/// Circle through an entry point on the crest and an exit point near the
/// toe, centre above the chord, inside the model (above its base).
pub fn random_circle(r: &mut Rng, s: &SlopeShape) -> Result<Circle> {
    for _ in 0..200 {
        let x_in = uniform(r, 0.2, 0.9) * s.crest;
        let x_out = s.crest + s.run * uniform(r, 0.85, 1.0) + s.toe * uniform(r, 0.0, 0.4);
        let a: Pt = [x_in, s.h];
        let b: Pt = [x_out, ground_y(s, x_out)];
        let mx = (a[0] + b[0]) / 2.0;
        let my = (a[1] + b[1]) / 2.0;
        let len = js::math::hypot(&[b[0] - a[0], b[1] - a[1]]);
        // Unit normal of the chord, pointing up.
        let mut nx = -(b[1] - a[1]) / len;
        let mut ny = (b[0] - a[0]) / len;
        if ny < 0.0 {
            nx = -nx;
            ny = -ny;
        }
        let off = uniform(r, 0.15, 1.2) * len;
        let cx = mx + nx * off;
        let cy = my + ny * off;
        let radius = js::math::hypot(&[a[0] - cx, a[1] - cy]);
        // Base of the circle above the model base, centre above the crest.
        if cy - radius < -s.depth + 0.25 {
            continue;
        }
        if cy <= s.h + 0.5 {
            continue;
        }
        // Circle cuts the ground only at the entry and the exit: the arc
        // below the ground between them, nowhere else inside the model.
        return Ok(Circle { cx, cy, radius });
    }
    Err(EngineError::new("No admissible circle"))
}

/// The Mohr-Coulomb model of a generated material (its JSON).
pub fn mc(m: &Value) -> Result<Value> {
    let model = &m["model"];
    if model["kind"] != "mohr-coulomb" {
        return Err(EngineError::new(format!(
            "Material \"{}\" is not Mohr-Coulomb",
            m["name"].as_str().unwrap_or("")
        )));
    }
    Ok(model.clone())
}

pub fn mohr_coulomb(gamma: f64, c: f64, phi: f64, gamma_sat: Option<f64>) -> Value {
    let mut m = json!({
        "kind": "mohr-coulomb",
        "unitWeight": gamma,
        "cohesion": c,
        "frictionAngle": phi,
    });
    if let Some(s) = gamma_sat {
        m["unitWeightSat"] = json!(s);
    }
    m
}

fn pts(points: &[Pt]) -> Value {
    Value::Array(points.iter().map(|p| json!([p[0], p[1]])).collect())
}

/// A random left-to-right slope with a trial circle.
pub fn random_case(r: &mut Rng, opts: &GenerateOptions) -> Result<GeneratedCase> {
    let shape = random_shape(r);
    let coordinates = shape_coordinates(&shape);
    let layers = match opts.layers {
        Some(l) => l,
        None => {
            if r.next() < 0.5 {
                1
            } else {
                2
            }
        }
    };
    let [c_lo, c_hi] = opts.c.unwrap_or([2.0, 20.0]);
    let [p_lo, p_hi] = opts.phi.unwrap_or([15.0, 35.0]);
    let mat = |r: &mut Rng, name: &str| {
        let gamma = uniform(r, 16.0, 21.0);
        let c = uniform(r, c_lo, c_hi);
        let phi = uniform(r, p_lo, p_hi);
        json!({ "name": name, "model": mohr_coulomb(gamma, c, phi, None) })
    };
    let mut materials = vec![mat(r, "Upper")];
    let x_end = coordinates[4][0];
    let mut def = Map::new();
    def.insert("orientation".into(), json!("ltr"));
    def.insert("coordinates".into(), pts(&coordinates));
    if layers == 2 {
        materials.push(mat(r, "Lower"));
        let y0 = uniform(r, -0.4, 0.6) * shape.h;
        let y1 = y0 + uniform(r, -0.3, 0.1) * shape.h;
        // Keep the boundary below the ground at the right edge.
        let y_right = js::math::min(y1, -0.1 * shape.depth);
        def.insert(
            "materialBoundaries".into(),
            json!([{ "coordinates": [[0, y0], [x_end, y_right]], "materialName": "Lower" }]),
        );
        def.insert(
            "regionAssignments".into(),
            json!([
                { "point": [0.5, (y0 + shape.h) / 2.0], "materialName": "Upper" },
                { "point": [0.5, (y0 - shape.depth) / 2.0], "materialName": "Lower" },
            ]),
        );
    }
    if opts.water {
        let w_crest = shape.h * uniform(r, -0.2, 0.7);
        let w_toe = uniform(r, -0.5, 0.0) * shape.h * 0.3;
        def.insert(
            "waterTable".into(),
            json!({
                "mode": "custom",
                "value": [[0, w_crest], [shape.crest, w_crest], [shape.crest + shape.run, w_toe], [x_end, w_toe]],
                "followBoundary": true,
            }),
        );
    }
    // (TypeScript's `materials` array is the definition's, pushed to later)
    let mut ordered = Map::new();
    ordered.insert("orientation".into(), def.remove("orientation").unwrap());
    ordered.insert("coordinates".into(), def.remove("coordinates").unwrap());
    ordered.insert("materials".into(), Value::Array(materials));
    ordered.extend(def);
    let circle = random_circle(r, &shape)?;
    Ok(GeneratedCase {
        def: Value::Object(ordered),
        circle,
        shape,
    })
}

/// Options for accurate, comparable FOS values on a fixed surface.
pub fn property_options() -> Value {
    json!({
        "slices": 40,
        "tolerance": 1e-7,
        "maxIterations": 200,
        "refinedIterations": 0,
        "minSlipArea": 0,
        "minSlipDepth": 0,
    })
}

/// `Method`: an analysis method or "Ordinary".
pub type Method = &'static str;

/// `{ ...a, ...b }` of two JSON objects.
pub fn spread(a: &Value, b: &Value) -> Value {
    let mut out = a.as_object().cloned().unwrap_or_default();
    if let Some(b) = b.as_object() {
        for (k, v) in b {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}

/// Definition analysed on the given circle only.
pub fn on_circle(def: &Value, c: &Circle) -> Value {
    spread(
        def,
        &json!({ "customSearchPlanes": [{ "cx": c.cx, "cy": c.cy, "radius": c.radius }], "customPlanesOnly": true }),
    )
}

/// Definition analysed on the given polyline only.
pub fn on_polyline(def: &Value, points: &[Pt], axis: Option<Pt>) -> Value {
    let mut surface = json!({ "points": pts(points) });
    if let Some(a) = axis {
        surface["axis"] = json!([a[0], a[1]]);
    }
    spread(
        def,
        &json!({ "customSurfaces": [surface], "customPlanesOnly": true }),
    )
}

/// The JSON definition as the engine reads it.
pub fn definition(def: &Value) -> Result<SlopeDefinition> {
    serde_json::from_value(def.clone())
        .map_err(|e| EngineError::new(format!("invalid slope definition: {e}")))
}

/// FOS of a definition (given in model space, either orientation) on its
/// custom surfaces, through the same canonical path as the application.
pub fn fos_of(def: &Value, method: Method, options: &Value) -> Result<Option<f64>> {
    let canonical = to_canonical_slope_definition(&definition(def)?, None)?;
    let mut slope = build_slope(&canonical)?;
    let mut merged = spread(&property_options(), options);
    merged["method"] = json!(if method == "Ordinary" {
        "Bishop"
    } else {
        method
    });
    let patch: AnalysisOptionsPatch = serde_json::from_value(merged)
        .map_err(|e| EngineError::new(format!("invalid analysis options: {e}")))?;
    slope.update_analysis_options(&patch)?;
    if method != "Ordinary" {
        return analyse_slope(&mut slope, &mut RunCtx::default());
    }
    let Some(plane) = slope.individual_planes().first().cloned() else {
        return Ok(None);
    };
    let slices = get_slices(
        &slope,
        plane.lc[0],
        plane.rc[0],
        plane.cx,
        plane.cy,
        plane.radius,
        plane.points.as_deref(),
        &mut SliceScratch::new(),
    )?;
    Ok(if !slices.is_empty() {
        analyse_ordinary(&slope, &slices)
    } else {
        None
    })
}

fn map_pts(v: &Value, f: &dyn Fn(Pt) -> Pt) -> Value {
    match v.as_array() {
        Some(a) => Value::Array(
            a.iter()
                .map(|p| {
                    let q = f([
                        p[0].as_f64().unwrap_or(f64::NAN),
                        p[1].as_f64().unwrap_or(f64::NAN),
                    ]);
                    json!([q[0], q[1]])
                })
                .collect(),
        ),
        None => v.clone(),
    }
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(f64::NAN)
}

/// Mirror x about x = axis, reversing every x range. Independent of canonical.rs.
pub fn mirror_definition(def: &Value, axis: f64) -> Value {
    let mx = move |x: f64| 2.0 * axis - x;
    let mp = move |p: Pt| -> Pt { [mx(p[0]), p[1]] };
    let mut out = def.as_object().cloned().unwrap_or_default();
    out.insert(
        "orientation".into(),
        json!(if def["orientation"] == "rtl" {
            "ltr"
        } else {
            "rtl"
        }),
    );
    out.insert("coordinates".into(), map_pts(&def["coordinates"], &mp));
    if let Some(bs) = def.get("materialBoundaries").and_then(Value::as_array) {
        out.insert(
            "materialBoundaries".into(),
            Value::Array(
                bs.iter()
                    .map(|b| {
                        spread(
                            b,
                            &json!({ "coordinates": map_pts(&b["coordinates"], &mp) }),
                        )
                    })
                    .collect(),
            ),
        );
    }
    if let Some(rs) = def.get("regionAssignments").and_then(Value::as_array) {
        out.insert(
            "regionAssignments".into(),
            Value::Array(
                rs.iter()
                    .map(|a| {
                        let p = mp([num(&a["point"][0]), num(&a["point"][1])]);
                        spread(a, &json!({ "point": [p[0], p[1]] }))
                    })
                    .collect(),
            ),
        );
    }
    if def["waterTable"]["mode"] == "custom" {
        out.insert(
            "waterTable".into(),
            spread(
                &def["waterTable"],
                &json!({ "value": map_pts(&def["waterTable"]["value"], &mp) }),
            ),
        );
    }
    if let Some(ws) = def.get("waterTables").and_then(Value::as_array) {
        out.insert(
            "waterTables".into(),
            Value::Array(
                ws.iter()
                    .map(|w| {
                        spread(
                            w,
                            &json!({ "coordinates": map_pts(&w["coordinates"], &mp) }),
                        )
                    })
                    .collect(),
            ),
        );
    }
    if let Some(us) = def.get("udls").and_then(Value::as_array) {
        out.insert(
            "udls".into(),
            Value::Array(
                us.iter()
                    .map(|u| {
                        spread(
                            u,
                            &json!({ "x1": mx(num(&u["x2"])), "x2": mx(num(&u["x1"])) }),
                        )
                    })
                    .collect(),
            ),
        );
    }
    if let Some(ls) = def.get("lineLoads").and_then(Value::as_array) {
        out.insert(
            "lineLoads".into(),
            Value::Array(
                ls.iter()
                    .map(|l| {
                        let mut o = spread(l, &json!({ "x": mx(num(&l["x"])) }));
                        // `...(l.angle ? { angle: -l.angle } : {})`
                        if let Some(a) = l
                            .get("angle")
                            .and_then(Value::as_f64)
                            .filter(|a| *a != 0.0 && !a.is_nan())
                        {
                            o["angle"] = json!(-a);
                        }
                        o
                    })
                    .collect(),
            ),
        );
    }
    for key in ["reinforcements", "piles"] {
        if let Some(qs) = def.get(key).and_then(Value::as_array) {
            out.insert(
                key.into(),
                Value::Array(
                    qs.iter()
                        .map(|q| {
                            spread(
                                q,
                                &json!({ "x1": mx(num(&q["x1"])), "x2": mx(num(&q["x2"])) }),
                            )
                        })
                        .collect(),
                ),
            );
        }
    }
    if let Some(l) = def.get("analysisLimits").filter(|l| l.is_object()) {
        out.insert(
            "analysisLimits".into(),
            json!({
                "entryLeftX": mx(num(&l["entryRightX"])),
                "entryRightX": mx(num(&l["entryLeftX"])),
                "exitLeftX": mx(num(&l["exitRightX"])),
                "exitRightX": mx(num(&l["exitLeftX"])),
            }),
        );
    }
    if let Some(cs) = def.get("customSearchPlanes").and_then(Value::as_array) {
        out.insert(
            "customSearchPlanes".into(),
            Value::Array(
                cs.iter()
                    .map(|c| spread(c, &json!({ "cx": mx(num(&c["cx"])) })))
                    .collect(),
            ),
        );
    }
    if let Some(ss) = def.get("customSurfaces").and_then(Value::as_array) {
        out.insert(
            "customSurfaces".into(),
            Value::Array(
                ss.iter()
                    .map(|s| {
                        let mut points = map_pts(&s["points"], &mp);
                        if let Some(a) = points.as_array_mut() {
                            a.reverse();
                        }
                        let mut o = json!({ "points": points });
                        if s.get("axis").is_some_and(|a| a.is_array()) {
                            let p = mp([num(&s["axis"][0]), num(&s["axis"][1])]);
                            o["axis"] = json!([p[0], p[1]]);
                        }
                        o
                    })
                    .collect(),
            ),
        );
    }
    if let Some(ms) = def.get("materials").and_then(Value::as_array) {
        out.insert(
            "materials".into(),
            Value::Array(
                ms.iter()
                    .map(|m| {
                        if m["model"]["kind"] != "spatial-mohr-coulomb" {
                            return m.clone();
                        }
                        let dp: Vec<Value> = m["model"]["dataPoints"]
                            .as_array()
                            .map(|a| {
                                a.iter()
                                    .map(|p| {
                                        json!([
                                            mx(num(&p[0])),
                                            p[1].clone(),
                                            p[2].clone(),
                                            p[3].clone(),
                                            p[4].clone()
                                        ])
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();
                        spread(
                            m,
                            &json!({ "model": spread(&m["model"], &json!({ "dataPoints": dp })) }),
                        )
                    })
                    .collect(),
            ),
        );
    }
    Value::Object(out)
}

/// The transformation of `transform_definition`: lengths ×k, then shifted
/// by (dx, dy); stresses ×s.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Transform {
    pub k: Option<f64>,
    pub s: Option<f64>,
    pub dx: Option<f64>,
    pub dy: Option<f64>,
}

/// Affine map of a Mohr-Coulomb definition: lengths ×k, then shifted by
/// (dx, dy); stresses ×s (cohesion, UDL, unit weight ×s/k, line loads per
/// metre ×s·k, element and pile forces ×s·k² with their spacing ×k).
/// Water keeps γw, so with water only s = k is consistent.
pub fn transform_definition(def: &Value, t: Transform) -> Result<Value> {
    let k = t.k.unwrap_or(1.0);
    let s = t.s.unwrap_or(1.0);
    let dx = t.dx.unwrap_or(0.0);
    let dy = t.dy.unwrap_or(0.0);
    let x_of = move |x: f64| x * k + dx;
    let y_of = move |y: f64| y * k + dy;
    let p_of = move |p: Pt| -> Pt { [x_of(p[0]), y_of(p[1])] };
    let scale_pullout = |p: &Value| -> Value {
        match p["kind"].as_str() {
            Some("bond") => {
                let mut o = json!({ "kind": "bond", "strength": num(&p["strength"]) * s * k });
                if p.get("bondedLength").is_some_and(|v| !v.is_null()) {
                    o["bondedLength"] = json!(num(&p["bondedLength"]) * k);
                }
                o
            }
            Some("development") => json!({
                "kind": "development",
                "length1": num(&p["length1"]) * k,
                "length2": num(&p["length2"]) * k,
            }),
            _ => spread(p, &json!({ "adhesion": num(&p["adhesion"]) * s })),
        }
    };
    let mut out = def.as_object().cloned().unwrap_or_default();
    out.insert("coordinates".into(), map_pts(&def["coordinates"], &p_of));
    let mut materials = Vec::new();
    for m in def["materials"].as_array().cloned().unwrap_or_default() {
        let model = material_model_of(&m);
        if model["kind"] != "mohr-coulomb" {
            return Err(EngineError::new("transformDefinition: Mohr-Coulomb only"));
        }
        let mut nm = spread(
            &model,
            &json!({
                "unitWeight": (num(&model["unitWeight"]) * s) / k,
                "cohesion": num(&model["cohesion"]) * s,
            }),
        );
        if model.get("unitWeightSat").is_some_and(|v| !v.is_null()) {
            nm["unitWeightSat"] = json!((num(&model["unitWeightSat"]) * s) / k);
        }
        materials.push(spread(&with_material_model(&m), &json!({ "model": nm })));
    }
    out.insert("materials".into(), Value::Array(materials));
    if let Some(bs) = def.get("materialBoundaries").and_then(Value::as_array) {
        out.insert(
            "materialBoundaries".into(),
            Value::Array(
                bs.iter()
                    .map(|b| {
                        spread(
                            b,
                            &json!({ "coordinates": map_pts(&b["coordinates"], &p_of) }),
                        )
                    })
                    .collect(),
            ),
        );
    }
    if let Some(rs) = def.get("regionAssignments").and_then(Value::as_array) {
        out.insert(
            "regionAssignments".into(),
            Value::Array(
                rs.iter()
                    .map(|a| {
                        let p = p_of([num(&a["point"][0]), num(&a["point"][1])]);
                        spread(a, &json!({ "point": [p[0], p[1]] }))
                    })
                    .collect(),
            ),
        );
    }
    if let Some(w) = def.get("waterTable").filter(|w| w.is_object()) {
        let value = match w["mode"].as_str() {
            Some("custom") => map_pts(&w["value"], &p_of),
            Some("height") => json!(y_of(num(&w["value"]))),
            _ => json!(num(&w["value"]) * k),
        };
        out.insert("waterTable".into(), spread(w, &json!({ "value": value })));
    }
    if let Some(ws) = def.get("waterTables").and_then(Value::as_array) {
        out.insert(
            "waterTables".into(),
            Value::Array(
                ws.iter()
                    .map(|w| {
                        spread(
                            w,
                            &json!({ "coordinates": map_pts(&w["coordinates"], &p_of) }),
                        )
                    })
                    .collect(),
            ),
        );
    }
    if let Some(us) = def.get("udls").and_then(Value::as_array) {
        out.insert(
            "udls".into(),
            Value::Array(
                us.iter()
                    .map(|u| {
                        spread(
                            u,
                            &json!({ "magnitude": num(&u["magnitude"]) * s, "x1": x_of(num(&u["x1"])), "x2": x_of(num(&u["x2"])) }),
                        )
                    })
                    .collect(),
            ),
        );
    }
    if let Some(ls) = def.get("lineLoads").and_then(Value::as_array) {
        out.insert(
            "lineLoads".into(),
            Value::Array(
                ls.iter()
                    .map(|l| json!({ "magnitude": num(&l["magnitude"]) * s * k, "x": x_of(num(&l["x"])) }))
                    .collect(),
            ),
        );
    }
    let present = |q: &Value, f: &str| q.get(f).is_some_and(|v| !v.is_null());
    if let Some(qs) = def.get("reinforcements").and_then(Value::as_array) {
        out.insert(
            "reinforcements".into(),
            Value::Array(
                qs.iter()
                    .map(|q| {
                        let spacing = q.get("spacing").and_then(Value::as_f64).unwrap_or(1.0);
                        let mut o = spread(
                            q,
                            &json!({
                                "x1": x_of(num(&q["x1"])), "y1": y_of(num(&q["y1"])),
                                "x2": x_of(num(&q["x2"])), "y2": y_of(num(&q["y2"])),
                                // Capacities per element (spacing ×k): ×s·k².
                                "tensileCapacity": num(&q["tensileCapacity"]) * s * k * k,
                                "spacing": spacing * k,
                            }),
                        );
                        for f in ["end1Capacity", "end2Capacity", "prestress"] {
                            if present(q, f) {
                                o[f] = json!(num(&q[f]) * s * k * k);
                            }
                        }
                        if q.get("pullout").is_some_and(|p| p.is_object()) {
                            o["pullout"] = scale_pullout(&q["pullout"]);
                        }
                        o
                    })
                    .collect(),
            ),
        );
    }
    if let Some(ps) = def.get("piles").and_then(Value::as_array) {
        out.insert(
            "piles".into(),
            Value::Array(
                ps.iter()
                    .map(|p| {
                        let spacing = p.get("spacing").and_then(Value::as_f64).unwrap_or(1.0);
                        let mut o = spread(
                            p,
                            &json!({
                                "x1": x_of(num(&p["x1"])), "y1": y_of(num(&p["y1"])),
                                "x2": x_of(num(&p["x2"])), "y2": y_of(num(&p["y2"])),
                                "spacing": spacing * k,
                            }),
                        );
                        // per pile: EI (kNm²) ×s·k⁴ and EA (kN) ×s·k², as forces per pile ×s·k²
                        let scales = [
                            ("bendingStiffness", s * js::math::pow(k, 4.0)),
                            ("axialStiffness", s * k * k),
                            ("diameter", k),
                            ("force", s * k * k),
                            ("shearCapacity", s * k * k),
                            ("momentCapacity", s * k * k * k),
                        ];
                        for (f, factor) in scales {
                            if present(p, f) {
                                o[f] = json!(num(&p[f]) * factor);
                            }
                        }
                        o
                    })
                    .collect(),
            ),
        );
    }
    if let Some(l) = def.get("analysisLimits").filter(|l| l.is_object()) {
        out.insert(
            "analysisLimits".into(),
            json!({
                "entryLeftX": x_of(num(&l["entryLeftX"])),
                "entryRightX": x_of(num(&l["entryRightX"])),
                "exitLeftX": x_of(num(&l["exitLeftX"])),
                "exitRightX": x_of(num(&l["exitRightX"])),
            }),
        );
    }
    if let Some(cs) = def.get("customSearchPlanes").and_then(Value::as_array) {
        out.insert(
            "customSearchPlanes".into(),
            Value::Array(
                cs.iter()
                    .map(|c| json!({ "cx": x_of(num(&c["cx"])), "cy": y_of(num(&c["cy"])), "radius": num(&c["radius"]) * k }))
                    .collect(),
            ),
        );
    }
    if let Some(ss) = def.get("customSurfaces").and_then(Value::as_array) {
        out.insert(
            "customSurfaces".into(),
            Value::Array(
                ss.iter()
                    .map(|c| {
                        let mut o = json!({ "points": map_pts(&c["points"], &p_of) });
                        if c.get("axis").is_some_and(|a| a.is_array()) {
                            let p = p_of([num(&c["axis"][0]), num(&c["axis"][1])]);
                            o["axis"] = json!([p[0], p[1]]);
                        }
                        o
                    })
                    .collect(),
            ),
        );
    }
    Ok(Value::Object(out))
}

/// `materialModelOf(m)` on JSON: the model, or the legacy flat fields as a
/// Mohr-Coulomb model.
fn material_model_of(m: &Value) -> Value {
    if m.get("model").is_some_and(|v| v.is_object()) {
        return m["model"].clone();
    }
    let mut model = json!({
        "kind": "mohr-coulomb",
        "unitWeight": m.get("unitWeight").cloned().unwrap_or(json!(0)),
        "cohesion": m.get("cohesion").cloned().unwrap_or(json!(0)),
        "frictionAngle": m.get("frictionAngle").cloned().unwrap_or(json!(0)),
    });
    if let Some(v) = m.get("unitWeightSat").filter(|v| !v.is_null()) {
        model["unitWeightSat"] = v.clone();
    }
    model
}

/// `withMaterialModel(m)` on JSON: the material with its model and without
/// the legacy flat fields.
fn with_material_model(m: &Value) -> Value {
    let mut out = m.as_object().cloned().unwrap_or_default();
    for f in ["unitWeight", "unitWeightSat", "cohesion", "frictionAngle"] {
        out.remove(f);
    }
    out.insert("model".into(), material_model_of(m));
    Value::Object(out)
}

/// Relative difference |a − b| / max(|a|, |b|, tiny).
pub fn rel_diff(a: f64, b: f64) -> f64 {
    (a - b).abs() / js::math::max(js::math::max(a.abs(), b.abs()), 1e-12)
}

/// Add random water, loads, reinforcement, piles to a generated case.
pub fn decorate(r: &mut Rng, g: &GeneratedCase, features: &[&str]) -> Value {
    let shape = g.shape;
    let mut def = g.def.as_object().cloned().unwrap_or_default();
    let has = |f: &str| features.contains(&f);
    let x_toe = shape.crest + shape.run;
    let x_end = x_toe + shape.toe;
    if has("water") {
        let w_crest = shape.h * uniform(r, -0.2, 0.6);
        def.insert(
            "waterTable".into(),
            json!({
                "mode": "custom",
                "value": [[0, w_crest], [shape.crest * 0.8, w_crest], [x_toe, -0.2], [x_end, -0.2]],
                "followBoundary": true,
            }),
        );
    }
    if has("udl") {
        let x1 = uniform(r, 0.0, shape.crest * 0.6);
        let magnitude = uniform(r, 5.0, 40.0);
        let x2 = x1 + uniform(r, 1.0, shape.crest * 0.4);
        def.insert(
            "udls".into(),
            json!([{ "magnitude": magnitude, "x1": x1, "x2": x2 }]),
        );
    }
    if has("lineLoad") {
        let magnitude = uniform(r, 10.0, 80.0);
        let x = uniform(r, 0.3, 0.95) * shape.crest;
        def.insert(
            "lineLoads".into(),
            json!([{ "magnitude": magnitude, "x": x }]),
        );
    }
    if has("nail") {
        // A nail from the face into the slope (downward to the left).
        let t = uniform(r, 0.3, 0.7);
        let x1 = shape.crest + shape.run * t;
        let y1 = shape.h * (1.0 - t);
        let x2 = x1 - uniform(r, 6.0, 12.0);
        let y2 = y1 - uniform(r, 1.0, 4.0);
        let tensile = uniform(r, 50.0, 200.0);
        let spacing = uniform(r, 1.0, 2.0);
        let strength = uniform(r, 20.0, 80.0);
        let direction = if r.next() < 0.5 { "axial" } else { "tangent" };
        let application = if r.next() < 0.5 { "active" } else { "passive" };
        def.insert(
            "reinforcements".into(),
            json!([{
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "tensileCapacity": tensile, "spacing": spacing,
                "pullout": { "kind": "bond", "strength": strength },
                "direction": direction, "application": application,
            }]),
        );
    }
    if has("pile") {
        let x = shape.crest + shape.run * uniform(r, 0.2, 0.6);
        let y_top = shape.h * (1.0 - (x - shape.crest) / shape.run);
        let force = uniform(r, 20.0, 100.0);
        let angle = uniform(r, -20.0, 20.0);
        let direction = ["angle", "tangent", "perpendicular"][(r.next() * 3.0).floor() as usize];
        let application = if r.next() < 0.5 { "active" } else { "passive" };
        def.insert(
            "piles".into(),
            json!([{
                "x1": x, "y1": y_top, "x2": x, "y2": -shape.depth + 0.1,
                "force": force, "angle": angle, "direction": direction, "application": application,
            }]),
        );
    }
    Value::Object(def)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mulberry32_matches_javascript() {
        // rng(1) in Node: the first three numbers
        let mut r = rng(1.0);
        let a = r.next();
        let b = r.next();
        let c = r.next();
        assert_eq!(a, 0.6270739405881613);
        assert_eq!(b, 0.002735721180215478);
        assert_eq!(c, 0.5274470399599522);
    }

    #[test]
    fn to_uint32_is_javascripts() {
        assert_eq!(to_uint32(-1.0), 4294967295);
        assert_eq!(to_uint32(1.9), 1);
        assert_eq!(to_uint32(f64::NAN), 0);
        assert_eq!(to_uint32(4294967296.0 + 5.0), 5);
        assert_eq!(to_uint32(-1.5), 4294967295);
    }
}
