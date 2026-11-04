//! Port of packages/engine/src/types/analysis.ts
//!
//! Analysis type definitions for slope stability analysis.

use crate::error::{EngineError, Result};
use crate::js;
use crate::model::canonical::SlopeOrientation;
use crate::types::material::Material;
use crate::types::reinforcement::ReinforcementForce;
use crate::types::sgi3d::{Sgi3dResult, Sgi3dSettings};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Supported analysis methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnalysisMethod {
    Bishop,
    Janbu,
    #[serde(rename = "Morgenstern-Price")]
    MorgensternPrice,
}

impl AnalysisMethod {
    /// The method's name as TypeScript spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            AnalysisMethod::Bishop => "Bishop",
            AnalysisMethod::Janbu => "Janbu",
            AnalysisMethod::MorgensternPrice => "Morgenstern-Price",
        }
    }
}

/// Supported interslice force functions for Morgenstern-Price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IntersliceFunctionType {
    Constant,
    HalfSine,
    ClippedSine,
    Trapezoidal,
    DataPointSpecified,
}

/// Pore pressure head below an inclined piezometric line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PorePressureHead {
    PhreaticCorrection,
    Vertical,
}

/// How trial surfaces are generated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SearchMethod {
    Circular,
    Block,
}

/// Analysis configuration options.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptions {
    /// Number of slices (10–500, default: 25).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub slices: f64,
    /// Number of search iterations (500–100,000, default: 1000). The grid of
    /// entry/exit pairs and circles is sized by it; the circles tangent to the
    /// model base and to each material interface come on top, so a layered
    /// model evaluates more surfaces than this.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub iterations: f64,
    /// Extra second-pass refinement iterations around critical candidates (0–100,000, default: 500).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub refined_iterations: f64,
    /// Minimum horizontal distance between entry and exit points (m).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub min_failure_dist: f64,
    /// FOS convergence tolerance (default: 0.001).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub tolerance: f64,
    /// Max inner-loop FOS iterations (default: 15).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub max_iterations: f64,
    /// Analysis method.
    pub method: AnalysisMethod,
    /// Apply Janbu correction factor f₀ (default: false).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub janbu_correction: Option<bool>,
    /// Interslice force function shape for Morgenstern-Price.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interslice_function: Option<IntersliceFunctionType>,
    /// Normalized [x, f] points in [0,1]×[0,1] for data-point-specified mode.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub interslice_data_points: Option<Vec<[f64; 2]>>,
    /// Pore pressure head below an inclined piezometric line:
    /// - "vertical" (default): full vertical head, as commercial programs
    ///   use for a piezometric line.
    /// - "phreatic-correction": vertical head × cos²θ of the line's
    ///   inclination (equipotentials normal to a straight phreatic line).
    ///   Gives lower pore pressure, i.e. a higher FOS, below a steep line.
    ///   The correction belongs to a free phreatic surface with seepage
    ///   parallel to it, not to a piezometric line, and the option applies to
    ///   every water line of the model. A vertical step in a line (a wall or
    ///   a sheet pile) gets no correction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pore_pressure_head: Option<PorePressureHead>,
    /// Depth of a tension crack below the ground surface (m, default 0 = none).
    /// The slip surface ends at the crack on the upslope side and the soil
    /// above the crack depth there carries no shear.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub tension_crack_depth: Option<f64>,
    /// Fraction of the crack depth filled with water (0–1, default 0).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub tension_crack_water: Option<f64>,
    /// Tension crack depth from the soil at each surface's entry instead of
    /// `tensionCrackDepth`: the Rankine depth z = 2c/(γ√Ka) − q/γ with
    /// Ka = tan²(45° − φ/2), i.e. 2cu/γ − q/γ for undrained clay (default
    /// false). Uses the same (design) strengths as the analysis.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tension_crack_auto: Option<bool>,
    /// Tension crack at a limiting base inclination (°, 0 < angle < 90; not
    /// set or 0: none): from the entry, the part of a slip surface whose base
    /// is steeper than this angle is cut off, and the surface ends at a
    /// vertical crack where its inclination falls to the angle (as commercial
    /// programs offer it, typically 45° + φ/2 or about 60°). With a crack
    /// depth (`tensionCrackDepth` or `tensionCrackAuto`) as well, the crack
    /// further from the entry governs. Water in the crack (`tensionCrackWater`)
    /// is the part of its depth there.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub tension_crack_angle: Option<f64>,
    /// Composite circles (default true): a circle that reaches impenetrable
    /// material (bedrock on the base of the model) follows its top there
    /// instead of being rejected (model/composite.ts). False: such circles are
    /// not analysed, as before 2026-11.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composite_surfaces: Option<bool>,
    /// With composite circles, whether they also follow the base of the model
    /// where no impenetrable material lies on it (default false: a circle
    /// through the base is not analysed, the base is only the edge of the
    /// model). True treats the material below the model as impenetrable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composite_base: Option<bool>,
    /// Pseudostatic seismic load: the horizontal seismic coefficient kh. Each
    /// slice carries kh × its weight horizontally in the sliding direction,
    /// at the centre of gravity of the slice. Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub seismic_horizontal: Option<f64>,
    /// The vertical seismic coefficient kv: kv × the slice weight acts
    /// vertically at the slice's centre line, positive downward (adding to
    /// the weight), negative upward. Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub seismic_vertical: Option<f64>,
    /// Partial factors (Eurocode 7 design values). When set, strengths are
    /// divided and variable loads multiplied by them, and the FOS is the
    /// over-design factor on design values (≥ 1.0 satisfies the design).
    /// `Some(None)`: given as `null`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullable"
    )]
    pub partial_factors: Option<Option<PartialFactors>>,
    /// Also analyse sliding in the opposite direction and report the lower
    /// FOS. Run by the application around `analyseSlope` (see
    /// `oppositeDirectionDefinition`); the opposite run uses automatic search
    /// limits, since the model's limits belong to its own direction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub both_directions: Option<bool>,
    /// After the circular search, optimise the best circles as non-circular
    /// (polyline) surfaces, which can follow weak layers (default false).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub non_circular_optimization: Option<bool>,
    /// How trial surfaces are generated (default "circular"):
    /// - "circular": the grid of circles through entry and exit points.
    /// - "block": block surfaces through the model's block search objects
    ///   (`SlopeDefinition.blockSearchObjects`), `iterations` of them, then
    ///   `refinedIterations` around the best; with `nonCircularOptimization`
    ///   the best are optimised as polylines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_method: Option<SearchMethod>,
    /// Block search: range [min, max] (°, from the horizontal) of the
    /// inclination of the upslope (active) end segment. Null or not set:
    /// the Rankine active angle 45° + φ/2 of the soil above the first base
    /// point.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullable"
    )]
    pub block_active_angle: Option<Option<[f64; 2]>>,
    /// Block search: range [min, max] (°, from the horizontal) of the
    /// inclination of the downslope (passive) end segment. Null or not set:
    /// the Rankine passive angle 45° − φ/2 of the soil above the last base
    /// point.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullable"
    )]
    pub block_passive_angle: Option<Option<[f64; 2]>>,
    /// Surfaces less deep than this below the ground (m, vertical) are not
    /// analysed (default 0).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub min_slip_depth: Option<f64>,
    /// Surfaces whose sliding mass (cross-section area per metre, m²) is
    /// smaller than this are not analysed. 0, null or not set: no limit.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullable"
    )]
    pub min_slip_area: Option<Option<f64>>,
    /// Strength reduction by finite elements after the limit equilibrium analysis.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fem: Option<FemAnalysisSettings>,
    /// 3D effects after SGI's guidance after the 2D analysis (circular surfaces).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sgi3d: Option<Sgi3dSettings>,
}

/// Partial factors applied to characteristic values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialFactors {
    /// γcu on undrained shear strength.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cu: f64,
    /// γc' on effective cohesion.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cohesion: f64,
    /// γφ' on tan φ'.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub tan_phi: f64,
    /// γQ on variable loads (distributed and line loads).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub variable_load: f64,
    /// How the factors were formed in Swedish practice, for display and
    /// editing (`swedish_partial_factors`); the analyses use the factors above
    /// only. Not set: the factors were entered or taken from another set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<SwedishFactorBasis>,
}

/// Swedish safety class (säkerhetsklass) of a structure or slope: 1, 2 or 3.
pub type SafetyClass = u8;

/// Partial factor γd on the load effects in safety class 1, 2 and 3 (EKS):
/// `SAFETY_CLASS_GAMMA_D[class - 1]`.
pub const SAFETY_CLASS_GAMMA_D: [(SafetyClass, f64); 3] = [(1, 0.83), (2, 0.91), (3, 1.0)];

/// γd of a safety class (`SAFETY_CLASS_GAMMA_D[class]`).
pub fn safety_class_gamma_d(class: SafetyClass) -> Option<f64> {
    SAFETY_CLASS_GAMMA_D
        .iter()
        .find(|(c, _)| *c == class)
        .map(|(_, g)| *g)
}

/// The input of a set of Swedish partial factors (`swedish_partial_factors`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwedishFactorBasis {
    /// Safety class 1, 2 or 3: γd = 0.83, 0.91 or 1.0 on the variable loads.
    pub safety_class: SafetyClass,
    /// Conversion factor η on the undrained shear strength: γcu = 1.5 / η.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub eta_cu: f64,
    /// Conversion factor η on c′ and tan φ′: γc′ = γφ′ = 1.3 / η.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub eta_drained: f64,
    /// γQ before γd: γQ = variableLoadBase · γd. 1.3 gives the EN 1997-1 DA3
    /// load factor in safety class 3; some Swedish guidance uses 1.4 (for
    /// example for traffic loads). The governing document decides.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub variable_load_base: f64,
}

/// Partial factors in Swedish practice from the safety class and the
/// conversion factors η: design values X_d = η X_k / γM with γM = 1.5 on
/// the undrained shear strength and 1.3 on c′ and tan φ′, and variable loads
/// Q_d = γQ γd Q_k. Permanent loads (the soil's weight) take 1.0. The
/// factors are rounded to three decimals.
pub fn swedish_partial_factors(basis: &SwedishFactorBasis) -> Result<PartialFactors> {
    let Some(gd) = safety_class_gamma_d(basis.safety_class) else {
        return Err(EngineError::new("Safety class must be 1, 2 or 3"));
    };
    for (k, v) in [
        ("etaCu", basis.eta_cu),
        ("etaDrained", basis.eta_drained),
        ("variableLoadBase", basis.variable_load_base),
    ] {
        if !(v.is_finite() && v > 0.0) {
            return Err(EngineError::new(format!("{k} must be a positive number")));
        }
    }
    let r3 = |v: f64| js::math::round(v * 1000.0) / 1000.0;
    Ok(PartialFactors {
        cu: r3(1.5 / basis.eta_cu),
        cohesion: r3(1.3 / basis.eta_drained),
        tan_phi: r3(1.3 / basis.eta_drained),
        variable_load: r3(basis.variable_load_base * gd),
        basis: Some(basis.clone()),
    })
}

/// EN 1997-1 Annex A, material set M2 with γQ = 1.3 (Design Approach 3).
pub const EC7_DA3_FACTORS: PartialFactors = PartialFactors {
    cu: 1.4,
    cohesion: 1.25,
    tan_phi: 1.25,
    variable_load: 1.3,
    basis: None,
};

/// Default analysis options (`DEFAULT_ANALYSIS_OPTIONS`).
pub fn default_analysis_options() -> AnalysisOptions {
    AnalysisOptions {
        slices: 25.0,
        iterations: 1000.0,
        // As in the desktop app: without refinement the minimum of the first
        // grid is 0.5–4 % too high.
        refined_iterations: 500.0,
        min_failure_dist: 0.0,
        // Morgenstern-Price accepts |Fm − Ff| below it: at 0.005 the factor on a
        // fixed non-circular surface was up to 0.2 % off the solution, at 0.001
        // within 0.02 %, for a search 0–25 % slower.
        tolerance: 0.001,
        max_iterations: 15.0,
        method: AnalysisMethod::Bishop,
        janbu_correction: Some(false),
        interslice_function: Some(IntersliceFunctionType::HalfSine),
        interslice_data_points: Some(Vec::new()),
        pore_pressure_head: Some(PorePressureHead::Vertical),
        tension_crack_depth: Some(0.0),
        tension_crack_water: Some(0.0),
        tension_crack_auto: None,
        tension_crack_angle: None,
        composite_surfaces: None,
        composite_base: None,
        seismic_horizontal: None,
        seismic_vertical: None,
        partial_factors: None,
        both_directions: None,
        non_circular_optimization: Some(false),
        search_method: None,
        block_active_angle: None,
        block_passive_angle: None,
        min_slip_depth: Some(0.0),
        min_slip_area: Some(Some(0.0)),
        fem: None,
        sgi3d: None,
    }
}

/// Water table input — one of three modes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum WaterTableInput {
    Height {
        #[serde(deserialize_with = "crate::types::json::num")]
        height: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        follow_boundary: Option<bool>,
    },
    Depth {
        #[serde(deserialize_with = "crate::types::json::num")]
        depth: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        follow_boundary: Option<bool>,
    },
    Custom {
        coordinates: Vec<[f64; 2]>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        follow_boundary: Option<bool>,
    },
}

/// Analysis limit bounds for search area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisLimits {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub entry_left_x: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub entry_right_x: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub exit_left_x: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub exit_right_x: f64,
}

/// The tension crack a surface was cut off at (`SlipSurfaceResult.crack`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Crack {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub top: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub bottom: f64,
}

/// A single slip surface with its computed FOS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlipSurfaceResult {
    /// Circle center x (m).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cx: f64,
    /// Circle center y (m).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cy: f64,
    /// Circle radius (m).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub radius: f64,
    /// Factor of Safety.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub fos: f64,
    /// Entry point [x, y].
    pub entry_point: [f64; 2],
    /// Exit point [x, y].
    pub exit_point: [f64; 2],
    /// Whether the solver converged for this surface (for Morgenstern-Price:
    /// a crossing Fm = Ff; false for a closest pair, see `closestPair`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub converged: Option<bool>,
    /// Morgenstern-Price: the moment and force factors never met and the
    /// closest pair was accepted (gap in `equilibriumGap`). The factor meets
    /// moment equilibrium and force equilibrium only within the gap; the
    /// surface is not converged but keeps its factor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closest_pair: Option<bool>,
    /// Lambda-Fm-Ff-gap rows for this surface (Morgenstern-Price only).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub lff_array: Option<Vec<[f64; 4]>>,
    /// Morgenstern-Price: |Fm − Ff| where the moment and force equilibrium
    /// curves never crossed and the closest pair was accepted (no
    /// complete-equilibrium solution exists on this surface). Absent when
    /// they crossed.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub equilibrium_gap: Option<f64>,
    /// Non-circular surface: its points from entry to exit (then cx, cy is
    /// the moment axis and radius 0). Absent for a circle. For a composite
    /// circle (`composite`), the surface as analysed, with the circle's
    /// centre and radius.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<[f64; 2]>>,
    /// A composite circle: along impenetrable material or the model's base where the circle went below it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composite: Option<bool>,
    /// Reinforcement forces on the sliding mass (critical surface only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcement_forces: Option<Vec<ReinforcementForce>>,
    /// The tension crack the analysis cut the surface off at (critical
    /// surface only): its x, the ground level there (`top`) and the crack
    /// bottom on the surface (`bottom`, = entryPoint's y). Absent without a
    /// crack.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crack: Option<Crack>,
}

/// Slice data for detailed output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceData {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x_left: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x_right: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub width: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y_top: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y_bottom: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub height: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub area: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub alpha: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub base_length: f64,
    /// Soil weight of the slice (kN).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub weight: f64,
    /// UDL and line load acting on the slice (kN).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub surface_load: Option<f64>,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cohesion: f64,
    /// Friction angle at the base (degrees).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub friction_angle: f64,
    /// Effective base normal force N′ = N − u·l (kN) from the method's equilibrium at the FOS (solvedEffectiveNormals).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub normal_force: f64,
    /// Shear force the base can resist, c·l + max(N′, 0)·tan φ (kN): no
    /// friction from a negative effective normal (see the
    /// negative-effective-normal warning). NaN in a result saved before the
    /// field existed.
    #[serde(
        default = "crate::types::json::nan",
        deserialize_with = "crate::types::json::num"
    )]
    pub shear_force: f64,
    /// Pore water pressure at the base (kPa): negative above the water line
    /// in a material with φb (the matric suction, see Slice.suction), else
    /// ≥ 0.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub pore_pressure: f64,
    /// The base material, as the worker posts it: a copy of the material
    /// (name, color, model), not a reference (PORTING.md, Decisions).
    pub base_material: Material,
}

/// Kind of a result warning (see analysisWarnings).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnalysisWarningCode {
    DanglingBoundary,
    NegativeEffectiveNormal,
    LowMAlpha,
    BishopNonCircular,
    FrictionalSurfaceSlide,
    ShallowCohesionlessSurface,
    SteepEntryNoEquilibrium,
    SteepEntryTension,
}

/// Something about the input or the critical surface that the factor of
/// safety alone does not show, in English for display.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisWarning {
    pub code: AnalysisWarningCode,
    pub message: String,
    /// Slices of the critical surface concerned (the slice warnings).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    /// Index into materialBoundaries (dangling-boundary).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary_index: Option<usize>,
}

/// Flow rule of the finite element analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FlowRule {
    DavisB,
    Associated,
    NonAssociated,
}

/// Pore pressures of the finite element analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FemPorePressure {
    WaterTable,
    Seepage,
}

/// Solver of non-associated flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NonAssociatedSolver {
    Viscoplastic,
    Newton,
}

/// Convergence test of the viscoplastic iteration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FemConvergence {
    Increment,
    Equilibrium,
}

/// Initial stresses of the finite element analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InitialStress {
    Gravity,
    K0,
}

/// Strength reduction by finite elements, run after the limit equilibrium
/// analysis when enabled (src/fem). Stiffness barely affects the factor of
/// safety; it scales the displacements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FemAnalysisSettings {
    pub enabled: bool,
    /// Davis B (default), associated, or non-associated with the dilation angle.
    pub flow_rule: FlowRule,
    /// Young's modulus E (kPa) of every soil.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub youngs_modulus: f64,
    /// Poisson's ratio ν of every soil.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub poissons_ratio: f64,
    /// Dilation angle ψ (°), used by Davis B and non-associated flow.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub dilation_angle: f64,
    /// Initial element size (m); null: a twentieth of the model height.
    #[serde(default, deserialize_with = "crate::types::json::opt_num")]
    pub element_size: Option<f64>,
    /// Rankine tension cut-off at zero effective stress; default on for new
    /// projects (soil carries no tension, the usual default of finite element
    /// programs; it brought cSlope closer to a commercial program's verification
    /// values, RMS 4.6 % to 3.0 %).
    pub tension_cutoff: bool,
    /// Adaptive refinements of the mesh (0–3), for associated flow and Davis B.
    /// Not with non-associated flow: its factor has no limit as the mesh is
    /// refined (it falls on every refinement, Sysala et al. 2021), so it is
    /// computed on the initial mesh only.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub refinement_levels: f64,
    /// Pore pressures: hydrostatic below the water table ("water-table"), or
    /// from steady seepage with the water table as reservoir and tail water
    /// where it lies at or above the ground ("seepage"). Not set: water table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pore_pressure: Option<FemPorePressure>,
    /// Solver of non-associated flow: the viscoplastic iteration of Griffiths
    /// & Lane ("viscoplastic", default) or Newton's method with the
    /// unsymmetric consistent tangent, F raised in increments ("newton", the
    /// implicit method of most finite element programs; similar F, usually
    /// slower). Not set: viscoplastic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub non_associated_solver: Option<NonAssociatedSolver>,
    /// Convergence test of the viscoplastic iteration: the displacement
    /// increment ("increment"), or in addition the out-of-balance force of the
    /// stresses returned to the yield surface, at most 0.1 % of the load
    /// ("equilibrium", with Anderson acceleration of the iteration). Not set:
    /// increment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub convergence: Option<FemConvergence>,
    /// The lower and upper bounds of limit analysis (perfect plasticity,
    /// associated flow, and with Davis B's reduced strength), which bracket
    /// the factor of safety and converge as the mesh is refined: the finite
    /// element factor of safety, the strength reduction a comparison; minutes
    /// of run time. Not set: off (files from before; on for new projects).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_analysis: Option<bool>,
    /// Initial stresses: gravity applied in one increment ("gravity", default)
    /// or the K0 procedure ("k0"): σ′h = K0 σ′v from the overburden
    /// (fem/initial-stress.ts). With associated flow F does not depend on them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_stress: Option<InitialStress>,
    /// K0 of every soil for the K0 procedure; null or not set: 1 − sin φ′ (Jaky).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullable"
    )]
    pub k0: Option<Option<f64>>,
    /// Ground level before excavation (m) for the K0 procedure; null or not set: the present ground.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullable"
    )]
    pub original_ground_level: Option<Option<f64>>,
    /// Construction stage per material name (0 by default); later stages are built after the earlier ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_stages: Option<BTreeMap<String, f64>>,
}

/// `DEFAULT_FEM_SETTINGS`.
pub fn default_fem_settings() -> FemAnalysisSettings {
    FemAnalysisSettings {
        enabled: false,
        // The factor of safety from the limit analysis bounds; the strength
        // reduction with Davis B (the option recommended in the app: fast,
        // stable and on the safe side). Files without a flow rule read as
        // non-associated (the app's persistence), as before.
        flow_rule: FlowRule::DavisB,
        youngs_modulus: 1e5,
        poissons_ratio: 0.3,
        dilation_angle: 0.0,
        element_size: None,
        tension_cutoff: true,
        refinement_levels: 1.0,
        pore_pressure: None,
        non_associated_solver: None,
        convergence: None,
        limit_analysis: Some(true),
        initial_stress: None,
        k0: None,
        original_ground_level: None,
        material_stages: None,
    }
}

/// Elements and F of one mesh (`FemResultSummary.levels`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FemLevel {
    pub elements: usize,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub fos: f64,
}

/// One point of the F–displacement curve (`FemResultSummary.curve`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FemCurvePoint {
    #[serde(rename = "F", deserialize_with = "crate::types::json::num")]
    pub f: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub displacement: f64,
}

/// A pile's largest forces (`FemResultSummary.piles`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FemPileForces {
    pub pile: usize,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub max_axial_force: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub max_shear_force: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub max_moment: f64,
}

/// Bounds with Davis B's reduced strength (`FemBounds.davis`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FemDavisBounds {
    #[serde(default, deserialize_with = "crate::types::json::opt_num")]
    pub lower: Option<f64>,
    #[serde(default, deserialize_with = "crate::types::json::opt_num")]
    pub upper: Option<f64>,
}

/// Lower and upper bounds of limit analysis (`FemResultSummary.bounds`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FemBounds {
    #[serde(default, deserialize_with = "crate::types::json::opt_num")]
    pub lower: Option<f64>,
    #[serde(default, deserialize_with = "crate::types::json::opt_num")]
    pub upper: Option<f64>,
    /// Elements of the last mesh.
    pub elements: usize,
    /// Refinements on the bound gap (bound-adapt.ts); absent in older results: none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refinements: Option<usize>,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub elapsed_ms: f64,
    pub warnings: Vec<String>,
    /// The same bounds with Davis B's reduced strength for the dilation
    /// angle (limit-common.ts): the associated material that stands for
    /// non-associated flow, below the bounds above. Absent in older results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub davis: Option<FemDavisBounds>,
}

/// Result of the finite element analysis in model coordinates, as plain arrays (JSON).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FemResultSummary {
    /// Factor of safety by strength reduction (largest converged F).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub factor_of_safety: f64,
    /// Smallest F that did not converge.
    #[serde(rename = "failedF", deserialize_with = "crate::types::json::num")]
    pub failed_f: f64,
    pub flow_rule: FlowRule,
    /// Elements and F per mesh, coarsest first.
    pub levels: Vec<FemLevel>,
    pub warnings: Vec<String>,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub elapsed_ms: f64,
    /// Corner node coordinates of the final mesh.
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    /// Corner nodes of each element (3 per element).
    pub triangles: Vec<usize>,
    /// Plastic shear strain per element at the factor of safety.
    pub plastic_shear: Vec<f64>,
    /// Shear strain of the last displacement increment per element: the failure mechanism.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shear_increment: Option<Vec<f64>>,
    /// Displacement (x, y) per node at the factor of safety (m).
    pub displacement: Vec<f64>,
    /// The converged trials of the final mesh that rose from a converged
    /// state, by increasing F: the largest displacement component (m) at each
    /// reduction factor (the F–displacement curve; it turns flat at
    /// failure). Absent in results saved before it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub curve: Option<Vec<FemCurvePoint>>,
    /// The piles' largest forces at the factor of safety, per pile (kN, kNm), in the slope's pile order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub piles: Option<Vec<FemPileForces>>,
    /// Lower and upper bounds of limit analysis (null where not found), when asked for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<FemBounds>,
}

/// Full analysis result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    /// Minimum Factor of Safety found.
    #[serde(rename = "minFOS", deserialize_with = "crate::types::json::num")]
    pub min_fos: f64,
    /// Maximum Factor of Safety found.
    #[serde(rename = "maxFOS", deserialize_with = "crate::types::json::num")]
    pub max_fos: f64,
    /// Critical slip surface (lowest FOS).
    pub critical_surface: Option<SlipSurfaceResult>,
    /// All evaluated slip surfaces.
    pub all_surfaces: Vec<SlipSurfaceResult>,
    /// Slices for the critical surface.
    pub critical_slices: Vec<SliceData>,
    /// Analysis method used.
    pub method: AnalysisMethod,
    /// Lambda-Fm-Ff data for the critical surface (Morgenstern-Price only).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub critical_lff_array: Option<Vec<[f64; 4]>>,
    /// Critical surface pushing moment used in FoS calculations.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub critical_pushing_moment: Option<f64>,
    /// Critical surface resisting moment used in FoS calculations.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub critical_resisting_moment: Option<f64>,
    /// Critical slip volume (2D area, i.e. volume per unit width).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub critical_slip_volume: Option<f64>,
    /// Elapsed time in ms.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub elapsed_ms: f64,
    /// Number of analysed surfaces that did not converge within iteration limits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub non_converged_surfaces: Option<usize>,
    /// Number of geometry split operations that failed and fell back to unsplit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_failure_count: Option<usize>,
    /// Warnings on the input and the critical surface (none: omitted or empty).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<AnalysisWarning>>,
    /// Number of trial surfaces not analysed because they are shallower than
    /// the minimum slip depth or smaller than the minimum slip area.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discarded_by_size: Option<usize>,
    /// Sliding direction of the reported surfaces in model space: "ltr" =
    /// towards +x. Set when both directions were analysed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sliding_direction: Option<SlopeOrientation>,
    /// Minimum FOS in the other direction (null: no valid surface).
    #[serde(
        rename = "otherDirectionMinFOS",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullable"
    )]
    pub other_direction_min_fos: Option<Option<f64>>,
    /// Strength reduction by finite elements, when enabled in the options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fem: Option<FemResultSummary>,
    /// 3D effects after SGI's guidance (AnalysisOptions.sgi3d), its circle in model space.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sgi3d: Option<Sgi3dResult>,
    /// Why the 3D effects could not be computed, when they could not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sgi3d_error: Option<String>,
    /// Why the finite element analysis failed, when it was enabled and did not complete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fem_error: Option<String>,
}
