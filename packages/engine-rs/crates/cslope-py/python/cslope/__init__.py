"""cSlope: slope stability analysis (limit equilibrium and finite elements).

The engine of the cSlope app, compiled from Rust. Models and options are the
app's JSON shapes as Python dicts (camelCase keys); results come back as
dicts the same way. See the README for an overview and ``cslope.examples``
for models to start from.

    >>> import cslope
    >>> from cslope.examples import simple_slope
    >>> cslope.validate(simple_slope())                     # [] when valid
    []
    >>> result = cslope.analyse(simple_slope(), {"method": "Bishop"})
    >>> cslope.summarize(result)["fosLabel"]                # doctest: +SKIP
    'factor of safety'

``analyse`` takes the app's default options (Morgenstern-Price, 30 slices,
1000 + 500 trial surfaces, composite surfaces; ``default_options()``), not
the engine's own, and also an analysis document ``{"format":
"cslope-analysis", "formatVersion": 1, "definition": ..., "options": ...}``.
"""

from __future__ import annotations

import array as _array
from typing import Any, Callable, List, Literal, Optional

from . import _native
from ._native import (
    ENGINE_BUILD,
    SCHEMA_NAMES,
    SCHEMA_VERSION,
    AnalysisCancelled,
    CancelToken,
    EngineError,
    __version__,
    default_options,
    model_to_definition,
    reliability,
    swedish_partial_factors,
    to_canonical,
    validate_material_model,
)

__all__ = [
    "ENGINE_BUILD",
    "SCHEMA_NAMES",
    "SCHEMA_VERSION",
    "AnalysisCancelled",
    "CancelToken",
    "EngineError",
    "Slope",
    "__version__",
    "analyse",
    "default_options",
    "fem_summary",
    "model_to_definition",
    "reliability",
    "schema",
    "summarize",
    "swedish_partial_factors",
    "to_canonical",
    "validate",
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


def validate(doc_or_definition: Any, options: Optional[Any] = None) -> List[dict]:
    """The issues of an analysis document or of a definition (and options).

    Returns a list of ``{"path", "code", "message", "severity"}`` dicts,
    empty when the input is valid. ``path`` is a JSON pointer: under
    ``/definition`` and ``/options`` for a document
    (``{"format": "cslope-analysis", "formatVersion": 1, "definition",
    "options"}``), from the definition's root for a bare definition (its
    ``options`` under ``/options``). ``severity`` is ``"error"`` (a wrong
    answer or none) or ``"warning"`` (often a mistake). Checked: the JSON
    schema (unknown keys, types, values), and the model's rules: every
    region assigned once, interior boundaries that reach the outline,
    loads, search limits and water lines within the model, ``unitWeightSat``
    below the water, the deprecated ``materialName`` and ``followBoundary``.
    """
    return _native.validate(doc_or_definition, options)


def summarize(result: Any, options: Optional[Any] = None) -> dict:
    """What a result means, as the app's report states it.

    ``options`` are those the analysis ran with (as given to ``analyse``,
    over the same defaults; or the analysis document). Returns a dict with
    ``fos``, ``fosLabel`` ("factor of safety" on characteristic values,
    "over-design factor" on design values), ``valueBasis``,
    ``partialFactors`` (with their ``basis``, or None), ``method`` (the text
    the app shows), ``criticalSurface`` (shape, entry and exit, or None),
    ``warnings`` (``{code, message}``), ``nonConverged``,
    ``bothDirections`` (or None), ``engineBuild`` and more.
    """
    return _native.summarize(result, options)


def schema(name: str = "analysis-document") -> dict:
    """The JSON schema ``name`` (one of ``SCHEMA_NAMES``), as a new dict.

    The schemas are built into the package (the same as
    packages/engine/schema in the repository); their ``$id`` carries
    ``SCHEMA_VERSION``. They are stricter than the engine: no unknown keys,
    JSON numbers, integers for counts.
    """
    return _native.schema(name)


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

    ``definition`` is a ``SlopeDefinition`` dict, or an analysis document
    (``{"format": "cslope-analysis", "formatVersion": 1, "definition",
    "options"}``), and ``options`` a partial ``AnalysisOptions`` dict
    (``method``, ``slices``, ``searchMethod``, ...). The options are the
    app's defaults (``default_options()``: Morgenstern-Price, 30 slices,
    1000 + 500 trial surfaces, composite surfaces), then the document's
    options, then ``options``. (Earlier versions used the engine's own
    defaults, Bishop with 25 slices and circles; ``Slope`` still does.)
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
