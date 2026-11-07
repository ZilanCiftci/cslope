---
name: cslope
description: Check the stability of a slope with cSlope's engine from Python or the command line - describe the slope (outline, soil layers, water, loads, search limits), validate it, run a limit equilibrium analysis (Morgenstern-Price, Bishop, Janbu) and report F with what it means. Use when someone asks for the factor of safety of a slope, embankment, cut or excavation, or for a check with partial factors (Swedish safety classes), and gives or can give the geometry and soil parameters.
---

# cslope: check a slope

cSlope's engine, the one in the cSlope app, as a Python package with a `cslope` command. You describe the slope with a builder in the app's terms, save it as an analysis document (JSON), and run it. The result is a summary that says what F is: a factor of safety on characteristic values, or an over-design factor on design values when partial factors are applied.

## When it applies

- Limit equilibrium of a 2D section: circular and composite slip surfaces, or block search; Morgenstern-Price (the default), Bishop or Janbu.
- Drained (c′, φ′) and undrained (su) soils, layers, a piezometric line, distributed and line loads, Swedish partial factors.
- Not covered here yet: finite elements and reliability (probability of failure). Say so if they are asked for; do not approximate them with limit equilibrium.

## Install

With uv, no install step is needed:

```
uvx cslope info                              # the command
uv run --with cslope python my_slope.py      # a script that imports cslope
```

Or install it: `pip install cslope`.

Python 3.10 or later. `cslope info` prints the package version, the engine build and the schema version.

## The workflow

1. **Get the inputs from the person.** The geometry, every soil's parameters, the water, the loads and, for a check with partial factors, the safety class and the conversion factors η. **Never invent soil parameters** and **never assume a safety class or η**: ask. If a value is missing, stop and say which.
2. **Build and save the document** with `cslope.build` (below). Each call checks what it can at once and raises with a message that says what is wrong; fix the input, do not work around the check.
3. **Validate**: `save` already refuses a document with errors; `cslope validate slope.json` (or `cslope.validate(doc)`) lists each issue with its path in the document (`/definition/regionAssignments/1`). Errors stop the analysis; warnings are worth reading.
4. **Run**: `cslope analyse slope.json` prints the summary; `--json` prints `{"summary": ..., "result": ...}` for further processing. `--threads N` limits the threads.
5. **Report the summary unchanged**: F with its label and basis, the method, the critical surface (entry and exit), and every warning. Do not round F differently, relabel it ("safe", "FoS"), or leave out warnings. A warning can mean F is not reliable.

Exit status of the command: 0 done, 1 the analysis failed, 2 the input is not valid (each issue printed with its path).

## Units and orientation

- Lengths in m, stresses and strengths in kPa, unit weights in kN/m³, angles in degrees, line loads in kN/m. x to the right, y up.
- `Definition(orientation="ltr")`: the slope slides to the right (the crest on the left). `"rtl"`: it slides to the left. Give the coordinates as they are either way; results come back in the same coordinates.

## The builder

```python
from cslope.build import Definition, swedish_partial_factors

d = Definition(orientation="ltr")
d.exterior = [(0, 0), (0, 12), (16, 12), (32, 4), (44, 4), (44, 0)]   # the outline, m

d.add_material("Sand", c=3, phi=34, gamma=19, gamma_sat=20)   # drained: c′ kPa, φ′ °
d.add_material("Clay", su=40, gamma=17, gamma_sat=17)         # undrained: su kPa

d.add_interior_boundary([(0, 6), (28, 6)])   # from the exterior to the exterior
d.assign("Sand", at=(8, 9))                  # a point inside each region
d.assign("Clay", at=(20, 2))

d.add_piezometric_line([(0, 10), (30, 4), (44, 4)], free_water=True)  # left to right
d.add_distributed_load(x=(6, 14), q=10)      # kPa, vertical
d.add_line_load(x=10, p=40, angle=0)         # kN/m, angle from the downward vertical
d.search_limits(entry=(2, 18), exit=(28, 42))

d.options.method = "Morgenstern-Price"       # or "Bishop", "Janbu"
d.options.slices = 30
d.save("slope.json")                         # validates, then writes
```

- `assign` every region; a region without an assignment is an error.
- Give `gamma_sat` for every material that can be below the piezometric line.
- `free_water=True` lets water above the ground (a lake, a ditch) act on the slope; `False` cuts the line at the ground.
- `d.options` has fixed attributes (`method`, `slices`, `iterations`, `refined_iterations`, `composite_surfaces`, `search_method`, `interslice_function`, `tolerance`, `min_slip_depth`, `tension_crack_depth`, `seismic_horizontal`, `seismic_vertical`, `both_directions`, `partial_factors`). A misspelt one is an `AttributeError`, never a silent default. Its defaults are the app's for a new model.
- `d.to_dict()` is the document; `Definition.load("slope.json")` reads one back.

## The document and its schema

The document is `{"format": "cslope-analysis", "formatVersion": 1, "definition": {...}, "options": {...}}`. Options it leaves out take the app's defaults (`cslope.default_options()`: Morgenstern-Price, 30 slices, composite surfaces); the builder writes every option it has. `cslope schema` prints its JSON schema, `cslope schema <name>` another one: `analysis-document`, `slope-definition`, `analysis-options`, `analysis-result`, `result-summary`, `validation-issues` and more (`cslope info` lists them). Each schema's `$id` is `urn:cslope:schema:<name>:<version>` (for example `urn:cslope:schema:analysis-document:0.1.0`), the version being `cslope.SCHEMA_VERSION`. Look up a field there rather than guessing its name; unknown keys are errors.

From Python instead of the command:

```python
import cslope

doc = d.to_dict()
result = cslope.analyse(doc)                       # the full result
summary = cslope.summarize(result, doc)             # what to report
```

## Partial factors (Swedish practice)

```python
d.options.partial_factors = swedish_partial_factors(
    safety_class=2,            # 1, 2 or 3: from the project, never assumed
    eta_cu=1.0,                # η on su: γcu = 1.5 / η
    eta_drained=1.0,           # η on c′ and tan φ′: γc′ = γφ′ = 1.3 / η
    variable_load_base=1.3,    # γQ = this · γd (γd = 0.83, 0.91, 1.0)
)
```

Every argument is required. With partial factors the summary says "over-design factor" on design values: it must be at least 1.0. Without them it is a "factor of safety" on characteristic values; the required value then comes from the governing document, not from cSlope.

## Examples

In `examples/`, each writes the `.json` next to it and analyzes it (`python examples/layered_soil.py`). The soil values in them are illustrative, not for use.

| Example | Shows |
|---|---|
| `single_slope.py` | one drained soil, search limits |
| `layered_soil.py` | two layers, an interior boundary, region assignments |
| `water_table.py` | a piezometric line with free water, saturated unit weight |
| `distributed_load.py` | undrained clay under a drained crust, a distributed load |
| `swedish_partial_factors.py` | a check with Swedish partial factors (over-design factor) |

## Trust in the results

The engine is the cSlope app's. Its verification against published reference problems is on the Verification page of the cSlope website (the problems are not in the package). Report the engine build from the summary (`engineBuild`, or `cslope info`) with the result.
