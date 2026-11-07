"""Build a slope model in the app's terms and save it as an analysis document.

Each call checks what it can at once (numbers are numbers, a material is
known, a point lies in the model), so a mistake fails where it is made, not
as a wrong factor later. Units: m, kPa, kN/m³ and degrees.

    >>> from cslope.build import Definition
    >>> d = Definition(orientation="ltr")                      # doctest: +SKIP
    >>> d.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    >>> d.add_material("Clay", c=5, phi=30, gamma=19, gamma_sat=20)
    >>> d.search_limits(entry=(5, 15), exit=(35, 45))
    >>> d.save("slope.json")                                   # then: cslope analyse slope.json

The document written by ``save`` (and returned by ``to_dict``) is
``{"format": "cslope-analysis", "formatVersion": 1, "definition": {...},
"options": {...}}``; ``cslope.analyse`` runs it and ``cslope analyse`` runs
the file.
"""

from __future__ import annotations

import copy
import json
import math
import numbers
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

import cslope as _cslope

__all__ = [
    "DOCUMENT_FORMAT",
    "DOCUMENT_FORMAT_VERSION",
    "METHODS",
    "Definition",
    "InvalidDefinition",
    "Options",
    "swedish_partial_factors",
]

#: The ``format`` and ``formatVersion`` of an analysis document.
DOCUMENT_FORMAT = "cslope-analysis"
DOCUMENT_FORMAT_VERSION = 1

#: The limit equilibrium methods, named as the engine names them.
METHODS = ("Morgenstern-Price", "Bishop", "Janbu")

Point = Tuple[float, float]
PathLike = Union[str, "os.PathLike[str]"]

# Relative to the model's size: points closer than this to an edge are on it.
_ON_EDGE = 1e-9


class InvalidDefinition(ValueError):
    """The definition has errors; ``issues`` lists them (path, code, message)."""

    def __init__(self, issues: List[Dict[str, Any]]):
        self.issues = issues
        lines = ["{}: {}".format(i.get("path") or "/", i.get("message")) for i in issues]
        super().__init__("The definition has errors:\n" + "\n".join(lines))


# ── checks ───────────────────────────────────────────────────────────────


def _number(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise TypeError("{} must be a number, not {!r}".format(what, value))
    v = float(value)
    if not math.isfinite(v):
        raise ValueError("{} must be a finite number, not {!r}".format(what, value))
    return v


def _positive(value: Any, what: str) -> float:
    v = _number(value, what)
    if v <= 0:
        raise ValueError("{} must be greater than 0, not {!r}".format(what, value))
    return v


def _non_negative(value: Any, what: str) -> float:
    v = _number(value, what)
    if v < 0:
        raise ValueError("{} must be 0 or more, not {!r}".format(what, value))
    return v


def _point(p: Any, what: str) -> Point:
    if isinstance(p, (str, bytes)) or not isinstance(p, Sequence) or len(p) != 2:
        raise TypeError("{} must be a point (x, y), not {!r}".format(what, p))
    return (_number(p[0], what + " x"), _number(p[1], what + " y"))


def _points(points: Any, what: str, minimum: int) -> List[Point]:
    if isinstance(points, (str, bytes)) or not isinstance(points, Iterable):
        raise TypeError("{} must be a list of points (x, y), not {!r}".format(what, points))
    pts = [_point(p, "{} point {}".format(what, i + 1)) for i, p in enumerate(points)]
    if len(pts) < minimum:
        raise ValueError("{} needs at least {} points, got {}".format(what, minimum, len(pts)))
    return pts


def _range(r: Any, what: str) -> Tuple[float, float]:
    if isinstance(r, (str, bytes)) or not isinstance(r, Sequence) or len(r) != 2:
        raise TypeError("{} must be a range (x1, x2), not {!r}".format(what, r))
    a, b = _number(r[0], what + " x1"), _number(r[1], what + " x2")
    if a > b:
        raise ValueError("{} must go from left to right: x1 {} is greater than x2 {}".format(what, a, b))
    return (a, b)


def _area(poly: List[Point]) -> float:
    return 0.5 * sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]))


def _distance_to_segment(p: Point, a: Point, b: Point) -> float:
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    len2 = dx * dx + dy * dy
    t = 0.0 if len2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _inside(p: Point, poly: List[Point]) -> bool:
    """Ray casting; a point on an edge counts as outside."""
    x, y = p
    result = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            result = not result
    return result


# ── partial factors ─────────────────────────────────────────────────────


def _material_model(
    name: str, gamma: Any, c: Any, phi: Any, su: Any, gamma_sat: Any
) -> Dict[str, Any]:
    """The engine's material model of ``add_material``'s arguments."""
    model: Dict[str, Any]
    if su is not None:
        if c is not None or phi is not None:
            raise ValueError("Give either su (undrained) or c and phi (drained) for {!r}, not both".format(name))
        model = {"kind": "undrained", "unitWeight": _positive(gamma, "gamma"),
                 "undrainedShearStrength": _positive(su, "su")}
    else:
        if c is None or phi is None:
            raise ValueError("{!r} needs c and phi (drained) or su (undrained)".format(name))
        model = {"kind": "mohr-coulomb", "unitWeight": _positive(gamma, "gamma"),
                 "cohesion": _non_negative(c, "c"), "frictionAngle": _phi(phi)}
    if gamma_sat is not None:
        model["unitWeightSat"] = _positive(gamma_sat, "gamma_sat")
    return model


def _phi(phi: Any) -> float:
    v = _non_negative(phi, "phi")
    if v >= 90:
        raise ValueError("phi must be less than 90°, not {!r}".format(phi))
    return v


def swedish_partial_factors(
    safety_class: int, eta_cu: float, eta_drained: float, variable_load_base: float
) -> Dict[str, Any]:
    """Partial factors in Swedish practice, for ``options.partial_factors``.

    Every argument is required: the safety class and the conversion factors
    η are engineering decisions for the slope at hand, never defaults.
    γcu = 1.5 / ``eta_cu``, γc′ = γφ′ = 1.3 / ``eta_drained``, and
    γQ = ``variable_load_base`` · γd with γd = 0.83, 0.91 or 1.0 in safety
    class 1, 2 or 3. With partial factors F is an over-design factor on
    design values, not a factor of safety. (``cslope.swedish_partial_factors``.)
    """
    return _cslope.swedish_partial_factors(
        safety_class=safety_class,
        eta_cu=eta_cu,
        eta_drained=eta_drained,
        variable_load_base=variable_load_base,
    )


# ── options ─────────────────────────────────────────────────────────────

# attribute -> (engine key, the app's default for a new model). The builder
# writes these into every document.
_OPTION_FIELDS = {
    "method": ("method", "Morgenstern-Price"),
    "slices": ("slices", 30),
    "iterations": ("iterations", 1000),
    "refined_iterations": ("refinedIterations", 500),
    "composite_surfaces": ("compositeSurfaces", True),
    "search_method": ("searchMethod", "circular"),
    "interslice_function": ("intersliceFunction", "half-sine"),
    "tolerance": ("tolerance", 0.001),
    "min_slip_depth": ("minSlipDepth", 0.0),
    "tension_crack_depth": ("tensionCrackDepth", 0.0),
    "seismic_horizontal": ("seismicHorizontal", 0.0),
    "seismic_vertical": ("seismicVertical", 0.0),
    "both_directions": ("bothDirections", False),
    "partial_factors": ("partialFactors", None),
}
# The rest of the app's options (Analysis › Options): written only when set.
# None: not given (the app's own behaviour without it).
_MORE_OPTION_FIELDS = {
    "max_iterations": ("maxIterations", 15),
    "min_failure_dist": ("minFailureDist", 0.0),
    "min_slip_area": ("minSlipArea", 0.0),
    "janbu_correction": ("janbuCorrection", False),
    "interslice_data_points": ("intersliceDataPoints", []),
    "pore_pressure_head": ("porePressureHead", "vertical"),
    "tension_crack_water": ("tensionCrackWater", 0.0),
    "tension_crack_auto": ("tensionCrackAuto", None),
    "tension_crack_angle": ("tensionCrackAngle", None),
    "non_circular_optimization": ("nonCircularOptimization", False),
    "composite_base": ("compositeBase", None),
    "block_active_angle": ("blockActiveAngle", None),
    "block_passive_angle": ("blockPassiveAngle", None),
    "fem": ("fem", None),
    "sgi3d": ("sgi3d", None),
}
_ALL_OPTION_FIELDS = dict(_OPTION_FIELDS, **_MORE_OPTION_FIELDS)
_OPTION_KEYS = {key: attr for attr, (key, _) in _ALL_OPTION_FIELDS.items()}
_INTERSLICE = ("constant", "half-sine", "clipped-sine", "trapezoidal", "data-point-specified")
_WHOLE = ("slices", "iterations", "refined_iterations", "max_iterations")


class Options:
    """Analysis options with the app's defaults for a new model.

    Only these attributes exist; setting any other is an ``AttributeError``
    (a misspelt option never runs silently with a default):

    - ``method``: "Morgenstern-Price" (default), "Bishop" or "Janbu"
    - ``slices`` (30), ``iterations`` (1000), ``refined_iterations`` (500)
    - ``composite_surfaces`` (True): circles follow a stronger layer below
    - ``search_method``: "circular" (default) or "block"
    - ``interslice_function``: "half-sine" (default), "constant",
      "clipped-sine", "trapezoidal" or "data-point-specified"
      (Morgenstern-Price; the last with ``interslice_data_points``)
    - ``tolerance`` (0.001), ``min_slip_depth`` (0 m),
      ``tension_crack_depth`` (0 m)
    - ``seismic_horizontal``, ``seismic_vertical`` (0, as a fraction of g)
    - ``both_directions`` (False): also analyze sliding the other way
    - ``partial_factors`` (None): from ``swedish_partial_factors`` or a dict
      ``{"cu", "cohesion", "tanPhi", "variableLoad"}``; then F is an
      over-design factor on design values

    and the rest of the app's options, written into a document only when
    set: ``max_iterations`` (15), ``min_failure_dist`` (0 m),
    ``min_slip_area`` (0 m²), ``janbu_correction`` (False),
    ``interslice_data_points`` ([(x, f)]), ``pore_pressure_head``
    ("vertical" or "phreatic-correction"), ``tension_crack_water`` (0, the
    crack's water filling, 0 to 1), ``tension_crack_auto`` and
    ``tension_crack_angle`` (°), ``non_circular_optimization`` (False),
    ``composite_base``, ``block_active_angle`` and ``block_passive_angle``
    ((from, to) in °), ``fem`` and ``sgi3d`` (the engine's settings dicts).
    Setting an option to None removes it where None is allowed.
    """

    __slots__ = ("_own", "_source", "_changed")

    def __init__(self, **values: Any):
        defaults = {key: copy.deepcopy(d) for key, d in _OPTION_FIELDS.values() if d is not None}
        object.__setattr__(self, "_own", defaults)
        object.__setattr__(self, "_source", None)
        object.__setattr__(self, "_changed", None)
        for attr, v in values.items():
            setattr(self, attr, v)

    @classmethod
    def _over(cls, source: Any, changed: Any) -> "Options":
        """Options that read the dict ``source()`` gives (a model's
        options); a change is ``changed(key, value)`` (value None: remove
        the key), which the owner applies."""
        o = cls.__new__(cls)
        object.__setattr__(o, "_own", None)
        object.__setattr__(o, "_source", source)
        object.__setattr__(o, "_changed", changed)
        return o

    @property
    def _values(self) -> Dict[str, Any]:
        return self._source() if self._source is not None else self._own

    def __getattr__(self, attr: str) -> Any:
        field = _ALL_OPTION_FIELDS.get(attr)
        if field is None:
            raise AttributeError("Options has no attribute {!r}".format(attr))
        key, default = field
        v = self._values.get(key, default)
        if attr in _WHOLE and isinstance(v, float) and v.is_integer():
            v = int(v)
        return copy.deepcopy(v)

    def __setattr__(self, attr: str, value: Any) -> None:
        if attr not in _ALL_OPTION_FIELDS:
            raise AttributeError(
                "Options has no attribute {!r}; the options are: {}".format(attr, ", ".join(_ALL_OPTION_FIELDS))
            )
        key = _ALL_OPTION_FIELDS[attr][0]
        v = _check_option(attr, value)
        if self._changed is not None:
            self._changed(key, v)  # the owner changes its dict
        elif v is None:
            self._values.pop(key, None)
        else:
            self._values[key] = v

    def __dir__(self) -> List[str]:
        return sorted(set(object.__dir__(self)) | set(_ALL_OPTION_FIELDS))

    def __repr__(self) -> str:
        return "Options({})".format(", ".join("{}={!r}".format(a, getattr(self, a)) for a in _OPTION_FIELDS))

    def to_dict(self) -> Dict[str, Any]:
        """The engine's ``AnalysisOptions`` dict: the options above written
        out, the others as set."""
        return copy.deepcopy(self._values)

    @classmethod
    def from_dict(cls, options: Dict[str, Any]) -> "Options":
        """Options from an ``AnalysisOptions`` dict; keys the builder does not
        know are kept as they are."""
        o = cls()
        for key, v in options.items():
            attr = _OPTION_KEYS.get(key)
            if attr is None:
                o._values[key] = copy.deepcopy(v)
            else:
                setattr(o, attr, v)
        return o


def _check_option(attr: str, v: Any) -> Any:
    if v is None:
        if _ALL_OPTION_FIELDS[attr][1] is None:
            return None
        raise ValueError("{} cannot be None".format(attr))
    if attr == "method":
        if v not in METHODS:
            raise ValueError("method must be one of {}, not {!r}".format(", ".join(METHODS), v))
        return v
    if attr == "search_method":
        if v not in ("circular", "block"):
            raise ValueError("search_method must be 'circular' or 'block', not {!r}".format(v))
        return v
    if attr == "interslice_function":
        if v not in _INTERSLICE:
            raise ValueError("interslice_function must be one of {}, not {!r}".format(", ".join(_INTERSLICE), v))
        return v
    if attr == "pore_pressure_head":
        if v not in ("vertical", "phreatic-correction"):
            raise ValueError("pore_pressure_head must be 'vertical' or 'phreatic-correction', not {!r}".format(v))
        return v
    if attr in (
        "composite_surfaces", "both_directions", "janbu_correction", "non_circular_optimization",
        "composite_base", "tension_crack_auto",
    ):
        if not isinstance(v, bool):
            raise TypeError("{} must be True or False, not {!r}".format(attr, v))
        return v
    if attr in _WHOLE:
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if isinstance(v, bool) or not isinstance(v, int) or v < (0 if attr == "refined_iterations" else 1):
            raise ValueError("{} must be a whole number of at least 1, not {!r}".format(attr, v))
        return v
    if attr == "tolerance":
        return _positive(v, attr)
    if attr in ("min_slip_depth", "tension_crack_depth", "min_failure_dist", "min_slip_area"):
        return _non_negative(v, attr)
    if attr == "tension_crack_water":
        w = _non_negative(v, attr)
        if w > 1:
            raise ValueError("tension_crack_water is the crack's filling, from 0 to 1, not {!r}".format(v))
        return w
    if attr in ("seismic_horizontal", "seismic_vertical", "tension_crack_angle"):
        return _number(v, attr)
    if attr in ("block_active_angle", "block_passive_angle"):
        a, b = _range(v, attr)
        return [a, b]
    if attr == "interslice_data_points":
        return [list(p) for p in _points(v, attr, 0)]
    if attr in ("fem", "sgi3d"):
        if not isinstance(v, dict):
            raise TypeError("{} must be a dict (the engine's settings) or None, not {!r}".format(attr, v))
        return copy.deepcopy(v)
    if attr == "partial_factors":
        if not isinstance(v, dict):
            raise TypeError("partial_factors must be a dict or None, not {!r}".format(v))
        for k in ("cu", "cohesion", "tanPhi", "variableLoad"):
            if k not in v:
                raise ValueError("partial_factors needs {!r} (use swedish_partial_factors)".format(k))
            _positive(v[k], "partial_factors[{!r}]".format(k))
        return copy.deepcopy(v)
    raise AttributeError(attr)  # pragma: no cover - guarded by __setattr__


# ── the definition ──────────────────────────────────────────────────────

# definition keys the builder writes; any other key of a loaded definition
# is kept as it is
_BUILT_KEYS = (
    "orientation",
    "coordinates",
    "materials",
    "materialBoundaries",
    "regionAssignments",
    "waterTable",
    "udls",
    "lineLoads",
    "analysisLimits",
)


class Definition:
    """A slope model: the exterior, materials, water, loads and search limits.

    ``orientation`` is "ltr" when the slope slides to the right (the crest
    on the left) and "rtl" when it slides to the left; coordinates are in
    the model's own direction either way (x to the right, y up, m).
    """

    def __init__(self, orientation: str = "ltr"):
        if orientation not in ("ltr", "rtl"):
            raise ValueError("orientation must be 'ltr' (slides to the right) or 'rtl' (slides to the left)")
        self.orientation = orientation
        self.options = Options()
        self._exterior: Optional[List[Point]] = None
        self._materials: List[Dict[str, Any]] = []
        self._boundaries: List[List[Point]] = []
        self._assignments: List[Dict[str, Any]] = []
        self._water: Optional[Dict[str, Any]] = None
        self._udls: List[Dict[str, Any]] = []
        self._line_loads: List[Dict[str, Any]] = []
        self._limits: Optional[Dict[str, float]] = None
        self._extra: Dict[str, Any] = {}

    # geometry

    @property
    def exterior(self) -> Optional[List[Point]]:
        """The outline of the model, a closed polygon of (x, y) points (m)."""
        return None if self._exterior is None else list(self._exterior)

    @exterior.setter
    def exterior(self, points: Any) -> None:
        pts = _points(points, "exterior", 3)
        if len(pts) > 3 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if abs(_area(pts)) == 0:
            raise ValueError("exterior encloses no area")
        self._exterior = pts

    def _need_exterior(self, what: str) -> List[Point]:
        if self._exterior is None:
            raise ValueError("Set the exterior before {}".format(what))
        return self._exterior

    def _x_range(self) -> Tuple[float, float]:
        xs = [p[0] for p in self._need_exterior("this")]
        return min(xs), max(xs)

    def _tolerance(self) -> float:
        ext = self._need_exterior("this")
        xs, ys = [p[0] for p in ext], [p[1] for p in ext]
        return _ON_EDGE * max(max(xs) - min(xs), max(ys) - min(ys), 1.0)

    def _within_x(self, x: float, what: str) -> None:
        lo, hi = self._x_range()
        tol = self._tolerance()
        if x < lo - tol or x > hi + tol:
            raise ValueError("{} x = {} is outside the model (x from {} to {})".format(what, x, lo, hi))

    def _on_or_outside(self, p: Point) -> bool:
        ext = self._need_exterior("this")
        tol = self._tolerance()
        on_edge = any(_distance_to_segment(p, a, b) <= tol for a, b in zip(ext, ext[1:] + ext[:1]))
        return on_edge or not _inside(p, ext)

    def add_interior_boundary(self, points: Any) -> None:
        """A line between two materials. It must run from the exterior to the
        exterior: both ends on the outline (or beyond it), never inside."""
        pts = _points(points, "interior boundary", 2)
        self._need_exterior("adding an interior boundary")
        for end, p in (("start", pts[0]), ("end", pts[-1])):
            if not self._on_or_outside(p):
                raise ValueError(
                    "The interior boundary's {} ({}, {}) is inside the model; "
                    "extend it to the exterior.".format(end, p[0], p[1])
                )
        self._boundaries.append(pts)

    # materials

    def add_material(
        self,
        name: str,
        *,
        gamma: float,
        c: Optional[float] = None,
        phi: Optional[float] = None,
        su: Optional[float] = None,
        gamma_sat: Optional[float] = None,
    ) -> str:
        """A material with drained strength (``c`` kPa, ``phi`` °) or
        undrained strength (``su`` kPa); ``gamma`` and ``gamma_sat`` are the
        unit weights above and below the water (kN/m³). Give ``gamma_sat``
        whenever the material can be below a piezometric line. Returns the
        name, for ``assign``."""
        if not isinstance(name, str) or not name.strip():
            raise ValueError("A material needs a name")
        if any(m["name"] == name for m in self._materials):
            raise ValueError("A material named {!r} exists already".format(name))
        model = _material_model(name, gamma, c, phi, su, gamma_sat)
        self._materials.append({"name": name, "model": model})
        return name

    def _known(self, material: str) -> str:
        if not any(m["name"] == material for m in self._materials):
            names = ", ".join(repr(m["name"]) for m in self._materials) or "none yet"
            raise ValueError("No material named {!r} (materials: {})".format(material, names))
        return material

    def assign(self, material: str, at: Any) -> None:
        """Give the region that holds the point ``at`` = (x, y) this
        material. Assign every region of the model."""
        self._known(material)
        p = _point(at, "at")
        if self._on_or_outside(p):
            raise ValueError("The point ({}, {}) is not inside the exterior".format(p[0], p[1]))
        self._assignments.append({"point": [p[0], p[1]], "materialName": material})

    # water

    def add_piezometric_line(self, points: Any, free_water: bool = True) -> None:
        """The piezometric line (m), from left to right across the model.
        With ``free_water`` (the default) water above the ground acts on it,
        as in a lake or a ditch; without, the line is cut at the ground."""
        if self._water is not None:
            raise ValueError("The model has a piezometric line already")
        if not isinstance(free_water, bool):
            raise TypeError("free_water must be True or False")
        pts = _points(points, "piezometric line", 2)
        for (x1, _), (x2, _) in zip(pts, pts[1:]):
            if x2 < x1:
                raise ValueError("The piezometric line must run from left to right (x goes back at {})".format(x2))
        for i, (x, _) in enumerate(pts):
            self._within_x(x, "Piezometric line point {}".format(i + 1))
        self._water = {"mode": "custom", "value": [[x, y] for x, y in pts], "freeWater": free_water}

    # loads

    def add_distributed_load(self, x: Any, q: float, direction: str = "vertical") -> None:
        """A distributed load ``q`` (kPa) on the ground from x = (x1, x2) (m);
        ``direction`` "vertical" (per horizontal meter) or "normal" (normal
        to the ground)."""
        x1, x2 = _range(x, "x")
        if x1 == x2:
            raise ValueError("A distributed load needs x1 < x2")
        self._within_x(x1, "Distributed load x1")
        self._within_x(x2, "Distributed load x2")
        if direction not in ("vertical", "normal"):
            raise ValueError("direction must be 'vertical' or 'normal', not {!r}".format(direction))
        load: Dict[str, Any] = {"magnitude": _positive(q, "q"), "x1": x1, "x2": x2}
        if direction != "vertical":
            load["direction"] = direction
        self._udls.append(load)

    def add_line_load(self, x: float, p: float, angle: float = 0.0, y: Optional[float] = None) -> None:
        """A line load ``p`` (kN/m) at ``x`` (m); ``angle`` from the downward
        vertical (°, positive towards +x); ``y`` the elevation of the load
        point for a load on a wall face (default: on the ground at x)."""
        xv = _number(x, "x")
        self._within_x(xv, "Line load")
        a = _number(angle, "angle")
        if abs(a) > 90:
            raise ValueError("angle must be from -90 to 90°, not {!r}".format(angle))
        load: Dict[str, Any] = {"magnitude": _positive(p, "p"), "x": xv}
        if a != 0:
            load["angle"] = a
        if y is not None:
            load["y"] = _number(y, "y")
        self._line_loads.append(load)

    # search

    def search_limits(self, entry: Any, exit: Any) -> None:
        """Where slip surfaces may enter and exit the ground: entry = (x1, x2)
        and exit = (x1, x2), in m."""
        e = _range(entry, "entry")
        x = _range(exit, "exit")
        for what, v in (("Entry x1", e[0]), ("Entry x2", e[1]), ("Exit x1", x[0]), ("Exit x2", x[1])):
            self._within_x(v, what)
        self._limits = {"entryLeftX": e[0], "entryRightX": e[1], "exitLeftX": x[0], "exitRightX": x[1]}

    # output

    def definition_dict(self) -> Dict[str, Any]:
        """The engine's ``SlopeDefinition`` dict."""
        if self._exterior is None:
            raise ValueError("The model has no exterior")
        if not self._materials:
            raise ValueError("The model has no materials")
        d: Dict[str, Any] = copy.deepcopy(self._extra)
        d["orientation"] = self.orientation
        d["coordinates"] = [[x, y] for x, y in self._exterior]
        d["materials"] = copy.deepcopy(self._materials)
        if self._boundaries:
            d["materialBoundaries"] = [{"coordinates": [[x, y] for x, y in b]} for b in self._boundaries]
        if self._assignments:
            d["regionAssignments"] = copy.deepcopy(self._assignments)
        if self._water is not None:
            d["waterTable"] = copy.deepcopy(self._water)
        if self._udls:
            d["udls"] = copy.deepcopy(self._udls)
        if self._line_loads:
            d["lineLoads"] = copy.deepcopy(self._line_loads)
        if self._limits is not None:
            d["analysisLimits"] = dict(self._limits)
        return d

    def to_dict(self) -> Dict[str, Any]:
        """The analysis document: ``{"format": "cslope-analysis",
        "formatVersion": 1, "definition": {...}, "options": {...}}``."""
        return {
            "format": DOCUMENT_FORMAT,
            "formatVersion": DOCUMENT_FORMAT_VERSION,
            "definition": self.definition_dict(),
            "options": self.options.to_dict(),
        }

    def validate(self) -> List[Dict[str, Any]]:
        """The engine's issues with this document (``cslope.validate``):
        ``{"path", "code", "message", "severity"}`` dicts."""
        return _cslope.validate(self.to_dict())

    def save(self, path: PathLike) -> List[Dict[str, Any]]:
        """Validate the document and write it to ``path`` (UTF-8 JSON).
        Raises ``InvalidDefinition`` on errors (nothing is written); returns
        the warnings."""
        doc = self.to_dict()
        issues = _cslope.validate(doc)
        errors = [i for i in issues if i.get("severity", "error") == "error"]
        if errors:
            raise InvalidDefinition(errors)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(dumps(doc))
        return [i for i in issues if i.get("severity") == "warning"]

    @classmethod
    def load(cls, path: PathLike) -> "Definition":
        """A definition from an analysis document (or a bare definition) file."""
        with open(path, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))

    @classmethod
    def from_dict(cls, doc: Dict[str, Any]) -> "Definition":
        """A definition from an analysis document or a bare definition dict,
        checked call by call as if it were built here; materials of any model
        and keys the builder does not write are kept as they are."""
        definition, options = split_document(doc)
        d = cls(orientation=definition.get("orientation", "ltr"))
        if "coordinates" in definition:
            d.exterior = definition["coordinates"]
        for m in definition.get("materials", []):
            if any(x["name"] == m.get("name") for x in d._materials):
                raise ValueError("A material named {!r} exists already".format(m.get("name")))
            d._materials.append(copy.deepcopy(m))  # any material model, kept as it is
        for b in definition.get("materialBoundaries", []):
            d.add_interior_boundary(b["coordinates"])
        for a in definition.get("regionAssignments", []):
            d.assign(a["materialName"], at=a["point"])
        wt = definition.get("waterTable")
        if wt is not None:
            if wt.get("mode", "custom") != "custom":
                d._extra["waterTable"] = copy.deepcopy(wt)
            else:
                free = wt["freeWater"] if "freeWater" in wt else not wt.get("followBoundary", True)
                d.add_piezometric_line(wt["value"], free_water=bool(free))
        for u in definition.get("udls", []):
            d.add_distributed_load(x=(u["x1"], u["x2"]), q=u["magnitude"], direction=u.get("direction", "vertical"))
            if "excessPorePressure" in u:
                d._udls[-1]["excessPorePressure"] = copy.deepcopy(u["excessPorePressure"])
        for ll in definition.get("lineLoads", []):
            d.add_line_load(x=ll["x"], p=ll["magnitude"], angle=ll.get("angle", 0.0), y=ll.get("y"))
        lim = definition.get("analysisLimits")
        if lim is not None:
            d.search_limits(entry=(lim["entryLeftX"], lim["entryRightX"]), exit=(lim["exitLeftX"], lim["exitRightX"]))
        for k, v in definition.items():
            if k not in _BUILT_KEYS:
                d._extra[k] = copy.deepcopy(v)
        if options is not None:
            d.options = Options.from_dict(options)
        return d


# ── documents ───────────────────────────────────────────────────────────

_NUMBER_LIST = re.compile(r"\[\s*(-?[0-9][0-9.eE+-]*(?:,\s*-?[0-9][0-9.eE+-]*)*)\s*\]")


def dumps(doc: Dict[str, Any]) -> str:
    """A document as indented JSON, with each point on one line."""
    text = json.dumps(doc, ensure_ascii=False, indent=2)
    text = _NUMBER_LIST.sub(lambda m: "[" + ", ".join(v.strip() for v in m.group(1).split(",")) + "]", text)
    return text + "\n"



def split_document(doc: Dict[str, Any]) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """(definition, options) of an analysis document; a bare definition
    gives (definition, None)."""
    if not isinstance(doc, dict):
        raise TypeError("An analysis document must be a JSON object")
    if "format" in doc or "definition" in doc:
        if doc.get("format") != DOCUMENT_FORMAT:
            raise ValueError(
                "Not an analysis document: format is {!r}, not {!r}".format(doc.get("format"), DOCUMENT_FORMAT)
            )
        if doc.get("formatVersion") != DOCUMENT_FORMAT_VERSION:
            raise ValueError("Unsupported formatVersion {!r} (this version reads {})".format(
                doc.get("formatVersion"), DOCUMENT_FORMAT_VERSION))
        definition = doc.get("definition")
        if not isinstance(definition, dict):
            raise ValueError("The document has no definition")
        options = doc.get("options")
        if options is not None and not isinstance(options, dict):
            raise ValueError("The document's options must be an object")
        return definition, options
    return doc, None
