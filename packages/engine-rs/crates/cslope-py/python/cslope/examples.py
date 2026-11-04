"""Demo models to start from.

Each function returns a new ``SlopeDefinition`` dict, so it can be changed
freely. They are made-up teaching examples, not verification problems:
use them to try the API, not to check the engine.

    >>> import cslope
    >>> from cslope.examples import simple_slope
    >>> for phi in (25, 30, 35):                                  # doctest: +SKIP
    ...     r = cslope.analyse(simple_slope(friction_angle=phi), {"method": "Bishop"})
    ...     print(phi, round(r["minFOS"], 3))
"""

from __future__ import annotations

from typing import Any, Dict, List

__all__ = ["simple_slope", "slope_with_water_table", "clay_crust_with_load", "two_layer_cut_left", "ALL"]


def simple_slope(
    friction_angle: float = 30.0,
    cohesion: float = 5.0,
    unit_weight: float = 19.0,
    height: float = 10.0,
    gradient: float = 2.0,
) -> Dict[str, Any]:
    """A homogeneous slope of ``height`` m, ``gradient`` horizontal to 1
    vertical, in a soil with drained strength c', φ' (kPa, degrees); no
    water. Slides to the right."""
    crest = 15.0
    toe = crest + gradient * height
    return {
        "coordinates": [
            [0.0, 0.0],
            [0.0, height + 5.0],
            [crest, height + 5.0],
            [toe, 5.0],
            [toe + 15.0, 5.0],
            [toe + 15.0, 0.0],
        ],
        "materials": [
            {
                "name": "Soil",
                "model": {
                    "kind": "mohr-coulomb",
                    "unitWeight": unit_weight,
                    "cohesion": cohesion,
                    "frictionAngle": friction_angle,
                },
            }
        ],
    }


def slope_with_water_table(water_height: float = 9.0) -> Dict[str, Any]:
    """The simple slope with a phreatic line: horizontal at ``water_height``
    m behind the crest, falling through the slope to the toe and then
    following the ground (saturated unit weight 20 kN/m³ below it)."""
    d = simple_slope(friction_angle=28.0, cohesion=4.0)
    d["materials"][0]["model"]["unitWeightSat"] = 20.0
    d["waterTable"] = {
        "mode": "custom",
        "value": [[0.0, water_height], [12.0, water_height], [35.0, 5.0], [50.0, 5.0]],
    }
    return d


def clay_crust_with_load(load: float = 20.0) -> Dict[str, Any]:
    """A low slope in soft clay (undrained, su = 18 kPa) under a 1.5 m dry
    crust (drained, c' = 5 kPa, φ' = 30°), with a strip load of ``load`` kPa
    behind the crest."""
    return {
        "coordinates": [[0.0, -12.0], [0.0, 0.0], [8.0, 0.0], [20.0, -4.0], [34.0, -4.0], [34.0, -12.0]],
        "materials": [
            {"name": "Crust", "model": {"kind": "mohr-coulomb", "unitWeight": 18.0, "cohesion": 5.0, "frictionAngle": 30.0}},
            {"name": "Clay", "model": {"kind": "undrained", "unitWeight": 16.5, "undrainedShearStrength": 18.0}},
        ],
        "materialBoundaries": [{"coordinates": [[-0.05, -1.5], [12.55, -1.5]], "materialName": ""}],
        "regionAssignments": [
            {"point": [3.0, -0.5], "materialName": "Crust"},
            {"point": [15.0, -8.0], "materialName": "Clay"},
        ],
        "udls": [{"magnitude": load, "x1": 4.0, "x2": 8.0}],
    }


def two_layer_cut_left() -> Dict[str, Any]:
    """A cut that slides to the left: sand over firm clay. The coordinates
    are in the model's own direction; the engine mirrors it internally and
    reports the results back in these coordinates."""
    return {
        "orientation": "rtl",
        "coordinates": [[0.0, 0.0], [0.0, 4.0], [12.0, 4.0], [28.0, 12.0], [44.0, 12.0], [44.0, 0.0]],
        "materials": [
            {"name": "Sand", "model": {"kind": "mohr-coulomb", "unitWeight": 19.0, "cohesion": 3.0, "frictionAngle": 34.0}},
            {"name": "Firm clay", "model": {"kind": "mohr-coulomb", "unitWeight": 20.0, "cohesion": 12.0, "frictionAngle": 24.0}},
        ],
        "materialBoundaries": [{"coordinates": [[15.95, 6.0], [44.05, 6.0]], "materialName": ""}],
        "regionAssignments": [
            {"point": [36.0, 9.0], "materialName": "Sand"},
            {"point": [20.0, 2.0], "materialName": "Firm clay"},
        ],
    }


#: Every example by name, with default parameters.
ALL: List[str] = ["simple_slope", "slope_with_water_table", "clay_crust_with_load", "two_layer_cut_left"]
