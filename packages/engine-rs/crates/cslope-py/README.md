# cslope-py: the Python binding

The Rust engine (`crates/cslope-engine`) as the Python package `cslope`
(pyo3 0.29 + pythonize, built with maturin; ARCHITECTURE.md §4). The PyPI
description is `README-PYPI.md`; this file is for developers.

```
crates/cslope-py/
  Cargo.toml            cdylib `_native` (pyo3 abi3-py39, pythonize, rayon)
  build.rs              ENGINE_BUILD = version + git commit
  src/lib.rs            module functions: analyse, fem_summary, reliability, to_canonical, validate, summarize, schema, ...
  src/run.rs            pythonize in and out, GIL release, progress, cancellation, threads
  src/slope.rs          the Slope class
  src/errors.rs         EngineError / AnalysisCancelled, error mapping
  pyproject.toml        maturin (pinned), package metadata
  python/cslope/        __init__.py (wrappers, FE arrays), __init__.pyi (TypedDicts), py.typed, examples.py
  tests/                pytest: test_api.py, test_schema.py (self-contained; the wheels' smoke test)
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
| `validate(doc_or_definition, options=None)` | `validate_definition::validate`: the issues (`path`, `code`, `message`, `severity`) of an analysis document or a definition |
| `summarize(result, options=None)` | `summarize_result`: F and what it is (factor of safety / over-design factor), method, critical surface, warnings |
| `swedish_partial_factors(safety_class, eta_cu, eta_drained, variable_load_base)` | `swedish_partial_factors` |
| `default_options()` | `public_default_options` (D-23) |
| `schema(name)`, `SCHEMA_NAMES`, `SCHEMA_VERSION` | `types::schema`: the JSON schemas (also in packages/engine/schema) |
| `validate_material_model(model)` | `try_validate_material_model`: list of messages |
| `Slope(definition)` | `build_slope` of the canonical definition: `update_analysis_options`, `analysis_options`, `analyse(...)` (`analyse_slope`, every slice kept), `min_fos`, `search` (every trial surface, canonical coordinates), `result()` (the `AnalysisResult`), `fem(options, ...)` (`analyze_fem`), `orientation`, `definition` |
| `CancelToken()` | `.cancel()` from another thread stops the analyses it was passed to |
| `__version__`, `ENGINE_BUILD` | crate version; version + git commit |
| `project.open(path)`, `Project.save(path)` | a `.cslp` project file: its models as dicts, changed and saved as the app saves them (below); `project.read` is a deprecated alias of `open` |

Notes:

- **Defaults (D-23, a change)**: `analyse` takes the app's defaults for a
  new model (`public_default_options`: Morgenstern-Price, 30 slices, 1000 +
  500 trial surfaces, composite surfaces), then the options of an analysis
  document, then `options`. Earlier it took the engine's own defaults
  (Bishop, 25 slices, circles), which `Slope` and `reliability` still use.
- **Analysis documents**: `analyse`, `validate` and `summarize` take
  `{"format": "cslope-analysis", "formatVersion": 1, "definition",
  "options"}` as well as a bare definition.
- **Schemas and stubs**: `__init__.pyi`'s TypedDicts between the GENERATED
  markers come from the JSON schemas: `bun packages/engine-rs/tools/schema.ts`
  writes both, CI checks they are fresh (`--check`).

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

## Project files

`cslope.project` opens, changes and saves the app's `.cslp` project files
with the engine's reader and writer (the crate `cslope-project`, feature
`native`; issue #58):

```python
import cslope
from cslope import project
from cslope.cli import export_document

p = project.open("slope.cslp")
for m in p.models:
    print(m.id, m.name, m.min_fos, m.result_is_current)   # None without a saved result
m = p.model_named("Section A")
m.data["materials"][0]["model"]["undrainedShearStrength"] = 35
doc = export_document(m.data)     # the analysis document, as the app runs the model
m.set_result(cslope.analyse(doc))            # the result, with the hash of the model's input
p.save("slope.cslp")                          # what the app would write
```

`open(path)` gives a `Project`: `manifest`, `version` (the project schema
version, 3), `active_model_id`, `units`, `models` (each a `Model` with `id`,
`data`, `result`, `backgrounds`, `min_fos`, `input_hash`,
`result_is_current`, `set_result(result)`, `set_error(message)`), `assets`
(the attachments; `read_asset(id)`, checked against its SHA-256 when the
file was opened), `placements(model)` (the drawings placed under a model:
each a `Placement` with its attachment, page, crop, calibration and affine
`transform`; `to_model(u, v)` maps a point of the drawing to the model),
`thumbnail()` and `save(path)`. A model's dict is the model as the app holds
it after opening the file (missing members filled, values out of range
clamped, as the app's `parseProjectData` does), in the app's shape with
camelCase keys.

The reader is strict where the app is lenient: it reads files the app saved
with this layout and schema version (`project.FORMAT_VERSION`,
`project.SCHEMA_VERSION`); a file of an earlier version (a `.json` project,
the first `.cslp` layout, an older schema) is refused with a message to open
it in the app and save it (the app migrates it), a newer one with a message
to update, and a member or entry the format does not define is a
`ValueError` naming its path. The writer never writes one either: a member
added to a model's dict in Python is refused when the project is saved. The
file is written atomically (a temporary file renamed over it).

Results: each saved result carries the hash of the input it was computed
for (`inputHash`, docs/file-format.md section 5; `Model.input_hash` is the
app's `analysisInputHash`). When a project is saved, a model whose input
changed since its result keeps no `result.json`, and the project then drops
its `thumbnail.png`, unless the model was run again (`set_result`, which
stamps the current hash and `engine: {version, sourceHash: ""}`). The app
shows a result whose hash is not the model's as out of date.

`model_to_definition` converts a model's dict as the app does before a run
(the port of the app's `buildModelSpaceSlopeDTO`, held to the app's by a
golden corpus), in the model's own orientation. It first reads the model as
the app does when it opens the project (`normalize_model`); `normalize=False`
converts the dict as it is, which must then have the shape the app writes.

From the command line:

- `cslope analyse site.cslp [--model NAME | --all] [--write]` analyses
  models of a project as the app runs them (the active model by default) and
  prints their summaries; with `--write` it saves the results to the project
  (in model coordinates, with the input hash), under the save policy above.
  A model with the finite element analysis switched on is analysed but not
  written (the app runs that part).
- `cslope export site.cslp [--model NAME | --all] [-o PATH]` writes a model
  as an analysis document (`{"format": "cslope-analysis", ...}`) with its
  complete options, which `cslope validate` and `cslope analyse` take; the
  water is written with `freeWater`, and a region the app leaves to the
  first material gets that assignment explicitly. The `inputHash` of a saved
  result is over the definition in canonical orientation (`to_canonical`),
  not over the exported one.

The format is specified in `docs/file-format.md` at the repository root.
When the app's `PROJECT_FILE_VERSION` or `.cslp` format version changes,
the crate's constants follow in the same change (CI checks they are
equal), and a Python release follows the app's release the same day: a
released `cslope` refuses files of a newer schema version.

## Tests

```
cd packages/engine-rs/crates/cslope-py
maturin develop --release
pytest tests
```

`test_project.py` opens and saves the app's project fixtures
(packages/desktop/src/features/project/fixtures) and `tests/data/app-results.cslp`
(made by the app's writer, `packages/desktop/scripts/make-export-fixture.ts`).

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
