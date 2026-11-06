"""The layered slope with a distributed load, checked with Swedish partial
factors.

With partial factors the strengths are divided and the variable loads
multiplied before the analysis, so F is an over-design factor on design
values (it must be at least 1.0), not a factor of safety.

The safety class and the conversion factors η are engineering decisions for
the slope at hand. The values below are illustrative: ask for them, never
assume them. The soil values are illustrative too.

    python swedish_partial_factors.py   # writes swedish_partial_factors.json and analyzes it
"""

from pathlib import Path

from cslope.build import Definition, swedish_partial_factors


def build() -> Definition:
    d = Definition(orientation="ltr")
    d.exterior = [(0, 0), (0, 12), (16, 12), (32, 4), (44, 4), (44, 0)]
    d.add_material("Sand", c=3, phi=34, gamma=19, gamma_sat=20)
    d.add_material("Clay", c=12, phi=24, gamma=20, gamma_sat=20)
    d.add_interior_boundary([(0, 6), (28, 6)])
    d.assign("Sand", at=(8, 9))
    d.assign("Clay", at=(20, 2))
    # A variable load (kPa) behind the crest: γQ applies to it.
    d.add_distributed_load(x=(6, 14), q=10)
    d.search_limits(entry=(2, 18), exit=(28, 42))
    d.options.method = "Morgenstern-Price"
    d.options.slices = 30
    d.options.partial_factors = swedish_partial_factors(
        safety_class=2,  # from the project's requirements
        eta_cu=1.0,  # η on su (no undrained material here)
        eta_drained=1.0,  # η on c′ and tan φ′
        variable_load_base=1.3,  # γQ before γd
    )
    return d


if __name__ == "__main__":
    from cslope.cli import main

    path = Path(__file__).with_suffix(".json")
    build().save(path)
    raise SystemExit(main(["analyse", str(path)]))
