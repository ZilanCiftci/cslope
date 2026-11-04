"""Parameter study: the factor of safety of a slope against the friction angle.

    python examples/parameter_study.py            # prints a table
    python examples/parameter_study.py --plot     # and plots it (needs matplotlib)

Each analysis takes a few hundredths of a second; the trial surfaces are
evaluated on every core (the result does not depend on the thread count).
"""

from __future__ import annotations

import sys

import cslope
from cslope.examples import simple_slope

METHODS = ("Bishop", "Morgenstern-Price")


def study(angles):
    rows = []
    for phi in angles:
        definition = simple_slope(friction_angle=phi, cohesion=5.0)
        fos = [cslope.analyse(definition, {"method": m})["minFOS"] for m in METHODS]
        rows.append((phi, *fos))
    return rows


def main() -> None:
    angles = list(range(20, 41, 2))
    rows = study(angles)
    print(f"cslope {cslope.__version__} ({cslope.ENGINE_BUILD})")
    print("phi'  " + "  ".join(f"{m:>17}" for m in METHODS))
    for phi, *fos in rows:
        print(f"{phi:4.0f}  " + "  ".join(f"{f:17.3f}" for f in fos))

    if "--plot" in sys.argv:
        import matplotlib.pyplot as plt

        for i, m in enumerate(METHODS):
            plt.plot([r[0] for r in rows], [r[1 + i] for r in rows], marker="o", label=m)
        plt.axhline(1.0, color="grey", linewidth=0.8)
        plt.xlabel("friction angle φ′ (°)")
        plt.ylabel("factor of safety F")
        plt.title("10 m slope 1:2, c′ = 5 kPa, γ = 19 kN/m³")
        plt.legend()
        plt.show()


if __name__ == "__main__":
    main()
