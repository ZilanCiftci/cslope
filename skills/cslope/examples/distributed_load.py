"""A distributed load behind the crest of a low slope in soft clay under a
dry crust.

The clay is undrained (su), the crust drained (c, phi). The load is
vertical, in kPa, between x1 and x2. The soil values are illustrative.

    python distributed_load.py  # writes distributed_load.json and analyzes it
"""

from pathlib import Path

from cslope.build import Definition


def build() -> Definition:
    d = Definition(orientation="ltr")
    d.exterior = [(0, -12), (0, 0), (8, 0), (20, -4), (34, -4), (34, -12)]
    d.add_material("Crust", c=2, phi=32, gamma=18)
    d.add_material("Clay", su=18, gamma=16.5, gamma_sat=16.5)
    # The crust is 1.5 m thick: from the left edge to the slope face.
    d.add_interior_boundary([(0, -1.5), (12.5, -1.5)])
    d.assign("Crust", at=(3, -0.5))
    d.assign("Clay", at=(15, -8))
    d.add_distributed_load(x=(4, 8), q=20)
    d.options.method = "Morgenstern-Price"
    d.options.slices = 30
    return d


if __name__ == "__main__":
    from cslope.cli import main

    path = Path(__file__).with_suffix(".json")
    build().save(path)
    raise SystemExit(main(["analyse", str(path)]))
