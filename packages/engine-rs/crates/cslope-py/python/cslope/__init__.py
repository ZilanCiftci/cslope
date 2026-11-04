"""cSlope: slope stability analysis (limit equilibrium and finite elements).

The engine of the cSlope app, compiled from Rust. Models and options are the
app's JSON shapes as Python dicts (camelCase keys); results come back as
dicts the same way. See the README for an overview and ``cslope.examples``
for models to start from.

    >>> import cslope
    >>> from cslope.examples import simple_slope
    >>> result = cslope.analyse(simple_slope(), {"method": "Bishop"})
    >>> round(result["minFOS"], 3)  # doctest: +SKIP
"""

from __future__ import annotations

import array as _array
from typing import Any, Callable, Literal, Optional

from . import _native
from ._native import (
    ENGINE_BUILD,
    AnalysisCancelled,
    CancelToken,
    EngineError,
    __version__,
    reliability,
    to_canonical,
    validate_material_model,
)

__all__ = [
    "ENGINE_BUILD",
    "AnalysisCancelled",
    "CancelToken",
    "EngineError",
    "Slope",
    "__version__",
    "analyse",
    "fem_summary",
    "reliability",
    "to_canonical",
    "validate_material_model",
]

ArrayKind = Literal["array", "numpy", "list"]

# The long numeric arrays of the finite element results: field -> typecode.
_FEM_SUMMARY_ARRAYS = {
    "x": "d",
    "y": "d",
    "triangles": "q",
    "plasticShear": "d",
    "shearIncrement": "d",
    "displacement": "d",
}
_FEM_RESULT_ARRAYS = {
    "displacement": "d",
    "plasticShearStrain": "d",
    "shearStrainIncrement": "d",
}
_FEM_MESH_ARRAYS = {"x": "d", "y": "d", "triangles": "q", "elementMaterial": "q"}


def _convert(d: dict, fields: dict, kind: ArrayKind) -> None:
    if kind == "list":
        return
    if kind == "numpy":
        try:
            import numpy as np
        except ImportError as e:  # pragma: no cover - depends on the environment
            raise ImportError("arrays='numpy' needs numpy: pip install 'cslope[numpy]'") from e
        for k, code in fields.items():
            if d.get(k) is not None:
                d[k] = np.asarray(d[k], dtype=np.float64 if code == "d" else np.int64)
        return
    if kind != "array":
        raise ValueError("arrays must be 'array', 'numpy' or 'list'")
    for k, code in fields.items():
        if d.get(k) is not None:
            d[k] = _array.array(code, d[k])


def analyse(
    definition: Any,
    options: Optional[Any] = None,
    *,
    both_directions: bool = False,
    progress: Optional[Callable[[dict], Any]] = None,
    threads: Optional[int] = None,
    cancel: Optional[CancelToken] = None,
) -> Any:
    """Limit equilibrium analysis of a slope.

    ``definition`` is a ``SlopeDefinition`` dict and ``options`` a partial
    ``AnalysisOptions`` dict (``method``, ``slices``, ``searchMethod``, ...).
    Returns the ``AnalysisResult`` dict: ``minFOS``, ``criticalSurface``,
    ``criticalSlices``, ``allSurfaces``, ``warnings``, ... in the model's
    coordinates.

    ``both_directions`` also analyses sliding the other way and reports the
    lower factor. ``threads`` is the number of threads that evaluate the trial
    surfaces (None: every core, 1: this thread only); the result does not
    depend on it. ``progress`` is called with an event dict after each batch
    of surfaces and may return False to cancel (``AnalysisCancelled``);
    Ctrl+C cancels too (``KeyboardInterrupt``).
    """
    return _native.analyse(
        definition,
        options,
        both_directions=both_directions,
        progress=progress,
        threads=threads,
        cancel=cancel,
    )


def fem_summary(
    definition: Any,
    settings: Any,
    *,
    bounds: bool = False,
    progress: Optional[Callable[[dict], Any]] = None,
    cancel: Optional[CancelToken] = None,
    arrays: ArrayKind = "array",
) -> Any:
    """Finite element analysis of a slope as the app runs it.

    ``settings`` is a ``FemAnalysisSettings`` dict (flow rule, stiffness,
    element size, refinement levels, ...). Strength reduction always; with
    ``bounds=True`` and ``"limitAnalysis": True`` in the settings also the
    lower and upper bounds of limit analysis (minutes of run time). Returns
    the ``FemResultSummary`` dict in the model's coordinates; its mesh and
    field arrays are ``array.array`` (``arrays="array"``), numpy arrays
    (``"numpy"``) or lists (``"list"``). ``progress`` receives each trial.
    """
    r = _native.fem_summary(definition, settings, bounds=bounds, progress=progress, cancel=cancel)
    _convert(r, _FEM_SUMMARY_ARRAYS, arrays)
    return r


class Slope(_native.Slope):
    """A slope built from a definition, analysed in place.

    >>> s = Slope(definition)                       # doctest: +SKIP
    >>> s.update_analysis_options({"method": "Bishop"})  # doctest: +SKIP
    >>> s.analyse()                                 # doctest: +SKIP
    >>> s.search[0]["fos"], s.result()["minFOS"]    # doctest: +SKIP
    """

    def fem(
        self,
        options: Optional[Any] = None,
        *,
        progress: Optional[Callable[[dict], Any]] = None,
        cancel: Optional[CancelToken] = None,
        arrays: ArrayKind = "array",
    ) -> Any:
        """Finite element strength reduction of this slope.

        ``options`` is a ``FemAnalysisOptions`` dict (``elementSize``,
        ``flowRule``, ``fTolerance``, ``materialParameters``, ``adaptive``,
        ...). Returns the ``FemAnalysisResult`` dict (canonical coordinates):
        ``factorOfSafety``, ``trials``, ``levels``, ``mesh``,
        ``displacement``, ``plasticShearStrain``, ...
        """
        r = self._fem(options, progress=progress, cancel=cancel)
        _convert(r, _FEM_RESULT_ARRAYS, arrays)
        _convert(r["mesh"], _FEM_MESH_ARRAYS, arrays)
        return r
