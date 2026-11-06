"""A single slope: one drained soil, no water, sliding to the right.

The soil values are illustrative. For a real slope, use the values from the
site investigation; never guess them.

    python single_slope.py      # writes single_slope.json and analyzes it
"""

from pathlib import Path

from cslope.build import Definition


def build() -> Definition:
    d = Definition(orientation="ltr")  # the crest on the left, sliding to the right
    # The outline (m): 10 m high at 2 horizontal to 1 vertical.
    d.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    # c (kPa), phi (°), unit weights (kN/m³)
    d.add_material("Silty sand", c=5, phi=30, gamma=19, gamma_sat=20)
    # Slip surfaces enter behind the crest and exit at or beyond the toe.
    d.search_limits(entry=(2, 15), exit=(30, 48))
    # The options are set in full so the result does not depend on defaults.
    d.options.method = "Morgenstern-Price"
    d.options.slices = 30
    return d


if __name__ == "__main__":
    from cslope.cli import main

    path = Path(__file__).with_suffix(".json")
    build().save(path)
    raise SystemExit(main(["analyse", str(path)]))
