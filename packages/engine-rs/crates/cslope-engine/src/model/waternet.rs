//! Port of packages/engine/src/model/waternet.ts
//!
//! Pore pressure from head lines and reference lines (a "waternet"). At a
//! point between two reference lines the head varies linearly with the
//! elevation from the bottom head line of the upper reference line to the
//! top head line of the lower one; below the lowest reference line it is
//! that line's bottom head line. Above the uppermost reference line it
//! varies linearly from the top head line of that line to the phreatic
//! level (where the head is the phreatic line's), and above the phreatic
//! level it is the phreatic line's. A reference line without head lines is
//! left out. The pore pressure is γw × (head − z), not negative. This
//! describes, for example, a clay layer between a phreatic level and a
//! confined aquifer with another head.

use crate::js;
use crate::types::constants::WATER_UNIT_WEIGHT;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

type Pt = [f64; 2];

/// A head line: the elevation of the head along x.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct HeadLine {
    pub id: String,
    pub points: Vec<Pt>,
}

/// A reference line: where the head of its top and bottom head lines applies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceLine {
    pub points: Vec<Pt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_head_line_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom_head_line_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Waternet {
    /// Head lines by id: the elevation of the head along x.
    pub head_lines: Vec<HeadLine>,
    /// Reference lines: where the head of their top and bottom head lines applies.
    pub reference_lines: Vec<ReferenceLine>,
    /// The head line that is the phreatic line (above all reference lines).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phreatic_line_id: Option<String>,
    /// The waternet with its head lines looked up once (the pore pressure
    /// runs per slice); TypeScript keeps it in a WeakMap by object. Like
    /// that cache it is not renewed when the lines are changed afterwards.
    #[serde(skip)]
    compiled: OnceLock<Compiled>,
}

impl PartialEq for Waternet {
    fn eq(&self, other: &Self) -> bool {
        self.head_lines == other.head_lines
            && self.reference_lines == other.reference_lines
            && self.phreatic_line_id == other.phreatic_line_id
    }
}

impl Waternet {
    pub fn new(
        head_lines: Vec<HeadLine>,
        reference_lines: Vec<ReferenceLine>,
        phreatic_line_id: Option<String>,
    ) -> Self {
        Waternet {
            head_lines,
            reference_lines,
            phreatic_line_id,
            compiled: OnceLock::new(),
        }
    }
}

/// y of a polyline at x, constant beyond its ends; NaN without points.
fn line_at(pts: &[Pt], x: f64) -> f64 {
    let n = pts.len();
    if n == 0 {
        return f64::NAN;
    }
    if x <= pts[0][0] {
        return pts[0][1];
    }
    if x >= pts[n - 1][0] {
        return pts[n - 1][1];
    }
    let mut k = 1;
    while k < n - 1 && pts[k][0] < x {
        k += 1;
    }
    let [x0, y0] = pts[k - 1];
    let [x1, y1] = pts[k];
    if x1 > x0 {
        y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    } else {
        y1
    }
}

#[derive(Debug, Clone)]
struct CompiledRef {
    points: Vec<Pt>,
    x0: f64,
    x1: f64,
    /// Head lines for the zone above and below the line (each falls back on the other).
    top: Option<Vec<Pt>>,
    bottom: Option<Vec<Pt>>,
}

#[derive(Debug, Clone)]
struct Compiled {
    phreatic: Option<Vec<Pt>>,
    refs: Vec<CompiledRef>,
}

fn compile(wn: &Waternet) -> &Compiled {
    wn.compiled.get_or_init(|| {
        let head = |id: Option<&String>| -> Option<Vec<Pt>> {
            let id = id?;
            wn.head_lines
                .iter()
                .find(|l| &l.id == id)
                .map(|l| l.points.clone())
        };
        Compiled {
            phreatic: head(wn.phreatic_line_id.as_ref()),
            refs: wn
                .reference_lines
                .iter()
                .filter(|r| {
                    (r.top_head_line_id.is_some() || r.bottom_head_line_id.is_some())
                        && r.points.len() >= 2
                })
                .map(|r| {
                    let top = head(
                        r.top_head_line_id
                            .as_ref()
                            .or(r.bottom_head_line_id.as_ref()),
                    );
                    let bottom = head(
                        r.bottom_head_line_id
                            .as_ref()
                            .or(r.top_head_line_id.as_ref()),
                    );
                    CompiledRef {
                        points: r.points.clone(),
                        x0: r.points[0][0],
                        x1: r.points[r.points.len() - 1][0],
                        top,
                        bottom,
                    }
                })
                .collect(),
        }
    })
}

fn at(pts: Option<&Vec<Pt>>, x: f64) -> f64 {
    match pts {
        Some(pts) => line_at(pts, x),
        None => f64::NAN,
    }
}

/// The pore pressure (kPa, ≥ 0) at (x, z).
pub fn waternet_pore_pressure(wn: &Waternet, x: f64, z: f64) -> f64 {
    let Compiled { phreatic, refs } = compile(wn);
    // the reference lines at x nearest above and below z
    let mut upper: Option<&CompiledRef> = None;
    let mut lower: Option<&CompiledRef> = None;
    let mut yu = f64::INFINITY;
    let mut yl = f64::NEG_INFINITY;
    for r in refs {
        if x < r.x0 || x > r.x1 {
            continue;
        }
        let y = line_at(&r.points, x);
        if y >= z {
            if y < yu {
                yu = y;
                upper = Some(r);
            }
        } else if y > yl {
            yl = y;
            lower = Some(r);
        }
    }
    let h: f64;
    match upper {
        None => {
            // above the uppermost reference line: towards the phreatic level
            let hp = at(phreatic.as_ref(), x);
            let hl = match lower {
                Some(lower) => at(lower.top.as_ref(), x),
                None => f64::NAN,
            };
            if lower.is_some() && hl.is_finite() && hp.is_finite() && z < hp && hp > yl {
                h = hl + ((z - yl) / (hp - yl)) * (hp - hl);
            } else {
                h = if hp.is_finite() { hp } else { hl };
            }
        }
        Some(upper) => {
            let hu = at(upper.bottom.as_ref(), x);
            match lower {
                None => h = hu,
                Some(lower) => {
                    let hl = at(lower.top.as_ref(), x);
                    let t = if yu > yl { (z - yl) / (yu - yl) } else { 0.0 };
                    h = if hu.is_finite() && hl.is_finite() {
                        hl + t * (hu - hl)
                    } else if hu.is_finite() {
                        hu
                    } else {
                        hl
                    };
                }
            }
        }
    }
    if h.is_finite() {
        js::math::max(0.0, (h - z) * WATER_UNIT_WEIGHT)
    } else {
        0.0
    }
}
