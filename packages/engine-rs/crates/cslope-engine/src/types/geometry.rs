//! Port of packages/engine/src/types/geometry.ts
//!
//! Geometry type definitions for slope stability analysis. These are the
//! engine's internal types; a material is referred to by its `MaterialId`
//! in the slope's table, and a slice is serialized through the slope (the
//! `WithSlope` wrapper of ARCHITECTURE.md §1, which resolves the id to
//! `{ name, color, model }`).

use crate::types::hoek_brown::HoekBrownParameters;
use crate::types::material::MaterialId;
use crate::types::material_models::{MaterialModel, ShearNormalModel};
use crate::types::reinforcement::ReinforcementForce;
use std::sync::Arc;

/// Represents a polygon region with an associated material.
/// Used for material layers in the slope model.
#[derive(Debug, Clone, PartialEq)]
pub struct GeometryWithMaterial {
    /// X-coordinates of polygon vertices.
    pub px: Vec<f64>,
    /// Y-coordinates of polygon vertices.
    pub py: Vec<f64>,
    /// Associated material.
    pub material: MaterialId,
    /// Cached minimum X bound (None for clipped fragments).
    pub x_min: Option<f64>,
    /// Cached maximum X bound (None for clipped fragments).
    pub x_max: Option<f64>,
    /// Cached maximum Y bound (None for clipped fragments).
    pub y_max: Option<f64>,
}

/// Represents a slip surface (circular arc discretized as polyline).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SlipSurface {
    /// Coordinate pairs [[x0,y0], [x1,y1], ...].
    pub geometry: Vec<[f64; 2]>,
    /// X-coordinates of the surface.
    pub px: Vec<f64>,
    /// Y-coordinates of the surface.
    pub py: Vec<f64>,
    /// Leftmost X.
    pub x_left: f64,
    /// Rightmost X.
    pub x_right: f64,
    /// Lowest Y.
    pub y_bottom: f64,
    /// Highest Y.
    pub y_top: f64,
}

/// Represents a single vertical slice through the slope.
///
/// In TypeScript a plain interface rather than a class with heavy mutable
/// state; the solver functions operate on these immutably where possible.
/// Field names follow TypeScript's (`R`, `U` as `r`, `u`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Slice {
    /// Center X of slice.
    pub x: f64,
    /// Left X boundary.
    pub x_left: f64,
    /// Right X boundary.
    pub x_right: f64,
    /// Top Y at left edge.
    pub y0_top: f64,
    /// Top Y at right edge.
    pub y1_top: f64,
    /// Mean top Y.
    pub y_top: f64,
    /// Bottom Y at left edge (on circle).
    pub y0_bottom: f64,
    /// Bottom Y at right edge (on circle).
    pub y1_bottom: f64,
    /// Mean bottom Y.
    pub y_bottom: f64,
    /// Slice width (m).
    pub width: f64,
    /// Slice height (m).
    pub height: f64,
    /// Slice area (m²).
    pub area: f64,
    /// Base inclination angle (rad).
    pub alpha: f64,
    /// Arc length of slice base (m).
    pub base_length: f64,
    /// Slice weight (kN).
    pub weight: f64,
    /// Distance from circle center to slice midpoint.
    pub dx: f64,
    /// Height from center of rotation to midpoint.
    pub e: f64,
    /// `R`: moment arm of the base shear about the centre (m): the radius on
    /// a circle, the perpendicular distance to the base on a non-circular
    /// surface.
    pub r: f64,
    /// Moment arm of the base normal force about the axis point (m),
    /// positive where the normal force drives; 0 on a circle.
    pub normal_arm: Option<f64>,
    /// On a circle: the weight's arm about the centre is `dx`, while α is
    /// the inclination at the middle of the slice's arc (R sin α ≠ dx).
    pub circular: Option<bool>,
    /// UDL force on slice (kN).
    pub udl: f64,
    /// Line load force on slice (kN).
    pub ll: f64,
    /// Whether the slice is geometrically valid.
    pub is_valid: bool,
    /// Base material at the slice bottom.
    pub base_material: Option<MaterialId>,
    /// Effective cohesion at base (kPa).
    pub cohesion: f64,
    /// Undrained cohesion at base (kPa).
    pub cohesion_undrained: f64,
    /// Part of the characteristic `cohesion` that is undrained shear strength
    /// (lime-cement columns in their drained limit: (1 − a)·cu,soil), which
    /// takes γcu when design values are formed. Not set: 0.
    pub cohesion_undrained_part: Option<f64>,
    /// Matric suction at the base centre (kPa, > 0): the negative pore
    /// pressure −u above the water line, set only on a base in a material
    /// with φb (`UnsaturatedStrength`) above its water line. U stays 0 there.
    pub suction: Option<f64>,
    /// Part of `cohesion` that is strength from that suction,
    /// min(suction, maxSuction)·tan φb (kPa); a design value, like
    /// `cohesion`, when partial factors are applied (γc′). Not set: 0.
    pub suction_strength: Option<f64>,
    /// Friction angle at base (deg).
    pub friction_angle: f64,
    /// Friction angle at base (rad).
    pub phi: f64,
    /// `U`: pore water pressure at the base centre (kPa), not a force: the
    /// force on the base is U · baseLength.
    pub u: f64,
    /// The part of U from the water lines or the waternet alone (kPa), set
    /// only where rᵤ or B-bar add to it.
    pub u_water: Option<f64>,
    /// Weight of free water standing on the slice top (kN).
    pub water_load: Option<f64>,
    /// Horizontal external force on the slice (kN), positive in the sliding
    /// direction (+x in canonical coordinates): water pressure on an inclined
    /// ground surface or in a tension crack.
    pub h_force: Option<f64>,
    /// Driving moment about the circle centre (kN·m) of the external water
    /// forces that is not already included as (weight + loads) × dx.
    pub extra_moment: Option<f64>,
    /// Reinforcement forces on the slice, [downward, horizontal (+x), extra
    /// moment] per metre, like the loads above: the moment beyond
    /// downward·dx. Active forces are applied as they are, passive ones
    /// divided by the trial FOS.
    pub reinforcement_active: Option<[f64; 3]>,
    pub reinforcement_passive: Option<[f64; 3]>,
    /// The individual reinforcement forces acting on the slice.
    pub reinforcement_forces: Option<Vec<ReinforcementForce>>,
    /// Combined method: the undrained strength governed in the last solve.
    pub undrained_governs: Option<bool>,
    /// When `true`, the solver uses Combined method (min of drained/undrained).
    pub is_combined: Option<bool>,
    /// A base in Hoek–Brown rock: `cohesion` and `phi` are the instantaneous
    /// parameters at the base's effective normal stress, updated by the
    /// analysis (solvers.ts).
    pub hoek_brown: Option<HoekBrownParameters>,
    /// The strength model at the base when not the base material's own (its
    /// `aboveWater` model). Shared, never deep-cloned.
    pub strength_model: Option<Arc<MaterialModel>>,
    /// Elevation of the slice's centre of gravity (the weight's), where a horizontal seismic force acts.
    pub y_centroid: Option<f64>,
    /// A shear-normal function at the base, updated like `hoek_brown`. Shared.
    pub shear_normal: Option<Arc<ShearNormalModel>>,
    /// When `true`, any slip surface passing through this slice should
    /// be treated as infinitely stable and excluded from the search.
    pub skip_surface: Option<bool>,
    /// When `true`, the slip surface has entered impenetrable material
    /// and the entire surface must be rejected.
    pub impenetrable: Option<bool>,
}
