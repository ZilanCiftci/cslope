"""Layered soil: sand over clay, split by an interior boundary.

The interior boundary runs from the exterior to the exterior, and each
region gets its material from a point inside it. The soil values are
illustrative; use the values from the site investigation.

    python layered_soil.py      # writes layered_soil.json and analyzes it
"""

from pathlib import Path

from cslope.build import Definition


def build() -> Definition:
    d = Definition(orientation="ltr")
    d.exterior = [(0, 0), (0, 12), (16, 12), (32, 4), (44, 4), (44, 0)]
    d.add_material("Sand", c=3, phi=34, gamma=19, gamma_sat=20)
    d.add_material("Clay", c=12, phi=24, gamma=20, gamma_sat=20)
    # From the left edge to the slope face at y = 6 m.
    d.add_interior_boundary([(0, 6), (28, 6)])
    d.assign("Sand", at=(8, 9))
    d.assign("Clay", at=(20, 2))
    d.search_limits(entry=(2, 18), exit=(28, 42))
    d.options.method = "Morgenstern-Price"
    d.options.slices = 30
    return d


if __name__ == "__main__":
    from cslope.cli import main

    path = Path(__file__).with_suffix(".json")
    build().save(path)
    raise SystemExit(main(["analyse", str(path)]))
