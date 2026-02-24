"""Generate golden values for Phase 3 solver tests."""

import sys
sys.path.insert(0, "src")

from pyslope import Material, Slope, Udl, LineLoad

# ── Test 1: Homogeneous slope, Bishop method ──────────────────────
s = Slope()
m1 = Material(name="M1", unit_weight=20, friction_angle=19.6, cohesion=3)
s.set_materials(m1)
coords = [(0, -15), (0, 0), (20, 0), (40, -10), (50, -10), (50, -15)]
s.set_external_boundary(coords)
s.asign_material((1, -1), m1)
s.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
s.update_analysis_options(slices=50, iterations=200, method="Bishop")
s.analyse_slope()
fos_bishop = s.get_min_FOS()
cx_b, cy_b, r_b = s.get_min_FOS_circle()
print(f"=== Homogeneous Bishop ===")
print(f"FOS: {fos_bishop:.6f}")
print(f"Circle: cx={cx_b:.4f}, cy={cy_b:.4f}, r={r_b:.4f}")
print(f"Num search planes: {len(s._search)}")

# ── Test 2: Same slope, Janbu method ─────────────────────────────
s2 = Slope()
s2.set_materials(m1)
s2.set_external_boundary(coords)
s2.asign_material((1, -1), m1)
s2.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
s2.update_analysis_options(slices=50, iterations=200, method="Janbu")
s2.analyse_slope()
fos_janbu = s2.get_min_FOS()
print(f"\n=== Homogeneous Janbu ===")
print(f"FOS: {fos_janbu:.6f}")

# ── Test 3: Same slope, Morgenstern-Price ─────────────────────────
s3 = Slope()
s3.set_materials(m1)
s3.set_external_boundary(coords)
s3.asign_material((1, -1), m1)
s3.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
s3.update_analysis_options(slices=50, iterations=200, method="Morgenstern-Price")
s3.analyse_slope()
fos_mp = s3.get_min_FOS()
print(f"\n=== Homogeneous Morgenstern-Price ===")
print(f"FOS: {fos_mp:.6f}")

# ── Test 4: Slope with UDL ──────────────────────────────────────
s4 = Slope()
s4.set_materials(m1)
s4.set_external_boundary(coords)
s4.asign_material((1, -1), m1)
s4.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
udl = Udl(magnitude=10, x1=5, x2=15)
s4.set_udls(udl)
s4.update_analysis_options(slices=40, iterations=200, method="Bishop")
s4.analyse_slope()
fos_udl = s4.get_min_FOS()
print(f"\n=== With UDL (Bishop) ===")
print(f"FOS: {fos_udl:.6f}")

# ── Test 5: Slope with water table ───────────────────────────────
s5 = Slope()
s5.set_materials(m1)
s5.set_external_boundary(coords)
s5.asign_material((1, -1), m1)
s5.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
s5.set_water_table(height=-5)
s5.update_analysis_options(slices=40, iterations=200, method="Bishop")
s5.analyse_slope()
fos_water = s5.get_min_FOS()
print(f"\n=== With Water Table (Bishop) ===")
print(f"FOS: {fos_water:.6f}")

# ── Test 6: Single known plane - Ordinary method ─────────────────
# Use a fixed plane to test individual solver methods directly
s6 = Slope()
s6.set_materials(m1)
s6.set_external_boundary(coords)
s6.asign_material((1, -1), m1)
s6.update_analysis_options(slices=30, iterations=200, method="Bishop")

# Add a single known circle
from pyslope.solvers import get_slices, analyse_circular_failure_ordinary
from pyslope.solvers import analyse_circular_failure_bishop, analyse_circular_failure_janbu

# Use a manually-specified circle
cx_test, cy_test, r_test = 28.0, 25.0, 35.0
# Find entry/exit (intersections with surface)
import pyslope.math_utils as mu
import numpy as np
ints = mu.get_circle_line_intersections(cx_test, cy_test, r_test,
    s6._surface_lineXY[0], s6._surface_lineXY[1])
ints = sorted(ints, key=lambda x: x[0])
print(f"\n=== Single Plane Test ===")
print(f"Circle: cx={cx_test}, cy={cy_test}, r={r_test}")
if len(ints) >= 2:
    x0, x1_pt = ints[0][0], ints[-1][0]
    print(f"Entry x={x0:.6f}, Exit x={x1_pt:.6f}")
    slices = get_slices(s6, x0, x1_pt, cx_test, cy_test, r_test)
    print(f"Num slices: {len(slices)}")

    fos_ord = analyse_circular_failure_ordinary(s6, slices)
    print(f"Ordinary FOS: {fos_ord:.6f}" if fos_ord else "Ordinary FOS: None")

    fos_b, _, _ = analyse_circular_failure_bishop(s6, slices)
    print(f"Bishop FOS: {fos_b:.6f}" if fos_b else "Bishop FOS: None")

    fos_j, _, _ = analyse_circular_failure_janbu(s6, slices)
    print(f"Janbu FOS: {fos_j:.6f}" if fos_j else "Janbu FOS: None")

# ── Test 7: Multi-material slope ─────────────────────────────────
s7 = Slope()
clay = Material(name="Clay", unit_weight=20, friction_angle=25, cohesion=10)
sand = Material(name="Sand", unit_weight=19, friction_angle=32, cohesion=0)
s7.set_materials(clay, sand)
slope_coords = [(0, -15), (0, 0), (20, 0), (40, -10), (50, -10), (50, -15)]
s7.set_external_boundary(slope_coords)
s7.set_material_boundary([(0, -5), (50, -5)])
s7.asign_material((25, -3), clay)
s7.asign_material((25, -12), sand)
s7.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
s7.update_analysis_options(slices=50, iterations=200, method="Bishop")
s7.analyse_slope()
fos_multi = s7.get_min_FOS()
print(f"\n=== Multi-material (Bishop) ===")
print(f"FOS: {fos_multi:.6f}")

# ── Comparison of methods on same search planes ──────────────────
print(f"\n=== Method Comparison Summary ===")
print(f"Bishop:           {fos_bishop:.6f}")
print(f"Janbu:            {fos_janbu:.6f}")
print(f"Morgenstern-Price: {fos_mp:.6f}")
print(f"With UDL:          {fos_udl:.6f}")
print(f"With Water:        {fos_water:.6f}")
print(f"Multi-material:    {fos_multi:.6f}")
