//! Port of packages/engine/src/types/material.ts
//!
//! Material type definitions for slope stability analysis.

use crate::error::{EngineError, Result};
use crate::types::material_models::{MaterialModel, MaterialModelBase, MohrCoulombModel};
use crate::types::strength::{resolve_strength, ResolvedStrength, StrengthContext};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// A material: its model, or (for brevity in code and tests) a Mohr-Coulomb
/// model from the flat fields, which are read only when `model` is absent.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MaterialParams {
    /// Material unit weight in kN/m³ (default: 20).
    pub unit_weight: Option<f64>,
    /// Friction angle in degrees (default: 35).
    pub friction_angle: Option<f64>,
    /// Cohesion in kPa (default: 2).
    pub cohesion: Option<f64>,
    /// Reference depth for cohesion variation (default: 0).
    pub cohesion_ref_depth: Option<f64>,
    /// Rate of cohesion change with depth (default: 0).
    pub cohesion_rate_of_change: Option<f64>,
    /// Undrained cohesion in kPa (default: 20).
    pub cohesion_undrained: Option<f64>,
    /// Material name.
    pub name: Option<String>,
    /// Display color (hex or CSS name).
    pub color: Option<String>,
    /// Combined-method c-factor (default: 0).
    pub c_factor: Option<f64>,
    /// The material model; the flat fields are ignored when it is given.
    pub model: Option<MaterialModel>,
}

/// Small tolerance for floating-point comparisons.
pub const MATERIAL_EPSILON: f64 = 1e-10;

/// A material. Serialized as the worker posts a `Material` instance
/// (structured clone of its fields): `{ name, color, model }`. Immutable
/// once created: a slope's table entry is replaced, never edited, so `Arc`
/// clones of the model stay valid snapshots (ARCHITECTURE.md §1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Material {
    pub name: String,
    pub color: String,
    /// The material: unit weight and strength (see `resolve_strength`).
    pub model: Arc<MaterialModel>,
    /// Facade identity (JS object key); None for materials made in Rust.
    #[serde(skip)]
    pub external_key: Option<u32>,
}

/// How slices, geometry and the slope refer to a material (TypeScript
/// shares one `Material` object): its index in the slope's material table
/// (ARCHITECTURE.md §1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct MaterialId(pub u32);

impl Material {
    /// `new Material(params)`: the "RangeError" messages of TypeScript.
    pub fn new(params: MaterialParams) -> Result<Material> {
        let name = params.name.unwrap_or_default();
        let color = params.color.unwrap_or_default();
        let model = match params.model {
            Some(model) => model,
            None => {
                let friction_angle = params.friction_angle.unwrap_or(35.0);
                if friction_angle < 0.0 || friction_angle > 90.0 {
                    return Err(EngineError::range(
                        "friction_angle must be between 0 and 90",
                    ));
                }
                MaterialModel::MohrCoulomb(MohrCoulombModel {
                    base: MaterialModelBase::new(params.unit_weight.unwrap_or(20.0)),
                    friction_angle,
                    cohesion: params.cohesion.unwrap_or(2.0).abs(),
                    drawdown_strength: None,
                    cohesion_ref_depth: Some(params.cohesion_ref_depth.unwrap_or(0.0)),
                    cohesion_rate_of_change: Some(params.cohesion_rate_of_change.unwrap_or(0.0)),
                    cohesion_undrained: Some(params.cohesion_undrained.unwrap_or(20.0)),
                    c_factor: Some(params.c_factor.unwrap_or(0.0)),
                })
            }
        };
        let uw = model.unit_weight();
        if !(uw >= 0.0 && uw <= 500.0) {
            return Err(EngineError::range("unit weight must be between 0 and 500"));
        }
        Ok(Material {
            name,
            color,
            model: Arc::new(model),
            external_key: None,
        })
    }

    /// Unit weight (kN/m³): the model's.
    pub fn unit_weight(&self) -> f64 {
        self.model.unit_weight()
    }

    /// The strength at a point (see `resolve_strength`).
    pub fn get_strength(&self, context: &StrengthContext) -> Result<ResolvedStrength> {
        resolve_strength(&self.model, context)
    }
}
