"""Read a model's result: F and what it is, the critical surface, the
warnings and the slices, without running anything.

    python read_results.py site.cslp
"""

import sys

import cslope

p = cslope.Project.open(sys.argv[1] if len(sys.argv) > 1 else "site.cslp")
r = p.active_model.result
if r is None:
    sys.exit("The active model has no result: run it in the app or with m.analyze().")

print(r.fos, r.fos_label, r.method)  # F, "factor of safety", "Bishop"
print(r.critical_surface["text"])  # the critical surface, as the app describes it
for w in r.warnings:  # read every warning: one can mean F is not reliable
    print("warning:", w["message"])

for s in r.slices[:3]:  # the app's slice table, one dict per slice
    print(s["slice"], s["material"], round(s["alpha"], 1), round(s["normal_force"], 1))
r.to_csv("slices.csv")  # the whole table, as the app exports it

print(r.summary["engineBuild"])  # report the engine build with the result
