"""A slope with a piezometric line: water behind the crest, falling through
the slope to the toe.

Below the line the saturated unit weight applies, so every material that
can be below it has ``gamma_sat``. With ``free_water=True`` water above the
ground (a lake, a ditch) loads it. The soil values are illustrative.

    python water_table.py       # writes water_table.json and analyzes it
"""

from pathlib import Path

from cslope.build import Definition


def build() -> Definition:
    d = Definition(orientation="ltr")
    d.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    d.add_material("Silty sand", c=4, phi=28, gamma=19, gamma_sat=20)
    # From the left edge to the right edge of the model (m).
    d.add_piezometric_line([(0, 14), (12, 14), (35, 5), (50, 5)], free_water=True)
    d.search_limits(entry=(2, 15), exit=(30, 48))
    d.options.method = "Morgenstern-Price"
    d.options.slices = 30
    return d


if __name__ == "__main__":
    from cslope.cli import main

    path = Path(__file__).with_suffix(".json")
    build().save(path)
    raise SystemExit(main(["analyse", str(path)]))
