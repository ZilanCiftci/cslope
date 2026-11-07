"""A project from nothing: one model built with the app's names, analyzed
and saved as a .cslp file that the cSlope app opens with the result current.

    python new_project.py          # writes site.cslp in this folder

The soil values are illustrative, not for use.
"""

import cslope

p = cslope.Project()
m = p.add_model("Section A")  # the app's defaults: Morgenstern-Price, 30 slices

# Exterior (m): x to the right, y up; the slope slides to the right.
m.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]

# Materials: c and phi (kPa, degrees) or su (kPa); unit weights (kN/m³).
sand = m.add_material("Sand", c=5, phi=32, gamma=19, gamma_sat=20)
clay = m.add_material("Clay", su=40, gamma=17, gamma_sat=18)

# An interior boundary splits the section; each region gets a material.
m.add_interior_boundary([(0, 8), (50, 8)])
m.assign(sand, at=(5, 12))
m.assign(clay, at=(25, 3))

# Water, a load on the crest and where slip surfaces enter and exit.
m.add_piezometric_line([(0, 12), (15, 11), (35, 5), (50, 5)])
m.add_distributed_load(x=(3, 10), q=20)  # kPa, vertical
m.search_limits(entry=(1, 14), exit=(30, 48))

r = m.analyze()
print(f"F {r.fos:.3f} ({r.fos_label}, {r.method})")
p.save("site.cslp")
