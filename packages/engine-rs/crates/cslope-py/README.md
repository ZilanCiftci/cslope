# cslope-py: the Python binding

The Rust engine (`crates/cslope-engine`) as the Python package `cslope`
(pyo3 0.29 + pythonize, built with maturin; ARCHITECTURE.md §4). The PyPI
description is `README-PYPI.md`; this file is for developers.

```
crates/cslope-py/
  Cargo.toml            cdylib `_native` (pyo3 abi3-py310, pythonize, rayon)
  build.rs              ENGINE_BUILD = version + git commit
  src/lib.rs            module functions: analyse, fem_summary, reliability, to_canonical, validate, summarize, schema, ...
  src/run.rs            pythonize in and out, GIL release, progress, cancellation, threads
  src/slope.rs          the Slope class
  src/errors.rs         EngineError / AnalysisCancelled, error mapping
  pyproject.toml        maturin (pinned), package metadata
  python/cslope/        __init__.py (wrappers, FE arrays), __init__.pyi (TypedDicts), py.typed, examples.py,
                        model.py and project.py (Model, Project), result.py (Result), build.py, cli.py
  tests/                pytest (the wheels' smoke test runs them all; those that need other parts of the repository skip)
  examples/             new_project.py, change_and_rerun.py, read_results.py (shown on the website), parameter_study.py
```

## Build and install

Rust 1.97 (`rust-toolchain.toml`) and Python 3.10 or later.

```
cd packages/engine-rs/crates/cslope-py
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install maturin==1.15.0 pytest numpy

maturin develop --release        # build and install into the venv (editable)
# or a wheel:
maturin build --release --out dist && pip install dist/cslope-*.whl
```

One wheel (`cp310-abi3`) serves every CPython from 3.10. The wheel holds
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
| `analyze(definition, options=None, *, both_directions=False, progress=None, threads=None, cancel=None)` (alias `analyse`) | `run_analysis`: the `AnalysisResult` the app shows, in model coordinates |
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

Two ways in, one model underneath (the app's `ModelEntry`, read and written
by the crate `cslope-project`):

- **Objects, for people** (issue #59): `cslope.Project`, `cslope.Model` and
  `cslope.Result` build a model from nothing or open a `.cslp`, change it,
  run it and save a project the app opens, with the results current.
- **JSON, for agents and scripts**: the analysis document (`cslope.build`,
  `cslope validate`, `cslope analyse doc.json`, `cslope export site.cslp`).
  `model.definition` and `Model.from_definition` cross between the two.

```python
import cslope

p = cslope.Project.open("site.cslp")
m = p.model("Section A")
print(m.result.fos, m.result_is_current)       # the saved result, without a run
m.material("Clay").su = 35                      # now out of date
r = m.analyse(threads=4)                        # run as the app runs it; kept on the model
print(r.fos, r.fos_label, r.critical_surface["text"])
r.to_csv("section-a-slices.csv")                # the app's slice table
p.save()                                        # the app shows the new result as current

for m in p.models:                              # every model of a project
    m.analyse()

p = cslope.Project()                            # a project from nothing
m = p.add_model("Section B")
m.exterior = [(0, 0), (0, 15), (15, 15), (35, 5), (50, 5), (50, 0)]
sand = m.add_material("Sand", c=0, phi=32, gamma=19, gamma_sat=20)
clay = m.add_material("Clay", su=25, gamma=17, gamma_sat=18)
m.add_interior_boundary([(0, 8), (50, 8)])
m.assign(sand, at=(5, 12))
m.assign(clay, at=(25, 3))
m.add_piezometric_line([(0, 12), (15, 11), (35, 5), (50, 5)])
m.add_distributed_load(x=(3, 10), q=20)
m.search_limits(entry=(2, 14), exit=(20, 45))
m.options.partial_factors = cslope.swedish_partial_factors(
    safety_class=2, eta_cu=1.0, eta_drained=1.0, variable_load_base=1.3)
m.analyse()
p.save("site-b.cslp")
m.save_definition("section-b.json")             # the JSON an agent or `cslope analyse` runs
```

### Names

The builder's names (`cslope.build`, #56) carry over; the app's labels are
in brackets. A **property** is state read or set at no cost; a **method**
adds, removes, runs or writes. Units: m, kPa, kN/m (line loads,
reinforcement), kN/m³, degrees (also a slice's base angle). Points are
`(x, y)`, x to the right and y up, in the model's own direction;
`orientation` is `"ltr"` (the slope slides to the right) or `"rtl"`.

| | |
|---|---|
| `Project()`, `Project.open(path)` | a new project; open a `.cslp` (`cslope.project.open` too) |
| `project.models`, `project.model(name)` | the models in the app's order; one by name (`model_named` is an alias) |
| `project.add_model(name, orientation="ltr")`, `add_model(model)`, `remove_model(model)` | the first model added is the active one |
| `project.active_model`, `project.save(path=None)` | the path defaults to the file opened; the save policy below |
| `Model(name, orientation="ltr")`, `Model.from_definition(doc_or_path, name=)` | a standalone model; one from an analysis document |
| `name`, `orientation`, `exterior` | [Exterior] |
| `add_interior_boundary(points)` → `InteriorBoundary` | [Interior boundaries]; ends on the exterior or an earlier boundary |
| `add_material(name, *, gamma, c=, phi=, su=, gamma_sat=, model=, color=, depth_range=)` → `Material`; `material(name)` | [Materials]; `model=` takes any engine material model |
| `assign(material, at=(x, y))`, `assignments` | [Assign]; replaces the region's earlier assignment |
| `add_piezometric_line(points, *, name=, materials=, free_water=True)` → `PiezometricLine` | [Piezometric lines]; the first is the main line; `free_water` holds for every line |
| `add_distributed_load(x=(x1, x2), q, direction="vertical", *, excess_pore_pressure=)` → `DistributedLoad` | [Distributed loads] |
| `add_line_load(x, p, angle=0, y=None)` → `LineLoad` | [Line loads] |
| `add_reinforcement(start, end, kind="anchor", **fields)` → `Reinforcement`, `add_pile(start, end, kind="pile", **fields)` → `Pile` | [Reinforcement]; the fields are the app's, snake_case; the app's presets fill the rest |
| `search_limits(entry=(x1, x2), exit=(x1, x2))`, `search_limits(None)` | [Search limits] |
| `add_custom_surface(center=, radius=)` / `add_custom_surface(points=)` → `CustomSurface`, `custom_surfaces_only` | [Custom surfaces] |
| `add_block_search_object(points)` → `BlockSearchObject` | block search |
| `options` | [Options] the builder's `Options`, with all of the app's options (snake_case of the app's keys); the app's defaults (D-23) |
| `analyse(*, threads=, progress=, cancel=)` → `Result` | runs as the app runs it, keeps the result; raises on an engine error and keeps nothing |
| `result`, `error`, `result_is_current`, `input_hash` | the saved result (read without a run), the last run's error |
| `definition`, `save_definition(path)` | the analysis document (JSON, the agents' path) |
| `data` | the model's dict (the app's JSON shape): the way to what has no method (title block, waternet, earlier stage, rapid drawdown, parameters) |
| `Result`: `fos`, `fos_label`, `method`, `critical_surface`, `warnings`, `summary`, `slices`, `to_csv(path=None, decimal_comma=False)`, `data`, `saved`, `is_current` | `slices` are dicts with the slice table's columns |

The lists `materials`, `interior_boundaries`, `piezometric_lines`,
`distributed_loads`, `line_loads`, `reinforcements`, `piles`,
`custom_surfaces` and `block_search_objects` hold items whose properties
change the model in place (`m.material("Clay").c = 12`); `item.remove()`
removes one (a model keeps at least one material, as in the app). After
each change, also before the model has an exterior or a material, the
model is read as the app reads it when it opens the project, so the model holds what the app will show: a value
the app would not keep (a negative seismic coefficient, say) is refused
with a `ValueError` that says what the app takes, and a field the app's Parameters drive by an
expression is not overwritten. `tests/test_objects.py` builds each of the
app's examples with these names and gets the app's F within 1e-6, and
checks that the names reach every field of the engine's definition (a field
added to the engine fails it until it gets a name or is listed on purpose).

### The project as dicts

`open(path)` gives a `Project`: `manifest`, `version` (the project schema
version, 3), `active_model_id`, `units`, `models` (each `Model` also has
`id`, `data`, `backgrounds`, `set_result(result)` and `set_error(message)`),
`assets` (the attachments; `read_asset(id)`, checked against its SHA-256
when the file was opened), `placements(model)` (the drawings placed under a
model: each a `Placement` with its attachment, page, crop, calibration and
affine `transform`; `to_model(u, v)` maps a point of the drawing to the
model), `thumbnail()` and `save(path)`. A model's dict is the model as the
app holds it after opening the file (missing members filled, values out of
range clamped, as the app's `parseProjectData` does), in the app's shape
with camelCase keys; it can be changed directly too.

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

`test_objects.py` builds the app's examples with `Project` and `Model` and
compares F with the app's (the results saved in `tests/data/app-results.cslp`),
changes one model of that project, runs and saves it, and checks the names
against the engine's schema. `test_project.py` opens and saves the app's project fixtures
(packages/desktop/src/features/project/fixtures) and `tests/data/app-results.cslp`
(made by the app's writer, `packages/desktop/scripts/make-export-fixture.ts`).

`test_examples.py` runs every file in `examples/` as a script, in the
order a reader follows (new_project.py writes the project the next two
open), and each of the skill's examples (`skills/cslope/examples`) as
`python <example>.py`. The website's Python and agent pages
(`packages/website/src/docs/python.mdx`, `agents.mdx`) include these files
as they are, so a new example there needs an entry in the test.

`test_api.py` needs only the installed package: the demo models against
pinned factors of safety (within 1e-6), thread counts giving identical
results, progress and cancellation, error mapping, the `Slope` class and
the FE summary. Before the TypeScript engine was removed, the binding was
also compared with it and with the native engine on the checks of several
verification problems (PORTING.md, Python binding).

## Wheels

`.github/workflows/python.yml` builds the wheels on a tag `py-v*` or by
hand (Linux x86_64 and aarch64 manylinux, macOS universal2, Windows x64)
and runs the tests, with the crate's and the skill's examples, against
each on Python 3.10 and 3.13. The wheels are the run's artifacts
(`wheel-<platform>`).

On a tag `py-v<version>` the `publish` job uploads the wheels to PyPI
(`pip install cslope`) through the trusted publisher configured there:
this workflow, environment `pypi`, which a maintainer approves; no secrets
are needed. The version is the workspace's
(`packages/engine-rs/Cargo.toml`); 0.1.0 is published. A release is: bump
the workspace version, merge, then create the tag (on GitHub, a release
with a new tag `py-v<version>` on main) and approve the deployment.
