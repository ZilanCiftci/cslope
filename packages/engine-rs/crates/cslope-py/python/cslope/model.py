"""A model of a project, as objects: build it, change it, run it.

A ``Model`` is one model of a ``.cslp`` project, the app's model
(``model.json``) underneath, with the builder's names (``cslope.build``)
and the app's labels: Exterior, Interior boundaries, Materials, Assign,
Piezometric lines, Distributed loads, Line loads, Reinforcement, Search
limits, Custom surfaces, Options. Units: m, kPa, kN/m (line loads,
reinforcement), kN/m³ and degrees; points are ``(x, y)`` with x to the
right and y up, in the model's own direction (``orientation`` "ltr": the
slope slides to the right, "rtl": to the left).

    >>> import cslope
    >>> m = cslope.Model("Section A")                                # doctest: +SKIP
    >>> m.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
    >>> clay = m.add_material("Clay", c=5, phi=30, gamma=19, gamma_sat=20)
    >>> m.search_limits(entry=(5, 15), exit=(35, 45))
    >>> r = m.analyse()
    >>> r.fos, r.fos_label
    >>> clay.c = 8                     # the result is now out of date
    >>> m.result_is_current
    False

Each call checks what it can at once (a number is a number, a point lies
in the model, a material is known), and after each change the model is read
as the app reads it when it opens the project, so what the model holds is
what the app will show; a value the app would not keep is refused.
``model.data`` is the model's dict itself (the app's JSON shape), for what
has no method here (the title block, a waternet, an earlier stage, rapid
drawdown, parameters); ``model.definition`` is the analysis document the
model runs as (the engine's JSON, the agents' path).
"""

from __future__ import annotations

import copy
import json
import os
import warnings
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple, Union

from . import _native
from .build import (
    _ALL_OPTION_FIELDS,
    _OPTION_KEYS,
    InvalidDefinition,
    Options,
    _distance_to_segment,
    _inside,
    _material_model,
    _non_negative,
    _number,
    _phi,
    _point,
    _points,
    _positive,
    _range,
    _ON_EDGE,
    dumps,
    split_document,
)
from .result import Result

__all__ = [
    "Model",
    "Material",
    "InteriorBoundary",
    "PiezometricLine",
    "DistributedLoad",
    "LineLoad",
    "Reinforcement",
    "Pile",
    "CustomSurface",
    "BlockSearchObject",
]

Point = Tuple[float, float]
PathLike = Union[str, "os.PathLike[str]"]

# The app's colours for new materials and piezometric lines (store/defaults.ts).
_MATERIAL_COLORS = ("#d4a373", "#a8c686", "#b5838d", "#6d6875", "#e5989b", "#ffb4a2")
_PIEZO_COLORS = ("#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899")

# A model the app's reader takes, to fill a new model or row with the app's defaults.
_STUB_COORDINATES = [[0.0, 0.0], [10.0, 0.0], [0.0, 10.0]]
_STUB_MATERIAL = {"id": "stub", "name": "stub", "model": {"kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 0, "frictionAngle": 30}}


def _stub(**members: Any) -> Dict[str, Any]:
    return _native.normalize_model(
        dict({"id": "stub", "name": "stub", "coordinates": _STUB_COORDINATES, "materials": [_STUB_MATERIAL]}, **members)
    )


def _filled(key: str, row: Dict[str, Any]) -> Dict[str, Any]:
    """``row`` of the list ``key`` with the app's defaults for what it leaves out."""
    rows = _stub(**{key: [row]})[key]
    if not rows:
        raise ValueError("Not a valid {} entry: {!r}".format(key, row))
    return rows[0]


def _pts(points: Iterable[Point]) -> List[List[float]]:
    return [[float(x), float(y)] for x, y in points]


def _tuples(points: Any) -> List[Point]:
    return [(p[0], p[1]) for p in points or []]


def _expression_error(what: str, expression: Any) -> ValueError:
    return ValueError(
        "{} is set by the expression {!r} (the app's Parameters); change the parameter in the app, "
        "or remove the expression from model.data first.".format(what, expression)
    )


class _Item:
    """A row of one of the model's lists, read and changed in place."""

    _list = ""
    _what = ""

    def __init__(self, model: "Model", row_id: str):
        self._model = model
        self._id = row_id

    def _row(self) -> Dict[str, Any]:
        for r in self._model.data.get(self._list) or []:
            if r.get("id") == self._id:
                return r
        raise LookupError("This {} was removed from the model".format(self._what))

    def _expression(self, key: str) -> Any:
        return ((self._row().get("expressions") or {}).get(key)) or None

    def _set(self, key: str, value: Any, what: str) -> None:
        expr = self._expression(key)
        if expr:
            raise _expression_error("{}'s {}".format(self._what.capitalize(), what), expr)

        def apply(data: Dict[str, Any]) -> None:
            row = next(r for r in data[self._list] if r.get("id") == self._id)
            if value is None:
                row.pop(key, None)
            else:
                row[key] = value

        self._model._change(apply, lambda: self._row().get(key) == value, "{} {}".format(self._what, what), value)

    def remove(self) -> None:
        """Remove it from the model."""
        self._row()
        self._model._change(lambda d: d.__setitem__(self._list, [r for r in d[self._list] if r.get("id") != self._id]))

    def __eq__(self, other: object) -> bool:
        return type(other) is type(self) and other._model is self._model and other._id == self._id  # type: ignore[attr-defined]

    def __hash__(self) -> int:
        return hash((id(self._model), self._id))


def _field(key: str, what: str, check: Optional[Callable[[Any], Any]] = None, doc: str = "") -> Any:
    def get(self: _Item) -> Any:
        return copy.deepcopy(self._row().get(key))

    def set_(self: _Item, value: Any) -> None:
        self._set(key, check(value) if check is not None and value is not None else value, what)

    return property(get, set_, doc=doc)


def _choice(*allowed: str) -> Callable[[Any], str]:
    def check(v: Any) -> str:
        if v not in allowed:
            raise ValueError("must be one of {}, not {!r}".format(", ".join(map(repr, allowed)), v))
        return v

    return check


def _ends(self: _Item) -> Tuple[Point, Point]:
    r = self._row()
    return (r["x1"], r["y1"]), (r["x2"], r["y2"])


def _ends_property(which: int, doc: str) -> Any:
    def get(self: _Item) -> Point:
        return _ends(self)[which]

    def set_(self: _Item, p: Any) -> None:
        x, y = _point(p, "start" if which == 0 else "end")
        n = "1" if which == 0 else "2"

        def apply(data: Dict[str, Any]) -> None:
            row = next(r for r in data[self._list] if r.get("id") == self._id)
            row["x" + n], row["y" + n] = x, y

        self._model._change(apply)

    return property(get, set_, doc=doc)


# ── materials ───────────────────────────────────────────────────────────

# attribute -> key of the material model
_MATERIAL_FIELDS = {
    "gamma": "unitWeight",
    "gamma_sat": "unitWeightSat",
    "c": "cohesion",
    "phi": "frictionAngle",
    "su": "undrainedShearStrength",
}


class Material(_Item):
    """A material (Materials). ``c`` (kPa) and ``phi`` (°) of a drained
    material, ``su`` (kPa) of an undrained one, ``gamma`` and ``gamma_sat``
    (kN/m³) above and below the water; a property the material's model does
    not have reads None and cannot be set. ``model`` is the engine's
    material model dict (any kind: SHANSEP, Hoek-Brown, ...)."""

    _list = "materials"
    _what = "material"

    def __repr__(self) -> str:
        return "Material({!r}, {})".format(self.name, self.kind)

    @property
    def name(self) -> str:
        return str(self._row()["name"])

    @name.setter
    def name(self, value: str) -> None:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("A material needs a name")
        if value != self.name and self._model._material_named(value, required=False) is not None:
            raise ValueError("A material named {!r} exists already".format(value))
        self._set("name", value, "name")

    color = _field("color", "color", doc="The colour (#rrggbb).")
    depth_range = _field("depthRange", "depth range", lambda v: list(_range(v, "depth_range")),
                         doc="(top, bottom) depth range (m) where the material applies, or None.")

    @property
    def kind(self) -> str:
        return str(self._row()["model"]["kind"])

    @property
    def model(self) -> Dict[str, Any]:
        return copy.deepcopy(self._row()["model"])

    @model.setter
    def model(self, model: Dict[str, Any]) -> None:
        _check_material_model(model, self.name)
        exprs = self._row().get("modelExpressions") or {}
        if any(exprs.values()):
            raise _expression_error("Material {!r}'s model".format(self.name), next(v for v in exprs.values() if v))
        self._set("model", copy.deepcopy(model), "model")

    def _get(self, attr: str) -> Optional[float]:
        return self._row()["model"].get(_MATERIAL_FIELDS[attr])

    def _put(self, attr: str, value: Any) -> None:
        key = _MATERIAL_FIELDS[attr]
        row = self._row()
        if key not in row["model"] and attr != "gamma_sat":
            raise AttributeError("Material {!r} ({}) has no {}".format(self.name, self.kind, attr))
        expr = (row.get("modelExpressions") or {}).get(key)
        if expr:
            raise _expression_error("Material {!r}'s {}".format(self.name, attr), expr)
        if value is None:
            if attr != "gamma_sat":
                raise ValueError("{} cannot be None".format(attr))
        elif attr == "phi":
            value = _phi(value)
        elif attr == "c":
            value = _non_negative(value, attr)
        else:
            value = _positive(value, attr)
        model = dict(row["model"])
        if value is None:
            model.pop(key, None)
        else:
            model[key] = value
        _check_material_model(model, self.name)
        self._set("model", model, attr)

    gamma = property(lambda self: self._get("gamma"), lambda self, v: self._put("gamma", v), doc="Unit weight γ (kN/m³).")
    gamma_sat = property(lambda self: self._get("gamma_sat"), lambda self, v: self._put("gamma_sat", v),
                         doc="Saturated unit weight γsat (kN/m³), below the water; None: γ.")
    c = property(lambda self: self._get("c"), lambda self, v: self._put("c", v), doc="Cohesion c′ (kPa).")
    phi = property(lambda self: self._get("phi"), lambda self, v: self._put("phi", v), doc="Friction angle φ′ (°).")
    su = property(lambda self: self._get("su"), lambda self, v: self._put("su", v), doc="Undrained shear strength su (kPa).")

    def remove(self) -> None:
        """Remove the material, with its region assignments and its piezometric line assignment."""
        self._row()
        mid = self._id

        def apply(d: Dict[str, Any]) -> None:
            d["materials"] = [r for r in d["materials"] if r["id"] != mid]
            d["regionMaterials"] = [a for a in d.get("regionMaterials") or [] if a["materialId"] != mid]
            (d.get("piezometricLine") or {}).get("materialAssignment", {}).pop(mid, None)

        self._model._change(apply)


def _check_material_model(model: Any, name: str) -> None:
    if not isinstance(model, dict):
        raise TypeError("A material model is a dict (the engine's MaterialModel), not {!r}".format(model))
    problems = _native.validate_material_model(model)
    if problems:
        raise ValueError("Material {!r}: {}".format(name, "; ".join(problems)))


# ── geometry, water, loads, support, search ─────────────────────────────


class _Points(_Item):
    """A row with ``coordinates``."""

    @property
    def points(self) -> List[Point]:
        return _tuples(self._row()["coordinates"])

    def _expression(self, key: str) -> Any:
        if key == "coordinates":
            exprs = self._row().get("coordinateExpressions") or []
            return next((e.get("x") or e.get("y") for e in exprs if e.get("x") or e.get("y")), None)
        return super()._expression(key)


class InteriorBoundary(_Points):
    """An interior boundary (Interior boundaries): a line between
    materials that runs from the exterior (or another boundary) to the
    exterior (or another boundary)."""

    _list = "materialBoundaries"
    _what = "interior boundary"

    def __repr__(self) -> str:
        return "InteriorBoundary({!r})".format(self.points)

    @_Points.points.setter  # type: ignore[attr-defined]
    def points(self, points: Any) -> None:
        pts = self._model._boundary_points(points, skip=self._id)
        self._set("coordinates", pts, "points")


class PiezometricLine(_Points):
    """A piezometric line (Piezometric lines). The first is the main line,
    for the materials no line is assigned to; ``materials`` are the names of
    those that use this one."""

    _list = "lines"
    _what = "piezometric line"

    def __repr__(self) -> str:
        return "PiezometricLine({!r})".format(self.name)

    def _row(self) -> Dict[str, Any]:
        for r in self._model.data["piezometricLine"]["lines"]:
            if r.get("id") == self._id:
                return r
        raise LookupError("This piezometric line was removed from the model")

    def _set(self, key: str, value: Any, what: str) -> None:
        expr = self._expression(key)
        if expr:
            raise _expression_error("The piezometric line's {}".format(what), expr)

        def apply(data: Dict[str, Any]) -> None:
            row = next(r for r in data["piezometricLine"]["lines"] if r.get("id") == self._id)
            row[key] = value

        self._model._change(apply, lambda: self._row().get(key) == value, "piezometric line " + what, value)

    @_Points.points.setter  # type: ignore[attr-defined]
    def points(self, points: Any) -> None:
        self._set("coordinates", self._model._water_points(points), "points")

    name = _field("name", "name", doc="The line's name.")
    color = _field("color", "color", doc="The colour (#rrggbb).")

    @property
    def materials(self) -> List[str]:
        names = {m["id"]: m["name"] for m in self._model.data["materials"]}
        assigned = self._model.data["piezometricLine"].get("materialAssignment") or {}
        return [names[mid] for mid, lid in assigned.items() if lid == self._id and mid in names]

    @materials.setter
    def materials(self, materials: Sequence[Union[str, Material]]) -> None:
        ids = [self._model._material_id(m) for m in materials]

        def apply(d: Dict[str, Any]) -> None:
            assigned = d["piezometricLine"].setdefault("materialAssignment", {})
            for mid in [k for k, v in assigned.items() if v == self._id]:
                del assigned[mid]
            for mid in ids:
                assigned[mid] = self._id

        self._model._change(apply)

    def remove(self) -> None:
        """Remove the line (and its material assignments)."""
        self._row()

        def apply(d: Dict[str, Any]) -> None:
            p = d["piezometricLine"]
            p["lines"] = [r for r in p["lines"] if r["id"] != self._id]
            assigned = p.get("materialAssignment") or {}
            for mid in [k for k, v in assigned.items() if v == self._id]:
                del assigned[mid]
            for k in ("activeLineId", "mainLineId"):
                if p.get(k) == self._id:
                    p[k] = p["lines"][0]["id"] if p["lines"] else None
            if not p["lines"]:
                p["enabled"] = False

        self._model._change(apply)


class DistributedLoad(_Item):
    """A distributed load (Distributed loads): ``q`` (kPa) on the ground
    from ``x`` = (x1, x2) (m), ``direction`` "vertical" or "normal";
    ``excess_pore_pressure`` maps material names to the ratio Δu/q."""

    _list = "udls"
    _what = "distributed load"

    def __repr__(self) -> str:
        return "DistributedLoad(x={!r}, q={!r})".format(self.x, self.q)

    @property
    def x(self) -> Tuple[float, float]:
        r = self._row()
        return (r["x1"], r["x2"])

    @x.setter
    def x(self, x: Any) -> None:
        x1, x2 = self._model._load_range(x)
        for key, v in (("x1", x1), ("x2", x2)):
            if self._expression(key):
                raise _expression_error("The distributed load's " + key, self._expression(key))

        def apply(d: Dict[str, Any]) -> None:
            row = next(r for r in d["udls"] if r["id"] == self._id)
            row["x1"], row["x2"] = x1, x2

        self._model._change(apply)

    q = _field("magnitude", "q", lambda v: _positive(v, "q"), doc="The load (kPa).")

    @property
    def direction(self) -> str:
        return str(self._row().get("direction") or "vertical")

    @direction.setter
    def direction(self, value: str) -> None:
        _choice("vertical", "normal")(value)
        self._set("direction", None if value == "vertical" else value, "direction")

    @property
    def excess_pore_pressure(self) -> Dict[str, float]:
        names = {m["id"]: m["name"] for m in self._model.data["materials"]}
        return {names[e["materialId"]]: e["ratio"] for e in self._row().get("excessPorePressure") or [] if e["materialId"] in names}

    @excess_pore_pressure.setter
    def excess_pore_pressure(self, ratios: Optional[Dict[Any, float]]) -> None:
        self._set("excessPorePressure", self._model._excess(ratios), "excess pore pressure")


class LineLoad(_Item):
    """A line load (Line loads): ``p`` (kN/m) at ``x`` (m), ``angle`` from
    the downward vertical (°, positive towards +x), ``y`` the load point's
    elevation on a wall face (None: on the ground)."""

    _list = "lineLoads"
    _what = "line load"

    def __repr__(self) -> str:
        return "LineLoad(x={!r}, p={!r})".format(self.x, self.p)

    x = _field("x", "x", lambda v: _number(v, "x"), doc="Where the load acts (m).")
    p = _field("magnitude", "p", lambda v: _positive(v, "p"), doc="The load (kN/m).")

    @property
    def angle(self) -> float:
        return float(self._row().get("angle") or 0.0)

    @angle.setter
    def angle(self, value: float) -> None:
        self._set("angle", _angle(value) or None, "angle")

    y = _field("y", "y", lambda v: _number(v, "y"), doc="The load point's elevation (m), or None: on the ground.")


def _angle(v: Any) -> float:
    a = _number(v, "angle")
    if abs(a) > 90:
        raise ValueError("angle must be from -90 to 90°, not {!r}".format(v))
    return a


# reinforcement: attribute -> row key (the app's ReinforcementRow)
_REINFORCEMENT_FIELDS = {
    "label": "label",
    "tensile_capacity": "tensileCapacity",
    "spacing": "spacing",
    "pullout": "pullout",
    "bond_strength": "bondStrength",
    "bonded_length": "bondedLength",
    "prestress": "prestress",
    "adhesion": "adhesion",
    "interface_friction": "interfaceFriction",
    "development_length1": "developmentLength1",
    "development_length2": "developmentLength2",
    "end1_capacity": "end1Capacity",
    "end2_capacity": "end2Capacity",
    "direction": "direction",
    "application": "application",
}
_PILE_FIELDS = {
    "label": "label",
    "mode": "mode",
    "force": "force",
    "diameter": "diameter",
    "spacing": "spacing",
    "shear_capacity": "shearCapacity",
    "moment_capacity": "momentCapacity",
    "bending_stiffness": "bendingStiffness",
    "angle": "angle",
    "direction": "direction",
    "application": "application",
    "location": "location",
}


def _row_fields(cls: type, fields: Dict[str, str]) -> None:
    for attr, key in fields.items():
        setattr(cls, attr, _field(key, attr.replace("_", " ")))


class Reinforcement(_Item):
    """A reinforcement element (Reinforcement): from ``start`` (the head,
    at the face) to ``end``, ``kind`` "anchor", "tieback", "nail" or
    "geosynthetic"; the other properties are the app's fields
    (``tensile_capacity`` kN, ``spacing`` m, ``pullout`` "none", "bond",
    "interface" or "development", ``bond_strength`` kN/m, ``bonded_length``
    m, ``prestress`` kN, ``adhesion`` kPa, ``interface_friction`` °,
    ``development_length1`` and ``2`` m, ``end1_capacity`` and
    ``end2_capacity`` kN, ``direction`` "axial", "tangent" or "bisector",
    ``application`` "active" or "passive", ``label``)."""

    _list = "reinforcements"
    _what = "reinforcement"

    def __repr__(self) -> str:
        return "Reinforcement({!r}, start={!r}, end={!r})".format(self.kind, self.start, self.end)

    kind = _field("type", "kind", _choice("anchor", "tieback", "nail", "geosynthetic"))
    start = _ends_property(0, "The head (x, y), at the face (m).")
    end = _ends_property(1, "The far end (x, y) (m).")


class Pile(_Item):
    """A pile row or sheet pile wall (Reinforcement › Piles): from
    ``start`` (top) to ``end``, ``kind`` "pile" or "sheet-pile"; the other
    properties are the app's fields (``mode`` "force" or "ito-matsui",
    ``force`` kN/m, ``diameter`` m, ``spacing`` m, ``shear_capacity`` kN,
    ``moment_capacity`` kNm, ``bending_stiffness`` kNm², ``angle`` °,
    ``direction`` "tangent", "perpendicular" or "angle", ``application``
    "active" or "passive", ``location`` "centroid" or "slip-surface",
    ``label``)."""

    _list = "piles"
    _what = "pile"

    def __repr__(self) -> str:
        return "Pile({!r}, start={!r}, end={!r})".format(self.kind, self.start, self.end)

    kind = _field("type", "kind", _choice("pile", "sheet-pile"))
    start = _ends_property(0, "The top (x, y) (m).")
    end = _ends_property(1, "The toe (x, y) (m).")


_row_fields(Reinforcement, _REINFORCEMENT_FIELDS)
_row_fields(Pile, _PILE_FIELDS)


class CustomSurface(_Item):
    """A custom slip surface (Custom surfaces): a circle (``center``,
    ``radius``) or a polyline (``points``)."""

    _list = "customSearchPlanes"
    _what = "custom surface"

    def __repr__(self) -> str:
        if self.points is not None:
            return "CustomSurface(points={!r})".format(self.points)
        return "CustomSurface(center={!r}, radius={!r})".format(self.center, self.radius)

    @property
    def center(self) -> Optional[Point]:
        r = self._row()
        return None if r.get("points") is not None else (r["cx"], r["cy"])

    @property
    def radius(self) -> Optional[float]:
        r = self._row()
        return None if r.get("points") is not None else r["radius"]

    @property
    def points(self) -> Optional[List[Point]]:
        pts = self._row().get("points")
        return None if pts is None else _tuples(pts)


class BlockSearchObject(_Item):
    """A block search object: the polyline (``points``) along which a block
    search places its base."""

    _list = "blockSearchObjects"
    _what = "block search object"

    def __repr__(self) -> str:
        return "BlockSearchObject({!r})".format(self.points)

    @property
    def points(self) -> List[Point]:
        return _tuples(self._row()["points"])

    @points.setter
    def points(self, points: Any) -> None:
        self._set("points", _pts(_points(points, "block search object", 1)), "points")


# ── the model ───────────────────────────────────────────────────────────


class Model:
    """One model: the exterior, materials, water, loads, support, search and
    options, its result and its run (see the module's docs).

    ``Model(name, orientation="ltr")`` is a new, empty model (add it to a
    project with ``Project.add_model``); ``Model.from_definition(doc)``
    reads an analysis document. A model of an opened project comes from
    ``project.models`` or ``project.model(name)``.
    """

    def __init__(self, name: str = "Model 1", orientation: str = "ltr"):
        _check_orientation(orientation)
        data = _stub(id="model-1", name=_check_name(name), orientation=orientation)
        data["coordinates"] = []
        data["materials"] = []
        self.data: Dict[str, Any] = data
        self._saved: Optional[Dict[str, Any]] = None
        self.backgrounds: List[Dict[str, Any]] = []
        self._result: Optional[Result] = None

    @classmethod
    def _of(cls, data: Dict[str, Any], saved: Optional[Dict[str, Any]], backgrounds: List[Dict[str, Any]]) -> "Model":
        m = cls.__new__(cls)
        m.data = data
        m._saved = saved
        m.backgrounds = backgrounds
        m._result = None
        return m

    def __repr__(self) -> str:
        return "Model({!r})".format(self.name)

    # ── the model as the app reads it ──

    def _ready(self) -> bool:
        return len(self.data.get("coordinates") or []) >= 3 and bool(self.data.get("materials"))

    def _need_ready(self, what: str) -> None:
        if len(self.data.get("coordinates") or []) < 3:
            raise ValueError("Model {!r} has no exterior; set it before {}".format(self.name, what))
        if not self.data.get("materials"):
            raise ValueError("Model {!r} has no materials; add one before {}".format(self.name, what))

    def _change(
        self,
        apply: Callable[[Dict[str, Any]], None],
        kept: Optional[Callable[[], bool]] = None,
        what: str = "",
        value: Any = None,
    ) -> None:
        """Apply a change to the model's dict, then read it as the app does
        (when it can be read: an exterior and a material); ``kept`` says
        whether the app kept the value, else the change is undone."""
        before = copy.deepcopy(self.data)
        work = copy.deepcopy(self.data)
        apply(work)
        new = _native.normalize_model(work) if len(work.get("coordinates") or []) >= 3 and work.get("materials") else work
        self.data.clear()
        self.data.update(new)
        if kept is not None and self._ready() and not kept():
            self.data.clear()
            self.data.update(before)
            raise ValueError("{} = {!r} is not a value the app keeps".format(what, value))

    # ── identity ──

    @property
    def id(self) -> str:
        return str(self.data.get("id", ""))

    @property
    def name(self) -> str:
        return str(self.data.get("name", ""))

    @name.setter
    def name(self, value: str) -> None:
        name = _check_name(value)
        self._change(lambda d: d.__setitem__("name", name))

    @property
    def orientation(self) -> str:
        """"ltr" (the slope slides to the right) or "rtl" (to the left).
        Setting it does not move any point."""
        return str(self.data.get("orientation", "ltr"))

    @orientation.setter
    def orientation(self, value: str) -> None:
        _check_orientation(value)
        self._change(lambda d: d.__setitem__("orientation", value))

    # ── geometry ──

    @property
    def exterior(self) -> List[Point]:
        """The outline of the model (Exterior): a closed polygon of (x, y)
        points (m)."""
        return _tuples(self.data.get("coordinates"))

    @exterior.setter
    def exterior(self, points: Any) -> None:
        exprs = self.data.get("coordinateExpressions") or []
        expr = next((e.get("x") or e.get("y") for e in exprs if e.get("x") or e.get("y")), None)
        if expr:
            raise _expression_error("The exterior", expr)
        pts = _points(points, "exterior", 3)
        ring = pts[:-1] if len(pts) > 3 and pts[0] == pts[-1] else pts
        if _area(ring) == 0:
            raise ValueError("exterior encloses no area")
        self._change(lambda d: d.__setitem__("coordinates", _pts(pts)))

    def _need_exterior(self, what: str) -> List[Point]:
        ext = self.exterior
        if len(ext) < 3:
            raise ValueError("Set the exterior before {}".format(what))
        return ext

    def _tolerance(self) -> float:
        ext = self._need_exterior("this")
        xs, ys = [p[0] for p in ext], [p[1] for p in ext]
        return _ON_EDGE * max(max(xs) - min(xs), max(ys) - min(ys), 1.0)

    def _within_x(self, x: float, what: str) -> None:
        xs = [p[0] for p in self._need_exterior("this")]
        lo, hi, tol = min(xs), max(xs), self._tolerance()
        if x < lo - tol or x > hi + tol:
            raise ValueError("{} x = {} is outside the model (x from {} to {})".format(what, x, lo, hi))

    def _on_or_outside(self, p: Point) -> bool:
        ext = self._need_exterior("this")
        tol = self._tolerance()
        on_edge = any(_distance_to_segment(p, a, b) <= tol for a, b in zip(ext, ext[1:] + ext[:1]))
        return on_edge or not _inside(p, ext)

    def _boundary_points(self, points: Any, skip: Optional[str] = None) -> List[List[float]]:
        pts = _points(points, "interior boundary", 2)
        self._need_exterior("adding an interior boundary")
        tol = self._tolerance()
        others = [_tuples(b["coordinates"]) for b in self.data["materialBoundaries"] if b["id"] != skip]

        def on_other(p: Point) -> bool:
            return any(_distance_to_segment(p, a, b) <= tol for o in others for a, b in zip(o, o[1:]))

        for end, p in (("start", pts[0]), ("end", pts[-1])):
            if not (self._on_or_outside(p) or on_other(p)):
                raise ValueError(
                    "The interior boundary's {} ({}, {}) is inside the model; "
                    "extend it to the exterior or to another boundary.".format(end, p[0], p[1])
                )
        return _pts(pts)

    def add_interior_boundary(self, points: Any) -> InteriorBoundary:
        """A line between materials (Interior boundaries). Both ends lie on
        the exterior (or beyond it) or on an earlier boundary, never loose
        inside the model."""
        pts = self._boundary_points(points)
        row_id = self._new_id("bnd", self.data["materialBoundaries"])
        self._change(lambda d: d["materialBoundaries"].append({"id": row_id, "coordinates": pts}))
        return InteriorBoundary(self, row_id)

    @property
    def interior_boundaries(self) -> List[InteriorBoundary]:
        return [InteriorBoundary(self, b["id"]) for b in self.data["materialBoundaries"]]

    # ── materials ──

    def add_material(
        self,
        name: str,
        *,
        gamma: Optional[float] = None,
        c: Optional[float] = None,
        phi: Optional[float] = None,
        su: Optional[float] = None,
        gamma_sat: Optional[float] = None,
        model: Optional[Dict[str, Any]] = None,
        color: Optional[str] = None,
        depth_range: Optional[Tuple[float, float]] = None,
    ) -> Material:
        """A material (Materials) with drained strength (``c`` kPa, ``phi``
        °) or undrained strength (``su`` kPa); ``gamma`` and ``gamma_sat``
        are the unit weights above and below the water (kN/m³). Give
        ``gamma_sat`` whenever the material can be below a piezometric line.
        Any other kind: ``model``, the engine's material model dict (then
        none of the strengths). ``color`` defaults to the app's next colour."""
        if not isinstance(name, str) or not name.strip():
            raise ValueError("A material needs a name")
        if self._material_named(name, required=False) is not None:
            raise ValueError("A material named {!r} exists already".format(name))
        if model is not None:
            if any(v is not None for v in (gamma, c, phi, su, gamma_sat)):
                raise ValueError("Give either model or the strengths and unit weights for {!r}, not both".format(name))
            _check_material_model(model, name)
            model = copy.deepcopy(model)
        else:
            if gamma is None:
                raise ValueError("{!r} needs gamma (the unit weight, kN/m³)".format(name))
            model = _material_model(name, gamma, c, phi, su, gamma_sat)
        materials = self.data["materials"]
        row: Dict[str, Any] = {
            "id": self._new_id("mat", materials),
            "name": name,
            "color": color if color is not None else _MATERIAL_COLORS[len(materials) % len(_MATERIAL_COLORS)],
            "model": model,
        }
        if depth_range is not None:
            row["depthRange"] = list(_range(depth_range, "depth_range"))
        self._change(lambda d: d["materials"].append(row))
        return Material(self, row["id"])

    @property
    def materials(self) -> List[Material]:
        return [Material(self, m["id"]) for m in self.data["materials"]]

    def material(self, name: str) -> Material:
        """The material of this name."""
        m = self._material_named(name, required=True)
        assert m is not None
        return m

    def _material_named(self, name: str, required: bool) -> Optional[Material]:
        found = [m for m in self.data["materials"] if m["name"] == name]
        if len(found) > 1:
            raise LookupError("{} materials are named {!r}".format(len(found), name))
        if not found:
            if required:
                names = ", ".join(repr(m["name"]) for m in self.data["materials"]) or "none yet"
                raise LookupError("No material named {!r} (materials: {})".format(name, names))
            return None
        return Material(self, found[0]["id"])

    def _material_id(self, material: Union[str, Material]) -> str:
        if isinstance(material, Material):
            if material._model is not self:
                raise ValueError("{!r} is a material of another model".format(material))
            return material._row()["id"]
        return self.material(material)._id

    def assign(self, material: Union[str, Material], at: Any) -> None:
        """Give the region that holds the point ``at`` = (x, y) this material
        (Assign); an earlier assignment of that region is replaced. Assign
        every region of the model."""
        mid = self._material_id(material)
        p = _point(at, "at")
        if self._on_or_outside(p):
            raise ValueError("The point ({}, {}) is not inside the exterior".format(p[0], p[1]))
        definition = _native.model_to_definition(self.data) if self._ready() else None

        def region(q: Any) -> Optional[int]:
            return None if definition is None else _native.region_index(definition, [q[0], q[1]])

        target = region(p)

        def apply(d: Dict[str, Any]) -> None:
            kept = [a for a in d["regionMaterials"] if target is None or region(a["point"]) != target]
            d["regionMaterials"] = kept + [{"point": [p[0], p[1]], "materialId": mid}]

        self._change(apply)

    @property
    def assignments(self) -> List[Tuple[Point, str]]:
        """The region assignments: (point, material name)."""
        names = {m["id"]: m["name"] for m in self.data["materials"]}
        return [((a["point"][0], a["point"][1]), names.get(a["materialId"], "")) for a in self.data["regionMaterials"]]

    # ── water ──

    def _water_points(self, points: Any) -> List[List[float]]:
        pts = _points(points, "piezometric line", 2)
        for (x1, _), (x2, _) in zip(pts, pts[1:]):
            if x2 < x1:
                raise ValueError("The piezometric line must run from left to right (x goes back at {})".format(x2))
        for i, (x, _) in enumerate(pts):
            self._within_x(x, "Piezometric line point {}".format(i + 1))
        return _pts(pts)

    def add_piezometric_line(
        self,
        points: Any,
        *,
        name: Optional[str] = None,
        materials: Optional[Sequence[Union[str, Material]]] = None,
        free_water: bool = True,
    ) -> PiezometricLine:
        """A piezometric line (m), from left to right across the model
        (Piezometric lines). The first is the main line, for every material
        no line is assigned to; ``materials`` are the materials that use this
        one. With ``free_water`` (the default) water above the ground acts
        on it, as in a lake or a ditch; without, the line is cut at the
        ground. It holds for every line of the model."""
        if not isinstance(free_water, bool):
            raise TypeError("free_water must be True or False")
        pts = self._water_points(points)
        piezo = self.data["piezometricLine"]
        lines = piezo["lines"]
        if lines and piezo.get("freeWater", True) != free_water:
            raise ValueError(
                "free_water holds for every line of a model; this model's lines have free_water={}".format(piezo.get("freeWater", True))
            )
        ids = [self._material_id(m) for m in materials or []]
        row = {
            "id": self._new_id("piezo", lines),
            "name": name if name is not None else "Line {}".format(len(lines) + 1),
            "color": _PIEZO_COLORS[len(lines) % len(_PIEZO_COLORS)],
            "coordinates": pts,
        }

        def apply(d: Dict[str, Any]) -> None:
            p = d["piezometricLine"]
            p["lines"].append(row)
            p["enabled"] = True
            p["freeWater"] = free_water
            if not p.get("activeLineId"):
                p["activeLineId"] = row["id"]
            if not p.get("mainLineId"):
                p["mainLineId"] = p["lines"][0]["id"]
            assigned = p.setdefault("materialAssignment", {})
            for mid in ids:
                assigned[mid] = row["id"]

        self._change(apply)
        return PiezometricLine(self, str(row["id"]))

    @property
    def piezometric_lines(self) -> List[PiezometricLine]:
        return [PiezometricLine(self, r["id"]) for r in self.data["piezometricLine"]["lines"]]

    # ── loads ──

    def _load_range(self, x: Any) -> Tuple[float, float]:
        x1, x2 = _range(x, "x")
        if x1 == x2:
            raise ValueError("A distributed load needs x1 < x2")
        self._within_x(x1, "Distributed load x1")
        self._within_x(x2, "Distributed load x2")
        return x1, x2

    def _excess(self, ratios: Optional[Dict[Any, float]]) -> Optional[List[Dict[str, Any]]]:
        if not ratios:
            return None
        return [{"materialId": self._material_id(m), "ratio": _non_negative(r, "excess pore pressure ratio")} for m, r in ratios.items()]

    def add_distributed_load(
        self,
        x: Any,
        q: float,
        direction: str = "vertical",
        *,
        excess_pore_pressure: Optional[Dict[Any, float]] = None,
    ) -> DistributedLoad:
        """A distributed load ``q`` (kPa) on the ground from x = (x1, x2) (m)
        (Distributed loads); ``direction`` "vertical" (per horizontal meter)
        or "normal" (normal to the ground); ``excess_pore_pressure`` maps
        materials to the excess pore pressure the load causes in them, as a
        ratio of q."""
        x1, x2 = self._load_range(x)
        _choice("vertical", "normal")(direction)
        row: Dict[str, Any] = {"id": self._new_id("udl", self.data["udls"]), "magnitude": _positive(q, "q"), "x1": x1, "x2": x2}
        if direction != "vertical":
            row["direction"] = direction
        excess = self._excess(excess_pore_pressure)
        if excess:
            row["excessPorePressure"] = excess
        self._change(lambda d: d["udls"].append(row))
        return DistributedLoad(self, row["id"])

    @property
    def distributed_loads(self) -> List[DistributedLoad]:
        return [DistributedLoad(self, r["id"]) for r in self.data["udls"]]

    def add_line_load(self, x: float, p: float, angle: float = 0.0, y: Optional[float] = None) -> LineLoad:
        """A line load ``p`` (kN/m) at ``x`` (m) (Line loads); ``angle`` from
        the downward vertical (°, positive towards +x); ``y`` the elevation
        of the load point for a load on a wall face (default: on the ground
        at x)."""
        xv = _number(x, "x")
        self._within_x(xv, "Line load")
        a = _angle(angle)
        row: Dict[str, Any] = {"id": self._new_id("ll", self.data["lineLoads"]), "magnitude": _positive(p, "p"), "x": xv}
        if a != 0:
            row["angle"] = a
        if y is not None:
            row["y"] = _number(y, "y")
        self._change(lambda d: d["lineLoads"].append(row))
        return LineLoad(self, row["id"])

    @property
    def line_loads(self) -> List[LineLoad]:
        return [LineLoad(self, r["id"]) for r in self.data["lineLoads"]]

    # ── support ──

    def _support(self, key: str, prefix: str, fields: Dict[str, str], kind: str, start: Any, end: Any, values: Dict[str, Any]) -> str:
        unknown = sorted(set(values) - set(fields))
        if unknown:
            raise TypeError("Unknown {} field(s): {} (the fields: {})".format(prefix, ", ".join(unknown), ", ".join(fields)))
        x1, y1 = _point(start, "start")
        x2, y2 = _point(end, "end")
        rows = self.data.setdefault(key, []) or []
        row: Dict[str, Any] = {"id": self._new_id(prefix, rows), "type": kind, "x1": x1, "y1": y1, "x2": x2, "y2": y2}
        for attr, v in values.items():
            if v is not None:
                row[fields[attr]] = v
        filled = _filled(key, row)
        for attr, v in values.items():
            if v is not None and filled.get(fields[attr]) != v:
                raise ValueError("{} = {!r} is not a value the app keeps".format(attr, v))

        def apply(d: Dict[str, Any]) -> None:
            d[key] = list(d.get(key) or []) + [filled]

        self._change(apply)
        return str(filled["id"])

    def add_reinforcement(self, start: Any, end: Any, kind: str = "anchor", **fields: Any) -> Reinforcement:
        """A reinforcement element from ``start`` (the head, at the face) to
        ``end`` (Reinforcement), ``kind`` "anchor", "tieback", "nail" or
        "geosynthetic"; the fields not given are the app's for the kind
        (see ``Reinforcement``)."""
        _choice("anchor", "tieback", "nail", "geosynthetic")(kind)
        return Reinforcement(self, self._support("reinforcements", "reinf", _REINFORCEMENT_FIELDS, kind, start, end, fields))

    @property
    def reinforcements(self) -> List[Reinforcement]:
        return [Reinforcement(self, r["id"]) for r in self.data.get("reinforcements") or []]

    def add_pile(self, start: Any, end: Any, kind: str = "pile", **fields: Any) -> Pile:
        """A pile row or sheet pile wall from ``start`` (top) to ``end``,
        ``kind`` "pile" or "sheet-pile"; the fields not given are the app's
        (see ``Pile``)."""
        _choice("pile", "sheet-pile")(kind)
        return Pile(self, self._support("piles", "pile", _PILE_FIELDS, kind, start, end, fields))

    @property
    def piles(self) -> List[Pile]:
        return [Pile(self, r["id"]) for r in self.data.get("piles") or []]

    # ── search ──

    def search_limits(self, entry: Any = None, exit: Any = None) -> None:
        """Where slip surfaces may enter and exit the ground (Search limits):
        entry = (x1, x2) and exit = (x1, x2), in m. ``search_limits(None)``
        turns the limits off (the whole slope is searched)."""
        if entry is None and exit is None:
            self._change(lambda d: d["analysisLimits"].__setitem__("enabled", False))
            return
        e = _range(entry, "entry")
        x = _range(exit, "exit")
        for what, v in (("Entry x1", e[0]), ("Entry x2", e[1]), ("Exit x1", x[0]), ("Exit x2", x[1])):
            self._within_x(v, what)
        limits = {"enabled": True, "entryLeftX": e[0], "entryRightX": e[1], "exitLeftX": x[0], "exitRightX": x[1]}
        self._change(lambda d: d.__setitem__("analysisLimits", limits))

    def add_custom_surface(self, center: Any = None, radius: Optional[float] = None, *, points: Any = None) -> CustomSurface:
        """A custom slip surface (Custom surfaces), analysed with the
        search: a circle (``center`` (x, y), ``radius``, m) or a polyline
        (``points``)."""
        planes = self.data["customSearchPlanes"]
        row_id = self._new_id("csp", planes)
        if points is not None:
            if center is not None or radius is not None:
                raise ValueError("A custom surface is a circle (center, radius) or a polyline (points), not both")
            row: Dict[str, Any] = {"id": row_id, "cx": 0, "cy": 0, "radius": 0, "points": _pts(_points(points, "custom surface", 2))}
        else:
            if center is None or radius is None:
                raise ValueError("A circular custom surface needs center and radius")
            cx, cy = _point(center, "center")
            row = {"id": row_id, "cx": cx, "cy": cy, "radius": _positive(radius, "radius")}
        self._change(lambda d: d["customSearchPlanes"].append(row))
        return CustomSurface(self, row_id)

    @property
    def custom_surfaces(self) -> List[CustomSurface]:
        return [CustomSurface(self, r["id"]) for r in self.data["customSearchPlanes"]]

    @property
    def custom_surfaces_only(self) -> bool:
        """Analyse the custom surfaces only, without a search."""
        return bool(self.data.get("customPlanesOnly"))

    @custom_surfaces_only.setter
    def custom_surfaces_only(self, value: bool) -> None:
        if not isinstance(value, bool):
            raise TypeError("custom_surfaces_only must be True or False")
        self._change(lambda d: d.__setitem__("customPlanesOnly", value))

    def add_block_search_object(self, points: Any) -> BlockSearchObject:
        """A polyline (m) along which a block search
        (``options.search_method = "block"``) places the block's base."""
        rows = self.data.get("blockSearchObjects") or []
        row = {"id": self._new_id("bso", rows), "points": _pts(_points(points, "block search object", 1))}
        self._change(lambda d: d.__setitem__("blockSearchObjects", list(d.get("blockSearchObjects") or []) + [row]))
        return BlockSearchObject(self, str(row["id"]))

    @property
    def block_search_objects(self) -> List[BlockSearchObject]:
        return [BlockSearchObject(self, r["id"]) for r in self.data.get("blockSearchObjects") or []]

    # ── options ──

    @property
    def options(self) -> Options:
        """The analysis options (Options), read and changed in place: the
        same attributes as ``cslope.build.Options``."""

        def changed(key: str, value: Any) -> None:
            def apply(d: Dict[str, Any]) -> None:
                if value is None:
                    d["options"].pop(key, None)
                else:
                    d["options"][key] = value

            self._change(apply, lambda: _same_option(self.data["options"], key, value), "options." + _OPTION_KEYS[key], value)

        return Options._over(lambda: self.data["options"], changed)

    # ── run and result ──

    @property
    def definition(self) -> Dict[str, Any]:
        """The analysis document the model runs as (``{"format":
        "cslope-analysis", "formatVersion": 1, "definition", "options"}``,
        the engine's JSON), as ``cslope export`` writes it: the app's
        definition in the model's own direction, each region's material
        stated, and the complete options."""
        self._need_ready("its definition")
        from .cli import export_document

        return export_document(self.data)

    def save_definition(self, path: PathLike) -> List[Dict[str, Any]]:
        """Validate ``definition`` and write it to ``path`` (UTF-8 JSON),
        for ``cslope analyse`` or an agent. Raises ``InvalidDefinition`` on
        errors (nothing is written); returns the warnings."""
        import cslope

        doc = self.definition
        issues = cslope.validate(doc)
        errors = [i for i in issues if i.get("severity", "error") == "error"]
        if errors:
            raise InvalidDefinition(errors)
        with open(path, "w", encoding="utf-8", newline="\n") as f:  # noqa: A001
            f.write(dumps(doc))
        return [i for i in issues if i.get("severity") == "warning"]

    @classmethod
    def from_definition(cls, doc: Union[Dict[str, Any], PathLike], name: str = "Model 1") -> "Model":
        """A model from an analysis document or a bare definition (a dict
        or a file), as the app imports one (File › Import › Analysis
        document)."""
        if not isinstance(doc, dict):
            with open(doc, encoding="utf-8") as f:  # noqa: A001
                doc = json.load(f)
        definition, options = split_document(doc)
        data = _native.definition_to_model(definition, id="model-1", name=_check_name(name), options=options)
        return cls._of(_native.normalize_model(data), None, [])

    def analyse(
        self,
        *,
        threads: Optional[int] = None,
        progress: Optional[Callable[[dict], Any]] = None,
        cancel: Any = None,
    ) -> Result:
        """Run the model as the app runs it and keep the result on it (saved
        with the project). ``threads``: the threads that evaluate the trial
        surfaces (None: every core; the result does not depend on it);
        ``progress`` is called with an event dict after each batch of
        surfaces and may return False to cancel; ``cancel`` a
        ``cslope.CancelToken``. Raises ``InvalidDefinition`` for a model the
        engine would not run and ``cslope.EngineError`` when the analysis
        fails (the model keeps no result then)."""
        import cslope

        doc = self.definition
        errors = [i for i in cslope.validate(doc) if i.get("severity", "error") == "error"]
        if errors:
            raise InvalidDefinition(errors)
        data = cslope.analyse(doc, threads=threads, progress=progress, cancel=cancel)
        if (doc["options"].get("fem") or {}).get("enabled") is True:
            warnings.warn(
                "Model {!r}: its finite element analysis runs in the app only; the limit equilibrium "
                "result is not kept on the model.".format(self.name),
                stacklevel=2,
            )
            return Result(data, doc["options"], model_name=self.name, current=lambda: False)
        self.set_result(data)
        result = self.result
        assert result is not None
        result._options = doc["options"]
        return result

    @property
    def result(self) -> Optional[Result]:
        """The model's result: the one of its last run, or the one saved in
        the project (read without a re-run); None without one. It may be
        out of date (``result_is_current``)."""
        saved = self._saved
        if not saved or saved.get("runState") != "done" or not isinstance(saved.get("result"), dict):
            return None
        if self._result is None or self._result.saved is not saved:
            self._result = Result(
                saved["result"],
                self.data.get("options"),
                model_name=self.name,
                saved=saved,
                current=lambda: self._saved is saved and self.result_is_current,
            )
        return self._result

    @property
    def error(self) -> Optional[str]:
        """The message of the model's last run when it failed, else None."""
        saved = self._saved
        return str(saved.get("errorMessage")) if saved and saved.get("runState") == "error" else None

    @property
    def min_fos(self) -> Optional[float]:
        """``result.fos``, or None (kept for earlier code)."""
        r = self.result
        return r.fos if r is not None else None

    @property
    def input_hash(self) -> str:
        """The hash of the model's analysis input as it is now (docs/file-format.md section 5)."""
        self._need_ready("its input hash")
        return _native.input_hash_of(self.data)

    @property
    def result_is_current(self) -> bool:
        """Whether there is a saved result and it was computed for the model's input as it is now.
        A result that is not is dropped when the project is saved."""
        return bool(self._saved) and self._ready() and self._saved.get("inputHash") == self.input_hash  # type: ignore[union-attr]

    def set_result(self, result: Dict[str, Any]) -> None:
        """Keep the result of a run of the model as it is now (an ``AnalysisResult`` in
        the model's coordinates, as ``cslope.analyse`` gives it), with its input hash."""
        self._need_ready("keeping a result")
        self._saved = _native.saved_result(self.data, result=result)

    def set_error(self, message: str) -> None:
        """Keep a failed run of the model as it is now."""
        self._need_ready("keeping a result")
        self._saved = _native.saved_result(self.data, error=message)

    # ── ids ──

    @staticmethod
    def _new_id(prefix: str, rows: List[Dict[str, Any]]) -> str:
        # zero-padded, so that the app's order by id (interior boundaries) is the order added
        used = {r.get("id") for r in rows}
        n = len(rows) + 1
        while "{}-{:03d}".format(prefix, n) in used:
            n += 1
        return "{}-{:03d}".format(prefix, n)


def _same_option(options: Dict[str, Any], key: str, value: Any) -> bool:
    if value is None:
        return key not in options
    if key not in options:
        # the app leaves out an option at its default (both directions off, a circular search, ...)
        return bool(value == _ALL_OPTION_FIELDS[_OPTION_KEYS[key]][1])
    if isinstance(value, dict) and isinstance(options[key], dict):
        # settings the app fills with its defaults (fem, sgi3d): what was given is kept
        return all(options[key].get(k) == v for k, v in value.items())
    return bool(options[key] == value)


def _check_orientation(orientation: Any) -> None:
    if orientation not in ("ltr", "rtl"):
        raise ValueError("orientation must be 'ltr' (slides to the right) or 'rtl' (slides to the left), not {!r}".format(orientation))


def _check_name(name: Any) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("A model needs a name")
    return name


def _area(poly: List[Point]) -> float:
    return 0.5 * sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]))

