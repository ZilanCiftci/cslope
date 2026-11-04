# cslope-py: the Python binding

The Rust engine (`crates/cslope-engine`) as the Python package `cslope`
(pyo3 0.29 + pythonize, built with maturin; ARCHITECTURE.md §4). The PyPI
description is `README-PYPI.md`; this file is for developers.

```
crates/cslope-py/
  Cargo.toml            cdylib `_native` (pyo3 abi3-py39, pythonize, rayon)
  build.rs              ENGINE_BUILD = version + git commit
  src/lib.rs            module functions: analyse, fem_summary, reliability, to_canonical, validate_material_model
  src/run.rs            pythonize in and out, GIL release, progress, cancellation, threads
  src/slope.rs          the Slope class
  src/errors.rs         EngineError / AnalysisCancelled, error mapping
  pyproject.toml        maturin (pinned), package metadata
  python/cslope/        __init__.py (wrappers, FE arrays), __init__.pyi (TypedDicts), py.typed, examples.py
  tests/                pytest: test_api.py (self-contained; the wheels' smoke test)
  examples/parameter_study.py
```

## Build and install

Rust 1.97 (`rust-toolchain.toml`) and Python 3.9 or later.

```
cd packages/engine-rs/crates/cslope-py
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install maturin==1.15.0 pytest numpy

maturin develop --release        # build and install into the venv (editable)
# or a wheel:
maturin build --release --out dist && pip install dist/cslope-*.whl
```

One wheel (`cp39-abi3`) serves every CPython from 3.9. The wheel holds
only the package: no tests, fixtures or verification problems.

## Use

```python
import cslope
from cslope.examples import simple_slope

r = cslope.analyse(simple_slope(), {"method": "Bishop"})
r["minFOS"], r["criticalSurface"], r["criticalSlices"][0]
```

`examples/parameter_study.py` varies φ′ of a slope and prints (or, with
`--plot` and matplotlib, plots) F for Bishop and Morgenstern-Price:

```
$ python examples/parameter_study.py
phi'             Bishop  Morgenstern-Price
  20              1.134              1.132
  30              1.622              1.620
  40              2.204              2.203   (every 2° in the script)
```

### API

| | |
|---|---|
| `analyse(definition, options=None, *, both_directions=False, progress=None, threads=None, cancel=None)` | `run_analysis`: the `AnalysisResult` the app shows, in model coordinates |
| `fem_summary(definition, settings, *, bounds=False, progress=None, cancel=None, arrays="array")` | `run_fem_summary` (`_with_bounds` with `bounds=True`): `FemResultSummary` |
| `reliability(definition, options, variables, reliability, *, progress=None, threads=None, cancel=None)` | `analyse_reliability`, the surface mapped to model coordinates |
| `to_canonical(definition)` | `to_canonical_slope_definition` |
| `validate_material_model(model)` | `try_validate_material_model`: list of messages |
| `Slope(definition)` | `build_slope` of the canonical definition: `update_analysis_options`, `analysis_options`, `analyse(...)` (`analyse_slope`, every slice kept), `min_fos`, `search` (every trial surface, canonical coordinates), `result()` (the `AnalysisResult`), `fem(options, ...)` (`analyze_fem`), `orientation`, `definition` |
| `CancelToken()` | `.cancel()` from another thread stops the analyses it was passed to |
| `__version__`, `ENGINE_BUILD` | crate version; version + git commit |

Notes:

- **Data**: dicts in the TypeScript engine's JSON shapes (camelCase keys),
  read and written by pythonize, as the app's JSON is read (unknown keys
  ignored, NaN and the infinities kept). Fixed-size arrays such as points
  come back as tuples (TypeScript's `[x, y]` tuple types); lists and tuples
  are both accepted as input.
- **Definitions are model definitions**: `analyse`, `reliability` and
  `Slope` turn them to the canonical orientation first (the app does this
  before it calls the engine), so a model that slides to the left
  (`"orientation": "rtl"`) can be given as it is. `fem_summary` does it
  itself, as in the app.
- **GIL**: every analysis runs in `py.detach` (formerly `allow_threads`),
  so other Python threads run meanwhile.
- **Threads**: `threads=None` evaluates the trial surfaces (and Monte Carlo
  samples) on rayon's global pool (every core, or `RAYON_NUM_THREADS`),
  `threads=1` on the calling thread, `threads=n` on a pool of n threads
  (kept for later calls). The results are identical bit for bit (the
  engine's `Evaluator` contract; tested). The finite element trials run one
  after another.
- **Progress**: the callback gets a dict per event: `{"kind": "search",
  "done", "totalHint", "phase"}`, `{"kind": "reliability", "progress"}`,
  `{"kind": "femTrial", "trial"}`, `{"kind": "bounds", "level"}` or
  `{"kind": "femStage", "stage"}` (the finite element analysis starts a
  stage: `{"stage": "mesh"}`, `{"stage": "strengthReduction", "mesh",
  "meshes"}`, `{"stage": "upperBound" | "lowerBound", "mesh", "meshes",
  "davis"}`, meshes from 0). It runs
  with the GIL taken for the call. Returning `False` cancels
  (`AnalysisCancelled`); an exception it raises cancels and is raised again.
- **Ctrl+C**: every progress event (with or without a callback) checks for
  signals; a `KeyboardInterrupt` cancels the engine's `CancelToken` and is
  raised again. Between events (one batch of surfaces, one FE trial) the
  engine does not look.
- **Errors**: `EngineError::range` → `ValueError`, the engine's TypeError →
  `TypeError`, cancelled → `cslope.AnalysisCancelled` (a subclass of
  `cslope.EngineError`), others → `cslope.EngineError` (a `RuntimeError`),
  messages unchanged. Input pythonize cannot read → `ValueError`
  ("Invalid slope definition: ...").
- **FE arrays**: `array.array` (`'d'`, indices `'q'`) by default, numpy
  arrays with `arrays="numpy"` (the `numpy` extra), lists with
  `arrays="list"`. The conversion is in Python (`numpy.asarray`) rather
  than the pyo3 `numpy` crate: no optional Rust feature, one wheel.

## Tests

```
cd packages/engine-rs/crates/cslope-py
maturin develop --release
pytest tests
```

`test_api.py` needs only the installed package: the demo models against
pinned factors of safety (within 1e-6), thread counts giving identical
results, progress and cancellation, error mapping, the `Slope` class and
the FE summary. Before the TypeScript engine was removed, the binding was
also compared with it and with the native engine on the checks of several
verification problems (PORTING.md, Python binding).

## Wheels

`.github/workflows/python.yml` builds the wheels on a tag `py-v*` (Linux
x86_64 and aarch64 manylinux, macOS universal2, Windows x64) and runs
`tests/test_api.py` against each. Publishing to PyPI is written out but
disabled until trusted publishing is configured.
