//! Port of packages/engine/src/types/reinforcement.ts
//!
//! Reinforcement (support) definitions: anchors, grouted tiebacks, soil
//! nails and geosynthetics.
//!
//! Each element is a straight line from end 1 (the head, at the face) to
//! end 2 (the embedded end). Where a slip surface crosses it, a tensile
//! force is applied to the sliding mass at the crossing point. Its size is
//! the capacity envelope there (tensile capacity, pullout from either end,
//! end anchorage), its direction and whether it is divided by the factor of
//! safety follow common conventions:
//!
//! - direction "axial": along the element (rigid supports: nails,
//!   tiebacks, anchors); "tangent": along the slip surface (flexible
//!   geosynthetics); "bisector": halfway between the two.
//! - application "active": a known (allowable) force on the driving side,
//!   not divided by F; "passive": an ultimate capacity mobilised with the
//!   soil strength, divided by F.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReinforcementDirection {
    Axial,
    Tangent,
    Bisector,
    /// Any other string or value, which acts as "axial" (TypeScript's last
    /// branch). (`null` is absent: `r.direction ?? "axial"`.)
    #[serde(untagged)]
    Other(serde_json::Value),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReinforcementApplication {
    Active,
    Passive,
    /// Any other string or value, which is not "passive". (`null` is
    /// absent: `application ?? "active"`.)
    #[serde(untagged)]
    Other(serde_json::Value),
}

/// Pullout resistance along the element (per element, per metre of its
/// length):
/// - "bond": a constant bond strength, over the whole element or only over
///   the bonded length at end 2 (grouted tiebacks);
/// - "interface": r = 2·(a + σ′v·tan δ)·Rc per metre of slope, soil
///   bearing on both faces of a sheet, with σ′v the effective vertical
///   stress at the element (the weight of the soil column above it less the
///   pore pressure) and Rc the coverage ratio (1 for a continuous sheet,
///   strip width / spacing for strips; FHWA's F*·α·σ′v·C·Rc). Rc only sets
///   the width of soil contact: the tensile and end capacities are per
///   element (per strip), so they are not multiplied by it. A
///   geosynthetic "coverage" A (as commercial programs define it) scales all strengths given per metre of
///   material width (T·A, (C + 2·L·τ)·A); there enter the tensile and end
///   capacities × A with spacing 1 (per metre of slope), and coverage A;
/// - "development": the tensile capacity develops linearly over the given
///   length from each end (0: that end is fully anchored).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum ReinforcementPullout {
    Bond {
        #[serde(deserialize_with = "crate::types::json::num")]
        strength: f64,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "crate::types::json::present_num"
        )]
        bonded_length: Option<f64>,
    },
    Interface {
        #[serde(deserialize_with = "crate::types::json::num")]
        adhesion: f64,
        #[serde(deserialize_with = "crate::types::json::num")]
        friction_angle: f64,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "crate::types::json::present_num"
        )]
        coverage: Option<f64>,
    },
    Development {
        // A missing length reads as NaN (TypeScript's `undefined`), which
        // `set_reinforcements` rejects with TypeScript's message.
        #[serde(
            default = "crate::types::json::nan",
            deserialize_with = "crate::types::json::num"
        )]
        length1: f64,
        #[serde(
            default = "crate::types::json::nan",
            deserialize_with = "crate::types::json::num"
        )]
        length2: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reinforcement {
    /// End 1 (head / face end).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x1: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y1: f64,
    /// End 2 (embedded end).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x2: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y2: f64,
    /// Tensile capacity per element (kN), or per metre with spacing 1. Per
    /// element means per strip or bar; a sheet with partial coverage (coverage
    /// A) is entered as T·A per metre with spacing 1.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub tensile_capacity: f64,
    /// Out-of-plane spacing (m); all capacities are divided by it. Default 1.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub spacing: Option<f64>,
    /// Pullout along the element. Without it both ends are fully anchored:
    /// the tensile capacity is available wherever the element is crossed
    /// (end-anchored bars).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pullout: Option<ReinforcementPullout>,
    /// Anchorage capacity at end 1 (plate, facing connection), kN per element. Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub end1_capacity: Option<f64>,
    /// Anchorage capacity at end 2, kN per element. Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub end2_capacity: Option<f64>,
    /// Default "axial".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<ReinforcementDirection>,
    /// Default "active".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application: Option<ReinforcementApplication>,
    /// Lock-off (prestress) load of a grouted anchor's free length, kN per
    /// element: the finite element analysis prestresses the free length with
    /// it (the limit equilibrium takes an active element's force as its
    /// capacity). Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_to_number"
    )]
    pub prestress: Option<f64>,
}

/// Direction of a pile's force on the sliding mass, always against the
/// movement:
/// - "angle": tilted `angle` degrees above horizontal (0: horizontal);
/// - "tangent": along the slip surface where it crosses the pile (the usual
///   default, "tangential");
/// - "perpendicular": perpendicular to the pile axis (horizontal for a
///   vertical pile).
///
/// Another string is kept (`Other`), as a JavaScript object keeps it, so
/// that `Slope::set_piles` reports it with TypeScript's message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PileForceDirection {
    Angle,
    Tangent,
    Perpendicular,
    #[serde(untagged)]
    Other(serde_json::Value),
}

/// Where an Ito & Matsui pile force acts: at the resultant of the soil
/// pressure on the pile above the slip surface ("centroid", the default),
/// or where the slip surface crosses the pile ("slip-surface", as Cai &
/// Ugai 2000, eq. 9, apply it). A given force acts at the crossing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PileForceLocation {
    Centroid,
    SlipSurface,
    /// Any other string or value, which is not "centroid": the force acts
    /// where the slip surface crosses the pile, as TypeScript's
    /// `(p.location ?? "centroid") === "centroid"` decides. (`null` is
    /// absent.)
    #[serde(untagged)]
    Other(serde_json::Value),
}

/// Pile row (or sheet pile wall) resisting the sliding mass in shear: where
/// a slip surface crosses the pile axis, a force acts against the sliding
/// direction (see `direction`; by default tilted `angle` degrees upwards,
/// 0: horizontal). Its size is the given shear force per pile, or —
/// without one, for a vertical pile — the Ito & Matsui (1975) lateral force
/// of the soil squeezing between the piles above the slip surface; either is
/// limited by the pile's shear and bending capacity. Per metre of slope:
/// divided by the spacing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pile {
    /// Pile head and tip.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x1: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y1: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x2: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y2: f64,
    /// Shear force per pile (kN); omit for Ito & Matsui (needs the diameter).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub force: Option<f64>,
    /// Pile diameter / width (m), for Ito & Matsui.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub diameter: Option<f64>,
    /// Centre-to-centre spacing (m). Default 1 (a wall per metre).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub spacing: Option<f64>,
    /// Shear capacity per pile (kN).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub shear_capacity: Option<f64>,
    /// Bending capacity per pile (kNm): force ≤ M / Lm, Lm the arm of the soil pressure.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub moment_capacity: Option<f64>,
    /// Tilt of the force above horizontal (°), for direction "angle". Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub angle: Option<f64>,
    /// Direction of the force. Default "angle" (with `angle`), so that saved
    /// models keep their result; the usual default elsewhere is "tangent".
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present"
    )]
    pub direction: Option<PileForceDirection>,
    /// Default "active".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application: Option<ReinforcementApplication>,
    /// Where an Ito & Matsui force acts. Default "centroid".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<PileForceLocation>,
    /// A continuous wall (sheet piles): in the finite element analysis no soil
    /// flows through it, and its default stiffness is that of a plate of
    /// thickness `diameter` per metre. Default: a wall where spacing ≤ diameter.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullish_truthy"
    )]
    pub wall: Option<bool>,
    /// Bending stiffness EI per pile (kNm²), for the finite element analysis; default a solid circle of `diameter` in concrete (E = 30 GPa), or a plate for a wall.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub bending_stiffness: Option<f64>,
    /// Axial stiffness EA per pile (kN), for the finite element analysis; default as `bendingStiffness`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub axial_stiffness: Option<f64>,
}

/// Applied reinforcement force, per metre of slope.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReinforcementForce {
    /// Index of the element in the slope's reinforcement (or pile) list.
    pub index: usize,
    /// Set (to true) for a pile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pile: Option<bool>,
    /// Crossing point with the slip surface.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y: f64,
    /// Force on the sliding mass (kN/m), +x in the sliding direction, +y up.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub fx: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub fy: f64,
    /// Magnitude (kN/m); divided by F in the solvers when passive.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub force: f64,
    pub passive: bool,
}
