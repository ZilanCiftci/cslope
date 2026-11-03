# Porting the engine to Rust

The TypeScript engine in `packages/engine/src` is being rewritten in Rust
here. The Rust engine replaces it: the app calls it as WebAssembly through a
thin TypeScript facade with the same API as `@cslope/engine`, and Python
calls it natively. Until the switch, the TypeScript engine is the reference.

## Layout

- `crates/cslope-engine/src/{types,math,model,fem}`: one Rust file per
  TypeScript file, same name in snake_case (`model/geometry-ops.ts` ->
  `model/geometry_ops.rs`). Each file starts with
  `//! Port of packages/engine/src/<path>.ts`.
- `crates/cslope-engine/tests/<area>_*.rs`: differential tests against
  fixtures, plus ported unit tests.
- `tools/fixtures/<area>.fixture.ts`: exporters that run the TypeScript
  engine and write `fixtures/<area>/<name>.json` with `writeFixture` from
  `write.ts`. They run under **Node (V8)**, the runtime the app ships with,
  not Bun (JavaScriptCore uses the platform libm): each file has one
  `it(...)` (vitest globals, no import) and runs with
  `cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts <area>`.
  Fixtures are not committed; every exporter must be rerunnable.
- `src/js/`: JavaScript semantics that change logic (not a port):
  `js::math::round/max/min/sign/pow` (JS rounding of halves, NaN and -0
  rules, `**` edge cases), `js::num` for every number formatted into a
  string or key (`to_string`, `to_fixed`), `js::array` for sorts and sums.
  `clippy.toml` bans the std equivalents of those. Transcendental functions
  (sin, cos, atan2, exp, powf, hypot) are std's, directly or through
  `js::math`; their last bits may differ from V8 (see tolerance policy).
- `crates/cslope-wasm`: the WebAssembly API (wasm-bindgen), called by the
  TypeScript facade in `packages/engine/src/facade` (see "Exporting a
  module to the facade" below). Later `crates/cslope-py` (pyo3).

## Exporting a module to the facade

Once a module is ported, it is exported to WebAssembly and shimmed, so that
its TypeScript unit tests run unchanged against Rust
(`cd packages/engine && bunx vitest run --config vitest.rust.config.ts`).
The app and the default tests keep the TypeScript engine until the switch
(ARCHITECTURE.md §9, Phase 6).

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
4. **Shim** `packages/engine/src/facade/<same path>.ts` for every TypeScript
   file with runtime exports: the same runtime export names (the facade
   test checks them against the original), each calling `wasm().<export>` or
   `testCall("<ts path>::<tsName>", [all args])`. Data constants are
   re-exported from the original file (they are read at module load, before
   the engine starts); the facade test compares them with the engine's.
   Where TypeScript returns parts of its input unchanged, wrap the result in
   `shareUnchanged(input, result)` so identity is kept. A module that is
   only types or data needs no shim.
5. **Build and run**: `bun packages/engine-rs/tools/build-wasm.ts` (product
   into `packages/engine/src/wasm`, testing into `src/wasm-testing`), then
   the rust vitest config. Commit the regenerated product glue
   (`src/wasm/cslope_wasm.js`, `.d.ts`; CI compares it with a fresh build).
6. **Manifest** `packages/engine/test-manifest.json`: set the module's test
   files to `run: true`, their `status` to `facade` once every engine module
   they import is ported (`mixed` runs the TypeScript modules not ported yet
   over the shims), their `mode` (facade, facade+testing, rust-ported,
   rewritten). A test that cannot pass unchanged goes in `knownDifferences`
   ("describe > test": reason); it is skipped and counted, never edited.

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
| model core | model/slope, composite, surface, reinforcement, search, build-slope | done: SlopeSnapshot within 1e-9 (largest 8.9e-16) for 997 variants of 216 definitions; plane lists key-aligned within 1e-9 except accepted near-ties (below); unit tests ported (tests/model_core_*.rs), the ones that need an analysis listed below |
| slices and solvers | model/slices, solvers, mp-march, drawdown, surface-slide, result-warnings | |
| optimisation | model/optimize, block-search | |
| reliability, 3D, helpers | model/reliability, sgi3d, property-helpers | |
| fem model | fem/model, seepage, piles, bars, newton, bfgs, srm, initial-stress, transfer, adapt | |
| fem limit analysis | fem/limit-common, lower-bound, upper-bound, bound-adapt, analysis, summary | |
| wasm + facade | crates/cslope-wasm, packages/engine (TypeScript API over WebAssembly) | infrastructure done and proven on the ported leaves (build script, engine.ts, shims, testing build, manifest, CI job); shims for later modules per the recipe above |
| python | crates/cslope-py | |

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
  absent or `null` is `None`. Fields typed `T | null` and optional
  (`partialFactors`, `minSlipArea`, `blockActiveAngle`, `k0`,
  `otherDirectionMinFOS`, …) are `Option<Option<T>>` (`Some(None)` is
  `null`). serde_json writes non-finite numbers as `null`, as
  `JSON.stringify`. A point list that is `null` reads as empty.
- **Shapes TypeScript validates and serde rejects**: a point with the wrong
  number of values, a string where a number belongs. Such JSON does not
  deserialize (a serde message instead of the validation message); the
  ported tests check that it is rejected.
- **Counts as f64**: `AnalysisOptions.slices`, `iterations`, … and the
  count constants (`DEFAULT_SLICES`, …) are `f64`, as TypeScript's
  `number` (slope.ts clamps and rounds them). Indices and counts in results
  (`ReinforcementForce.index`, warning counts, FE element counts and
  triangles) are `usize`.
- **No `PartialAnalysisOptions` yet**: `Partial<AnalysisOptions>` (the
  verification checks, `updateAnalysisOptions`) is left to the slope.ts
  port (ARCHITECTURE.md's `AnalysisOptionsPatch`).
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
  bound program goes to Clarabel (`fem::conic::solve_clarabel`). Proposed
  for the ports of lower-bound.ts / upper-bound.ts / bound-adapt.ts:
  `boundSolver: "highs"` still deserializes and is solved by Clarabel,
  `sides` ignored (the facade's `loadHighs` throws, ARCHITECTURE.md §3.1).
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
  in deserialized JSON). The checks of an unknown `method`,
  `porePressureHead`, `searchMethod` and `intersliceFunction` are serde's
  (enums), as is that of a reinforcement `pullout` without `length2`.
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
  keeps another string as `Other(String)` (serde untagged variant), so
  `set_piles` gives TypeScript's "Pile force direction must be 'angle',
  'tangent' or 'perpendicular'." (in TypeScript's order of checks); the
  force direction treats it as "angle", as TypeScript would.
- **Plane-list near-ties (accepted by the integrator)**: std's sin, cos,
  atan and tan return a different last bit from V8's for about 3 % of
  arguments. Circles found by bisection to be tangent to a material
  interface (typically where it meets the ground or the model's edge) are
  decided at rounding level: the decisive dip is quadratic in the
  bisection parameter, so 1e-14 moves the result by about 1e-7 relative and
  can add or drop the circle. On the fixtures (713,110 first-pass planes):
  64 only in TypeScript and 76 only in Rust, 31 with equal keys and values
  up to 1e-5 apart, all tangent to an interface; 48 key ties (the same
  circle within 1e-9 with a radius on a rounding half of the 4-decimal key,
  feet converted to metres). Refined planes (190,439): 12 / 15 / 28 / 3;
  local planes identical. Accepted up to 1 in 2,000 planes per list,
  provided every such plane is a tangent circle or a key tie (asserted in
  tests/model_core_fixtures.rs). The gate on results is the solver
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
