//! Port of packages/engine/src/types/loads.ts
//!
//! Load type definitions for slope stability analysis.

use crate::js;
use serde::{Deserialize, Serialize};

/// Uniformly distributed load (surface pressure) in kPa.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct UdlParams {
    /// Magnitude in kPa.
    pub magnitude: f64,
    /// One x-endpoint (m).
    pub x1: f64,
    /// Other x-endpoint (m).
    pub x2: f64,
    /// Display color (default: "red").
    pub color: Option<String>,
    /// How the pressure acts: "vertical" (default), or "normal" to the ground
    /// surface, as water or earth pressure against a slope. A normal pressure
    /// p on ground inclined at β carries p per horizontal metre vertically and
    /// p·tan β horizontally (into the ground), so the vertical part equals a
    /// vertical load of the same magnitude.
    pub direction: Option<UdlDirection>,
    /// The part of the load carried by excess pore pressure at slice bases in
    /// the named materials: 1 − the degree of consolidation under the load
    /// (0 drained, 1 undrained). A base under the load and below the water
    /// (with pore pressure) gets ratio × q more. Not set: none (fully
    /// consolidated).
    pub excess_pore_pressure: Option<Vec<UdlExcessPorePressure>>,
}

/// Excess pore pressure under a load in one material (see `UdlParams::excess_pore_pressure`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct UdlExcessPorePressure {
    /// Material name.
    pub material: String,
    /// Part of the load (0–1).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub ratio: f64,
}

/// Direction of a distributed load (see `UdlParams::direction`).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum UdlDirection {
    #[default]
    Vertical,
    Normal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Udl {
    pub magnitude: f64,
    pub x1: f64,
    pub x2: f64,
    pub length: f64,
    pub color: String,
    pub direction: UdlDirection,
    pub excess_pore_pressure: Vec<UdlExcessPorePressure>,
}

impl Udl {
    pub fn new(params: UdlParams) -> Udl {
        let direction = if params.direction == Some(UdlDirection::Normal) {
            UdlDirection::Normal
        } else {
            UdlDirection::Vertical
        };
        let x1 = js::math::min(params.x1, params.x2);
        let x2 = js::math::max(params.x1, params.x2);
        Udl {
            direction,
            magnitude: params.magnitude.abs(),
            x1,
            x2,
            length: x2 - x1,
            color: params.color.unwrap_or_else(|| "red".to_string()),
            excess_pore_pressure: params
                .excess_pore_pressure
                .unwrap_or_default()
                .into_iter()
                .filter(|e| e.ratio.is_finite() && e.ratio > 0.0)
                // buildSlope rejects a ratio above 1 in a definition; a load made
                // here directly keeps at most the whole load
                .map(|e| UdlExcessPorePressure {
                    material: e.material,
                    ratio: js::math::min(1.0, e.ratio),
                })
                .collect(),
        }
    }
}

/// Line load (point load per unit width) in kN/m.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct LineLoadParams {
    /// Magnitude in kN/m.
    pub magnitude: f64,
    /// x-coordinate where the load is applied (m).
    pub x: f64,
    /// Inclination of the load from the downward vertical (°), positive when
    /// it points towards +x: 0 vertical, ±90 horizontal. Default 0. The
    /// horizontal part acts at the ground at x.
    pub angle: Option<f64>,
    /// Elevation where the load acts (m), for the moment of its horizontal
    /// part: a point on a wall face. Default: the ground at x.
    pub y: Option<f64>,
    /// Display color (default: "blue").
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LineLoad {
    pub magnitude: f64,
    pub x: f64,
    /// Inclination from the downward vertical (°), positive towards +x.
    pub angle: f64,
    /// Elevation of the load point (None: the ground at x).
    pub y: Option<f64>,
    pub color: String,
}

impl LineLoad {
    pub fn new(params: LineLoadParams) -> LineLoad {
        LineLoad {
            magnitude: params.magnitude.abs(),
            x: params.x,
            angle: params.angle.filter(|a| a.is_finite()).unwrap_or(0.0),
            y: params.y.filter(|y| y.is_finite()),
            color: params.color.unwrap_or_else(|| "blue".to_string()),
        }
    }
}
