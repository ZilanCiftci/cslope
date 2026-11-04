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
| `validate_material_model(model)` | The errors of a material model (empty: valid) |
| `Slope(definition)` | A slope analysed in place: `update_analysis_options`, `analyse`, `search` (every trial surface), `result()`, `fem(options)` |

The package has type hints (`TypedDict`s for the main shapes).

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

## Examples

`cslope.examples` has a few made-up demo models: `simple_slope`,
`slope_with_water_table`, `clay_crust_with_load` and `two_layer_cut_left`.

## License

MIT.
