# cslope

Slope stability analysis in Python: the engine of the cSlope app, compiled
from Rust.

- **Limit equilibrium**: Bishop, Janbu and Morgenstern-Price; circular,
  composite, non-circular (optimised) and block searches; water tables and
  waternets, loads, reinforcement and piles, seismic coefficients, partial
  factors, rapid drawdown; a 3D correction of the factor of safety.
- **Finite elements**: strength reduction (associated, non-associated and
  Davis flow rules) with adaptive meshes, and the lower and upper bounds of
  limit analysis.
- **Reliability**: Taylor series and Monte Carlo.

One wheel per platform (Linux x86_64 and aarch64, macOS, Windows x64) for
CPython 3.9 and later, with no dependencies.

## Install

```
pip install cslope            # numpy optional: pip install "cslope[numpy]"
```

## Use

Models and options are plain dicts, in the JSON shape the cSlope app saves
(camelCase keys); results come back as dicts the same way. Lengths in m,
forces in kN, stresses in kPa, angles in degrees.

```python
import cslope

slope = {
    "coordinates": [[0, 0], [0, 15], [15, 15], [35, 5], [50, 5], [50, 0]],
    "materials": [
        {"name": "Soil", "model": {"kind": "mohr-coulomb", "unitWeight": 19,
                                   "cohesion": 5, "frictionAngle": 30}},
    ],
}

result = cslope.analyse(slope, {"method": "Morgenstern-Price"})
print(result["minFOS"])                      # factor of safety
print(result["criticalSurface"]["cx"],       # the critical circle
      result["criticalSurface"]["radius"])
print(len(result["criticalSlices"]))         # its slices, with forces
```

Check a model before running it, and read what F is afterwards:

```python
issues = cslope.validate(slope)              # [] when valid; else dicts with
for i in issues:                             # path, code, message, severity
    print(i["severity"], i["path"], i["message"])

summary = cslope.summarize(result)
print(summary["fos"], summary["fosLabel"])   # "factor of safety" or, with
print(summary["method"])                     # partial factors, "over-design factor"
```

Without options, `analyse` uses the app's defaults for a new model
(Morgenstern-Price, 30 slices, 1000 + 500 trial surfaces, composite
surfaces; `cslope.default_options()`). **Changed:** earlier versions used the
engine's own defaults (Bishop, 25 slices, circles only), which `Slope` still
uses. `analyse` also takes an analysis document, the model and its options
in one dict: `{"format": "cslope-analysis", "formatVersion": 1,
"definition": {...}, "options": {...}}`.

A parameter study:

```python
from cslope.examples import simple_slope

for phi in range(20, 41, 5):
    r = cslope.analyse(simple_slope(friction_angle=phi), {"method": "Bishop"})
    print(f"phi = {phi:2d}  F = {r['minFOS']:.3f}")
```

### Functions

| | |
|---|---|
| `analyse(definition, options=None, *, both_directions=False, progress=None, threads=None, cancel=None)` | Limit equilibrium analysis: `AnalysisResult` |
| `fem_summary(definition, settings, *, bounds=False, progress=None, cancel=None, arrays="array")` | Finite element analysis as the app runs it: `FemResultSummary` |
| `reliability(definition, options, variables, reliability, *, progress=None, threads=None, cancel=None)` | Taylor series or Monte Carlo: `ReliabilityResult` |
| `to_canonical(definition)` | The definition turned to slide towards +x |
| `model_to_definition(model, *, normalize=True)` | The engine's definition of a model of a project file (`cslope.project`), as the app makes it after opening the file |
| `normalize_model(model)` | A model of a project file as the app reads it on open (the fields the analysis takes, and complete options) |
| `validate(doc_or_definition, options=None)` | The issues of a model: `[{"path", "code", "message", "severity"}]`, JSON pointers such as `/materials/1/model/undrainedShearStrength` |
| `summarize(result, options=None)` | What a result means: `fos`, `fosLabel`, `valueBasis`, `partialFactors`, `method`, `criticalSurface`, `warnings`, `nonConverged`, `bothDirections`, `engineBuild` |
| `swedish_partial_factors(safety_class, eta_cu, eta_drained, variable_load_base)` | The `partialFactors` of the options in Swedish practice |
| `default_options()` | The defaults of `analyse` (the app's) |
| `schema(name="analysis-document")`, `SCHEMA_NAMES`, `SCHEMA_VERSION` | The JSON schemas of the input and the results |
| `validate_material_model(model)` | The errors of a material model (empty: valid) |
| `Slope(definition)` | A slope analysed in place: `update_analysis_options`, `analyse`, `search` (every trial surface), `result()`, `fem(options)` |

The package has type hints: `TypedDict`s for the shapes, generated from the
JSON schemas. The schemas are stricter than the engine (no unknown keys,
JSON numbers, integers for counts); `validate` checks against them and adds
the rules of the model (every region assigned, boundaries that reach the
outline, loads and water within the model, `unitWeightSat` below the water).
Deprecated: `waterTable.followBoundary` (use `freeWater`, its opposite) and
`materialBoundaries[].materialName` (use `regionAssignments`).

### Threads, progress and cancelling

Analyses run without holding the GIL. `threads` sets how many threads
evaluate the trial surfaces (default every core; `threads=1` this thread
only); the result is the same for any number. `progress` is called with an
event dict (`{"kind": "search", "done": 600, ...}`) and may return `False`
to cancel, which raises `cslope.AnalysisCancelled`. Ctrl+C stops an analysis
with `KeyboardInterrupt`, and a `cslope.CancelToken` passed as `cancel=` can
stop it from another thread.

### Errors

Invalid input raises `ValueError` (or `TypeError`); other engine errors,
such as a model where no valid slip surface is found, raise
`cslope.EngineError` (a `RuntimeError`).

### Finite element arrays

The mesh and field arrays of `fem_summary` and `Slope.fem` are
`array.array` by default, numpy arrays with `arrays="numpy"`, or lists with
`arrays="list"`.

### Command line

```
cslope analyse slope.json [--json] [--threads N]
cslope validate slope.json
cslope export site.cslp [--model NAME | --all] [-o PATH]
cslope schema [name]
cslope info
```

`cslope export` writes a model of a project file saved by the cSlope app as
an analysis document, as the app runs it (the active model by default). A
project saved by an earlier version of the app is refused: open it in the
app and save it.

## Examples

`cslope.examples` has a few made-up demo models: `simple_slope`,
`slope_with_water_table`, `clay_crust_with_load` and `two_layer_cut_left`.

## License

MIT.
