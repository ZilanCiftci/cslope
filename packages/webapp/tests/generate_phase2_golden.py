"""Generate golden values for Phase 2 TypeScript tests."""

import json
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
from shapely.geometry import Polygon

from pyslope import Material, Slope
from pyslope.solvers import get_slices
from pyslope.utilities import (
    get_surface_line,
)

results = {}

# ── 1. Surface line extraction ─────────────────────────────────────
print("=== Surface line extraction ===")

# Simple rectangle
rect = Polygon([(0, 0), (10, 0), (10, -10), (0, -10), (0, 0)])
sl = get_surface_line(rect)
results["surface_line_rect"] = {
    "x": list(sl.xy[0]),
    "y": list(sl.xy[1]),
}
print(f"Rectangle surface: x={list(sl.xy[0])}, y={list(sl.xy[1])}")

# Slope polygon (typical case)
slope_poly = Polygon([(0, 0), (5, 0), (25, -10), (30, -10), (30, -15), (0, -15), (0, 0)])
sl2 = get_surface_line(slope_poly)
results["surface_line_slope"] = {
    "x": list(sl2.xy[0]),
    "y": list(sl2.xy[1]),
}
print(f"Slope surface: x={list(sl2.xy[0])}, y={list(sl2.xy[1])}")

# ── 2. Polygon splitting ───────────────────────────────────────────
print("\n=== Polygon splitting ===")

from shapely import LineString
from shapely.ops import split

# Horizontal split
poly = Polygon([(0, 0), (10, 0), (10, -10), (0, -10), (0, 0)])
cut = LineString([(0, -5), (10, -5)])
pieces = split(poly, cut)
split_results = []
for g in pieces.geoms:
    px, py = g.exterior.xy
    split_results.append({"px": list(px), "py": list(py)})
results["split_horizontal"] = split_results
print(f"Horizontal split: {len(pieces.geoms)} pieces")
for i, g in enumerate(pieces.geoms):
    print(f"  Piece {i}: {list(g.exterior.coords)}")

# Diagonal split on slope
slope_poly2 = Polygon([(0, 0), (20, 0), (40, -10), (50, -10), (50, -15), (0, -15), (0, 0)])
cut2 = LineString([(0, -5), (50, -5)])
pieces2 = split(slope_poly2, cut2)
split_results2 = []
for g in pieces2.geoms:
    px, py = g.exterior.xy
    split_results2.append({"px": list(px), "py": list(py)})
results["split_slope_horizontal"] = split_results2
print(f"Slope horizontal split: {len(pieces2.geoms)} pieces")
for i, g in enumerate(pieces2.geoms):
    print(f"  Piece {i}: {list(g.exterior.coords)}")

# ── 3. Slope model setup ───────────────────────────────────────────
print("\n=== Slope model setup ===")

s = Slope()
ext = [(0, 0), (20, 0), (40, -10), (50, -10), (50, -15), (0, -15), (0, 0)]
s.set_external_boundary(ext)

results["slope_surface_line"] = {
    "x": list(s._surface_lineXY[0]),
    "y": list(s._surface_lineXY[1]),
}
print(f"Surface line: x={list(s._surface_lineXY[0])}")
print(f"Surface line: y={list(s._surface_lineXY[1])}")
print(f"External length: {s._external_length}")
results["slope_external_length"] = s._external_length

# y-intersections at various x
test_xs = [0, 10, 20, 30, 40, 50]
y_ints = {}
for x in test_xs:
    y = s.get_external_y_intersection(x)
    y_ints[str(x)] = y
    print(f"  y at x={x}: {y}")
results["slope_y_intersections"] = y_ints

# ── 4. Material boundary + assignment ──────────────────────────────
print("\n=== Material boundary + assignment ===")

m1 = Material(name="Clay", unit_weight=18, friction_angle=25, cohesion=10, color="#ff0000")
m2 = Material(name="Sand", unit_weight=20, friction_angle=35, cohesion=2, color="#00ff00")
m3 = Material(name="Rock", unit_weight=25, friction_angle=40, cohesion=50, color="#0000ff")

s2 = Slope()
s2.set_external_boundary(ext)
s2.set_material_boundary([(0, -5), (50, -5)])
s2.set_material_boundary([(0, -10), (50, -10)])

# Now we should have 3 geometries
results["num_geometries_after_split"] = len(s2._material_geometries)
print(f"Number of geometries after 2 splits: {len(s2._material_geometries)}")

for i, mg in enumerate(s2._material_geometries):
    print(
        f"  Geometry {i}: px={list(mg.px)[:5]}... material={mg.material.name if mg.material else 'None'}"
    )

s2.asign_material((1, -1), m1)
s2.asign_material((1, -6), m2)
s2.asign_material((1, -11), m3)

mat_names = [mg.material.name for mg in s2._material_geometries]
results["material_names_after_assign"] = mat_names
print(f"Material names after assignment: {mat_names}")

# ── 5. Analysis limits ─────────────────────────────────────────────
print("\n=== Analysis limits ===")
results["slope_limits"] = list(s._limits)
print(f"Default limits: {s._limits}")

s_lim = Slope()
s_lim.set_external_boundary(ext)
s_lim.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
results["custom_limits"] = list(s_lim._limits)
print(f"Custom limits: {s_lim._limits}")

# ── 6. Slice generation ────────────────────────────────────────────
print("\n=== Slice generation ===")

s3 = Slope()
s3.set_external_boundary([(0, 0), (20, 0), (40, -10), (50, -10), (50, -15), (0, -15), (0, 0)])
s3.asign_material((1, -1), m1)

# Simple circle: center at (30, 10), radius 25
cx, cy, radius = 30, 10, 25.0
# Find intersections with surface to get entry/exit points
intersections = s3._get_circle_external_intersection(cx, cy, radius)
print(f"Circle-surface intersections: {intersections}")
results["circle_surface_intersections"] = [list(p) for p in intersections]

if len(intersections) >= 2:
    x0 = intersections[0][0]
    x1 = intersections[1][0]
    slices = get_slices(s3, x0, x1, cx, cy, radius)
    print(f"Number of slices: {len(slices)}")
    results["num_slices"] = len(slices)

    # Store first and last slice properties
    if slices:
        first = slices[0]
        last = slices[-1]
        results["first_slice"] = {
            "x": first.x,
            "xLeft": first.x_left,
            "xRight": first.x_right,
            "yTop": first.y_top,
            "yBottom": first.y_bottom,
            "width": first.width,
            "height": first.height,
            "area": first.area,
            "alpha": first.alpha,
            "baseLength": first.base_length,
            "weight": first.weight,
        }
        results["last_slice"] = {
            "x": last.x,
            "xLeft": last.x_left,
            "xRight": last.x_right,
            "yTop": last.y_top,
            "yBottom": last.y_bottom,
            "width": last.width,
            "height": last.height,
            "area": last.area,
            "alpha": last.alpha,
            "baseLength": last.base_length,
            "weight": last.weight,
        }

        # Sum of all slice weights
        total_weight = sum(s.weight for s in slices)
        results["total_slice_weight"] = total_weight
        print(f"Total slice weight: {total_weight:.4f}")
        print(f"First slice: x={first.x:.4f}, width={first.width:.4f}, weight={first.weight:.4f}")
        print(f"Last slice:  x={last.x:.4f}, width={last.width:.4f}, weight={last.weight:.4f}")

# ── 7. Search plane generation ──────────────────────────────────────
print("\n=== Search plane generation ===")

s4 = Slope()
s4.set_external_boundary([(0, 0), (20, 0), (40, -10), (50, -10), (50, -15), (0, -15), (0, 0)])
s4.asign_material((1, -1), m1)
s4.update_analysis_options(iterations=1000)
s4.set_entry_exit_planes()
results["num_search_planes"] = len(s4._search)
print(f"Number of search planes: {len(s4._search)}")

if s4._search:
    first_plane = s4._search[0]
    results["first_search_plane"] = {
        "lc": list(first_plane["l_c"]),
        "rc": list(first_plane["r_c"]),
        "cx": first_plane["c_x"],
        "cy": first_plane["c_y"],
        "radius": first_plane["radius"],
    }
    print(f"First plane: l_c={first_plane['l_c']}, r_c={first_plane['r_c']}")

# ── 8. Water table ─────────────────────────────────────────────────
print("\n=== Water table ===")

s5 = Slope()
s5.set_external_boundary([(0, 0), (20, 0), (40, -10), (50, -10), (50, -15), (0, -15), (0, 0)])
s5.set_water_table(height=-3)

if s5._water_RLXY:
    results["water_table"] = {
        "x": list(s5._water_RLXY[0]),
        "y": list(s5._water_RLXY[1]),
    }
    print(f"Water table x: {list(s5._water_RLXY[0])}")
    print(f"Water table y: {list(s5._water_RLXY[1])}")

# ── Print all results as JSON ──────────────────────────────────────
print("\n=== JSON Output ===")


# Convert numpy types to Python types for JSON
def to_json_safe(obj):
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {k: to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_json_safe(v) for v in obj]
    if isinstance(obj, tuple):
        return [to_json_safe(v) for v in obj]
    return obj


safe_results = to_json_safe(results)
print(json.dumps(safe_results, indent=2))
