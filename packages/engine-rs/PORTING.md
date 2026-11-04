# Porting the engine to Rust

The TypeScript engine in `packages/engine/src` was rewritten in Rust here,
and the Rust engine replaced it at the cutover (2026-11-04, see "Cutover"
at the end): the app, the tests, the website's data and the report call it
as WebAssembly through a thin TypeScript API with the same names as before
(`@cslope/engine`), and Python is to call it natively. The TypeScript
implementation is gone; this file records how the port was made and
checked, and the rules for changing the engine now.

## Layout

- `crates/cslope-engine/src/{types,math,model,fem}`: one Rust file per
  TypeScript file, same name in snake_case (`model/geometry-ops.ts` ->
  `model/geometry_ops.rs`). Each file starts with
  `//! Port of packages/engine/src/<path>.ts`.
- `crates/cslope-engine/tests/<area>_*.rs`: differential tests against
  fixtures, plus ported unit tests.
- `golden/verification.json` (written by `tools/golden.ts` from the
  engine the app ships): the verification problems with their checks, and
  per analysis the minimum F, the critical surface's key and the counts of
  surfaces; `tests/verification_native.rs` compares the native engine with
  it (F within 1e-6, near-ties in `tests/allowlist.toml`). Until the
  cutover, `tools/fixtures/*.fixture.ts` exported fixtures from the
  TypeScript engine under Node (V8) for differential tests; they were
  removed with it (see "Cutover").
- `src/js/`: JavaScript semantics that change logic (not a port):
  `js::math::round/max/min/sign/pow` (JS rounding of halves, NaN and -0
  rules, `**` edge cases), `js::num` for every number formatted into a
  string or key (`to_string`, `to_fixed`), `js::array` for sorts and sums.
  `clippy.toml` bans the std equivalents of those. Transcendental functions
  (sin, cos, atan2, exp, powf, hypot) are std's, directly or through
  `js::math`; their last bits may differ from V8 (see tolerance policy).
- `crates/cslope-wasm`: the WebAssembly API (wasm-bindgen), called by the
  modules of `packages/engine/src` (helpers in `src/facade`; see "Exporting
  a module to the facade" below). Later `crates/cslope-py` (pyo3).

## Exporting a module to the facade

A Rust function the app or the tests need is exported to WebAssembly and
called from the TypeScript module of the same path, so that the TypeScript
tests (`cd packages/engine && bunx vitest run`, on the testing build) test
it. Until the cutover the callers were shims in `src/facade/<path>.ts`,
which `vitest.rust.config.ts` put in place of the TypeScript modules; at
the cutover each shim was merged into its module (the module keeps its
types, data and docs and calls the engine), and the steps below apply to
`src/<path>.ts` itself.

1. **Export** in `crates/cslope-wasm/src/api/<area>.rs` (a new file goes in
   `api/mod.rs`): one `#[wasm_bindgen] pub fn` per public function of the
   module (those `src/index.ts` exports), named as the Rust function. Take
   numbers as `f64`, number lists as `&[f64]` (a JS array or Float64Array),
   everything else as `JsValue` read with `convert::from_js(v, "what")`;
   return `f64`/`bool`/`String`/`Vec<f64>` directly (a `Vec<f64>` arrives as
   a Float64Array: the shim converts with `list`/`pt`) and everything else
   with `convert::to_js(&value)`. Map errors with `.js()?`
   (`errors::IntoJsResult`): RangeError for `EngineError::range`, Error
   otherwise, the message unchanged. An engine type without serde gets a DTO
   in the wasm crate (`MaterialParamsDto`), not serde in the engine.
2. **Internal functions** the tests import (not in `src/index.ts`): an arm in
   `crates/cslope-wasm/src/testing.rs` (`"<ts path>::<tsName>" => …`, args as
   a tuple, every parameter present) and the name in `TEST_FUNCTIONS`.
   Only the testing build has them.
3. **Objects with state** (a `Slope`, an FE result) live in a
   `registry::Registry` in a `thread_local!` and cross as a `u32` handle; the
   shim keeps the handle with the engine epoch (`engineEpoch()`) and frees it
   with a `FinalizationRegistry` and `free()` (see `facade/model/waternet.ts`
   and `api/geometry.rs` for the pattern). Take a value out of its slot
   (`take`/`put_back`) for calls that run JavaScript (progress callbacks).
4. **Wrapper** in `packages/engine/src/<path>.ts`: each runtime export
   calls `wasm().<export>` or `testCall("<ts path>::<tsName>", [all args])`.
   Data constants stay TypeScript data (they are read at module load,
   before the engine starts); the facade tests compare them with the
   engine's.
   Where TypeScript returns parts of its input unchanged, wrap the result in
   `shareUnchanged(input, result)` so identity is kept. A module that is
   only types or data needs no shim.
5. **Build and run**: `bun packages/engine-rs/tools/build-wasm.ts` (product
   into `packages/engine/src/wasm`, testing into `src/wasm-testing`), then
   the engine's tests. Commit the product build (`src/wasm`: the `.wasm`,
   the glue, `BUILD-INFO.json`): the app ships it, CI's check job and the
   release check that it is fresh (`tools/check-wasm-fresh.ts`), and CI's
   rust job rebuilds it and compares the bytes. The build is reproducible
   (`tools/build-wasm.ts`: machine paths remapped, no producers section,
   the wasm-bindgen CLI installed `--locked` on both sides); a build that
   differs fails that job and is uploaded as an artifact to look at.
6. (Until the cutover, `test-manifest.json` recorded how each test file
   ran on the facade; all 102 ran unchanged, none was rust-ported, and it
   was removed at the cutover.)

## Rules

1. **Port, don't redesign.** Same algorithms, same order of operations,
   same constants, same branches, so results match the TypeScript engine,
   ideally bit for bit. Comments that explain the engineering (sources,
   reasons) are carried over. Where JavaScript semantics matter, reproduce
   them: `Math.round` (half up, not half away from zero), `%` on negatives,
   `Number.EPSILON`, `toFixed`, sort stability (`js::array::sort_by`),
   `NaN` comparisons (`!(a > b)` is not `a <= b`), `||` vs `??` on 0 and
   NaN, `Math.max`/`min` (NaN and -0: `js::math::max`), `x ** 2` is
   `js::math::pow(x, 2.0)` not `x * x`, sums start at +0 (`js::array::sum`,
   not `Iterator::sum`), `Map`/`Set` iteration is insertion order (use
   `Vec`s of pairs, never iterate a `HashMap` where order matters), number
   keys formatted with `js::num::to_string`. ARCHITECTURE.md §5 lists more.
2. **Data types.** Every type that crosses the API (SlopeDefinition,
   material models, loads, reinforcement, AnalysisOptions, AnalysisResult,
   slices, warnings, FE results) is a serde struct or enum whose JSON is the
   TypeScript JSON: `#[serde(rename_all = "camelCase")]`, optional fields as
   `Option<T>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`,
   tagged unions as `#[serde(tag = "kind")]` where TypeScript uses a `kind`
   field. Unknown fields are ignored (the app may send more). JSON from the
   app must deserialize unchanged.
3. **Errors.** Where TypeScript throws, return `Result<_, EngineError>`
   with the identical message text (the app shows messages and tests match
   them): `EngineError::new` for `Error`, `EngineError::range` for
   `RangeError`. Numbers in messages go through `js::num::to_string` /
   `to_fixed`. `EngineError` lives in `src/error.rs`.
4. **Numbers.** `f64` everywhere TypeScript has `number`; indices `usize`.
   Fixtures encode NaN and the infinities as strings (see `write.ts` and
   `tests/common/mod.rs::num`). serde_json uses `float_roundtrip`.
5. **No unsafe, no panics on user input.** Panics only for internal
   invariants. Dependencies: serde (+ `rc`), serde_json; `clarabel` for the
   FE limit analysis (pure Rust, compiles to WebAssembly; HiGHS is not
   ported); `rayon` as an optional feature; wasm-bindgen (exact pin),
   js-sys, serde-wasm-bindgen in cslope-wasm only; pyo3, pythonize, numpy
   (optional) in cslope-py only. Ask before adding others.
5b. **Architecture.** ARCHITECTURE.md is binding for data ownership
   (materials by `MaterialId` index in the slope's table, models as
   `Arc<MaterialModel>`, no `Rc`/`RefCell` in the model, lazy caches as
   `OnceLock`, module-level buffers as scratch structs passed by `&mut`),
   the public API, `RunCtx` (progress, cancel, injected clock: never read
   time directly) and parallelism (`Evaluator`).
6. **Tolerance policy (decided by the user).** The target for the factor
   of safety is 1e-6; differences up to 1e-4 are not a practical problem
   but must be explained. The goal is a faithful port, not bit identity
   with V8: std's libm is used, and last-bit differences are accepted.
   Concretely:
   - geometry, slices and other intermediate values: relative 1e-9 (exact
     where the arithmetic has no transcendental functions, but don't chase
     last bits);
   - factor of safety of a given surface: within 1e-6;
   - minimum factor of safety of a whole search: within 1e-6. A search that
     takes another branch on a near-tie and so differs by more than 1e-6
     (but at most 1e-4) is accepted only if the cause is shown and the case
     is listed in `tests/allowlist.toml` with the reason;
   - every verification check passes with its existing tolerance;
   - FE: strength reduction within 1e-6 on F (same rule for near-ties up to
     1e-4); bounds within the solver tolerance.
   A difference above 1e-4 is a bug to find, never a tolerance to widen.
   The agreement figures quoted per module below (largest differences per
   surface and per search, the near-ties of `tests/allowlist.toml`) are
   measured natively, with the libm of Rust's std on the test machine
   (glibc on Linux), against V8's own implementation of the functions:
   they depend on that libm, not only on the port. On another platform,
   or in WebAssembly (where std's math is a different libm), the last
   bits of sin, cos, atan and so on differ otherwise, and so can these
   figures and which searches meet a near-tie. A result that moves with
   the last bit of its inputs (an unconverged iteration, a solve on the
   edge of failing) is compared only where it is well-conditioned
   (tests/solvers_branches_diff.rs measures this per result).
7. **Tests per module.**
   - Port the module's TypeScript unit tests (`*.test.ts` that test it
     directly) to Rust tests with the same cases and expectations.
   - Differential tests: export inputs and outputs of the module's public
     functions from the TypeScript engine on realistic inputs (the
     verification problems in `verification/problems.ts` built with
     `buildSlope`, plus edge cases from the unit tests) and compare. Expect
     exact equality for arithmetic; allow 1e-12 relative where libm differs
     (`atan2`, `exp`, `pow`, trig); for search results say what tolerance
     and why.
8. **Quality gate before reporting a module done:** `cargo fmt --check`,
   `cargo clippy --all-targets -- -D warnings`, `cargo test` (release
   profile for slow tests is fine), the fixtures regenerate from scratch, and
   a self-review of the diff against the TypeScript file, line by line.
   `set -e -o pipefail; bun packages/website/scripts/check-names.ts --repo`
   must pass (no other slope-stability program names in tracked files).
9. **Ownership.** Each agent edits only the files of its assigned modules,
   its own `tools/fixtures/<area>.ts` and `tests/<area>_*.rs`. Shared files
   (`lib.rs`, `mod.rs`, `Cargo.toml`, `error.rs`) get one-line additions
   only; the integrator resolves conflicts.
10. **Customer data** in the scratchpad (Lovö, Teodoliten, SVOA) is never
   used, copied or referenced.

## Status

| Area | TypeScript | Status |
|---|---|---|
| types | types/* | done (unit tests ported; round trips and differential fixtures `types`) |
| math | math/* | done (unit tests ported; differential fixtures `math`) |
| geometry | model/geometry-ops.ts (jsts replaced) | done: bit-identical to jsts on all fixtures incl. the importer fuzz corpus |
| canonical, waternet | model/canonical.ts, model/waternet.ts | done (unit tests ported; differential fixtures `canonical`) |
| fem leaves | fem/sparse, anderson, elements, mesh, conic | done: bit-identical to the fixtures (meshes, factors, solves, Anderson steps, Clarabel solutions) |
| model core | model/slope, composite, surface, reinforcement, search, build-slope | done (JSON read as TypeScript reads it: differential fixtures `json-compat`, 11,014 material models, definitions, options, setter sequences): SlopeSnapshot within 1e-9 (largest 8.9e-16) for 997 variants of 216 definitions; plane lists key-aligned within 1e-9 except accepted near-ties (below); unit tests ported (tests/model_core_*.rs), the ones that need an analysis listed below |
| slices and solvers | model/slices, solvers, steps, mp-march, drawdown, surface-slide, result-warnings | done: per surface (1074 planes, 44,889 slices; every verification problem and branch-covering extras) slices within 1.8e-12, F within 1.3e-11; whole circular searches (381) minima within 2.5e-13 except 10 allowlisted near-ties (tests/allowlist.toml, ≤ 5e-5); native verification 382 checks pass, 32 wait for the optimisation (seams below); rare branches (tests/solvers_branches_diff.rs): a fuzz of 12,000 random slice sets through every solver (well-conditioned results within 1e-10), slice sets and surfaces chosen for each rare exit of Morgenstern-Price, the march solver, evaluatePlanes and rapid drawdown; unit tests and the deferred analyses ported (tests/*_unit.rs) |
| optimisation | model/optimize, block-search | done: every batch of the optimisation and the block search of the 32 optimised verification analyses and 6 ACADS 3(a) block searches (tests/optimize_fixtures.rs): the same batches (but the circle batches of two circle-search near-ties, V009c and V053, causes C and A, listed in the test), 230,613 polyline surfaces with points within 3.5e-10 and F within 6.4e-10; minima within 8e-11; whole searches (410, the optimised ones included) as before plus one allowlisted first-pass near-tie (V009c); serial = rayon bit for bit; unit tests ported |
| reliability, 3D, helpers | model/reliability, sgi3d, property-helpers | done: 94 reliability analyses (the 18 probabilistic verification problems, reliability.test.ts and reliability-edge.test.ts cases) β, pf, Taylor terms, Monte Carlo statistics and samples within 1e-9 (two σ = 1e-6 cases within 8e-9, cancellation), progress and errors equal, the 30 probabilistic checks pass; sgi3d bit-identical on 168 results (28 analysed slopes, TypeScript's surfaces); Monte Carlo serial = rayon bit for bit; unit tests ported; invariants-search and invariants-paths ported (tests/invariants_unit.rs) |
| product path | api/run-analysis (TypeScript, moved from the desktop worker), api/run_analysis | done: the full AnalysisResult (but elapsedMs) of 409 runs (every verification analysis, every eighth also with both directions, the SGI 3D cut) within 1e-6 (largest 4.3e-8 outside allSurfaces), near-ties as explained below (tests/run_analysis_fixtures.rs) |
| fem model | fem/model, seepage, piles, bars, newton, bfgs, srm, initial-stress, transfer, adapt | done: assembled models (65 cases), elastic solutions, initial stresses, seepage heads, refinement and transfer within 1e-9 (largest 2.2e-10; bit-identical but where std libm enters); trials with the TypeScript iteration counts (states within 3e-11); strength reduction of all 35 FE verification problems on their first mesh and 20 option variants: F identical, the same trials (tests/fem_*.rs); rare branches (tests/fem_branches_diff.rs: 6,000 return-map trial stresses in every regime bit for bit, pile forces, seepage without water, Newton trial exits); no allowlist entries; unit tests ported, the ones that need analyzeFem listed below; wasm exports and shims: FE facade |
| fem limit analysis | fem/limit-common, lower-bound, upper-bound, bound-adapt, analysis, summary | done: on the 35 FE verification problems the bounds within 1.8e-6 (lower) and 8.3e-8 (upper) of TypeScript's, the programs within 1e-12, 8 exact fan ties (atan2's last bit) within 1.1e-4; analyzeFem F identical on all 35 with the same trials, levels and meshes; native FE verification 34/35 as in TypeScript (V056 fails in both); runFemSummary JSON identical on all 35 (rounded numbers bit-identical), runFemSummaryWithBounds the same on 20, the other 15 refine the bound meshes otherwise (exact ties: atan2's last bit, Dörfler marking of a degenerate optimum) and equal TypeScript under Bun (platform libm) bit for bit; unit tests and the deferred analyses ported (tests/fem_*); wasm exports and shims: FE facade |
| wasm + facade | crates/cslope-wasm, packages/engine (TypeScript API over WebAssembly) | done: every module, api/run-analysis and the parallel evaluator path over the engine; every test file of packages/engine ran unchanged on it (see "The limit equilibrium facade", "FE facade") |
| cutover | the app, the tests, the website, the report on the Rust engine; the TypeScript engine removed | done 2026-11-04 (see "Cutover") |
| FE facade | crates/cslope-wasm/src/api/fem.rs, fem_testing.rs; packages/engine/src/facade/fem | done: the 21 fem modules shimmed; the 14 FE test files (70 tests) pass unchanged on the Rust engine, no known differences; the slope crosses as the model facade's handle (`_h`) (see "FE facade" below) |
| python | crates/cslope-py | done: `cslope` (pyo3 + pythonize, abi3-py39): analyse, fem_summary, reliability, to_canonical, validate_material_model, Slope, CancelToken; results equal the native engine bit for bit and TypeScript within 1e-6 (tests/test_parity.py); any thread count bit for bit; wheels workflow .github/workflows/python.yml; see "Python binding" below |

## Decisions

Non-obvious choices made while porting, for the integrator and later
porters. Each names where it lives.

- **Material references** (types/material.rs, types/geometry.rs): as
  ARCHITECTURE.md §1. `MaterialId(u32)` (defined in types/material.rs) is
  the index into the slope's material table; `GeometryWithMaterial.material`
  and `Slice.base_material` hold it. `Material.model` is
  `Arc<MaterialModel>` (serde `rc`), `Material.external_key` is skipped by
  serde. `Slice.strength_model` is `Option<Arc<MaterialModel>>` and
  `Slice.shear_normal` `Option<Arc<ShearNormalModel>>`.
  `ResolvedStrength.shear_normal` is an `Arc` of a copy of the model, made
  only for that (rare) kind, because `resolve_strength` takes
  `&MaterialModel`; it serializes with its `kind` as TypeScript's object.
- **`SliceData.base_material` is a `Material` value**, not an id: it is
  the result DTO the worker posts, whose JSON is `{ name, color, model }`.
- **`MaterialModel`** (types/material_models.rs) is a serde enum tagged on
  `kind` with one struct per kind and the shared fields in a flattened
  `MaterialModelBase`. `phiB` and `maxSuction` live in the base for every
  kind (JavaScript keeps them on any model; validation reports them on a
  kind that does not take them). Deserialization dispatches on `kind` by
  hand so that an unknown kind becomes `MaterialModel::Unknown` (kept for
  `validate_material_model` and `resolve_strength` to report with
  TypeScript's messages) while a malformed known kind is a serde error.
  `SpatialInterpolation` and `DepthReference` keep an unknown string
  (`Other`), as TypeScript reads it (IDW fallback, validation message).
- **JS numbers in JSON** (types/json.rs, not a port): plain JSON has no NaN
  or ±Infinity. Required numbers accept `null` (what `JSON.stringify`
  writes for them) as NaN and the fixture strings "NaN"/"Infinity"; in
  material models a missing required number is NaN (TypeScript's
  `undefined`, which validation rejects as not finite). Optional numbers:
  absent or `null` is `None`, except where TypeScript tests
  `v !== undefined` before a finiteness check (`json::present_num`: `null`
  or another type is NaN, which the check rejects with TypeScript's
  message; see "JSON as TypeScript reads it"). Fields typed `T | null` and optional
  (`partialFactors`, `minSlipArea`, `blockActiveAngle`, `k0`,
  `otherDirectionMinFOS`, …) are `Option<Option<T>>` (`Some(None)` is
  `null`). serde_json writes non-finite numbers as `null`, as
  `JSON.stringify`. A point list that is `null` reads as empty.
- **JSON as TypeScript reads it** (types/json.rs, material_models.rs,
  validation.rs, slope_definition.rs, reinforcement.rs, model/slope.rs;
  differential fixtures `json-compat`): the engine reads every JSON the
  TypeScript engine reads, with its messages and silent defaults.
  - *Material models*: `MaterialModel::from_json` never fails. JSON in the
    engine's own shape (it serializes back to the same JSON) is typed
    directly. Any other JSON (a field of another kind, which validation.ts
    also checks, `null`, a value of another type, a point with the wrong
    number of values, an unknown kind, a model that is not an object) is
    validated by `validate_material_model_json`, a port of validation.ts
    over the JSON with JavaScript's rules (`json::js_*`: `Number.isFinite`
    takes numbers only, comparisons convert with `ToNumber`, `===` does not,
    reading a field of `null` is TypeScript's TypeError). Valid JSON is then
    read as TypeScript reads it (`null` fields as absent, `bBarLoad` by
    truthiness, `yieldFromEarlierStage === true`, `spline` when truthy, any
    `interpolation` value, other fields dropped); invalid JSON is kept
    (`UnknownModel.raw`) for `try_validate_material_model` to report and
    `resolve_strength` to refuse. One message is the port's own: a model
    validation accepts but whose value the types cannot hold ("The <kind>
    model has a value of a type the engine does not read."); the fuzz
    fixture (11,014 models) has none. `SlopeMaterialDefinition.model` is
    taken when truthy (`if (m.model)`), else the legacy flat fields.
  - *Errors*: `ErrorKind::Type` (`EngineError::type_error`, a JavaScript
    TypeError across the boundary) for TypeScript's own TypeErrors that the
    port reproduces (`aboveWater: null`, `intersliceDataPoints: null`,
    `blockActiveAngle: true`: "r is not iterable").
  - *Analysis options* (`AnalysisOptionsPatch`): a number that is `null` or
    of another type is NaN (`present_num`), so TypeScript's check gives its
    message ("Analysis option slices must be a finite number."); `method`,
    `porePressureHead`, `searchMethod` and `intersliceFunction` are
    `json::OrOther` (another value, `null` included, fails TypeScript's
    check at its place in the order, after the options before it were set);
    the flags are their truthiness (`compositeSurfaces: null` is false;
    the getters return the boolean, TypeScript the value given, which every
    use reads by truthiness); `partialFactors` that are not truthy are
    `null`, other values of the wrong shape NaN factors (TypeScript's
    message); `blockActiveAngle` / `blockPassiveAngle` are
    `AngleRangePatch` (`const [lo, hi] = r`); `minSlipArea` accepts `null` (older projects' automatic minimum), which is 0, no limit;
    `intersliceDataPoints` is `IntersliceDataPointsPatch`: TypeScript's
    filter (a point needs two values that `isFinite` accepts; further values
    are left out, every use reads x and f), a value that is not a list is
    its TypeError. Values the coercing filter keeps but the interslice
    function drops (`"0.5"`, `null`) are NaN and dropped (TypeScript's
    getter shows them; on a mirrored model `1 - x` would make such an x a
    number: not followed).
  - *Definitions*: `waterTable.mode` / `.value` keep another value (`Other`:
    the water table is left out, as buildSlope leaves it; a custom list
    that is not of points goes to `setWaterTable`, whose check rejects it);
    `waterTable.followBoundary` is `?? true` (`nullish_truthy`),
    `waterTables[].followBoundary` a default parameter (`null` is false,
    `truthy`); `waterTableId: null` is `Some(None)` (TypeScript assigns it:
    `hasMaterialWaterTables`, the default line); reinforcement `direction` /
    `application` and pile `location` / `application` keep another value
    (`Other(Value)`, acting as TypeScript's last branch: axial, not passive,
    not at the centroid; `null` is absent, as `??`); pile `direction: null`
    and `null` in the optional numbers of piles and reinforcement that
    setPiles / setReinforcements check are values (`present`,
    `present_num`), so the checks give TypeScript's messages; `wall` is
    `?? default` then truthiness; `prestress` `ToNumber` (unchecked).
  - *WebAssembly*: serde-wasm-bindgen reads `undefined` as `null`;
    `convert::from_js` first leaves out the fields whose value is
    `undefined` (plain objects, copy on write), so `{ slices: undefined }`
    is no option while `{ slices: null }` is TypeScript's error.
  - Not followed: values of other types in fields TypeScript neither checks
    nor reads by truthiness or `??` (a string coordinate, a number as a
    water table id: serde errors), an unknown `pullout.kind`, legacy flat
    material fields of another type.
- **Counts as f64**: `AnalysisOptions.slices`, `iterations`, … and the
  count constants (`DEFAULT_SLICES`, …) are `f64`, as TypeScript's
  `number` (slope.ts clamps and rounds them). Indices and counts in results
  (`ReinforcementForce.index`, warning counts, FE element counts and
  triangles) are `usize`.
- **Unknown fields** are dropped on deserialization (round trips compare
  the JSON the app and the verification produce, which has none).
- **`FemAnalysisSettings.material_stages`** is a `BTreeMap` (name order);
  the FE port must not rely on its iteration order matching TypeScript's
  insertion order.
- **Waternet cache** (model/waternet.rs): TypeScript's `WeakMap` cache of
  the compiled head lines is a `OnceLock` field skipped by serde; like the
  WeakMap it is not renewed if the lines are changed afterwards
  (`Waternet::new` starts empty).
- **Errors**: `Material::new`, `get_y_at_x_strict` and
  `get_line_between_points` return `EngineError::range` (RangeError);
  everything else `EngineError::new`.
- **Lint allowances**: lib.rs allows `clippy::neg_cmp_op_on_partial_ord`
  and `clippy::manual_range_contains` crate-wide (the port keeps
  TypeScript's NaN-aware `!(x > 0)` and `x >= a && x <= b`); tests/common
  allows `clippy::disallowed_methods` for its tolerance helper.

- **Slice base of a circle** (model/slices.rs `SliceBase`, `slice_base`,
  `with_slice_base`; not a port: an experiment switch, 2026-11-04). The
  engine's base of a slice of a circle is the arc (the arc length, α at
  the middle of the arc, the weight of the soil above the arc, the steep
  ends of the circle cut into narrower slices; CHANGELOG 2026-11-02). The
  environment variable `CSLOPE_SLICE_BASE=chord` makes it the
  conventional straight chord between the slice's edges, as the other
  programs discretise a circle (the chord's length and inclination, the
  weight of the polygon above the chord, the base point at the chord's
  middle for the pore pressure and the strength); `chord-even` also
  leaves the steep ends uncut (the nominal slices only). It is read once
  per process; absent in WebAssembly (no environment), so the app always
  analyses on the arc; `with_slice_base` overrides it on one thread for a
  test (tests/slice_base_unit.rs). The moment arm of the weight stays
  W·dx (the other programs take W·R·sin α of the chord, +0.03–0.1 % on F
  at 30 slices). Measured on the verification (tests/verification_native
  checks, `cargo run --release --example run_check -- --all`): against
  the programs' values the mean absolute error is 0.333 % on the arc,
  0.316 % on the chord and 0.307 % on the chord without the end cut
  (RMS 0.464 → 0.445 → 0.438 %); against the papers 0.485 → 0.480 →
  0.505 %. Against the converged value (500 slices) on 38 .gsz example
  surfaces the arc is within 0.03 % on average at 30 slices, the chord
  +0.11 % and the chord without the end cut +0.17 %, which is where the
  programs' own values sit (+0.16 %); with `chord-even` and the files'
  slice counts cSlope reproduces the files' slice weights, base angles
  and base lengths exactly and their F within 0.1 %. The arc stays the
  default: it converges from the first slice count, and the chord only
  reproduces the other programs' discretisation error.
- **jsts replacement (geometry).** `model/geometry_ops/jts/` ports exactly
  the jsts 2.12.1 code paths `geometry-ops.ts` reaches, not a general
  geometry library and not the `geo` crate: the order of faces, their start
  vertices, directions and holes come from jsts internals (the old
  `OverlayOp` edge list, `PolygonizeGraph` node and edge order, the STR tree
  query order of `HoleAssigner`, `EdgeRing.EnvelopeComparator`), and later
  code (material assignment by first containing face, keyholes, slices)
  depends on them. Ported: `RobustLineIntersector` with the double-double
  orientation predicate and `Intersection`; the geometry graph noding with
  the monotone-chain sweep line (`SimpleMCSweepLineIntersector`, first
  intersection per edge key kept, so visiting order is reproduced);
  `OverlayOp` union of linework with `EdgeNodingValidator` and the
  `SnapIfNeededOverlayOp` fallback (`SnapOverlayOp`: common bits removed,
  `GeometrySnapper`), which the region split of two regression tests
  needs; `MCIndexSnapRounder` (hot pixels in scaled integer coordinates,
  the chain recursion that decides which segments a hot pixel is tested
  against; only intersection points are rounded, input vertices never
  move); `Polygonizer` with `IsValidOp` for rings (including its quirks:
  the closing-pair test against the last point index, the first
  intersection skipped); `InteriorPointArea`; point location by ray
  crossing (`polygon.contains(point)` = location interior);
  `polygon.intersects(line)` as `RelateOp.intersects` (`jts/relate.rs`:
  `RectangleIntersects` for an axis-aligned rectangle, else the full
  `RelateComputer` with edge-end stars and their labelling), because its
  answer on degenerate input is jsts's own: a cutting line of one distinct
  point meets a polygon only at its first vertex (a rectangle anywhere),
  and a self-crossing or self-touching outline throws "side location
  conflict [ (x, y, NaN) ]" outside the try, so
  `splitPolygonByPolylineDetailed` throws (reachable through
  `setMaterialBoundary` with an invalid outline). One simplification,
  argued in the code: the noding validator tests every pair of segments
  whose x ranges overlap (a sweep over the segments sorted by least x)
  instead of pairs from different monotone chains (pairs within a chain
  can never fail it); same verdict, cost of the overlapping pairs (40
  lines of 1000 vertices: 99 ms instead of 2.7 s). Differential tests
  compare the public functions and the jsts primitives themselves (union,
  snap-rounded noding, polygonizer) bit for bit.
- **Sorts are V8's TimSort** (js/array.rs): `js::array::sort_by` ports
  `Array.prototype.sort` of V8 12.4 (`third_party/v8/builtins/array-sort.tq`,
  the V8 of the Node and Electron the app ships with): runs, binary
  insertion to the minimum run length, the merge stack, galloping with the
  adaptive threshold, a NaN comparison as 0. The comparator is called on
  the same pairs in the same order as in V8, so an inconsistent comparator
  (NaN keys, `a - b` of infinities) gives V8's order, and it never panics
  (std's `sort_by` panics on such comparators since Rust 1.81). The
  `js-sort` fixtures (Node) check 2020 arrays, 1092 of them with
  inconsistent comparators.
- **Accepted divergences in the geometry on malformed input** (no panics,
  covered by fuzzing against TypeScript): (1) NaN coordinates in a polygon
  or line given to `splitPolygonByPolylineDetailed` /
  `polygonizeRegions`: jsts keeps nodes and edge ends in red-black tree
  maps whose `compareTo` calls NaN equal to everything, so which entries
  merge depends on the tree's shape; the port's sorted lists can merge
  others (about 2 % of random NaN cases differ). Infinite coordinates
  agree. (2) x and y arrays of different lengths: TypeScript reads a
  missing value as `undefined`, which is NaN in arithmetic but equal to
  itself (`===`), so a ring whose missing y values all compare equal is
  closed for jsts; the port reads NaN. Where the two agree (most cases)
  the fixtures compare them. (3) Open for the slope.ts port:
  `polygonizeRegionsDetailed` throws in TypeScript when the outline's
  first or last vertex has a NaN coordinate (the ring is closed with a
  copy of that vertex, which jsts's `LinearRing` does not see as equal:
  "Points of LinearRing do not form a closed linestring", thrown outside
  its try); the Rust function has no error result and returns the unsplit
  outline with `failed: true`. About 6 % of a random NaN corpus; whoever
  ports its callers decides whether to give it a `Result`.
- **HiGHS (fem/conic.ts `solveHighs`, `toLpText`) is not ported.** Every
  bound program goes to Clarabel (`fem::conic::solve_clarabel`), as
  implemented in lower_bound.rs (`bound_solve`), upper_bound.rs and
  bound_adapt.rs: `boundSolver: "highs"` still deserializes
  (`BoundSolver::Highs`) and is solved by Clarabel, `sides` is kept but not
  read. The facade's `loadHighs` resolves, as `loadClarabel` does (see
  "FE facade" below), so that code written for HiGHS keeps running.
  Effect: such
  a run gives the Clarabel bounds, i.e. the exact Mohr–Coulomb cone instead
  of the inscribed p-gon (default 24 sides). Both are rigorous; the exact
  cone gives a higher lower bound and a lower upper bound (the p-gon
  shrinks the criterion by cos(π/p), 0.9914 for p = 24, i.e. about 1 % on
  c and tan φ), so F from a former "highs" run moves by up to about 1 %
  toward the other bound. The default ("clarabel") is unchanged.
- **Clarabel**: `clarabel = "=0.11.1"`, `default-features = false,
  features = ["serde"]`, as packages/engine/clarabel builds clarabel.wasm
  (0.11.1 does not compile without `serde`). It has no `wasm` feature: on
  wasm32 targets it uses web-time for its clock by itself;
  `cargo build --target wasm32-unknown-unknown` builds. Same settings as the
  TypeScript module: verbose off, max_iter 400, time limit max(0.1, limit),
  static regularisation 1e-8, then 1e-6 after NumericalError or
  InsufficientProgress; other settings (tolerances, equilibration, presolve)
  are Clarabel's defaults on both sides. The engine reads no clock here:
  the time left for the retry is the limit minus Clarabel's own
  `solve_time` (TypeScript reads `performance.now` around the call); both
  only matter when a limit is reached. Native and WebAssembly Clarabel gave
  bit-identical solutions on every fixture program.
- **fem/sparse.rs**: `groups` are `i64` (−1 entries skipped); the work
  arrays of `factor` are allocated per factorisation instead of cached on
  the shared symbolic object; the matching's augmenting path search is
  iterative, in the order of the TypeScript recursion.

- **WebAssembly boundary** (crates/cslope-wasm, packages/engine/src/engine.ts,
  src/facade): wasm-bindgen 0.2.130, js-sys 0.3.107, serde-wasm-bindgen
  0.6.5, exact pins (the CLI version is checked against Cargo.lock by
  `tools/build-wasm.ts`). Serializer: maps as objects and a `None` that is
  not skipped as `null` (`serialize_missing_as_null(true)`, not false as
  ARCHITECTURE.md §3.1 sketched): the engine's types skip optional fields,
  so a kept `None` is a TypeScript `T | null` (`partialFactors: null`).
  Values of the wrong shape are TypeErrors.
  The `wasm-release` profile strips debug info only (`strip = "debuginfo"`):
  `strip = true` also drops the `target_features` section wasm-bindgen
  reads, and the name section (+200 kB raw, +17 kB brotli) gives readable
  traps. `build-wasm.ts` appends `__wbg_reset()` to the generated glue, so
  that `engine.ts` can instantiate the module again after a trap; handles
  carry the engine epoch so that those of the old instance are refused.
- **`MaterialModel` deserialisation keeps NaN and ±Infinity**
  (types/json.rs `JsJson`, used in types/material_models.rs): the model is
  buffered before its kind is read; it was buffered as a
  `serde_json::Value`, which turns a non-finite number (from
  serde-wasm-bindgen) into `null`, so an optional NaN or Infinity read as
  absent and validation missed it. `JsJson` keeps them as the strings
  "NaN"/"Infinity"/"-Infinity" that `JsNum` reads.
- **Committed build during the port**: only the product glue
  (`packages/engine/src/wasm/cslope_wasm.js`, `.d.ts`), which the facade
  is typechecked against; the `.wasm` (about 1 MB, 240 kB brotli) and
  BUILD-INFO.json are ignored until Phase 6 commits them, and
  `tools/check-wasm-fresh.ts` then joins the check job. The testing build
  (`src/wasm-testing`) is never committed.
- **Facade semantics**: values cross as copies; `shareUnchanged` gives
  back the input's own objects where the result equals them (TypeScript's
  spreads keep identity); `Material` keeps a given `model` object and has a
  non-enumerable `_key`; `materialModelOf` returns a given `model` itself;
  `materialLayerTopAt` maps materials to indices by identity; constants and
  defaults stay TypeScript data, checked equal to `engine_constants()`.

### The limit equilibrium facade (crates/cslope-wasm/src/api/slope.rs, model.rs, analysis.rs, wire.rs, testing_le.rs; packages/engine/src/facade/model, api)

- **Slope over a handle** (api/slope.rs, facade/model/slope.ts): the
  facade `Slope` holds a `SLOPES` registry handle (`slope._h`, refused
  after an engine restart); `buildSlope` wraps the handle the engine
  made. Other export modules reach a slope with `with_slope` (a shared
  borrow of the registry while `f` runs: `f` may call JavaScript that
  reads slopes) and `with_slope_mut` (the slope taken out and put back:
  `f` may call JavaScript; a call on the slope meanwhile, or any change of
  a slope while a `with_slope` callback runs, is the Error "The slope is in
  use by a running analysis.", never a panic). The FE exports use the same
  two (`{ $slope: slope._h }`).
- **Snapshots and their cache**: getters return copies (one export,
  `slope_get(h, name)`), cached by the facade until the slope's stamp
  changes. The stamp changes when a mutable access changes
  `Slope::version()` (adding a material to the table alone does not), so
  `slope.search === slope.search` until the slope changes, and a snapshot
  taken before a change stays as it was. Loads, reinforcement, piles,
  the waternet and child slopes set from JavaScript are given back as the
  objects set (TypeScript keeps them); `earlierStage`/`drawdownBefore` of a
  built slope are copies under their own handle. `setEarlierStage(s)`
  copies `s` into the parent (TypeScript shares it; no test changes a child
  afterwards). `getWaterLineForMaterial` gives back `waterRLXY` itself for
  the default line.
- **Material identity** (facade/materials.ts): every facade `Material` has
  a key in a registry of weak references; a material crosses as
  `{ key, name, color, model }` and the table entry of that key is reused
  (`Slope::insert_material`). A material the engine made (buildSlope) gets
  a JavaScript object, and the engine's entry its key
  (`Slope::set_material_external_key`, a facade helper, not a port), the
  first time it is handed out, so `slices[0].baseMaterial ===
  materialGeometries[0].material`. `materialsChanged()` sends the current
  models of the materials JavaScript knows (TypeScript reads them in
  place).
- **Slices and planes in bulk** (api/wire.rs, facade/slice-codec.ts): the
  numbers of all slices cross as one `Float64Array` (42 per slice: the 25
  numbers, isValid, the material's table index, a mask of the optional
  fields and their values), the structured fields (reinforcement,
  Hoek–Brown, strength models) as a sparse list, the planes' own fields by
  serde with their slice counts. Through serde objects `slope.search` of
  V001 (2,105 planes, 109,048 slices) took 2.1 s against the analysis's
  0.4 s; now 0.14 s. A field a partial slice leaves out reads as NaN (a
  flag as false), as TypeScript's `undefined` in arithmetic (tests pass
  partial slices: `shallowCohesionlessMessage`, `analysisWarnings`).
- **The critical slices only, the others on request**: `analyseSlope`,
  `analyseSlopeSteps` and `runAnalysis` run with
  `SliceRetention::Critical`; a plane of `slope.search` (or
  `individualPlanes`) whose slices were dropped gets a `slices` getter that
  evaluates the plane again (`slope_plane_slices`; the same surface gives
  the same slices) while the slope is the one analysed, and throws once it
  has changed. With every slice kept, an analysed slope took up to 180 MB
  of WebAssembly memory until JavaScript collected the facade's object
  (FinalizationRegistry callbacks wait for a free turn of the event loop,
  which a run of synchronous tests rarely gives), the memory never shrinks,
  and beyond about 1.2 GB every analysis became 15 times slower; a
  verification test file then took 2.5 times TypeScript's time. Now about
  2 MB per analysed slope.
- **Changed slices are written back**: the solvers (`analyseBishop`,
  `analyseMorgensternPrice`, `solvedEffectiveNormals`,
  `applyReinforcement`, …) return `{ result, slices }` and the facade sets
  the caller's slice objects to the engine's (`baseMaterial` kept);
  `evaluatePlanes` replaces the planes' fields in place, as TypeScript and
  `applyEvaluatedPlane` do.
- **Steps and callbacks**: `analyseSlopeSteps`, `blockSearchSteps`,
  `optimiseNonCircularSteps` and `optimisePolylinesSteps` are generators
  over a steps handle (api/analysis.rs `steps_resume`): each batch is
  yielded as planes, evaluated by the driver (in JavaScript, or on an
  `EvaluatorPool`) and handed back on the next resume, so the parallel
  evaluator path and `analyseSlopeAsync` run the engine's search
  unchanged; `analyseSlopeSteps` generates the planes and sets the results
  as the TypeScript generator does. `optimiseNonCircular`, `blockSearch`
  and `optimisePolylines` call the caller's `evaluate` from Rust (a bridge
  that maps the materials, which are bound to objects before the call
  because the slope is borrowed meanwhile). `findAngleCrackX`,
  `findCrackX` and `boundaryCornerInMass` call their JavaScript functions.
- **Reliability**: `analyseReliability` is the engine's (progress through
  `onProgress`); `analyseReliabilityAsync` runs `ReliabilitySteps` over a
  handle: an analysis step's slope moves into the slope registry while the
  runner analyses it (`EvaluatorPool.analyse`), and back on the next
  resume; a samples step's sampler evaluates in the engine. The pool sends
  evaluators the step's definition: `ReliabilitySteps::analysed_definition`
  and `samples_definition` (accessors for drivers, not ports).
  `monteCarloSampler` returns a function over a sampler handle.
- **runAnalysis** is api/run_analysis.rs with `onProgress(surfacesEvaluated)`
  (every 256 surfaces: the engine reports by chunk, not by batch);
  `runAnalysisAsync` keeps TypeScript's orchestration over the shims and
  assembles each result in the engine (`analysis_result`).
- **Not through the facade**: `createSlice` and `shansepStrengthAt`
  (internals of getSlices whose context is closures over material
  objects) throw; no test or caller uses them. `isBlockSurface` knows the
  planes the facade's block search returned. `marchCounter.count` reads
  the engine's counter. `property-helpers.ts`, `verification-shard.ts`
  and src/verification stay TypeScript test support and data over the
  shims (no shim: their engine calls are the shims').
- **Product or testing build**: a shim exports every runtime name of its
  module, and the model modules' internal functions with plain arguments
  (`floorYAt`, `pileForceDirection`, `entryInclination`, …) are thin
  product exports of engine functions the analysis links anyway; only
  those that need the engine's internal state across calls (the slice
  arrays of `getSlicePropertyArrays` and the march solver, the plane
  generators `generateRefinedPlanes`/`generateLocalPlanes`) are in the
  testing dispatcher (testing_le.rs). To move to `__test_call` with the
  cutover if the product size asks for it (product wasm 2,146 kB, 497 kB
  brotli, with the whole engine now reachable from its exports).
- **Engine changes for the facade** (both TypeScript's behaviour): a
  `development` pullout without `length1`/`length2` reads the length as
  NaN and fails `set_reinforcements` with TypeScript's message (was a serde
  error); a definition without `materials` reads as none and fails
  `build_slope` with "The model needs at least one material." (was a serde
  error).

### Model core (model/slope.rs, composite.rs, surface.rs, reinforcement.rs, search.rs, build_slope.rs)

- **Material table** (slope.rs): `Slope.materials` is the table every
  `MaterialId` indexes; TypeScript's `_materials` (the materials registered
  by `addMaterial` / `assignMaterial`, whose first is the default of
  `setExternalBoundary`) is `registered`. `add_material(Material)` inserts
  and registers (a material whose `external_key` is already in the table
  gets that id: the same JavaScript object), `insert_material` only inserts
  (an object never passed to `addMaterial`), `register_material(id)` is
  `addMaterial` of a material already in the table (build_slope).
  `assign_material(coord, id)` with an id outside the table gives
  TypeScript's "assignMaterial only accepts instances of the Material
  class". `setExternalBoundary` without a registered material puts the
  default `new Material()` into the table (not registered, as in
  TypeScript). Monte Carlo writes a model with `set_material_model(id, Arc)`
  (resets the results). Equal materials under two ids are two materials,
  as two JavaScript objects are (material interfaces, water tables).
- **Options**: `AnalysisOptionsPatch` (`Partial<AnalysisOptions>`, serde)
  and `AnalysisLimitsPatch` (`Partial<AnalysisLimits>`) live in slope.rs;
  `T | null` fields are `Option<Option<T>>`. `_optionsGiven` merges patches
  field by field (a JavaScript `undefined` value in a spread cannot occur
  in deserialized JSON). An unknown `method`, `porePressureHead`,
  `searchMethod` and `intersliceFunction` fail TypeScript's checks with its
  messages (see "JSON as TypeScript reads it"); a `development` pullout
  without a length reads it as NaN and fails TypeScript's check with its
  message (was serde's error until the facade).
  `update_analysis_options` keeps TypeScript's order: options set before
  a failing check stay set; setting `compositeBase` resets the floor cache
  at once (TypeScript keys that cache on it).
- **Caches** are `OnceLock`s replaced by `reset_results`: the composite
  floor, reinforcement envelopes, pile profiles (`Result`, an error is not
  cached as in TypeScript's `??=`), and the per-slope WeakMap caches of
  surface.ts (`belowGroundBoundary`) and search.ts (`materialInterfaces`),
  which depend only on the geometry and its materials, all changed through
  `reset_results`. `basinOf`'s per-plane cache and the y-intersection
  caches are dropped (pure functions).
- **Children**: `set_earlier_stage` / `set_drawdown_before` take ownership
  (`Option<Box<Slope>>`); `set_drawdown_before` returns the error of the
  options it passes on.
- **Fallible generation**: the search functions return `Result` because
  `getExternalYIntersection` and `getCircleExternalIntersection` throw
  without a surface line. `set_entry_exit_planes` is `entry_exit_planes(&Slope)`
  then `set_search_planes`. `generate_local_planes` takes the key set
  explicitly (`plane_keys` builds TypeScript's default); budgets and
  iteration counts are `f64` as in TypeScript. `pileForce`'s default
  profile argument is `pile_force_with_profile`.
- **build_slope**: a legacy top-region assignment on a first boundary
  without points reproduces TypeScript's TypeError message ("Cannot read
  properties of undefined (reading '0')").
- **Region split errors** (geometry_ops.rs, slope.rs):
  `polygonize_regions(_detailed)` return `Result` where TypeScript throws:
  `gf.createLinearRing` of the outline, outside the function's try blocks
  (a NaN first or last vertex: "Points of LinearRing do not form a closed
  linestring"). slope.ts does not catch it (its only fallback is the
  `failed` result, counted in `splitFailureCount` with its message), so
  `set_material_boundaries` passes the error on and leaves the geometry
  unchanged, as TypeScript does (fixture scenario `boundaries-nan-vertex`).
- **Unknown pile direction** (types/reinforcement.rs): `PileForceDirection`
  keeps another value, `null` included, as `Other(serde_json::Value)`
  (serde untagged variant), so `set_piles` gives TypeScript's "Pile force
  direction must be 'angle', 'tangent' or 'perpendicular'." (in
  TypeScript's order of checks); the force direction treats it as "angle",
  as TypeScript would.
- **Pile profile length** (model/reinforcement.rs `build_pile_profile`):
  `new Float64Array(n + 1)` with n + 1 beyond 2^53 − 1 (a pile tip at
  y = −1e300) is TypeScript's RangeError "Invalid typed array length:
  2e+301"; a length that cannot be allocated is its RangeError "Array
  buffer allocation failed" (`try_reserve`: in WebAssembly the memory
  limit, natively what the system gives; V8 fails from about 2^31
  elements). Below that both engines compute the profile.
- **MaterialId per-slope tag** (ARCHITECTURE.md §1.3): not added. A tag in
  `MaterialId` (debug builds) changes its layout, constructor and serde
  form, which every module and test that makes ids (`MaterialId(n)`) uses;
  ids do not cross slopes in the ported code (drawdown and SHANSEP read
  child slices for numbers only), and an id outside the table is an index
  error in debug and release alike. To reconsider with the solver port.
- **Plane-list near-ties (accepted by the integrator)**: std's sin, cos,
  atan and tan, and `hypot` of two values (V8's `Math.hypot` scales and
  sums squares; libm's is correctly rounded), return a different last bit
  from V8's for about 3 % of arguments. Circles found by bisection to be tangent to a material
  interface (typically where it meets the ground or the model's edge) are
  decided at rounding level: the decisive dip is quadratic in the
  bisection parameter, so 1e-14 moves the result by about 1e-7 relative and
  can add or drop the circle. On the fixtures (713,110 first-pass planes):
  64 only in TypeScript and 76 only in Rust, 31 with equal keys and values
  up to 1e-5 apart, all tangent to an interface; 48 key ties (the same
  circle within 1e-9 with a radius on a rounding half of the 4-decimal key,
  feet converted to metres). Refined planes (190,439): 12 / 15 / 28 / 3;
  local planes identical. Accepted up to 1 in 2,000 planes per list,
  provided every such plane is a key tie or a tangent circle that passes
  within 1e-6 of the model's size of an end of a segment of its interface
  or a corner of the model, where the tangency is decided (asserted in
  tests/model_core_fixtures.rs, so that a bug in the tangent generation
  elsewhere cannot pass as a near-tie). The gate on results is the solver
  phase's: search minima within 1e-6.
- **Tests deferred to the solver phase** (they need getSlices,
  analyseSlope or runVerification): slope-api "result queries … answer
  after it" (ported with results set directly); composite.test.ts: the five
  analyses (rock followed, lens, outcrop, bare base, tangent to the bare
  base) and the analysis in "keeps the floor up to date";
  search-branches "planes through an entry and an exit point" (analysis);
  search-tangent: "does not get worse with more iterations", "an
  impenetrable layer gives the circle tangent to it", both "below the
  minimum slip size"; search-review-c2: "the minimum without refinement
  does not change", the four re-entrant-corner tests, V050b and V051;
  material-water-table.test.ts: all but the mirror (canonical's);
  reinforcement.test.ts: rigid block (6) and large active loads;
  reinforcement-branches "forces on the slices" and "degenerate elements"
  (ported on slices made directly on the arc; to repeat with getSlices);
  pile.test.ts: "raises the FOS … either orientation", the FOS of
  lime-cement columns; layer-top-depth.test.ts: the five S = f(depth)
  analyses; staged-water.test.ts: the five staged analyses (the stress of
  the loads is ported; its waternet tests belong to waternet.ts);
  review-fixes.test.ts: the interslice FOS, Morgenstern-Price (4), Monte
  Carlo (2), the slices of the extended water line, pile force direction
  FOS (4), strength cutoff; model-coordinates and point-limits: the
  analyses (the limits and model-space mapping are ported);
  real-world-coordinates (getSlices); integration, benchmarks, solvers,
  invariants-*, round2/3 and the other solver files.

### Slices and solvers (model/slices.rs, solvers.rs, steps.rs, mp_march.rs, drawdown.rs, surface_slide.rs, result_warnings.rs; api/ctx.rs)

- **Hot path** (ARCHITECTURE.md §1.4): `get_slices` / `create_slice`
  take a `SliceScratch` (clip buffers swapped with `mem::swap`, no
  allocation per slice after warm-up). Per surface a `SliceEnv` holds the
  context TypeScript closes over (`waterForMaterial`, base, `waterForWeight`,
  `porePressureAt`) as `&dyn Fn`. A non-default strength model of the slice
  is cloned into an `Arc` (rare).
- **SliceArrays** (solvers.rs) is the solver scratch (structure of arrays):
  tan φ, cos α and sin α are computed once per surface instead of per
  iteration; the values are the same numbers, so results do not move.
  `EvalScratch { slices, arrays }` is reused across the planes of a batch
  (tests/evaluator_invariance.rs: reused scratch equals fresh scratch).
- **Steps**: TypeScript's plane generators are `PlaneSteps` state machines
  (`resume(&mut self, &Slope) -> Result<Step<T>>`, `batch()`,
  `Step::{Batch, Done}`); `InParallel` is the lockstep combinator.
  `AnalyseSlopeSteps` has the stages of analyseSlope (first pass, block,
  refined, local, optimise). `run_steps` evaluates each batch with the
  `RunCtx`'s evaluator; with progress or cancellation set it evaluates in
  chunks of 256 surfaces and reports/cancels between chunks, otherwise in
  one call (results identical either way).
- **RunCtx** (api/ctx.rs, ARCHITECTURE.md §2.2, §7): progress callback
  (`ControlFlow::Break` cancels), `CancelToken`, clock, evaluator (`Serial`
  default; `Rayon` behind the `rayon` feature, batches under 32 run
  serially) and `SliceRetention` (`All` as TypeScript; `Critical` drops the
  slices per batch and re-evaluates the critical surface at the end).
  Serial and Rayon give bit-identical plane lists.
- **Morgenstern-Price solver choice** is process-wide as in TypeScript
  (an `AtomicU8`; the march options in a `RwLock`, `MARCH_COUNTER` an
  atomic). A run captures it at start (`EvalCtx`), so a change during a
  parallel batch cannot mix solvers. Tests that switch it take a lock.
- **analysis_warnings** solves the normals on a copy of the critical
  slices (TypeScript mutates and then discards them).
- **find_crack_x** takes a fallible depth function (the Rankine depth can
  fail on a model without a surface line) and returns `Result`.
- **Optimisation seam**: optimize.rs (`optimise_non_circular_steps`,
  `optimise_polylines_steps`, which returns only the non-seed planes) and
  block_search.rs (`block_search_steps`, `best_distinct`, `BLOCK_SEEDS`)
  are called by analyse_slope at TypeScript's points (ported in the
  optimisation phase, below).
- **Per-surface comparison** (tests/solvers_fixtures.rs): degenerate
  surfaces (no clear driving moment, F about 1e14; 417) and unconverged
  solves (85; their λ arrays too) are counted, not compared: their values
  are not meaningful at 1e-9. An optional field with |v| ≤ 1e-12 present
  in one engine only (free water of 1e-16 on V038b) counts as absent.
- **Whole-search near-ties** (tests/allowlist.toml, 10 entries, each with
  its cause; empty since the minimum slip area defaults to 0, see "Golden
  results"): the surfaces are evaluated identically (the TypeScript
  critical surface evaluated in Rust gives TypeScript's F bit for bit);
  what differs is plane generation at a discontinuity: (A) a local/refined
  seed entering exactly at the entry limit (`ex < entryLeftX` without
  tolerance in search.ts; a 1e-9 tolerance there in TypeScript would
  remove this class), (B) two surfaces within ~4e-13 swapping the basin
  seed, (C) the model core's first-pass near-ties. Largest allowed 5e-5
  (V047b Morgenstern-Price). The extra searches (fixtures `searches`,
  FULL_WATER etc.) are judged by the TypeScript critical surface evaluated
  in Rust within 1e-6; their piles, loads and limits are off the search
  grid so that generation does not hit discontinuities.
- **Deferred tests**: all analyses listed under the model core's "Tests
  deferred to the solver phase" are ported (tests/composite_search_unit.rs,
  search_water_unit.rs, staged_unit.rs, reinforcement_analyses_unit.rs,
  review_fixes_unit.rs, coordinates_unit.rs) except the ones that need
  later phases: the suction finite element case (Phase 5). V050b, V051
  and V002's non-circular search, "flagged for Bishop after the
  non-circular optimisation", the Monte Carlo case, the strength cutoff
  with reliability and the SGI 3D normal-load case were ported with the
  optimisation (tests/deferred_optimise_unit.rs). Not ported: invariants-*, integration,
  round2/3, benchmarks, final-review, review-round4, combined-depth,
  orientation-matrix (largely covered by the differential fixtures and
  native verification; to revisit with the facade).
- **Benchmark**: `cargo run --release --example bench_searches [--features
  rayon] -- [filter] [repeats]` against the Node times recorded in the
  search fixtures.

### Optimisation, reliability, 3D and the product path (model/optimize.rs, block_search.rs, reliability.rs, sgi3d.rs, property_helpers.rs; api/run_analysis.rs)

- **Generators as state machines** (optimize.rs): `OptimisePoints` holds
  `optimisePoints` with the program counters of its inner generators
  (`runCycle`: init, Δ loop, round loop, the round's batch out, the
  permanent move out; `refine`; `fosOf`) and their locals across a yield;
  `CircleSeed`, `LayerSeeds` (one batch per buried weak layer, an empty
  batch yielded as TypeScript yields it), the chain of the layer seeds and
  their searches, `PolishBest`, and the two entry points over
  `steps::InParallel`, so the batches are TypeScript's batches (verified
  batch by batch). Async Rust as a generator was considered and rejected:
  the futures would hold `&Slope` across yields, which `PlaneSteps`
  (the slope passed to each `resume`) does not allow without unsafe code.
- **Object identity** (optimize.rs): `polished.plane !== best.plane` and
  analyseSlope's `optimised.filter((p) => !known.has(p))` are
  `Optimised::moved` (the search's best is not the plane it started from)
  and `seed` (that plane was a seed of `optimisePolylines`). The planes of
  a round are taken out of the evaluated batch, not cloned.
- **Budgets** are `f64` (TypeScript's numbers); `OptimiseOptions` is a
  struct (`budget_per_seed`), the sync wrappers `optimise_non_circular` /
  `optimise_polylines` take an evaluate closure as TypeScript's `Evaluate`
  (`optimise_polylines` returns unchanged seeds as copies, the steps seam
  leaves them out).
- **Block search** (block_search.rs): the `WeakMap` of genes is a list
  beside the evaluated planes (by index); the evaluated batch joins `all`
  after its evaluation (TypeScript pushes before the yield, but reads `all`
  only after it). `best_distinct` returns no `Result` (the seam's `?` was
  dropped in solvers.rs). The objects are checked when the steps are made,
  which in analyseSlopeSteps is TypeScript's first `next()`.
- **mulberry32** (property_helpers.rs `Rng`): u32 wrapping arithmetic
  (`Math.imul`, `>>>`, the 32-bit `^` of a sum); the seed through
  `to_uint32` (`seed >>> 0`: NaN and ±∞ give 0). Checked against Node.
  The rest of property-helpers builds definitions as JSON
  (`serde_json::Value`, object spreads), read as `SlopeDefinition` where
  analysed.
- **Reliability** (reliability.rs): fields named by string as in
  TypeScript, read and written on the model's JSON
  (`MaterialModel::from_json`); `RandomVariable.material` and the
  correlation indices are `f64` (a fraction or an index out of range reads
  as TypeScript reads `c[a]`). `reliabilitySteps` is `ReliabilitySteps`
  (`Analyse`: the driver analyses `slope_mut()`; `Samples`: the driver
  returns the factors of `samples()` in order), so the async/evaluator
  path of TypeScript (`analyseReliabilityAsync`) is the run context:
  the analyses' batches go to `ctx.evaluator`, the samples to the new
  `Evaluator::map_samples` (api/ctx.rs; serial by default, rayon over the
  samples with a copy of the sampler's slope per thread; all values drawn
  first, aggregated in order: ARCHITECTURE.md §7.1). Each sample sets the
  models from their base values, so a sample does not depend on the ones
  before it on the same slope (the copies give the serial result bit for
  bit). `onProgress` is `ProgressEvent::Reliability(p)` (a new variant):
  after each Taylor variable and every 50th sample, as the synchronous
  TypeScript reports; with progress or a cancel token the samples are
  evaluated in chunks of 50. The inner analyses report no progress.
- **sgi3d** (sgi3d.rs): the `Set` of excluded names is a vector in the
  order first given; the cell loops accumulate `x += h` as TypeScript does.
- **run-analysis** (packages/engine/src/api/run-analysis.ts, ARCHITECTURE
  §0 finding 2): `runAnalysis(def, options, { onProgress })` (sync;
  `onProgress(surfacesEvaluated)` after each batch) and
  `runAnalysisAsync(def, options, analyse)` (each search by `analyse`,
  e.g. `EvaluatorPool.analyse`) hold the worker's former `analyse`,
  `analyseBothDirections`, `displayPoints`, critical moments and slice
  table; `elapsedMs` is the whole run's. The desktop worker calls them
  (FE stays in the worker). Rust: `api::run_analysis::run_analysis(def,
  &AnalysisOptionsPatch, &mut RunCtx)`; `elapsedMs` from the context's
  clock; the method is the slope's (TypeScript copies `options.method`,
  the same when given); the normal forces are solved on the slope's own
  critical slices (taken out and put back: `Slope::search_mut`), as
  TypeScript's solve writes their flags; a cancelled opposite direction
  is an error, not an empty direction.
- **Near-ties of the product path** (tests/run_analysis_fixtures.rs),
  each with its cause in the test: the searches' allowlisted entries
  (minimum only); `allSurfaces` matched by surface (equal F tie order
  may swap places), surfaces in one engine only up to 4 % of a list
  (V005: 12 %, a first-pass basin tied to 1e-12 seeds other refined and
  local surfaces, cause B), surfaces the same within 1e-9 but F apart up
  to 3 % (V051: 172 of 7862; F is discontinuous where a slice too thin to
  keep is dropped: moving the entry by 1e-12 gives 52 or 53 slices; the
  TypeScript geometry evaluated in Rust gives TypeScript's F); the λ–F rows
  of other than the critical surface; both directions of a symmetric model
  (V026, tied to 1e-14) may report the other direction.
- **Tests**: tests/optimize_unit.rs, optimize_fixtures.rs,
  reliability_unit.rs, sgi3d_unit.rs, run_analysis_fixtures.rs,
  invariants_unit.rs, deferred_optimise_unit.rs (the tests deferred to
  this phase: the Bishop warning after the optimisation, V050b, V051, the
  V002 Spencer search, V061's Monte Carlo, the strength cutoff with
  reliability, the SGI 3D normal load); fixtures from
  tools/fixtures/optimize, reliability, sgi3d and run-analysis-<k>
  (run-analysis about 330 MB of JSON). Not ported yet: the other
  property-helper invariant suites (invariants-symmetry, -mechanics,
  -continuity, -equivalence, -walls, -options, geometry-props,
  surface-props), largely covered by the differential fixtures.
- **Benchmark** (`cargo run --release --example bench_optimize [--features
  rayon]`, against the Node times recorded in the fixtures, which were
  exported on a busy machine): one thread, non-circular optimisation
  14.5× faster (29.6 s against 427.5 s over the 32 optimised verification
  analyses), block search 12.7×, Monte Carlo 7.0× (the mean-value search
  included); with rayon on 4 shared cores 20.4×, 20.5×, 9.8×.

### FE model (fem/model.rs, seepage.rs, piles.rs, bars.rs, newton.rs, bfgs.rs, srm.rs, initial_stress.rs, transfer.rs, adapt.rs)

- **Size field as data** (model.rs `SizeField`, ARCHITECTURE.md §2.2):
  `Layers` (the default of `build_fe_model`: h0 and the thin parts of each
  material polygon), `Refined` (adapt.rs `RefinedSizeField`: the old mesh's
  corners, a size per element, its bucket grid), `Scaled { inner, factor }`
  (summary.ts's `BOUND_COARSENING × sizeField`, min `(inner.min ?? 0) ×
  factor`) and `Constant { value, min }` (tests' `() => h`,
  bound-adapt.ts's `() => NaN`). `at(x, y)` and `min()` are the closure and
  its `min`. `FeModelOptions.size_field` and `FeModel.size_field` are
  `Arc<SizeField>`; `refined_size_field` returns one. A custom closure
  (fem tests that pass `sizeField: (x, y) => …`) has no counterpart: those
  tests are "rewritten" in the manifest.
- **FeModel**: element connectivity `Vec<usize>`, equation numbers `Vec<i64>`
  (−1 fixed, as the sparse matrix's groups), `Uint8Array` flags as
  `Vec<bool>`, `materials: Vec<Material>` (copies, for names and models)
  with `material_ids` (the slope's ids, TypeScript's object identity),
  `gp_hoek_brown` a `Vec` of (Gauss point, parameters) in insertion order
  (the `Map`), `gp_c0`/`gp_phi0` always copies (TypeScript aliases them to
  `gpC`/`gpPhi` without Hoek–Brown; only Hoek–Brown points are ever
  written). The `WeakMap` caches keyed on the model (srm.ts
  `elementEquations`, newton.ts `scatterIndex`) are `OnceLock` fields
  (`FeModel::element_equations`); newton.ts's per-model tangent matrices
  are made per `newton_at_f` call from the model's pattern (`empty_copy`;
  the values are zeroed before each assembly either way, so the arithmetic
  is the same). `with_initial_stress` clones the model (TypeScript's spread
  shares the arrays).
- **Options**: `FeModelOptions`, `SrmOptions` and `InitialStressOptions` are
  serde structs with TypeScript's JSON (`FemAnalysisOptions` is their
  union; the analysis port composes them). `prepare_fe_model(slope,
  &FeModelOptions, &InitialStressOptions, &SrmOptions)` takes the two halves
  of TypeScript's intersection type separately. `FlowRule` is
  types::analysis's; `SrmConvergence` (increment, extrapolated,
  equilibrium) and `TrialSolver` are srm.rs's (types::analysis has no
  "extrapolated"). Iteration limits are `usize`, `trials_per_round` `f64`
  (rounded as TypeScript does). `onTrial` is not an option:
  `strength_reduction_with(model, options, &mut on_trial)` calls it after
  each trial, and `SrmSearch::trials()` lists them.
- **The generator as a state machine** (srm.rs `SrmSearch`, ARCHITECTURE.md
  §2.2): `SrmSearch::new(&model, &options)` then `step(&model, outcomes)`
  → `SrmStep::Batch(TrialBatch)` (the reductions and the starting state) or
  `SrmStep::Done(Box<SrmResult>)`; the outcomes of a batch come back in the
  next call, in the batch's order. The program counter is explicit (the
  bracketing loop's test, the bisection's, the confirmation, the end) and
  `round`'s locals across its `yield` are kept in `Pending`. A call out of
  turn is an error and changes nothing. `new` reads the model's flow rule
  at once, where the generator reads it at its first `next()` (the same
  unless a trial runs in between). Converged states are `Arc<SrmState>`
  (TypeScript shares the objects): `TrialBatch.start`, `SrmResult.state`,
  `previous_state`, `SrmOptions.resume`/`warm_start`. The analysis port's
  `FemSearch` wraps one `SrmSearch` per mesh, as `onModel` does.
- **`run_trial(&mut FeModel, …)`**: TypeScript's `runTrial` sets the
  Hoek–Brown points' c and φ of the model in place
  (`setHoekBrownStrength`), and later searches on the same model see them;
  so the Rust trial takes the model mutably, and `SrmSearch::step` takes it
  shared between trials. Trials of one batch run in parallel need one model
  each (as the app's workers have).
- **No clock**: none of these modules reads time (in TypeScript only
  analysis.ts's `elapsedMs` and the bounds' time limits do); the
  `Clock` of `RunCtx` is for the analysis and limit analysis ports.
- **Errors**: the RangeError sites of model.ts (`invalid elastic parameters
  for material "…"`, `invalid van Genuchten parameters …`) are
  `EngineError::range`; "finite element model has no free degrees of
  freedom", newton.ts's "stress return failed", a non-positive Jacobian
  (elements.rs) and a matrix entry outside the pattern (an internal
  invariant) are `EngineError::new` passed up through `Result`. Newton's
  failed tangent factorisation is caught as in TypeScript (the elastic
  stiffness takes the step).
- **Other choices**: `pile_forces` returns `Vec<(pile, PileForces)>` in the
  order first met (the `Map`); `build_piles` takes the model's data in
  `PileInput` (its two closures become `gauss_unit_weight` with the
  seepage flag, and the ground line or ymax); `k0_stress` takes the inactive
  names as a slice. JavaScript `Set`s with insertion order (side nodes,
  material names, load x positions, construction stages) are vectors;
  SameValueZero is kept where NaN can occur. Divergences only on malformed
  input: a NaN coordinate makes TypeScript's bucket grids (transfer.ts,
  adapt.ts) read `cells[NaN]` and throw; Rust takes cell 0. `ru: null` in a
  material reads as absent (TypeScript would warn about rᵤ).
- **Tests**: tests/fem_model_fixtures.rs (models, initial stresses,
  refinement, transfer), tests/fem_srm_fixtures.rs (trials, the 35
  problems, the options), tests/fem_model_unit.rs (ported unit tests), from
  `tools/fixtures/fem-model.fixture.ts` (about 17 minutes under Node, most
  of it the 35 strength reductions; `CSLOPE_FEM_PARTS` and `CSLOPE_FEM_SRM`
  select parts). Vectors are compared at relative 1e-9 of the larger
  magnitude with a floor of 1e-3 of the vector's largest entry (entries that
  cancel, e.g. a load that is zero up to rounding, are measured against the
  vector's scale). JSON writes −0 as 0, so "not bit-identical" counts
  include −0 where the value is equal. Release only; 22 of the 35 problem
  cases (each over 10 s) and the V012 trials are `#[ignore]`d:
  `cargo test --release --test fem_srm_fixtures -- --ignored` (about 9
  minutes; the default FE tests about 50 s on 4 threads).
- **Timings** (release, one thread, this container; TypeScript under Node
  22 in the fixture run): the strength reductions of the 35 problems 614 s
  native against 893 s, 1.3–1.9 times faster (V012 82 against 111 s, V001
  11 against 16 s); preparing a model with construction stages 2–5 times
  faster (prepareFeModel 30 against 140 ms). The time goes to
  the sparse triangular solves of the viscoplastic iteration, which V8's
  JIT runs nearly as fast.
- **Tests deferred to the analysis port** (they need analyzeFem):
  initial-stress.test.ts "does not change the factor of safety of
  associated flow (V055)" and the analyzeFem part of "builds the
  embankment in layers" (its prepareFeModel part is ported);
  piles.test.ts "raise the factor of safety … report their forces" and the
  analyzeFem part of "warn where the forces exceed the pile's capacity"
  (its buildFeModel part is ported); analysis.test.ts "returns the factor
  of safety with the mesh and the fields", "warns about non-associated flow
  at high friction angles" and the analyzeFem part of "warns that rᵤ is not
  included" (its ignoredInputWarnings part is ported); hoek-brown.test.ts
  "give the finite element factor within 10 % of the limit equilibrium
  one"; summary.test.ts, bound-adapt, lower/upper-bound tests (not this
  port's modules). model.test.ts "meshDomain" and "SparseCholesky" were
  ported with the leaves. (All ported with the limit analysis, below.)

### FE limit analysis and analysis (fem/limit_common.rs, lower_bound.rs, upper_bound.rs, bound_adapt.rs, analysis.rs, summary.rs)

- **Time** only through `RunCtx.clock` (TypeScript's `performance.now`):
  the bounds' search and per-program time limits, the refinement budget of
  `adaptive_bounds`, `elapsedMs`. Clarabel's own time limit uses its own
  clock (conic.rs, as before). Cancellation is checked before each bound
  program and each trial; a cancelled run is an error even where
  TypeScript turns a bound's failure into a warning (`Level k, upper bound:
  …`, `Limit analysis: …`): only other errors become those warnings.
- **Callbacks as progress**: `onTrial` is `ProgressEvent::FemTrial(SrmTrial)`
  (`SrmTrial` is now `Copy`), `onLevel` is `ProgressEvent::Bounds(level)`;
  a `Break` cancels. `ProgressEvent` gained the two variants (the
  evaluator test's irrefutable `let` became `let … else`).
- **`FemSearch`** (analysis.rs): the generator `analyzeFemSearch` as a state
  machine over one `SrmSearch` per mesh (phases: first mesh, refined mesh,
  final tolerance), `FemSearch::new(slope, options, clock)` and
  `step(outcomes)` → `FemStep::Batch(FemTrialBatch)` / `Done`; the trials of
  a batch run on `model_mut()` (Hoek–Brown sets the model's strength, as
  `runTrial` does). `drain_trials()` gives the trials made since the last
  call (for `onTrial`). `analyze_fem(slope, options, ctx)` runs the batches
  in turn. `FemAnalysisOptions` is `{ model, srm, initial, adaptive }` with
  the three option structs flattened (TypeScript's JSON).
- **Programs**: `LbProblem::program(F)` / `UbProblem::program(F)` as
  TypeScript's closures; JavaScript `Map`s whose iteration order reaches the
  program (edge owners, the load power, the gap's edge list) are
  `limit_common::InsertionMap` (insertion order, delete leaves the order);
  the lower bound's recursive `split` is an explicit stack in the
  recursion's order. `UbProblem` keeps the model's surface edges, so that
  `bound_gap_indicator` does not build the model a third time (TypeScript
  builds it again for them; the same edges). The upper bound's column
  layout is a `OnceLock` set by the first `program` (TypeScript's
  `layout ??=`).
- **Option types**: `LowerBoundOptions` (= `UpperBoundOptions`) flattens
  `FeModelOptions`; `strength_rule` is `limit_common::StrengthRule`;
  `AdaptiveBoundsOptions { bounds, levels, theta, refinement_time_limit,
  gap_tolerance }`; `AdaptiveBoundsResult.size_field` is an
  `Arc<SizeField>` (`Constant { NaN }` for TypeScript's `() => NaN`).
- **summary.rs**: `Number(v.toPrecision(7))` is `js::num::round_to_precision`
  (`js::num::to_precision`, exact decimal expansion, ties away from zero as
  ECMAScript's toPrecision, tested against Node 22). The bounds' solver
  loader (`solvers`) and its "could not be loaded" warning have no
  counterpart (Clarabel is linked in). The coarsened bound mesh is
  `SizeField::Scaled { factor: 2 }`.
- **Exact ties of the lower bound's fans (accepted, not allowlisted
  values)**: the fans bisect, in an element near a singular point, its edge
  spanning the widest angle from it. Where the element has an edge on a
  straight line through the point (the ground surface between two singular
  points), its other two edges span exactly the same angle, and atan2's
  last bit decides (V8's fdlibm against std's libm; Bun with the platform
  libm picks as Rust does). The lower bound mesh then differs by a few
  elements. On the verification problems (coarsened mesh) 8 of 35 are such
  ties (V013a, V018, V020, V026, V038b, V056, V058, V063); their lower
  bounds differ by up to 1.1e-4 (V013a, V020), the rest ≤ 8.4e-7.
  `fem_bounds_fixtures.rs` detects them by the list of bisected edges and
  compares only the bound there.
- **Bounds against TypeScript** (tests/fem_bounds_fixtures.rs, 35 problems
  meshed as the app meshes the bounds): the program digests within 1e-12
  (a coefficient that is zero in exact arithmetic, the pore pressure's power
  on a rigid translation, is rounding noise in both engines and exactly 0
  in one of them on 9 programs: up to 21 of 47,000 coefficients; the sums
  of |v| and v² still agree within 1e-12); λ(1) within 8.1e-7 (lower) and
  1.3e-7 (upper); every trial's F and λ within 1e-3 (Clarabel's
  "AlmostSolved", reduced tolerances of about 1e-4, ends many lower bound
  programs; a λ of 76 or of 1e-5 carries that); the bounds within 1.8e-6
  (lower, V012) and 8.3e-8 (upper, V038b), ties aside.
- **Analysis against TypeScript** (tests/fem_analysis_fixtures.rs, the 35
  problems as runFemVerification runs them, adaptive, two levels): F
  identical (relative difference 0) on every problem, the same trials
  (F, convergence, iteration counts, solver), levels and mesh sizes,
  warnings and meshes; the fields at F (displacement, plastic shear strain,
  shear strain increment) within 6.4e-4 of their scale (V026; V052a 2.9e-4;
  the state just below collapse, where the tangent is nearly singular),
  the other 33 within 6e-10.
  FE verification natively: 34/35 references agree, as in TypeScript
  (V056 does not agree in either).
- **Summary** (tests/fem_summary_fixtures.rs): `run_fem_summary` and
  `run_fem_summary_with_bounds` JSON but `elapsedMs` for every problem with
  its settings (limit analysis on, one refinement level): `run_fem_summary`
  identical on all 35 (F, levels, warnings, mesh, fields after
  `toPrecision(7)`: no number differs). `run_fem_summary_with_bounds`: on
  20 the adaptive bounds take TypeScript's meshes and the bounds JSON agrees
  within 7.3e-5 (the solver's tolerance); on 15 the refinement takes other
  meshes from a level on, through (a) the fan ties above and (b) the
  Dörfler marking of the bound gap, which reads the lower bound's stress
  field (one optimum of a degenerate program, to Clarabel's tolerance), so
  that elements of nearly equal contribution are marked otherwise. Those
  15 run under Bun (JavaScriptCore, the platform libm as Rust, clock
  stubbed only under Node) give Rust's bounds bit for bit, elements and
  warnings too (V012's Davis B bounds aside: under Bun its real clock
  stopped them at their time limit); against Node their bounds differ by up
  to 1.6e-2 (V052a's Davis B upper bound on 6330 against 6575 elements;
  V012 9.6e-3, the others ≤ 4.4e-3). The test compares those within 2e-2
  and reports them (fem_summary_fixtures.rs `MESH_TOL`).
- **Tests**: unit tests of lower-bound, lower-bound-corner, upper-bound,
  bound-adapt, analysis and summary, and the deferred ones, in
  tests/fem_analysis_unit.rs (the "highs" cases of boundGapIndicator run
  Clarabel); the unit scenarios are also compared with the fixture
  units.json. Fixtures: `tools/fixtures/fem-analysis.fixture.ts`
  (`CSLOPE_FEMA_PARTS` = bounds, analysis, summary, units;
  `CSLOPE_FEMA_CASES`); under Node bounds and units take about 15 minutes,
  analysis about 1 hour and summary about 2 hours (under load; the parts
  run in parallel processes).
  Slow cases are `#[ignore]`d: `cargo test --release --test
  fem_analysis_fixtures -- --ignored` (and fem_summary_fixtures,
  fem_analysis_unit, fem_bounds_fixtures). Default (release, 4 threads,
  under load): fem_bounds_fixtures 20 cases, fem_analysis_fixtures 11,
  fem_summary_fixtures V019, fem_analysis_unit 23 tests; with --ignored
  about 7 + 52 + 75 + 2 minutes on two threads.
- **Timings** (release, one process at a time, Node 22 and native run
  back to back on this container under the same load from other work,
  load average 9–12 on 4 cores): `analyzeFem` with the verification options
  2.2–2.8 times faster natively (V018 4.3 against 10.6 s, V019 16 against
  45 s, V045 35 against 73 s, V057a 24 against 63 s, V059b 17 against 41 s,
  V047a 40 against 87 s); the bounds' searches 1.0–1.6 times (V045 2.8
  against 4.5 s, V057a 0.56 against 1.0 s): Clarabel's solve takes most of
  their time on both sides (the same crate, natively and as WebAssembly).

### FE facade (crates/cslope-wasm/src/api/fem.rs, fem_testing.rs; packages/engine/src/facade/fem)

- **Exports**: the product build has the public API of fem/index.ts and
  fem/summary.ts that `src/index.ts` exports: `analyze_fem`,
  `lower_bound`, `upper_bound`, `adaptive_bounds`, `run_fem_summary`,
  `run_fem_summary_with_bounds`, plus the size field handles
  (`size_field_at/min/free/count/constant`) and `fem_constants` (the data
  constants, which the facade test compares with the TypeScript ones). The
  internal functions the FE tests import go through `__test_call`
  (testing build): `testing.rs` hands every name starting `fem/` to
  `api::fem_testing::call` (54 names, `FEM_TEST_FUNCTIONS`, listed by
  `__test_functions`). That dispatcher reads its arguments one by one from
  the argument array, not with serde: handles, typed arrays and the
  mesher's size function cross as they are. Names `fem/<module>::$<op>`
  are the facade's own operations on handles (a model's field, a matrix's
  factorisation), not TypeScript functions.
- **The slope** (`slopeRef` in facade/fem/_handles.ts): the facade `Slope`'s
  handle `_h`, sent as `{ $slope: h }`, which `api::fem::with_slope`
  resolves through the model facade's registry
  (`crate::api::slope::with_slope_mut`, taking the slope out of its slot
  while the analysis runs, so that callbacks may run JavaScript). The
  definition fallback used while the model facade was not merged
  (`{ $definition: def }`) is gone.
- **Size fields as data** (ARCHITECTURE.md §2.2): a `SizeField` crosses as
  a handle in its own registry. Results' `sizeField` and
  `refinedSizeField` give a JavaScript function `(x, y) => size` with
  `min` that calls `size_field_at` and frees the handle when collected;
  options' `sizeField` is sent as that handle. A JavaScript closure as a
  size field is a TypeError (the engine does not call JavaScript size
  functions); no FE test passes one. `meshDomain`'s `size` is the
  exception: the mesher takes `&dyn Fn`, and the testing dispatcher wraps
  the JavaScript function (its exception is rethrown).
- **FeModel** (testing build): a model lives in a registry; the facade's
  `FeModel` reads each field (typed arrays as TypeScript's: Float64Array,
  Int32Array for indices and equations, Uint8Array for flags) from the
  engine on first access and caches it; `K` is null (the factorised
  matrix stays in the engine), `gpHoekBrown` a `Map`, `sizeField` a size
  field function. The trials take the model mutably (Hoek–Brown strength,
  as `runTrial`), so `runTrial`, `strengthReduction` and
  `setHoekBrownStrength` drop the cached fields. States (`SrmState`) cross
  as objects of Float64Arrays (copies; `warmStart` is read from the
  options).
- **Kernels with mutable arrays**: `SparseCholesky` keeps the pattern and
  the factors in the engine and `values`/`upper` in JavaScript (callers
  write them), sent with `factor()`; `solve(b)`, `Anderson.step(x, g)`,
  `returnMap`'s tangent, `returnMapInto`'s `out` and `C`, `gaussStrains`,
  `frameStiffness`, `stiffnessT6`, `shapeT6` write the engine's result into
  the caller's array. With that, the files the manifest had as
  rust-ported (anderson, newton, model with SparseCholesky and meshDomain,
  anchors, piles, transfer) run unchanged too (mode facade+testing).
- **Not exported** (the shim throws "… is not exported to the facade"):
  the trial kernels and builders that only the engine calls (bars,
  bfgs, newton's `evaluate`/`newtonAtF`, srm's `solveAtF`, piles'
  `buildPiles`/`beamDofs`/`beamInternal`/`pileForces`, `solveSeepage`,
  limit-common but `reducedStrength`, model's `gaussUnitWeight`,
  `freeLength`, `polylineY`, conic's `ProgramBuilder`, `affine`,
  `solveClarabel`), the generators `strengthReductionSearch`,
  `analyzeFemSearch` and `analyzeFemAsync` (the state machines `SrmSearch`
  and `FemSearch` are not exported yet; the app runs `runFemSummary` in
  one worker), and the programs of `lowerBoundProblem`/`upperBoundProblem`
  (`program`, `elementDissipation` throw; the meshes and sizes are given).
  No test or app code calls them through the facade.
- **Callbacks** (ARCHITECTURE.md §3.4): `onTrial` (analyzeFem, the
  summaries, strengthReduction) and `onLevel` (adaptiveBounds) are called
  from `RunCtx.progress` with the trial or level as a plain object; an
  exception thrown by one stops the run (`Break`) and is rethrown
  unchanged, not as "The analysis was cancelled.". Time is
  `performance.now()` (`PerfClock`, read on each call so that the clock is
  `Sync`).
- **Solvers' loaders (decision)**: Clarabel is linked in, `loadClarabel()`
  resolves at once (its binary is not needed). HiGHS is not ported and
  `boundSolver: "highs"` is solved by Clarabel (above), so `loadHighs()`
  resolves too, to a stand-in whose `solve` throws "HiGHS is not ported …"
  (nothing calls it: the programs are solved in the engine), and
  `boundSolver({ boundSolver: "highs" })` gives the engine's solver, as for
  "clarabel". Throwing from `loadHighs` (ARCHITECTURE.md §3.1 before) would
  break code that loads HiGHS before asking for "highs" bounds, which
  the engine still runs; the bound-adapt tests' "highs" cases pass
  unchanged with Clarabel's bounds. `toLpText` and `solveHighs` throw.
  The summaries' `solvers` loader is not called.
- **Results**: as TypeScript's, with the typed arrays of
  `FemAnalysisResult` (mesh, displacement, the strain fields),
  `UpperBoundResult.mechanism`, `BoundGap.eta`, the problems' meshes
  (`split` as a `Map`), and `sizeField` functions; `displacementJumpF` is
  null where TypeScript has null; the summaries are the engine's JSON
  (no NaN: `JSON.parse(JSON.stringify(r))` equals `r`).
- **Results of the FE test files on the Rust engine** (vitest.rust.config.ts,
  testing build): all 14 files, 70 of 70 tests, pass unchanged; no known
  differences, no engine difference found. The tests that use the FE
  engine from other areas (types/hoek-brown.test.ts,
  model/suction-strength.test.ts) pass over these shims too.
- **Timings** (the 14 files, 4 vitest workers, back to back on this
  container under load from other work, load average 6–10): TypeScript
  149 s wall (415 s of test time), Rust as WebAssembly 104 s (292 s; an
  earlier run at load 6: 77 s, 193 s), 1.4–1.9 times faster. Per file
  (TypeScript against WebAssembly): srm 147 against 101 s, initial-stress
  66 against 42 s, piles 53 against 36 s, bound-adapt 21 against 11 s,
  summary 15 against 9 s, transfer 9.4 against 3.0 s, lower-bound 7.2
  against 3.5 s; lower-bound-corner 71 against 68 s and upper-bound 19
  against 14 s, where Clarabel (WebAssembly on both sides) takes most of
  the time.
- **Size**: the product build with the FE engine and Clarabel 2.34 MB
  (571 kB brotli), the testing build 2.50 MB (1.22 MB before the FE exports).
- **Desktop cutover (Phase 6c, not done here)**: the worker calls
  `runFemSummary(slopeDef, options.fem, onTrial)` and
  `runFemSummaryWithBounds(slopeDef, options.fem, onTrial)` from the
  facade (the fourth argument, the Clarabel loader, is dropped); remove
  `clarabelBinary()` and its `import("@cslope/engine/clarabel.wasm?base64")`
  from `analysis.worker.ts`, the `"./clarabel.wasm"` export from
  packages/engine/package.json, then (Phase 8) `src/fem/clarabel.wasm`,
  `packages/engine/clarabel/` and the `highs` dependencies of the engine
  and the desktop. The worker initialises the engine from the posted
  module (ARCHITECTURE.md §3.2) before the first FE call. The bounds'
  time limits then read the worker's `performance.now()` through the
  engine's clock, as now.

### Python binding (crates/cslope-py)

- **Shape**: ARCHITECTURE.md §4; developer notes in crates/cslope-py/README.md.
  pyo3 `=0.29.3` (abi3-py39) and pythonize `=0.29.0` (its minor version
  must match pyo3's), maturin `==1.15.0` (pyproject.toml and the wheels
  workflow). The extension is `cslope._native`; `python/cslope/__init__.py`
  wraps it (FE arrays), and its `Slope` subclasses the Rust class to add
  `fem`. No `extension-module` feature (deprecated; maturin sets
  `PYO3_BUILD_EXTENSION_MODULE`).
- **Workspace**: a member but not a default member: plain `cargo
  build/clippy/test` in packages/engine-rs (CI's rust job) leave it out, as
  it needs a Python interpreter to build; `--workspace` or `-p cslope-py`
  take it.
- **Definitions are model definitions**: `analyse`, `reliability` and
  `Slope` canonicalise them, as the app does before it calls the engine (a
  canonical rtl definition keeps `orientation: "rtl"` with mirrored
  coordinates, so canonicalising twice would mirror back: the caller never
  does it). `fem_summary` canonicalises itself, as in the app.
- **Output**: pythonize writes Rust tuples (`[f64; 2]` points) as Python
  tuples, sequences as lists; NaN stays NaN (JSON would write null).
- **Threads**: `None` is rayon's global pool, `1` `Serial`, `n` a pool of n
  threads cached per n (an `Evaluator` that `install`s `Rayon` in it, so
  progress, signals and the callback stay on the calling thread). FE trials
  serial. Product runs keep only the critical slices
  (`SliceRetention::Critical`), `Slope.analyse` every slice.
- **Progress and Ctrl+C**: a hook is always installed; on every event it
  takes the GIL, runs `check_signals` (a `KeyboardInterrupt` cancels the
  run's `CancelToken` and is raised again) and calls the callback, if any;
  `False` cancels (`AnalysisCancelled`), an exception cancels and is raised
  again.
- **FE arrays** become `array.array` or numpy arrays in Python
  (`numpy.asarray`), not through the pyo3 `numpy` crate: no optional
  feature, one wheel per platform.
- **Agreement** (measured before the cutover with tests/test_parity.py on
  fixtures exported from the TypeScript engine; that test and its exporter
  were removed with the TypeScript engine, see Cutover): on 17 analyses (every check of V001, V002,
  V005, V010 and V013a, a non-circular optimised check, V001 with both
  directions, a cut sliding right and left with circles, both directions
  and a block search), a Taylor and a Monte Carlo analysis (V021a) and a
  small FE summary, the binding's results equal the native engine's bit for
  bit (the whole result but elapsedMs) and TypeScript's within 1e-6 (every
  field but `allSurfaces`, whose count may differ by the generation
  near-ties above), reliability and FE within 1e-9. Every thread count gives
  the same result bit for bit (tests/test_api.py).
- **Smoke test of the wheels** (tests/test_api.py, on every wheel): the demo
  models of `cslope.examples` against pinned factors within 1e-6, not bit
  for bit as ARCHITECTURE.md §8.5 first planned: another platform's libm may
  move the last bits (tolerance policy). The verification problems are not
  in the wheel.
- **Not done**: `Slope.slices(...)` and `Slope.analyse_circle(...)` of the
  §4 sketch (one circle is analysed with `customSearchPlanes` and
  `customPlanesOnly`); the CLI; an sdist; publishing (the workflow's
  publish job is disabled until a trusted publisher is configured).

## Cutover (2026-11-04)

The app, the engine's and the desktop's tests, the website's verification
table and the public report run on the Rust engine as WebAssembly; the
TypeScript implementation is removed (ARCHITECTURE.md §9, Phases 6 and 8).

- **Module paths.** Each facade shim was merged into the module it
  replaced: `packages/engine/src/<path>.ts` keeps the TypeScript types, the
  data constants (defaults, labels, the verification data) and the docs,
  and its functions call the engine. `src/facade` keeps the shared helpers
  (conversion, handles, slices in bulk, material identity) and the
  facade's own tests. `createSlice` and `shansepStrengthAt`, which only
  threw through the facade, and the stubs of functions not exported to
  WebAssembly (trial kernels, program builders, the HiGHS and Clarabel
  loaders) were removed; nothing called them. What TypeScript remains is
  listed in ARCHITECTURE.md §9 ("After the cutover").
- **Start.** `initEngine()` (Node, Bun: reads the wasm from disk) or
  `initEngine(bytes)` (the app's main thread, from the `?base64` import),
  `initEngineSync(engineModule())` in the workers (every request carries
  the compiled module). The app's Content-Security-Policy allows
  `'wasm-unsafe-eval'`.
- **Tests.** `packages/engine` runs its 105 test files on the testing build
  by default (`vitest.setup.ts`, the glue redirected in
  `vitest.config.ts`); CI's engine job builds it. The desktop tests run on
  the product build (`vitest.engine-setup.ts`).
- **Removed, and why.** The fixture exporters (`tools/fixtures/*`,
  `packages/engine/vitest.fixtures.config.ts`) ran the TypeScript engine,
  so they cannot run any more, and the differential tests against their
  fixtures (`tests/*_fixtures.rs`, `*_diff.rs`, `geometry_differential.rs`,
  `json_compat.rs`, `types_fixtures.rs`, and the fixture-only tests of the
  unit test files, 120 test functions in all, with the examples
  `bench_optimize` and `bench_searches`) compared the port with an engine
  that no longer exists: their job ended with the cutover (decided by the
  user). What they guarded stays guarded by the TypeScript test suite (the
  behaviour specification, run on this engine), the Rust unit tests, the
  414 verification checks and 35 FE references, and the golden results.
  Unit tests that needed only the verification definitions read them from
  the golden file. Also removed: `packages/engine/clarabel` and
  `src/fem/clarabel.wasm` (Clarabel is linked into the engine), and the
  `jsts` and `highs` dependencies of the engine and the desktop.
- **Golden results.** `golden/verification.json` (`tools/golden.ts`):
  values of the engine the app ships (WebAssembly through the API, as
  generate-data.ts runs it). Natively, 356 analyses agree within 1e-6 on F
  and on the critical surface and the counts but for 10 near-ties of
  cause B in `tests/allowlist.toml`: V036a Morgenstern-Price (the libm of
  WebAssembly breaks the tie of equal circles on a c' = 0 face a third
  way: 1.54e-5 from native, 1.5e-5 from TypeScript), V039 with
  compositeBase (8e-6, native only) and counts of surfaces in V036a–d and
  V039. The near-ties found against TypeScript only (V047b, V063, V086b,
  V009c; causes A and C) agree between WebAssembly and native and left the
  list. Since the minimum slip area defaults to 0 (2026-11-04) the ten
  cause-B entries have left it too: other circles seed the refinement, and
  all 356 analyses agree within 1e-10 with the same counts; the list is
  empty. An idle-machine benchmark of all 444 checks (TypeScript, Rust as
  WebAssembly, native) found every check passing in all three.
- **Verification.** generate-data.ts on the Rust engine: 414/414 checks,
  34/35 FE references (V056 as before); the published table (4 decimals)
  did not move (VERIFICATION-LOG.md, 2026-11-04).
- **HiGHS.** `boundSolver` takes only "clarabel" in TypeScript now; the
  engine still reads "highs" from older JSON and solves it by Clarabel
  (Decisions, above).
