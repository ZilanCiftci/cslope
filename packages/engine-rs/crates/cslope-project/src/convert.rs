//! The conversion between the app's model and the engine's definition, the
//! port of the app's (packages/desktop/src):
//!
//! - [`model_to_definition`], `buildModelSpaceSlopeDTO` (store/helpers.ts),
//!   with `engineBoundaryOrder`, `customPlanesInResultOrder`,
//!   `toEngineReinforcement` / `toEnginePile` (utils/reinforcement.ts),
//!   `mainPiezoLine` (utils/piezo.ts) and `isClosedBoundary`
//!   (utils/regions.ts);
//! - [`definition_to_model`], `modelFromDefinition`
//!   (store/definition-model.ts), without the project block and the paper
//!   (`projectInfo`, `resultViewSettings`): the app fills their defaults
//!   when it opens the model.
//!
//! Both are in model coordinates (the definition carries the orientation).
//! tests/golden.rs holds them to the app's results field for field
//! (golden/project-corpus.json, made by the app's code); a change on one side
//! must be made on the other.

use crate::model::*;
use crate::normalize::today;
use crate::options::{app_default_options, AnalysisOptions};
use cslope_engine::js;
use cslope_engine::model::canonical::resolve_orientation;
use cslope_engine::types::{
    material_model_of, AnalysisLimits, BlockSearchObject, CustomSearchPlane, CustomSurface,
    LineLoadDefinition, MaterialBoundary, Pile, RapidDrawdown, RegionAssignment, Reinforcement,
    ReinforcementPullout, SlopeDefinition, SlopeMaterialDefinition, UdlDefinition, UdlDirection,
    UdlExcessPorePressure, WaterTableDefinition, WaterTableEntry, WaterTableMode, WaterTableValue,
};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

/// An error of the conversion: what the app would refuse, in its words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConvertError(pub String);

impl std::fmt::Display for ConvertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ConvertError {}

fn err<T>(message: impl Into<String>) -> Result<T, ConvertError> {
    Err(ConvertError(message.into()))
}

/// An engine enum from the app's string (the engine keeps an unknown one
/// as `Other`, as the app would pass it on).
fn engine_enum<T: DeserializeOwned>(s: &str) -> T {
    serde_json::from_value(Value::String(s.to_owned())).expect("the engine's enums take any string")
}

/// The app's string of an engine enum (an unknown value as its JSON).
fn enum_text<T: serde::Serialize>(v: &T) -> String {
    match serde_json::to_value(v) {
        Ok(Value::String(s)) => s,
        Ok(other) => other.to_string(),
        Err(_) => String::new(),
    }
}

// ── The model to the definition ─────────────────────────────────

/// `isClosedBoundary`: a loop needs three distinct corners, `[a, b, a]` is
/// a line folded back.
pub fn is_closed_boundary(coords: &[Point]) -> bool {
    if coords.len() < 4 {
        return false;
    }
    let [x0, y0] = coords[0];
    let [xn, yn] = coords[coords.len() - 1];
    (x0 - xn).abs() < 1e-9 && (y0 - yn).abs() < 1e-9
}

/// `engineBoundaryOrder`: the boundaries in the order the analysis gets
/// them, by id (open boundaries before closed ones), as the canvas applies
/// them. The app sorts with `localeCompare`; for the ids it writes that is
/// their byte order (tests/golden.rs checks the forms it writes).
pub fn engine_boundary_order(boundaries: &[MaterialBoundaryRow]) -> Vec<&MaterialBoundaryRow> {
    let mut sorted: Vec<&MaterialBoundaryRow> = boundaries.iter().collect();
    sorted.sort_by(|a, b| a.id.as_bytes().cmp(b.id.as_bytes()));
    let (open, closed): (Vec<_>, Vec<_>) = sorted
        .into_iter()
        .partition(|b| !is_closed_boundary(&b.coordinates));
    open.into_iter().chain(closed).collect()
}

/// `customPlanesInResultOrder`: the circles, then the polylines with at
/// least two points (incomplete ones are still being entered).
pub fn custom_planes_in_result_order(
    planes: &[CustomSearchPlaneRow],
) -> Vec<&CustomSearchPlaneRow> {
    let circles = planes.iter().filter(|p| p.points.is_none());
    let polylines = planes
        .iter()
        .filter(|p| p.points.as_ref().is_some_and(|pts| pts.len() >= 2));
    circles.chain(polylines).collect()
}

/// `toEngineReinforcement`.
pub fn to_engine_reinforcement(row: &ReinforcementRow) -> Reinforcement {
    let pullout = match row.pullout.as_str() {
        "bond" => Some(ReinforcementPullout::Bond {
            strength: row.bond_strength,
            bonded_length: (row.bonded_length > 0.0).then_some(row.bonded_length),
        }),
        "interface" => Some(ReinforcementPullout::Interface {
            adhesion: row.adhesion,
            friction_angle: row.interface_friction,
            coverage: None,
        }),
        "development" => Some(ReinforcementPullout::Development {
            length1: row.development_length1.unwrap_or(0.0),
            length2: row.development_length2.unwrap_or(0.0),
        }),
        _ => None,
    };
    // `row.prestress` is truthy: not absent, 0 or NaN.
    let prestress = row
        .prestress
        .filter(|&p| row.pullout == "bond" && row.bonded_length > 0.0 && p != 0.0 && !p.is_nan());
    let has_pullout = pullout.is_some();
    Reinforcement {
        x1: row.x1,
        y1: row.y1,
        x2: row.x2,
        y2: row.y2,
        tensile_capacity: row.tensile_capacity,
        spacing: Some(row.spacing),
        pullout,
        end1_capacity: has_pullout.then_some(row.end1_capacity),
        end2_capacity: has_pullout.then_some(row.end2_capacity),
        direction: Some(engine_enum(&row.direction)),
        application: Some(engine_enum(&row.application)),
        prestress,
    }
}

/// `toEnginePile`.
pub fn to_engine_pile(row: &PileRow) -> Pile {
    Pile {
        x1: row.x1,
        y1: row.y1,
        x2: row.x2,
        y2: row.y2,
        force: (row.mode == "force").then_some(row.force),
        diameter: Some(row.diameter),
        spacing: Some(row.spacing),
        shear_capacity: (row.shear_capacity > 0.0).then_some(row.shear_capacity),
        moment_capacity: (row.moment_capacity > 0.0).then_some(row.moment_capacity),
        bending_stiffness: row.bending_stiffness.filter(|&e| e > 0.0),
        wall: (row.kind == "sheet-pile").then_some(true),
        angle: Some(row.angle),
        // `...(row.direction ? ...)`: an empty string is none.
        direction: row
            .direction
            .as_deref()
            .filter(|d| !d.is_empty())
            .map(engine_enum),
        application: Some(engine_enum(&row.application)),
        location: row
            .location
            .as_deref()
            .filter(|l| !l.is_empty())
            .map(engine_enum),
        axial_stiffness: None,
    }
}

/// The engine's definition of a model in the model's own coordinates, with
/// its orientation (`buildModelSpaceSlopeDTO`).
pub fn model_to_definition(model: &ModelEntry) -> SlopeDefinition {
    let materials = &model.materials;
    let analysis_limits = model.analysis_limits;
    let piezo = &model.piezometric_line;

    // The engine looks materials up by name, but users can give two
    // materials the same name: every material gets a unique engine name
    // (the display name, suffixed on collision) and is referred to by id.
    let mut engine_name_by_id: HashMap<&str, String> = HashMap::new();
    let mut used: HashSet<String> = HashSet::new();
    for m in materials {
        let mut name = m.name.clone();
        let mut k = 2;
        while used.contains(&name) {
            name = format!("{} ({k})", m.name);
            k += 1;
        }
        used.insert(name.clone());
        engine_name_by_id.insert(&m.id, name);
    }
    let engine_name = |id: &str| engine_name_by_id.get(id).cloned();

    let mut def = SlopeDefinition::new(
        model.coordinates.clone(),
        materials
            .iter()
            .map(|m| SlopeMaterialDefinition {
                name: engine_name(&m.id).unwrap_or_else(|| m.name.clone()),
                model: Some(m.model.clone()),
                unit_weight: None,
                friction_angle: None,
                cohesion: None,
                cohesion_ref_depth: None,
                cohesion_rate_of_change: None,
                cohesion_undrained: None,
                depth_range: m.depth_range,
                color: Some(m.color.clone()),
                water_table_id: None,
            })
            .collect(),
    );
    def.orientation = Some(model.orientation);

    if !model.material_boundaries.is_empty() {
        // Coordinates only (the materials come from the region
        // assignments), in the order the canvas applies them.
        def.material_boundaries = Some(
            engine_boundary_order(&model.material_boundaries)
                .into_iter()
                .map(|b| MaterialBoundary {
                    coordinates: b.coordinates.clone(),
                    material_name: String::new(),
                })
                .collect(),
        );
    }

    // Point-based region assignments, also without interior boundaries
    // (the single region can have a material assigned).
    if !model.region_materials.is_empty() {
        def.region_assignments = Some(
            model
                .region_materials
                .iter()
                .filter_map(|a| {
                    engine_name(&a.material_id).map(|material_name| RegionAssignment {
                        point: a.point,
                        material_name,
                    })
                })
                .collect(),
        );
    }

    if analysis_limits.enabled {
        def.analysis_limits = Some(AnalysisLimits {
            entry_left_x: analysis_limits.entry_left_x,
            entry_right_x: analysis_limits.entry_right_x,
            exit_left_x: analysis_limits.exit_left_x,
            exit_right_x: analysis_limits.exit_right_x,
        });
    }

    if !piezo.lines.is_empty() {
        // Free water above the ground comes from the line of the material at
        // the ground; a clipped line never rises above the surface.
        let follow_boundary = piezo.free_water == Some(false);
        let usable: Vec<&PiezoLine> = piezo
            .lines
            .iter()
            .filter(|l| l.coordinates.len() >= 2)
            .collect();
        // A main line still being drawn cannot carry the water: the first
        // complete line does (`mainPiezoLine` over the complete lines).
        let main_line = usable
            .iter()
            .find(|l| Some(&l.id) == piezo.main_line_id.as_ref())
            .or(usable.first())
            .copied()
            .unwrap_or(&piezo.lines[0]);
        if main_line.coordinates.len() >= 2 {
            def.water_table = Some(WaterTableDefinition {
                mode: WaterTableMode::Custom,
                value: WaterTableValue::Points(main_line.coordinates.clone()),
                follow_boundary: Some(follow_boundary),
                free_water: None,
            });
        }
        // Several lines: each material uses the line assigned to it (the
        // main line when none is).
        if piezo.lines.len() > 1 && !usable.is_empty() {
            def.water_tables = Some(
                usable
                    .iter()
                    .map(|l| WaterTableEntry {
                        id: l.id.clone(),
                        coordinates: l.coordinates.clone(),
                        follow_boundary: Some(follow_boundary),
                        free_water: None,
                    })
                    .collect(),
            );
            let usable_ids: HashSet<&str> = usable.iter().map(|l| l.id.as_str()).collect();
            for (dto, m) in def.materials.iter_mut().zip(materials) {
                if let Some(line_id) = piezo.material_assignment.get(&m.id) {
                    if !line_id.is_empty() && usable_ids.contains(line_id.as_str()) {
                        dto.water_table_id = Some(Some(line_id.clone()));
                    }
                }
            }
        }
    }

    // Rapid drawdown: the water before it; the lines are the water after.
    if let Some(rd) = &piezo.rapid_drawdown {
        if rd.water_before.len() >= 2 {
            def.rapid_drawdown = Some(RapidDrawdown {
                water_before: rd.water_before.clone(),
            });
        }
    }

    if !model.udls.is_empty() {
        def.udls = Some(
            model
                .udls
                .iter()
                .map(|u| {
                    // Entries of materials that no longer exist are dropped.
                    let excess: Vec<UdlExcessPorePressure> = u
                        .excess_pore_pressure
                        .iter()
                        .flatten()
                        .filter_map(|e| {
                            engine_name(&e.material_id).map(|material| UdlExcessPorePressure {
                                material,
                                ratio: e.ratio,
                            })
                        })
                        .collect();
                    UdlDefinition {
                        magnitude: u.magnitude,
                        x1: u.x1,
                        x2: u.x2,
                        direction: (u.direction.as_deref() == Some("normal"))
                            .then_some(UdlDirection::Normal),
                        excess_pore_pressure: (!excess.is_empty()).then_some(excess),
                    }
                })
                .collect(),
        );
    }

    if !model.line_loads.is_empty() {
        def.line_loads = Some(
            model
                .line_loads
                .iter()
                .map(|l| {
                    let angle = l.angle.filter(|a| a.is_finite() && *a != 0.0);
                    LineLoadDefinition {
                        magnitude: l.magnitude,
                        x: l.x,
                        angle,
                        y: angle.and(l.y.filter(|y| y.is_finite())),
                    }
                })
                .collect(),
        );
    }

    if let Some(rows) = model.reinforcements.as_ref().filter(|r| !r.is_empty()) {
        def.reinforcements = Some(rows.iter().map(to_engine_reinforcement).collect());
    }
    if let Some(rows) = model.piles.as_ref().filter(|p| !p.is_empty()) {
        def.piles = Some(rows.iter().map(to_engine_pile).collect());
    }

    if !model.custom_search_planes.is_empty() {
        let ordered = custom_planes_in_result_order(&model.custom_search_planes);
        let circles: Vec<CustomSearchPlane> = ordered
            .iter()
            .filter(|p| p.points.is_none())
            .map(|p| CustomSearchPlane {
                cx: p.cx,
                cy: p.cy,
                radius: p.radius,
            })
            .collect();
        let polylines: Vec<CustomSurface> = ordered
            .iter()
            .filter_map(|p| p.points.as_ref())
            .map(|points| CustomSurface {
                points: points.clone(),
                axis: None,
            })
            .collect();
        if !circles.is_empty() {
            def.custom_search_planes = Some(circles);
        }
        if !polylines.is_empty() {
            def.custom_surfaces = Some(polylines);
        }
        def.custom_planes_only = Some(model.custom_planes_only);
    }

    // Block search objects matter only to a block search; objects still
    // being entered (no point yet) are left out.
    let block_search = model.options.search_method.as_deref() == Some("block");
    let objects: Vec<BlockSearchObject> = model
        .block_search_objects
        .iter()
        .flatten()
        .filter(|o| !o.points.is_empty())
        .map(|o| BlockSearchObject {
            points: o.points.clone(),
        })
        .collect();
    if block_search && !objects.is_empty() {
        def.block_search_objects = Some(objects);
    }

    // Pore pressure from head and reference lines, and an earlier stage:
    // in model coordinates like the rest.
    def.waternet = model.waternet.clone();
    def.earlier_stage = model.earlier_stage.clone();

    def
}

// ── The definition to the model ─────────────────────────────────

/// What `definition_to_model` names the model and how it runs
/// (`DefinitionModelInfo`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DefinitionModelInfo {
    pub id: String,
    pub name: String,
    /// Analysis options on top of the app's defaults (method, slices, ...).
    pub options: Option<Map<String, Value>>,
}

/// The app's reinforcement row for an engine reinforcement, with the
/// engine's defaults for what the definition leaves out.
fn reinforcement_row(r: &Reinforcement, id: String) -> Result<ReinforcementRow, ConvertError> {
    let p = r.pullout.as_ref();
    if let Some(ReinforcementPullout::Interface {
        coverage: Some(c), ..
    }) = p
    {
        if *c != 1.0 {
            return err("Interface coverage is not supported");
        }
    }
    let direction = r
        .direction
        .as_ref()
        .map(enum_text)
        .unwrap_or_else(|| "axial".into());
    let kind = match p {
        Some(ReinforcementPullout::Interface { .. }) => "geosynthetic",
        _ if direction == "tangent" => "geosynthetic",
        Some(ReinforcementPullout::Bond { bonded_length, .. }) => {
            if bonded_length.is_some_and(|l| l != 0.0 && !l.is_nan()) {
                "tieback"
            } else {
                "nail"
            }
        }
        _ => "anchor",
    };
    let (bond_strength, bonded_length) = match p {
        Some(ReinforcementPullout::Bond {
            strength,
            bonded_length,
        }) => (*strength, bonded_length.unwrap_or(0.0)),
        _ => (0.0, 0.0),
    };
    let (adhesion, interface_friction) = match p {
        Some(ReinforcementPullout::Interface {
            adhesion,
            friction_angle,
            ..
        }) => (*adhesion, *friction_angle),
        _ => (0.0, 0.0),
    };
    let (development_length1, development_length2) = match p {
        Some(ReinforcementPullout::Development { length1, length2 }) => {
            (Some(*length1), Some(*length2))
        }
        _ => (None, None),
    };
    Ok(ReinforcementRow {
        id,
        label: None,
        kind: kind.into(),
        x1: r.x1,
        y1: r.y1,
        x2: r.x2,
        y2: r.y2,
        tensile_capacity: r.tensile_capacity,
        spacing: r.spacing.unwrap_or(1.0),
        pullout: match p {
            Some(ReinforcementPullout::Bond { .. }) => "bond",
            Some(ReinforcementPullout::Interface { .. }) => "interface",
            Some(ReinforcementPullout::Development { .. }) => "development",
            None => "none",
        }
        .into(),
        bond_strength,
        bonded_length,
        prestress: r.prestress.filter(|&v| v != 0.0 && !v.is_nan()),
        adhesion,
        interface_friction,
        development_length1,
        development_length2,
        end1_capacity: r.end1_capacity.unwrap_or(0.0),
        end2_capacity: r.end2_capacity.unwrap_or(0.0),
        direction,
        application: r
            .application
            .as_ref()
            .map(enum_text)
            .unwrap_or_else(|| "active".into()),
    })
}

/// The app's pile row for an engine pile (Ito & Matsui when no force is
/// given). Like the app's, it keeps neither `location` nor `wall` (the type
/// follows from the force and the spacing).
fn pile_row(p: &Pile, id: String) -> PileRow {
    let spacing = p.spacing.unwrap_or(1.0);
    PileRow {
        id,
        label: None,
        kind: if p.force.is_some() && spacing == 1.0 {
            "sheet-pile"
        } else {
            "pile"
        }
        .into(),
        x1: p.x1,
        y1: p.y1,
        x2: p.x2,
        y2: p.y2,
        mode: if p.force.is_some() {
            "force"
        } else {
            "ito-matsui"
        }
        .into(),
        force: p.force.unwrap_or(0.0),
        diameter: p.diameter.unwrap_or(0.6),
        spacing,
        shear_capacity: p.shear_capacity.unwrap_or(0.0),
        moment_capacity: p.moment_capacity.unwrap_or(0.0),
        bending_stiffness: p.bending_stiffness.filter(|&e| e != 0.0 && !e.is_nan()),
        angle: p.angle.unwrap_or(0.0),
        direction: p
            .direction
            .as_ref()
            .map(enum_text)
            .filter(|d| !d.is_empty()),
        application: p
            .application
            .as_ref()
            .map(enum_text)
            .unwrap_or_else(|| "active".into()),
        location: None,
    }
}

/// The JavaScript text of a water table mode, for the message.
fn mode_text(mode: &WaterTableMode) -> String {
    match mode {
        WaterTableMode::Other(Value::Null) => "undefined".into(),
        m => enum_text(m),
    }
}

/// The piezometric lines: the main water table, and each further line that
/// a material is assigned to. The app has one free-water setting for all.
fn piezometric_line(
    def: &SlopeDefinition,
    id: &str,
    material_id: impl Fn(usize) -> String,
) -> Result<PiezometricLineState, ConvertError> {
    let main: Option<&Vec<Point>> = match &def.water_table {
        Some(w) if w.mode == WaterTableMode::Custom => match &w.value {
            WaterTableValue::Points(p) => Some(p),
            _ => return err("The custom water table has no points"),
        },
        _ => None,
    };
    let extra: &[WaterTableEntry] = def.water_tables.as_deref().unwrap_or(&[]);
    let Some(main) = main else {
        if !extra.is_empty() {
            return err("Further water tables without a main one are not supported");
        }
        return Ok(PiezometricLineState::default());
    };
    let wt = def.water_table.as_ref().expect("a custom water table");
    // freeWater first, then the deprecated followBoundary (D-24); a further
    // line without either takes the main line's freeWater.
    let main_free = wt.free_water;
    let follow_boundary = match main_free {
        Some(free) => !free,
        None => wt.follow_boundary != Some(false),
    };
    if extra
        .iter()
        .any(|w| w.follows_boundary(main_free) != follow_boundary)
    {
        return err("Water tables that differ in free water are not supported");
    }
    let main_id = format!("{id}-water");
    // `new Map(...)`: a later entry with the same id wins.
    let mut line_id: HashMap<&str, String> = HashMap::new();
    for w in extra {
        let lid = if &w.coordinates == main {
            main_id.clone()
        } else {
            format!("{id}-water-{}", w.id)
        };
        line_id.insert(&w.id, lid);
    }
    let mut lines = vec![PiezoLine {
        id: main_id.clone(),
        name: Some("Water table".into()),
        color: Some("#3b82f6".into()),
        coordinates: main.clone(),
        coordinate_expressions: None,
    }];
    for (i, w) in extra
        .iter()
        .filter(|w| line_id[w.id.as_str()] != main_id)
        .enumerate()
    {
        lines.push(PiezoLine {
            id: line_id[w.id.as_str()].clone(),
            name: Some(w.id.clone()),
            color: Some(PIEZO_COLORS[(i + 1) % PIEZO_COLORS.len()].into()),
            coordinates: w.coordinates.clone(),
            coordinate_expressions: None,
        });
    }
    let mut material_assignment = BTreeMap::new();
    for (i, m) in def.materials.iter().enumerate() {
        let named = m.water_table_id.clone().flatten().filter(|s| !s.is_empty());
        let Some(named) = named else { continue };
        let Some(line) = line_id.get(named.as_str()) else {
            return err(format!("Material {} names an unknown water table", m.name));
        };
        if *line != main_id {
            material_assignment.insert(material_id(i), line.clone());
        }
    }
    Ok(PiezometricLineState {
        enabled: true,
        lines,
        active_line_id: Some(main_id.clone()),
        material_assignment,
        free_water: Some(!follow_boundary),
        main_line_id: Some(main_id),
        rapid_drawdown: None,
    })
}

/// An app model from an engine definition (`modelFromDefinition`), in
/// model coordinates; a definition without an orientation gets the one the
/// engine infers from its geometry. Without `projectInfo` and
/// `resultViewSettings`, which the app fills with its defaults on open.
pub fn definition_to_model(
    def: &SlopeDefinition,
    info: &DefinitionModelInfo,
) -> Result<ModelEntry, ConvertError> {
    if let Some(w) = &def.water_table {
        if w.mode != WaterTableMode::Custom {
            return err(format!(
                "Water table mode \"{}\" is not supported",
                mode_text(&w.mode)
            ));
        }
    }
    let id = info.id.as_str();
    let material_id = |i: usize| format!("{id}-mat-{}", i + 1);
    // `new Map(...)`: a later material with the same name wins.
    let id_by_name: HashMap<&str, String> = def
        .materials
        .iter()
        .enumerate()
        .map(|(i, m)| (m.name.as_str(), material_id(i)))
        .collect();
    let xs = def.coordinates.iter().map(|c| c[0]);
    let x_min = xs.clone().fold(f64::INFINITY, js::math::min);
    let x_max = xs.fold(f64::NEG_INFINITY, js::math::max);

    let materials = def
        .materials
        .iter()
        .enumerate()
        .map(|(i, m)| {
            Ok(MaterialRow {
                id: material_id(i),
                name: m.name.clone(),
                color: m
                    .color
                    .clone()
                    .unwrap_or_else(|| MATERIAL_COLORS[i % MATERIAL_COLORS.len()].into()),
                depth_range: m.depth_range,
                model: material_model_of(m).map_err(|e| ConvertError(e.message))?,
                model_expressions: None,
            })
        })
        .collect::<Result<Vec<_>, ConvertError>>()?;

    let mut piezometric_line = piezometric_line(def, id, material_id)?;
    // Rapid drawdown: the water before it (the lines are the water after).
    piezometric_line.rapid_drawdown = def.rapid_drawdown.as_ref().map(|r| RapidDrawdownState {
        water_before: r.water_before.clone(),
    });

    let excess = |entries: &Option<Vec<UdlExcessPorePressure>>| {
        let rows: Vec<UdlExcessPorePressureRow> = entries
            .iter()
            .flatten()
            .filter_map(|e| {
                id_by_name
                    .get(e.material.as_str())
                    .map(|material_id| UdlExcessPorePressureRow {
                        material_id: material_id.clone(),
                        ratio: e.ratio,
                    })
            })
            .collect();
        (!rows.is_empty()).then_some(rows)
    };

    let mut options = app_default_options();
    if let Some(o) = &info.options {
        options.extend(o.clone());
    }

    Ok(ModelEntry {
        id: id.to_owned(),
        name: info.name.clone(),
        orientation: resolve_orientation(def.orientation, &def.coordinates),
        // A project block of its own (the app: `createDefaultProjectInfo()`
        // with the model's name as its title) and the default sheet; the
        // corpus compares neither.
        project_info: ProjectInfo {
            title: info.name.clone(),
            ..ProjectInfo::default_for(&today())
        },
        coordinates: def.coordinates.clone(),
        coordinate_expressions: None,
        parameters: None,
        materials,
        material_boundaries: def
            .material_boundaries
            .iter()
            .flatten()
            .enumerate()
            .map(|(i, b)| MaterialBoundaryRow {
                // Ids sort in definition order (the analysis applies
                // boundaries by id).
                id: format!("{id}-boundary-{:03}", i + 1),
                coordinates: b.coordinates.clone(),
                coordinate_expressions: None,
            })
            .collect(),
        region_materials: def
            .region_assignments
            .iter()
            .flatten()
            .filter_map(|a| {
                id_by_name
                    .get(a.material_name.as_str())
                    .map(|m| RegionAssignmentRow {
                        point: a.point,
                        material_id: m.clone(),
                    })
            })
            .collect(),
        piezometric_line,
        udls: def
            .udls
            .iter()
            .flatten()
            .enumerate()
            .map(|(i, u)| UdlRow {
                id: format!("{id}-udl-{}", i + 1),
                magnitude: u.magnitude,
                x1: u.x1,
                x2: u.x2,
                direction: (u.direction == Some(UdlDirection::Normal)).then(|| "normal".into()),
                excess_pore_pressure: excess(&u.excess_pore_pressure),
                expressions: None,
            })
            .collect(),
        line_loads: def
            .line_loads
            .iter()
            .flatten()
            .enumerate()
            .map(|(i, l)| {
                // `l.angle` truthy: not absent, 0 or NaN.
                let angle = l.angle.filter(|&a| a != 0.0 && !a.is_nan());
                LineLoadRow {
                    id: format!("{id}-load-{}", i + 1),
                    magnitude: l.magnitude,
                    x: l.x,
                    angle,
                    y: angle.and(l.y),
                    expressions: None,
                }
            })
            .collect(),
        reinforcements: Some(
            def.reinforcements
                .iter()
                .flatten()
                .enumerate()
                .map(|(i, r)| reinforcement_row(r, format!("{id}-reinforcement-{}", i + 1)))
                .collect::<Result<_, _>>()?,
        ),
        piles: Some(
            def.piles
                .iter()
                .flatten()
                .enumerate()
                .map(|(i, p)| pile_row(p, format!("{id}-pile-{}", i + 1)))
                .collect(),
        ),
        custom_search_planes: def
            .custom_search_planes
            .iter()
            .flatten()
            .enumerate()
            .map(|(i, p)| CustomSearchPlaneRow {
                id: format!("{id}-plane-{}", i + 1),
                cx: p.cx,
                cy: p.cy,
                radius: p.radius,
                points: None,
            })
            .chain(
                def.custom_surfaces
                    .iter()
                    .flatten()
                    .enumerate()
                    .map(|(i, s)| CustomSearchPlaneRow {
                        id: format!("{id}-surface-{}", i + 1),
                        cx: 0.0,
                        cy: 0.0,
                        radius: 0.0,
                        points: Some(s.points.clone()),
                    }),
            )
            .collect(),
        custom_planes_only: def.custom_planes_only.unwrap_or(false),
        block_search_objects: Some(
            def.block_search_objects
                .iter()
                .flatten()
                .enumerate()
                .map(|(i, o)| BlockSearchObjectRow {
                    id: format!("{id}-block-{}", i + 1),
                    points: o.points.clone(),
                })
                .collect(),
        ),
        // Kept as they are (both in model coordinates, as the definition's).
        waternet: def.waternet.clone(),
        earlier_stage: def.earlier_stage.clone(),
        options: AnalysisOptions::from_map(options).map_err(ConvertError)?,
        analysis_limits: match &def.analysis_limits {
            Some(l) => AnalysisLimitsState {
                enabled: true,
                entry_left_x: l.entry_left_x,
                entry_right_x: l.entry_right_x,
                exit_left_x: l.exit_left_x,
                exit_right_x: l.exit_right_x,
            },
            None => AnalysisLimitsState {
                enabled: false,
                entry_left_x: x_min,
                entry_right_x: x_max,
                exit_left_x: x_min,
                exit_right_x: x_max,
            },
        },
        edit_view_offset: None,
        edit_view_scale: None,
        result_view_offset: None,
        result_view_scale: None,
        import_notes: None,
        result_view_settings: default_result_view_settings(),
        view_offset: None,
        view_scale: None,
        mode: None,
        locks: None,
    })
}
