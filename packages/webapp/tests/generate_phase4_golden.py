"""Generate golden values for Phase 4 – Search & Critical Surface benchmarks.

Run from repo root with the pySlope venv activated:
    python webapp/tests/generate_phase4_golden.py
"""

import json
from pyslope import Material, Slope, Udl, LineLoad

# ── 1. T-ACADS Simple (Morgenstern-Price) ────────────────────────

def t_acads_simple():
    s = Slope()
    m = Material(name="M1", unit_weight=20, friction_angle=19.6, cohesion=3, color="#6d5f2a")
    s.set_external_boundary([(0,-15),(0,0),(20,0),(40,-10),(50,-10),(50,-15),(0,-15)])
    s.asign_material((1,-1), m)
    s.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
    s.update_analysis_options(slices=30, method="Morgenstern-Price")
    s.analyse_slope()
    fos = s.get_min_FOS()
    cx, cy, r = s.get_min_FOS_circle()
    print(f"T-ACADS Simple (M-P): FOS={fos:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")
    print(f"  num_search_planes = {len(s._search)}")
    return {"fos": fos, "cx": cx, "cy": cy, "radius": r, "numPlanes": len(s._search)}

# ── 2. T-ACADS Simple — all methods ──────────────────────────────

def t_acads_simple_methods():
    results = {}
    for method in ["Bishop", "Janbu", "Morgenstern-Price"]:
        s = Slope()
        m = Material(name="M1", unit_weight=20, friction_angle=19.6, cohesion=3, color="#6d5f2a")
        s.set_external_boundary([(0,-15),(0,0),(20,0),(40,-10),(50,-10),(50,-15),(0,-15)])
        s.asign_material((1,-1), m)
        s.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
        s.update_analysis_options(slices=30, method=method)
        s.analyse_slope()
        fos = s.get_min_FOS()
        cx, cy, r = s.get_min_FOS_circle()
        results[method] = {"fos": fos, "cx": cx, "cy": cy, "radius": r}
        print(f"  {method}: FOS={fos:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")
    return results

# ── 3. T-ACADS Non-Homogeneous (M-P) ────────────────────────────

def t_acads_non_homogeneous():
    s = Slope()
    materials = [
        Material(name="Soil #1", unit_weight=19.5, friction_angle=38.0, cohesion=0, color="#6d5f2a"),
        Material(name="Soil #2", unit_weight=19.5, friction_angle=23.0, cohesion=5.3, color="#8c731a"),
        Material(name="Soil #3", unit_weight=19.5, friction_angle=20.0, cohesion=7.2, color="#636d2a"),
    ]
    s.set_external_boundary([(0,-15),(0,0),(20,0),(40,-10),(50,-10),(50,-15),(0,-15)])
    s.set_material_boundary([(0,-11),(18,-11),(30,-8),(20,-6),(16,-4),(0,-4),(0,-11)])
    s.set_material_boundary([(0,-11),(18,-11),(30,-8),(40,-10)])
    s.asign_material((1,-1), materials[0])
    s.asign_material((1,-5), materials[1])
    s.asign_material((1,-14), materials[2])
    s.set_analysis_limits(entry_left_x=16, entry_right_x=21.5, exit_left_x=38.5, exit_right_x=42.5)
    s.update_analysis_options(slices=30, method="Morgenstern-Price")
    s.analyse_slope()
    fos = s.get_min_FOS()
    cx, cy, r = s.get_min_FOS_circle()
    print(f"T-ACADS Non-Homogeneous (M-P): FOS={fos:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")
    return {"fos": fos, "cx": cx, "cy": cy, "radius": r}

# ── 4. Homogeneous slope + UDL (Bishop) ──────────────────────────

def slope_with_udl():
    s = Slope()
    m = Material(name="M1", unit_weight=20, friction_angle=19.6, cohesion=3)
    s.set_external_boundary([(0,-15),(0,0),(20,0),(40,-10),(50,-10),(50,-15),(0,-15)])
    s.asign_material((1,-1), m)
    s.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
    udl = Udl(magnitude=10, x1=5, x2=15)
    s.set_udls(udl)
    s.update_analysis_options(slices=40, iterations=200, method="Bishop")
    s.analyse_slope()
    fos = s.get_min_FOS()
    cx, cy, r = s.get_min_FOS_circle()
    print(f"Slope with UDL (Bishop): FOS={fos:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")
    return {"fos": fos, "cx": cx, "cy": cy, "radius": r}

# ── 5. Homogeneous slope + Line Load (Bishop) ────────────────────

def slope_with_line_load():
    s = Slope()
    m = Material(name="M1", unit_weight=20, friction_angle=19.6, cohesion=3)
    s.set_external_boundary([(0,-15),(0,0),(20,0),(40,-10),(50,-10),(50,-15),(0,-15)])
    s.asign_material((1,-1), m)
    s.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
    ll = LineLoad(magnitude=50, x=10)
    s.set_line_loads(ll)
    s.update_analysis_options(slices=40, iterations=200, method="Bishop")
    s.analyse_slope()
    fos = s.get_min_FOS()
    cx, cy, r = s.get_min_FOS_circle()
    print(f"Slope with Line Load (Bishop): FOS={fos:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")
    return {"fos": fos, "cx": cx, "cy": cy, "radius": r}

# ── 6. Water table (Bishop) ──────────────────────────────────────

def slope_with_water_table():
    s = Slope()
    m = Material(name="M1", unit_weight=20, friction_angle=19.6, cohesion=3)
    s.set_external_boundary([(0,-15),(0,0),(20,0),(40,-10),(50,-10),(50,-15),(0,-15)])
    s.asign_material((1,-1), m)
    s.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
    s.set_water_table(height=-5)
    s.update_analysis_options(slices=40, iterations=200, method="Bishop")
    s.analyse_slope()
    fos = s.get_min_FOS()
    cx, cy, r = s.get_min_FOS_circle()
    print(f"Slope with Water Table (Bishop): FOS={fos:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")
    return {"fos": fos, "cx": cx, "cy": cy, "radius": r}

# ── 7. Arai & Tagyo (Bishop) ─────────────────────────────────────

def arai_tagyo():
    s = Slope()
    m = Material(name="Soil", unit_weight=18.82, friction_angle=15.0, cohesion=41.65, color="#6d5f2a")
    s.set_external_boundary([(0,0),(0,35),(18,35),(48,15),(66,15),(66,0),(0,0)])
    s.asign_material((1,1), m)
    water_table = [(0,32),(18,29),(36,23),(66,23)]
    s.set_water_table(water_table, follow_external_boundary=True)
    s.set_analysis_limits(entry_left_x=0, entry_right_x=18, exit_left_x=48, exit_right_x=66)
    s.update_analysis_options(slices=30, method="Bishop")
    s.analyse_slope()
    fos = s.get_min_FOS()
    cx, cy, r = s.get_min_FOS_circle()
    print(f"Arai & Tagyo (Bishop): FOS={fos:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")
    return {"fos": fos, "cx": cx, "cy": cy, "radius": r}

# ── 8. Two-layer slope (Bishop) ──────────────────────────────────

def layered_slope():
    s = Slope()
    clay = Material(name="Clay", unit_weight=20, friction_angle=19.6, cohesion=3)
    sand = Material(name="Sand", unit_weight=19, friction_angle=32, cohesion=0)
    s.set_external_boundary([(0,-15),(0,0),(20,0),(40,-10),(50,-10),(50,-15),(0,-15)])
    s.set_material_boundary([(0,-5),(50,-5)])
    s.asign_material((25,-3), clay)
    s.asign_material((25,-12), sand)
    s.set_analysis_limits(entry_left_x=17, entry_right_x=22, exit_left_x=37, exit_right_x=43)
    s.update_analysis_options(slices=50, iterations=200, method="Bishop")
    s.analyse_slope()
    fos = s.get_min_FOS()
    cx, cy, r = s.get_min_FOS_circle()
    print(f"Layered Slope (Bishop): FOS={fos:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")
    return {"fos": fos, "cx": cx, "cy": cy, "radius": r}

# ── 9. Prandtl bearing capacity (M-P, Bishop, Janbu) ─────────────

def prandtl_bearing():
    results = {}
    # First run M-P to find critical circle
    s = Slope()
    m = Material(name="Soil", unit_weight=1e-6, friction_angle=0, cohesion=20, color="#6d5f2a")
    s.set_external_boundary([(0,0),(0,15),(50,15),(50,0),(0,0)])
    s.asign_material((1,1), m)
    udl = Udl(magnitude=102.83, x1=20, x2=30)
    s.set_udls(udl)
    s.set_analysis_limits(entry_left_x=19.5, entry_right_x=20.5, exit_left_x=30, exit_right_x=50)
    s.update_analysis_options(slices=30, method="Morgenstern-Price")
    s.analyse_slope()
    fos_mp = s.get_min_FOS()
    cx, cy, r = s.get_min_FOS_circle()
    results["Morgenstern-Price"] = {"fos": fos_mp, "cx": cx, "cy": cy, "radius": r}
    print(f"Prandtl (M-P): FOS={fos_mp:.6f}, cx={cx:.4f}, cy={cy:.4f}, r={r:.4f}")

    # Now run Bishop and Janbu on the same critical circle
    for method in ["Bishop", "Janbu"]:
        s2 = Slope()
        s2.set_external_boundary([(0,0),(0,15),(50,15),(50,0),(0,0)])
        s2.asign_material((1,1), m)
        s2.set_udls(udl)
        s2.update_analysis_options(slices=30, method=method)
        s2._individual_planes = []
        s2.add_single_circular_plane(cx, cy, r)
        s2.analyse_slope()
        fos = s2.get_min_FOS()
        results[method] = {"fos": fos}
        print(f"Prandtl ({method}): FOS={fos:.6f}")

    return results


if __name__ == "__main__":
    golden = {}

    print("=" * 60)
    print("Phase 4 — Golden Values for Benchmark Tests")
    print("=" * 60)

    print("\n--- T-ACADS Simple (M-P) ---")
    golden["t_acads_simple"] = t_acads_simple()

    print("\n--- T-ACADS Simple (all methods) ---")
    golden["t_acads_methods"] = t_acads_simple_methods()

    print("\n--- T-ACADS Non-Homogeneous (M-P) ---")
    golden["t_acads_non_homogeneous"] = t_acads_non_homogeneous()

    print("\n--- Slope with UDL (Bishop) ---")
    golden["slope_with_udl"] = slope_with_udl()

    print("\n--- Slope with Line Load (Bishop) ---")
    golden["slope_with_line_load"] = slope_with_line_load()

    print("\n--- Slope with Water Table (Bishop) ---")
    golden["slope_with_water_table"] = slope_with_water_table()

    print("\n--- Arai & Tagyo (Bishop) ---")
    golden["arai_tagyo"] = arai_tagyo()

    print("\n--- Layered Slope (Bishop) ---")
    golden["layered_slope"] = layered_slope()

    print("\n--- Prandtl Bearing Capacity ---")
    golden["prandtl_bearing"] = prandtl_bearing()

    # Write JSON
    with open("webapp/tests/phase4_golden.json", "w") as f:
        json.dump(golden, f, indent=2)
    print(f"\n✓ Golden values written to webapp/tests/phase4_golden.json")
