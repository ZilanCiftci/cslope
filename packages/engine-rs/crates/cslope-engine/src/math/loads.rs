//! Port of packages/engine/src/math/loads.ts
//!
//! Load force calculations for slices.

use crate::js;

/// UDL input data: [x1, x2, magnitude] per UDL.
pub type UdlData = [f64; 3];

/// Line load input data: [x, magnitude] per load.
pub type LineLoadData = [f64; 2];

/// Calculate UDL and Line Load forces for all slices at once.
///
/// `widths`: slice widths (m); `center_xs`: slice center x-coordinates;
/// `udls`: [x1, x2, magnitude] per UDL; `lin_loads`: [x, magnitude] per
/// line load. Returns (udl forces, line load forces) per slice.
pub fn calculate_all_loads(
    widths: &[f64],
    center_xs: &[f64],
    udls: &[UdlData],
    lin_loads: &[LineLoadData],
) -> (Vec<f64>, Vec<f64>) {
    let num_slices = widths.len();
    let mut udl_forces = vec![0.0; num_slices];
    let mut ll_forces = vec![0.0; num_slices];

    for i in 0..num_slices {
        let b = widths[i];
        let sx = center_xs[i];
        let sxl = sx - b / 2.0;
        let sxr = sx + b / 2.0;

        // UDLs — single overlap formula handles all cases
        for &[raw_x1, raw_x2, umag] in udls {
            let ux1 = js::math::min(raw_x1, raw_x2);
            let ux2 = js::math::max(raw_x1, raw_x2);
            let overlap_l = js::math::max(sxl, ux1);
            let overlap_r = js::math::min(sxr, ux2);
            if overlap_r > overlap_l {
                udl_forces[i] += (overlap_r - overlap_l) * umag;
            }
        }

        // Line loads
        for &[lx, lmag] in lin_loads {
            // Half-open per slice so a load on a shared boundary counts once,
            // but closed on the last slice: a load exactly at the exit point
            // was dropped while one at the entry point was kept.
            let last = i == widths.len() - 1;
            if sxl <= lx && (lx < sxr || (last && lx <= sxr)) {
                ll_forces[i] += lmag;
            }
        }
    }

    (udl_forces, ll_forces)
}
