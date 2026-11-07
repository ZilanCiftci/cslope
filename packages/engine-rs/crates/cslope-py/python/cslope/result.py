"""The result of a model's analysis (``Model.analyse``, ``Model.result``).

A ``Result`` holds the engine's ``AnalysisResult`` (``data``) and says what
it means as the app's report does (``summary``): F with its label, the
method, the critical surface and the warnings. ``slices`` gives the slices
of the critical surface as rows and ``to_csv`` the app's slice table
(Results › Export slice data). Units: m, kPa, kN/m, degrees.
"""

from __future__ import annotations

import math
import os
from typing import Any, Callable, Dict, List, Optional, Union, cast

__all__ = ["Result"]

# The columns of the app's slice table (features/export/sliceTable.ts):
# (row key, header, decimals).
_COLUMNS = (
    ("slice", "Slice", None),
    ("x_left", "x left (m)", 4),
    ("x_right", "x right (m)", 4),
    ("x", "x mid (m)", 4),
    ("width", "Width (m)", 4),
    ("y_top", "y top (m)", 4),
    ("y_bottom", "y base (m)", 4),
    ("height", "Height (m)", 4),
    ("area", "Area (m²)", 4),
    ("alpha", "Base angle α (°, + dipping in the sliding direction)", 3),
    ("base_length", "Base length (m)", 4),
    ("weight", "Weight (kN/m)", 3),
    ("surface_load", "Surface load (kN/m)", 3),
    ("material", "Base material", None),
    ("c", "Cohesion c (kPa)", 3),
    ("phi", "Friction angle φ (°)", 3),
    ("pore_pressure", "Pore pressure u (kPa)", 3),
    ("normal_force", "Effective normal force N' (kN/m)", 3),
    ("shear_strength", "Shear strength c·l + N'·tan φ (kN/m)", 3),
)
# Under partial factors the slices carry design values.
_DESIGN_HEADERS = {
    "surface_load": "Surface load, design (kN/m)",
    "c": "Design cohesion c_d (kPa)",
    "phi": "Design friction angle φ_d (°)",
    "shear_strength": "Design shear strength c_d·l + N'·tan φ_d (kN/m)",
}


class Result:
    """The outcome of an analysis: F, what it means, the critical surface
    and its slices.

    - ``fos``: the minimum F; ``fos_label``: "factor of safety" on
      characteristic values, "over-design factor" under partial factors
    - ``method``: the method's name ("Morgenstern-Price", ...)
    - ``critical_surface``: ``shape``, ``center``, ``radius``, ``points``,
      ``entry``, ``exit`` (or None)
    - ``warnings``: ``{code, message}`` dicts
    - ``summary``: all of it, as ``cslope.summarize`` gives it
    - ``slices``: the slices of the critical surface, from the entry to the
      exit, as dicts (the app's slice table's columns)
    - ``data``: the engine's ``AnalysisResult`` dict (model coordinates)
    - ``saved``: the ``result.json`` dict (``runState``, ``inputHash``,
      ``engine``, ...) when the result is kept on a model
    - ``is_current``: whether it was computed for the model as it is now
    """

    def __init__(
        self,
        data: Dict[str, Any],
        options: Optional[Dict[str, Any]] = None,
        *,
        model_name: str = "",
        saved: Optional[Dict[str, Any]] = None,
        current: Optional[Callable[[], bool]] = None,
    ):
        self.data = data
        self.saved = saved
        self._options = options
        self._model_name = model_name
        self._current = current
        self._summary: Optional[Dict[str, Any]] = None

    def __repr__(self) -> str:
        return "Result(fos={!r}, method={!r})".format(self.fos, self.method)

    @property
    def summary(self) -> Dict[str, Any]:
        if self._summary is None:
            import cslope

            self._summary = cast(Dict[str, Any], cslope.summarize(cast(Any, self.data), cast(Any, self._options)))
        return self._summary

    @property
    def fos(self) -> float:
        return float(self.data["minFOS"])

    @property
    def fos_label(self) -> str:
        return str(self.summary["fosLabel"])

    @property
    def method(self) -> str:
        return str(self.summary["methodName"])

    @property
    def critical_surface(self) -> Optional[Dict[str, Any]]:
        return self.summary["criticalSurface"]

    @property
    def warnings(self) -> List[Dict[str, Any]]:
        return list(self.summary["warnings"])

    @property
    def is_current(self) -> bool:
        return self._current() if self._current is not None else True

    @property
    def slices(self) -> List[Dict[str, Any]]:
        rows = []
        for i, s in enumerate(self.data.get("criticalSlices") or []):
            shear = s.get("shearForce")
            if not _finite(shear):
                shear = s["cohesion"] * s["baseLength"] + max(s["normalForce"], 0.0) * math.tan(
                    math.radians(s["frictionAngle"])
                )
            rows.append(
                {
                    "slice": i + 1,
                    "x_left": s["xLeft"],
                    "x_right": s["xRight"],
                    "x": s["x"],
                    "width": s["width"],
                    "y_top": s["yTop"],
                    "y_bottom": s["yBottom"],
                    "height": s["height"],
                    "area": s["area"],
                    "alpha": math.degrees(s["alpha"]),
                    "base_length": s["baseLength"],
                    "weight": s["weight"],
                    "surface_load": s.get("surfaceLoad") or 0.0,
                    "material": (s.get("baseMaterial") or {}).get("name", ""),
                    "c": s["cohesion"],
                    "phi": s["frictionAngle"],
                    "pore_pressure": s["porePressure"],
                    "normal_force": s["normalForce"],
                    "shear_strength": shear,
                }
            )
        return rows

    def to_csv(self, path: Union[str, "os.PathLike[str]", None] = None, *, decimal_comma: bool = False) -> str:
        """The app's slice table as CSV text (a header block, a blank row,
        the column headers, one row per slice); written to ``path`` when
        given. With ``decimal_comma`` the decimal separator is a comma and
        the field separator a semicolon (Excel with Swedish settings)."""
        pf = (self._options or {}).get("partialFactors")
        cs = self.data.get("criticalSurface")
        head: List[List[Any]] = [
            ["Model", self._model_name],
            ["Method", self.data.get("method", "")],
            ["Over-design factor (design values)" if pf else "Min F", _round(self.fos, 4)],
        ]
        if pf:
            head += [
                ["Values", "design values: strengths divided, surface loads multiplied by the partial factors"],
                ["γcu", pf["cu"]],
                ["γc'", pf["cohesion"]],
                ["γφ' (on tan φ')", pf["tanPhi"]],
                ["γQ", pf["variableLoad"]],
            ]
        else:
            head.append(["Values", "characteristic (no partial factors)"])
        if cs:
            if cs.get("composite"):
                head.append(["Critical surface", "composite circle (along the firm base)"])
            elif cs.get("points"):
                head.append(["Critical surface", "non-circular, {} points".format(len(cs["points"]))])
            else:
                head.append(["Critical surface", "circle"])
            if cs.get("composite") or not cs.get("points"):
                head += [["Center x (m)", _round(cs["cx"], 4)], ["Center y (m)", _round(cs["cy"], 4)], ["Radius (m)", _round(cs["radius"], 4)]]
            head += [["Entry x (m)", _round(cs["entryPoint"][0], 4)], ["Exit x (m)", _round(cs["exitPoint"][0], 4)]]
        headers = [(_DESIGN_HEADERS.get(k, h) if pf else h) for k, h, _ in _COLUMNS]
        rows = head + [[], headers]
        for s in self.slices:
            rows.append([s[k] if d is None else _round(s[k], d) for k, _, d in _COLUMNS])
        text = "\r\n".join((";" if decimal_comma else ",").join(_cell(v, decimal_comma) for v in r) for r in rows) + "\r\n"
        if path is not None:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(text)
        return text


def _finite(v: Any) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(v)


def _round(v: float, digits: int) -> Optional[float]:
    """``Math.round(v * 10^digits) / 10^digits`` (halves up), None when not finite."""
    if not _finite(v):
        return None
    f = 10.0 ** digits
    return math.floor(v * f + 0.5) / f


def _cell(v: Any, decimal_comma: bool) -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        s = str(int(v)) if float(v).is_integer() else repr(float(v))
        return s.replace(".", ",") if decimal_comma else s
    t = str(v)
    if t[:1] in ("=", "+", "-", "@", "\t", "\r"):  # a spreadsheet would run it as a formula
        return "\"'{}\"".format(t.replace('"', '""'))
    return '"{}"'.format(t.replace('"', '""')) if any(c in t for c in '",;\n\r') else t
