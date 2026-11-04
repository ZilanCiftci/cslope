# cSlope engine in Rust: architecture

Status: implemented; the cutover (Phases 6 and 8) was made on 2026-11-04:
the app, the tests, the website and the report run on the Rust engine as
WebAssembly, and the TypeScript implementation is removed (§9, "After the
cutover"; PORTING.md, "Cutover"). Python (Phase 7) is still to come. The
design, as accepted on 2026-11-03 by the integrator with these notes:
- All ten recommendations in §10.2 are adopted.
- §9 Phase 6 shadow mode: there is no multi-week beta wait. The gate for switching the app is the parity job, the facade test suites (100 % green, unedited), the desktop suites and all verification checks. A shadow-mode setting that runs both engines and logs differences ships for the beta testers and can stay on until the TypeScript engine is deleted.
- **Superseded by the user (2026-11-03): no port of V8's fdlibm and no bit identity.** Rust's std transcendental functions are used. Read §0.1, §5 and the bit-identity goals in §5.1, §5.4, §6.4 and §9 with PORTING.md's tolerance policy instead: F within 1e-6 per surface and per search (near-tie branches up to 1e-4 only if explained and allowlisted), verification checks with their tolerances; the golden file after deletion records F to 1e-6. js::math keeps only the JS rules that change logic (round, max/min, `**` edge cases); fixtures are still generated under Node.
- Phase 0 (a), moving the worker's `analyse` into the engine, waits until the parallel-worker change in the app has merged, because it touches the same worker code.

 This document goes with `PORTING.md`. Where the two differ, the "Amendments to PORTING.md" section at the end says which rule changes. Paths are relative to the repository root.

Sources:
- the TypeScript engine (`packages/engine/src`, about 28k lines including verification data);
- how the desktop app uses it (`packages/desktop/src`: 67 non-test files and 51 test files import `@cslope/engine`);
- the analysis worker (`packages/desktop/src/worker/analysis.worker.ts`);
- the spike on branch `origin/experiment/rust-lem` (`experiments/rust-engine/REPORT.md`);
- the existing Clarabel crate (`packages/engine/clarabel`, whose wasm is committed);
- CI and release (`.github/workflows/{ci,release,verification-full}.yml`);
- the Vercel build of the website.

---

## 0. Findings that shape the design

1. **Native was bit-identical to TS only by coincidence.** In the spike, native Rust matched TS run under Bun exactly, while Rust compiled to WASM differed by up to 2.1e-13. Bun runs JavaScriptCore, which calls the platform libm (glibc on Linux). Native Rust also calls glibc. Rust on wasm32 uses its own musl-derived libm. The app runs V8 (Electron), and V8 uses its own fdlibm port (`src/base/ieee754.cc`).
   - So the fixtures the agents generate with Bun are *not* the reference the product runs. Windows MSVC native builds and Python wheels would drift as well.
   - The engine uses `Math.max` 383 times, `Math.min` 227, `tan/sin/cos` about 80 each, `Math.hypot` 74, `**` 134, and `atan`, `log`, `exp`, `atan2`, `asin`, `acos`.
   - **Decision (§5):** one pure-Rust `js::math` module that ports V8's ieee754 functions and V8's `Math.hypot`, used on every target, with platform libm calls banned by clippy. Fixtures are generated under Node (V8).

2. **`AnalysisResult` is not built by the engine.** The desktop worker builds it: `analyse()`, `analyseBothDirections()`, `displayPoints()`, the critical moments and the slice table. Python and the verification report need the same function. It moves into the engine first, in TS, and then is ported like any other module (§9, Phase 0).

3. **The app runs from `file://`.** Workers cannot fetch a `.wasm` file. The app already inlines `clarabel.wasm` with a `?base64` Vite plugin, and a worker is created per run and cancelled with `worker.terminate()`.

4. **The Vercel build runs `tsc -b`.** That typechecks `website/scripts/generate-data.ts`, which imports `@cslope/engine/verification`, and Vercel has no Rust toolchain. The release workflow (Windows) runs `scripts/verification-report.ts` under Bun, which runs the engine. There is a precedent: `clarabel.wasm` is committed "so that the engine and the app need no Rust toolchain".

5. **Tests import internal modules by relative path** (`./slices`, `./solvers`, `../types/index`, …). About 150 distinct symbols are imported, many of them internal:
   - `getSlicePropertyArrays`, `generateRefinedPlanes`, `returnMapInto`, `emptyState`, `runTrial`, `Anderson`, `SparseCholesky`, `setMarchSearchOptions`, …
   - Tests build `new Slope()` 43 times and use the mutating API.
   - They pass slices returned by `getSlices` back into `analyseBishop` and friends.
   - They read `slices[i].baseMaterial?.name` and expect `RangeError` from `Material` and `getYAtXStrict`.
   - No test writes into `slope.search[i]` or into returned slices. That makes snapshot (copy-out) semantics safe.

6. **Mutation patterns in the TS model:**
   - `analyseSlope` builds a local plane list, evaluates it and then calls `slope.setSearchResults` (a clean read-then-write).
   - Lazy caches on `Slope` (`compositeFloor`, `pileProfiles`, `reinforcementEnvelopes`, `_externalYCache`) are filled from getters.
   - Monte Carlo reliability writes `material.model` in place and calls `slope.materialsChanged()`.
   - `setDrawdownBefore` and `updateAnalysisOptions` pass options on to the child slope.
   - `setMorgensternPriceSolver` and `setMarchSearchOptions` are module-level globals.
   - `slices.ts` uses module-level clip buffers.

7. **Time is read only in FE code.** `performance.now()` appears in FE only: time limits in the conic solvers, the bounds and `elapsedMs`. Limit equilibrium is fully deterministic. `std::time::Instant` panics on `wasm32-unknown-unknown`, so time must be injected.

8. **Dedup keys depend on JS number formatting.** `planeKey` builds keys from `${roundTo(x,4)}`, where JS prints `-0` as `"0"`. A naive Rust `format!("{}")` prints `"-0"` and would change which planes are deduplicated. This is one example of many JS-semantics traps (§5).

---

## 1. Core data model and ownership

### 1.1 Principles

- **Owned data, no lifetimes in public structs, no `Rc`/`RefCell` in the model.** Everything evaluated in parallel is `Send + Sync`.
- **The TS mutating API is kept** (`&mut self` setters, `analyse_slope(&mut Slope)`), because the facade, the tests and the port rules need it. Internally, evaluation borrows `&Slope` and writes into a plane list it owns, then commits it to the slope.
- **Materials are referenced by index (`MaterialId`), not by `Rc`.** One table per `Slope` holds them. Identity semantics (`includes(material)`, `Map<Material, string>`) become id comparisons. In-place model changes (reliability) touch one table entry.
- **Lazy caches are `OnceLock<T>` fields,** replaced by fresh ones in every setter (setters have `&mut self`). `OnceLock` is `Sync`, so `&Slope` can be shared across rayon threads. `prepare()` forces all of them before a parallel section.
- **Pure memoisation caches are removed:** `_externalYCache` and `_waterYCache` cache a deterministic function, so dropping them cannot change any bits.
- **Module-level mutable state becomes explicit:**
  - clip buffers live in a `SliceScratch` passed by `&mut`, one per thread;
  - the solver choice globals become `static AtomicU8`, process-wide like the TS module globals and used only by tests and scripts.

### 1.2 Type sketches (`crates/cslope-engine/src/model/slope.rs` and friends)

```rust
pub type Pt = [f64; 2];                       // serialises as [x, y]

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct MaterialId(pub u32);

/// types/material.ts. Immutable once created; a slope's table entry is
/// replaced, never edited, so Arc clones stay valid snapshots.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub name: String,
    pub color: String,
    pub model: Arc<MaterialModel>,           // serde "rc" feature
    /// Facade identity (JS object key); None for materials made in Rust.
    #[serde(skip)] pub external_key: Option<u32>,
}

pub struct GeometryWithMaterial {
    pub px: Vec<f64>, pub py: Vec<f64>,
    pub material: MaterialId,
    pub x_min: Option<f64>, pub x_max: Option<f64>, pub y_max: Option<f64>,
}

#[derive(Clone)]
pub struct WaterLine { pub x: Vec<f64>, pub y: Vec<f64> }
struct WaterLineInput { wx: Vec<f64>, wy: Vec<f64>, follow_boundary: bool }

#[derive(Clone)]
pub struct Slope {
    // material / geometry
    materials: Vec<Material>,                 // index = MaterialId
    material_geometries: Vec<GeometryWithMaterial>,
    external_px: Vec<f64>, external_py: Vec<f64>, external_length: f64,
    surface: Option<WaterLine>,               // surface line x/y
    // water (JS Map insertion order kept: Vec of pairs, replace in place)
    water: Option<WaterLine>, water_input: Option<WaterLineInput>,
    extra_water_lines: Vec<(String, Option<WaterLine>)>,
    extra_water_inputs: Vec<(String, WaterLineInput)>,
    material_water_table: Vec<(MaterialId, String)>,
    // loads and structures
    udls: Vec<Udl>, line_loads: Vec<LineLoad>,
    reinforcements: Vec<Reinforcement>, piles: Vec<Pile>,
    // options (as TS private fields)
    opts: SlopeOptions,                       // slices, iterations, method, …
    options_given: AnalysisOptionsPatch,      // _optionsGiven
    limits: [f64; 4],
    // stages
    earlier_stage: Option<Box<Slope>>,
    drawdown_before: Option<Box<Slope>>,
    waternet: Option<Waternet>,
    mirrored: bool, domain_x: Option<[f64; 2]>,
    // search
    search: Vec<SearchPlane>,
    individual_planes: Vec<SearchPlane>,
    custom_planes_only: bool,
    fixed_slices: Option<Vec<f64>>,
    split_failure_count: u32,
    dangling_boundaries: Vec<usize>,
    block_search_objects: Vec<Vec<Pt>>,
    // lazy (reset by every setter that resets results)
    composite_floor: OnceLock<Option<CompositeFloor>>,
    pile_profiles: OnceLock<Vec<Option<PileProfile>>>,
    reinforcement_envelopes: OnceLock<Vec<ReinforcementEnvelope>>,
    /// Bumped on every mutation and every analysis (facade caches key on it).
    version: u64,
}
```

**`Slice` (`types/geometry.rs`).** A plain struct with every TS field. Optional TS fields become `Option<_>` (`skip_serializing_if`).
- `base_material: Option<MaterialId>`.
- `strength_model: Option<Arc<MaterialModel>>`: the `aboveWater` model, shared, never deep-cloned.
- `hoek_brown: Option<HoekBrownParameters>` (Copy).
- `shear_normal: Option<Arc<ShearNormalModel>>`.
- `reinforcement_forces: Option<Vec<ReinforcementForce>>` (None, with no allocation, unless reinforcement acts).
- `reinforcement_active` / `reinforcement_passive: Option<[f64; 3]>`.

`Slice` is not serialised directly, because `base_material` needs the slope's table. Serialisation goes through `WithSlope<'a, T>(&'a Slope, &'a T)`. Its `Serialize` resolves ids to `Material` values, which gives the TS JSON shape `{ name, color, model }`.

**`SearchPlane`** mirrors the TS interface:
- `lc` and `rc` are `Pt`; `cx`, `cy`, `radius` are `f64`;
- `fos: Option<f64>`;
- `slices: Option<Vec<Slice>>`;
- `lff_array: Option<Vec<[f64; 4]>>`;
- `points`, `crack` and `composite` are optional;
- `unchecked`, `converged`, `closest_pair`, `optimised` and `below_min_size` are `Option<bool>`;
- `equilibrium_gap: Option<f64>`, `tangent_to: Option<usize>`.

### 1.3 Mapping the TS mutation pattern to Rust

| TS | Rust |
|---|---|
| `buildSlope(def)` returns a new Slope | `build_slope(&SlopeDefinition) -> Result<Slope>` |
| `analyseSlope(slope)` mutates `slope.search` | `analyse_slope(&mut Slope, &mut RunCtx) -> Result<Option<f64>>`. It builds `Vec<SearchPlane>` locally, evaluates with `&*slope`, then calls `slope.set_search_results(v)` |
| `evaluatePlanes(slope, planes)` | `evaluate_planes(&Slope, &mut [SearchPlane], &mut RunCtx) -> Result<()>` (§7) |
| `slope.setWaterTable(...)` etc. | `&mut self` methods with the same validation and messages, calling `reset_results()` where TS calls `_resetResults()` |
| lazy getters `??=` | `self.pile_profiles.get_or_init(\|\| …)` on `&self` |
| `setEarlierStage(s)` / `setDrawdownBefore(b)` (shared reference) | Takes ownership: `Option<Box<Slope>>`. The facade passes a *clone*, so later changes to the JS object are not seen, which differs from TS reference sharing; no test relies on it. `update_analysis_options` passes options on to `drawdown_before` as in TS |
| Monte Carlo `material.model = …; materialsChanged()` | `slope.set_material_model(id, Arc<MaterialModel>)`, which calls `reset_results()` |
| `slope.search` returns a live array | `fn search(&self) -> &[SearchPlane]`. Across FFI it is a snapshot |
| `getExternalYIntersection` with a Map cache | Computes directly |

Child slopes refer only to their own material table. Ids must never cross slopes: `drawdown` and `shansepStrengthAt` read child slices only for numbers. A `debug_assert` with a per-slope tag in `MaterialId` lookups (debug builds only) catches cross-slope misuse.

### 1.4 Clone costs and hot-spot allocation

- Cloning a slope (two-direction runs, facade `setEarlierStage`, Monte Carlo per thread) costs a few kB of geometry plus any stored search. `Slope::clone_model()` clones without `search` and `individual_planes` results.
- **`createSlice`.** The TS version takes closures (`waterForMaterial`, `base`, `waterForWeight`, `porePressureAt`) and returns a fresh object per slice. Rust uses:
  - a `SliceContext<'a>` built once per surface, holding per-material water lines `Vec<Option<&WaterLine>>` indexed by `MaterialId`, an `enum Base { Circle{..}, Polyline(&[Pt]), Composite{..} }` and `Option<&Waternet>`;
  - `fn create_slice(ctx: &SliceContext, scratch: &mut SliceScratch, …) -> Option<Slice>` with no heap work in the common case.
- **Polygon clipping.** `SliceScratch { ax, ay, bx, by: Vec<f64> }`, grown by doubling exactly like `ensureClipCapacity`, with the same arithmetic order. Material polygons are skipped by their cached `x_min` / `x_max` (TS does this too).
- **Solver arrays** (`getSlicePropertyArrays` allocates about 25 `Float64Array`s per solve) become a `SolverScratch` of SoA `Vec<f64>`s, cleared and refilled per surface.
- **Object spreads in `analyseSlope`** (`{...p, fos: null, slices: null, crack: undefined, converged: true}`) become `p.clone_for_evaluation()`. It clones geometry only. The `points` `Vec` clone is the only allocation.
- **Slice retention.** TS keeps `slices` on every evaluated plane: about 12k planes × about 50 slices in a non-circular run, a few hundred MB in JS. Rust uses `enum SliceRetention { All, Critical }` on `RunCtx`.
  - `All` is used by the facade's `analyseSlope` and the tests, which read `slope.search[i].slices`. It is faithful.
  - `Critical` is used by `run_analysis` (the app and Python). It keeps the slices of the running best plane only: strict `<` in `allPlanes` order, which picks the same plane as the final stable sort.
  - Results are identical. Only the memory differs.
- **Rule for optimisations:** an optimisation may never change which branch is taken or the order of float operations. Example: `getYAtX` must keep its linear first-segment-wins scan at vertical steps. Every optimisation lands with a differential test.

---

## 2. Public Rust API and module boundaries

### 2.1 Workspace layout

```
packages/engine-rs/
  Cargo.toml                    workspace: cslope-engine, cslope-wasm, cslope-py
  rust-toolchain.toml           1.97.0 + wasm32-unknown-unknown
  clippy.toml                   disallowed-methods (§5.3)
  PORTING.md  ARCHITECTURE.md   PORTING-SYNC.json (§9)
  crates/
    cslope-engine/              pure Rust, no wasm-bindgen / pyo3
      src/
        lib.rs error.rs
        js/        NEW (infrastructure, not a port): math.rs (V8 ieee754 port:
                   sin cos tan asin acos atan atan2 exp log pow + V8 hypot),
                   num.rs (Number::toString, toFixed, toPrecision, Math.round),
                   array.rs (V8 TimSort with JS comparator semantics, min/max
                   of slices, ordered sum), mod.rs
        types/ math/ model/ fem/      ports, one file per TS file
        api/       NEW (ports of the run-level TS added in Phase 0)
          run_analysis.rs      runAnalysis / analyseBothDirections
          ctx.rs               RunCtx, Progress, CancelToken, Clock, Evaluator
          snapshot.rs          WithSlope<'_, T> serialisers, SlopeSnapshot
      tests/                    <area>_*.rs differential + ported unit tests
      benches/                  criterion-free timing bins (std only)
    cslope-wasm/                cdylib: wasm-bindgen + serde-wasm-bindgen
      src/lib.rs registry.rs slope.rs analysis.rs fem.rs reliability.rs
          errors.rs panic.rs clock.rs testing.rs (feature "testing")
    cslope-py/                  cdylib: pyo3 (+ pythonize), maturin
      pyproject.toml python/cslope/{__init__.py,__init__.pyi,py.typed}
  tools/
    fixtures/<area>.ts          fixture exporters (run under Node, §5.4)
    fixtures/run-node.ts        vitest-based runner for the exporters
    build-wasm.ts               builds product + testing wasm, writes BUILD-INFO
    check-wasm-fresh.ts         CI: source hash vs BUILD-INFO
packages/engine/                becomes the FACADE, still "@cslope/engine"
  src/index.ts                  same export list as today
  src/engine.ts                 initEngine / initEngineSync / engineModule
  src/wasm/                     COMMITTED product build: cslope_wasm.js, .d.ts,
                                cslope_wasm_bg.wasm, BUILD-INFO.json
  src/wasm-testing/             testing build (gitignored, built by pretest)
  src/{types,math,model,fem}/*.ts  shims: TS types + re-exports from wasm
  src/verification/*            unchanged TS data + runners over the facade
```

### 2.2 Rust public API

The API is ported 1:1 by name in snake_case, plus `api/`:

```rust
// model
pub fn build_slope(def: &SlopeDefinition) -> Result<Slope>;
impl Slope { pub fn new() -> Self; /* every TS getter/setter, same validation/messages */ }
pub fn analyse_slope(slope: &mut Slope, ctx: &mut RunCtx) -> Result<Option<f64>>;
pub fn get_slices(slope: &Slope, entry_x: f64, x1: f64, cx: f64, cy: f64, r: f64,
                  points: Option<&[Pt]>, scratch: &mut SliceScratch) -> Result<Vec<Slice>>;
pub fn analyse_bishop(slope: &Slope, slices: &mut [Slice]) -> (Option<f64>, f64, f64, bool);
pub fn analyse_morgenstern_price(slope: &Slope, slices: &mut [Slice]) -> MpOutcome;
pub fn solved_effective_normals(slope: &Slope, slices: &[Slice], fos: f64,
                                lff: Option<&[[f64; 4]]>) -> Option<Vec<f64>>;
pub fn set_entry_exit_planes(slope: &mut Slope) -> Result<()>;
pub fn add_single_circular_plane(slope: &mut Slope, cx: f64, cy: f64, r: f64);
pub fn analysis_warnings(slope: &Slope, normals: Option<&[f64]>) -> Vec<AnalysisWarning>;
pub fn analyse_reliability(def: &SlopeDefinition, opts: &AnalysisOptions,
        vars: &[RandomVariable], ro: &ReliabilityOptions, ctx: &mut RunCtx) -> Result<ReliabilityResult>;
pub fn sgi3d_factor_of_safety(slope: &Slope, o: &Sgi3dOptions) -> Result<Option<Sgi3dResult>>;
// canonical
pub fn to_canonical_slope_definition(def: &SlopeDefinition) -> SlopeDefinition;
pub fn map_analysis_result_to_model_space(r: AnalysisResult, def: &SlopeDefinition) -> AnalysisResult;
// fem
pub fn analyze_fem(slope: &Slope, o: &FemAnalysisOptions, ctx: &mut RunCtx) -> Result<FemAnalysisResult>;
pub struct FemSearch { … }      // the TS generator as an explicit state machine:
impl FemSearch { pub fn new(slope: &Slope, o: &FemAnalysisOptions, clock: &dyn Clock) -> Result<Self>;
                 pub fn step(&mut self, outcomes: Option<Vec<TrialOutcome>>) -> Result<FemStep>; }
pub enum FemStep { Batch(FemTrialBatch), Done(Box<FemAnalysisResult>) }
pub fn run_fem_summary(def: &SlopeDefinition, s: &FemAnalysisSettings, ctx: &mut RunCtx) -> Result<FemResultSummary>;
pub fn run_fem_summary_with_bounds(def: &SlopeDefinition, s: &FemAnalysisSettings, ctx: &mut RunCtx) -> Result<FemResultSummary>;
pub fn lower_bound / upper_bound / adaptive_bounds (…, ctx) -> Result<…>;   // Clarabel linked in
// api: the one-call product path (port of the worker's analyse())
pub fn run_analysis(def: &SlopeDefinition, o: &AnalysisOptions, ctx: &mut RunCtx) -> Result<AnalysisResult>;
```

```rust
pub struct RunCtx<'a> {
    pub progress: Option<&'a mut dyn FnMut(ProgressEvent) -> ControlFlow<()>>,
    pub cancel: Option<&'a CancelToken>,       // AtomicBool, polled between batches
    pub clock: &'a dyn Clock,                  // now_ms(); Native=Instant, Wasm=performance.now, Fixed for tests
    pub evaluator: &'a dyn Evaluator,          // Serial | Rayon | Replay (§7)
    pub retention: SliceRetention,
}
pub enum ProgressEvent { Search { done: usize, total_hint: usize, phase: SearchPhase },
                         FemTrial(SrmTrial), Reliability(f64), Bounds(AdaptiveBoundsLevel) }
```

Notes on the API:
- Function-valued TS options become data. `sizeField: (x, y) => number` becomes `enum SizeField { Uniform{h, min}, Refined{…from refinedSizeField} }`. `onProgress` and `onLevel` become `RunCtx.progress`. `runBatch` becomes `FemSearch::step`.
- Cancellation returns `EngineError::cancelled()` with the message "The analysis was cancelled."
- `api/` modules, `RunCtx` and `FemSearch` are the only additions that are not ports. Everything else keeps the TS module and file boundaries.

### 2.3 Errors

The `EngineError` scaffold changes now, before many call sites exist:

```rust
pub enum ErrorKind { Error, Range, Cancelled }
pub struct EngineError { pub kind: ErrorKind, pub message: String }
impl EngineError { pub fn new(m) -> Self /* Error */; pub fn range(m) -> Self; pub fn cancelled() -> Self }
```

TS throws `RangeError` in `Material` (two places), `getYAtXStrict`, `getLineBetweenPoints` and `fem/model.ts`, and tests assert `toThrow(RangeError)`. The wasm layer turns `Range` into `js_sys::RangeError` and everything else into `js_sys::Error`. Python gets `ValueError` for `Range` and a `cslope.EngineError(RuntimeError)` subclass otherwise.

---

## 3. The WASM boundary

### 3.1 Decisions

| Question | Choice | Why |
|---|---|---|
| wasm-bindgen or plain C exports | **wasm-bindgen**, `--target web --omit-default-module-path`, pinned `=0.2.N` (crate and CLI) | Strings, `RangeError` objects, callbacks (`&js_sys::Function`), `Vec<f64>` to `Float64Array`, and `initSync` come for free. The C-ABI spike needed hand-written memory management. The version lock is enforced by `tools/build-wasm.ts` (§8) |
| JSON strings or serde-wasm-bindgen | **serde-wasm-bindgen** for API values; JSON only for fixtures | Results carry `Infinity`/`NaN` (`failedF`, `betaNormal`, `-Infinity` from `Math.max()` of empty lists, `NaN` fos in internals). `JSON.stringify` turns them into `null`. serde-wasm-bindgen passes f64 unchanged, maps `undefined` to `None` and ignores unknown fields. Config: `serialize_missing_as_null(false)`, `serialize_maps_as_objects(true)`. The spike measured boundary cost as negligible next to the analysis |
| Handles or JSON round trips | **Handles** for `Slope` and `FemAnalysisResult`. Stateless calls (`runAnalysis`, `toCanonicalSlopeDefinition`, …) take and return values | The test suite and the desktop use a stateful `Slope`; rebuilding per call would be wrong (mutations) and slow |
| Handle mechanism | **u32 slab registry in wasm** (`thread_local! RefCell<Slab<Entry>>`, entries with a generation) plus JS `FinalizationRegistry` and an explicit `free()` / `[Symbol.dispose]` | One mechanism serves the product API, the testing dispatcher (handles inside JSON args) and child-slope views. wasm-bindgen exported classes cannot be passed inside serde values |
| Typed arrays | FE: `Vec<f64>` / `Vec<i32>` getters on the FE result handle, which arrive as `Float64Array` / `Int32Array` copies. Metadata goes through serde | `FemAnalysisResult.mesh`, `displacement`, `plasticShearStrain` and `shearStrainIncrement` are typed arrays in TS. The app's `FemResultSummary` stays plain arrays, as today |
| Clarabel | Linked into the engine wasm | `loadClarabel()` and `runFemSummaryWithBounds(..., solvers)` stay in the facade as no-ops that resolve, for API compatibility. `clarabel.wasm`, its crate and the `?base64` import go away. HiGHS is not ported: `boundSolver: "highs"` is solved by Clarabel, and `loadHighs` resolves too (to a stand-in whose `solve` throws; PORTING.md, FE facade) |

### 3.2 Initialisation (sync API after one async start)

```ts
// packages/engine/src/engine.ts
export type WasmSource = BufferSource | WebAssembly.Module;
export function initEngineSync(source: WasmSource): void;      // workers, Node tests
export async function initEngine(source?: WasmSource): Promise<void>; // Node/Bun: reads src/wasm/*.wasm via node:fs when omitted
export function engineModule(): WebAssembly.Module;            // compiled once, to post to workers
export function isEngineReady(): boolean;
// any engine call before init throws Error("The cSlope engine is not initialised: call initEngine() first.")
```

Where each consumer initialises:
- **Desktop main thread.** `main.tsx` does `import b64 from "@cslope/engine/wasm?base64"`, then `await initEngine(decode(b64))` before `createRoot().render()`. All later main-thread calls (canvas hit tests with `isPointInPolygon`, `toCanonicalSlopeDefinition`, `buildSlope`/`getSlices` in `ResultsPlotDialogApp`, …) stay synchronous.
  - Async compile at startup avoids Chromium's size cap on synchronous `new WebAssembly.Module` on the main thread (8 MB in current Chromium; do not rely on it).
- **Workers.** `runInWorker` posts `{ type, …, engine: engineModule() }`. A `WebAssembly.Module` can be structured-cloned, so the worker calls `initEngineSync(msg.engine)` without compiling again and without a second base64 copy in the worker chunk. This matters because a worker is created per run.
- **vitest.**
  - `packages/engine` uses a `setupFiles` entry that calls `initEngineSync(readFileSync(...))` with the testing build.
  - `packages/desktop` adds the same to `src/test/setup.ts` with the product build.
  - jsdom swaps the global typed-array realm, so the setup copies bytes into `new Uint8Array(buf)` from the current realm before `new WebAssembly.Module`.
- **Bun scripts** (`verification-report.ts`, `generate-data.ts`) call `await initEngine()`, which reads from disk.

### 3.3 How the facade reproduces the TS API

**Shims keep the module paths.** `src/model/slices.ts` becomes:

```ts
export { createSlice, findCrackX, getSlices, rankineCrackDepth, headFactor, findAngleCrackX } from "../wasm-api/model";
export const WATER_LINE_GAP = "The water table does not span the slip surface.";
```

Every relative import in the tests (`./slices`, `../types/index`, …) therefore keeps resolving. Tests stay where they are.

**Facade classes.**

```ts
export class Material {                       // data object, identity = JS object
  readonly name: string; readonly color: string; readonly model: MaterialModel;
  /** @internal */ readonly _key: number;     // unique per instance
  constructor(p: MaterialParams = {}) {       // normalisation + RangeError in Rust
    Object.assign(this, wasm.material_normalize(p)); this._key = nextKey++;
  }
  get unitWeight() { return this.model.unitWeight; }
  getStrength(ctx: StrengthContext) { return wasm.resolve_strength(this.model, ctx); }
}
export class Udl { … constructor(p) { Object.assign(this, wasm.udl_normalize(p)); } }   // same for LineLoad

export class Slope {
  /** @internal */ readonly _h: number;
  /** @internal */ private _seen = -1; private _cache = new Map<string, unknown>();
  /** @internal */ readonly _mats = new Map<number, Material>();  // Rust index -> JS object
  constructor(handle?: number) { this._h = handle ?? wasm.slope_new(); finalizer.register(this, this._h, this); }
  private cached<T>(key: string, read: () => T): T {
    const v = wasm.slope_version(this._h);                       // ~15 ns
    if (v !== this._seen) { this._cache.clear(); this._seen = v; }
    if (!this._cache.has(key)) this._cache.set(key, read());
    return this._cache.get(key) as T;
  }
  get search(): readonly SearchPlane[] { return this.cached("search", () => this.decodePlanes(wasm.slope_search(this._h))); }
  get sliceCount() { return wasm.slope_slice_count(this._h); }
  assignMaterial(coord: [number, number], m: Material) {
    if (!(m instanceof Material)) throw new Error("assignMaterial only accepts instances of the Material class");
    wasm.slope_assign_material(this._h, coord, toWire(m));       // {key, name, color, model}
  }
  setUdls(...udls: Udl[]) { wasm.slope_set_udls(this._h, udls.filter((u) => u instanceof Udl)); }
  setEarlierStage(s: Slope | null) { wasm.slope_set_earlier_stage(this._h, s?._h ?? null); }  // clones s
  get earlierStage(): Slope | null { … child view: Slope over handle wasm.slope_child(this._h, "earlierStage") }
  free() { … }  [Symbol.dispose]() { this.free(); }
}
```

**Material identity.**
- Rust stores `external_key` on materials that came from JS.
- When the facade decodes `baseMaterial` / `material` (a Rust index), it returns the original JS `Material` when one exists for that key. Otherwise it creates one `Material` object per (slope, index) and caches it in `_mats`.
- So `slices[0].baseMaterial === slices[1].baseMaterial` holds, and `=== clay` holds when `clay` was assigned from JS.
- `AnalysisResult.criticalSlices[i].baseMaterial` is a plain `{name, color, model}`, which is what crosses `postMessage` today.

**Slices passed back in** (`analyseBishop(slope, slices)`):
- The facade encodes `baseMaterial` as an index by looking up `_key` among the slope's materials.
- Rust receives `Vec<Slice>` by value, mutates it (Hoek–Brown, `undrainedGoverns`) and returns the solver tuple.
- In TS the solvers mutate the caller's slices, for example `undrainedGoverns`. The facade writes back changed fields onto the JS objects it was given, so code that reads them after the call keeps working.

**Snapshot semantics.** Objects returned by getters are copies. Mutating them does not change the engine. This is documented in `index.ts`. No current test or desktop code relies on the opposite (checked).

**Testing build.**
- `cslope-wasm` has a feature `testing` that adds one export, `__test_call(name: &str, args: JsValue) -> Result<JsValue, JsValue>`.
- It dispatches about 150 internal functions that tests import: `getSlicePropertyArrays`, `generateRefinedPlanes`, `generateLocalPlanes`, `march`, `davisB`, `zzIndicator`, …
- Handles appear inside `args` as `{ $slope: h }`.
- Shim modules export wrappers `export const generateRefinedPlanes = (...a) => t("model/search::generateRefinedPlanes", a)`.
- The product wasm does not carry these serde impls or exports. Expect about 20–30 % smaller.

### 3.4 Progress and cancellation

- **Progress.** `runAnalysis(def, options, { onProgress })` in wasm takes a `&js_sys::Function`. Rust calls it every 256 evaluated surfaces (count-based, so progress never depends on time), on each FE trial and every 50 Monte Carlo samples. In the worker it posts `analysis-progress`. Real LE progress replaces the app's interval-driven fake progress.
- **Cancellation in the app** stays `worker.terminate()`. A synchronous wasm call cannot read messages, and that is fine for one run per worker. `CancelToken` is for native and Python.
- **Reentrancy.** Callbacks must not call back into the same slope handle; the registry's `RefCell` would be borrowed. The wasm layer never holds a registry borrow while calling JS: it takes the `Slope` out of its slot, runs, and puts it back. A reentrant call on that handle gets "The slope is in use by a running analysis."

### 3.5 Panics, size, profile

- **Panics.** Release builds use `panic = "abort"` (wasm traps). A panic hook calls an imported `console.error` with the message first. The facade catches `WebAssembly.RuntimeError`, marks the instance as broken and reinstantiates from the cached `Module` on the next call. Stale handles then throw "The engine was restarted after an internal error; build the model again." Workers are disposable anyway.
- **Size.**
  - Today: `clarabel.wasm` is 814 kB.
  - Expected product engine: 2–3.5 MB raw (LTO, `codegen-units = 1`, `opt-level = 3`, `strip = true`), about 0.8–1.3 MB brotli. Base64 inlining adds 33 % to the main chunk. That is fine from local disk in Electron.
  - CI fails above a 4 MB budget.
  - `wasm-opt` is left out in v1, for the toolchain cost; revisit with a pinned `binaryen`.
  - `simd128` is off in v1. Without fast-math LLVM does not reassociate float reductions, so it would be result-safe, but there is no evidence yet that it is needed.
- **Time.** In WASM, `Clock` reads `performance.now()` through `js_sys::Reflect` on the global object, which works in a worker and in the main thread. Clarabel is built with its `wasm` feature (web-time), as `packages/engine/clarabel` does today.

---

## 4. Python API (pyo3, `crates/cslope-py`, import name `cslope`)

Data goes in as `dict`/`list`/`str` (SlopeDefinition JSON shape, camelCase keys) and comes out as `dict`, through **pythonize** (serde to Python objects, keeps NaN and inf). Python is a scripting front end, so the main surface is the product functions:

```python
import cslope
cslope.__version__, cslope.ENGINE_BUILD          # crate version + git hash

res = cslope.analyse(definition, options=None, *, both_directions=False,
                     progress=None, threads=None) -> dict          # = run_analysis (AnalysisResult)
fem = cslope.fem_summary(definition, settings, *, bounds=False, progress=None) -> dict
rel = cslope.reliability(definition, options, variables, reliability, *, progress=None, threads=None) -> dict
cslope.to_canonical(definition) -> dict
cslope.validate_material_model(model) -> list[str]

s = cslope.Slope(definition)                     # build_slope
s.update_analysis_options({"method": "Bishop", "slices": 50})
fos = s.analyse(threads=None)                    # analyse_slope, SliceRetention.ALL
s.search -> list[dict]; s.min_fos; s.slices(entry_x, exit_x, cx, cy, r, points=None) -> list[dict]
s.analyse_circle(cx, cy, r, method=None) -> dict # convenience: one surface, its slices and FOS
s.fem(options) -> FemResult                      # .factor_of_safety, .mesh (x, y, triangles), .displacement ...
```

- **Arrays.** FE arrays come back as `array.array('d')` by default (zero dependencies). A `numpy` extra returns `ndarray` when numpy is installed (pyo3 `numpy` crate, optional feature).
- **GIL.**
  - Analyses run under `py.allow_threads` (named `detach` in newer pyo3), with rayon available.
  - `progress` callbacks take the GIL briefly, are throttled by count, and may return `False` to cancel.
  - `KeyboardInterrupt` comes through `py.check_signals()` in the same hook and becomes `CancelToken`.
- **Wheels.**
  - `abi3-py39`, so one wheel per platform: manylinux x86_64/aarch64, macOS universal2, Windows x64.
  - A handwritten `__init__.pyi` holds `TypedDict`s for the main shapes.
  - The verification problems are **not** shipped: they cite other programs, and the check-names policy applies.
  - A `cslope.examples` module carries a few clean demo models.
- **As built** (Phase 7): PORTING.md, "Python binding". Differences from
  this sketch: numpy arrays come from `numpy.asarray` in Python (no pyo3
  `numpy` feature); a `cancel=CancelToken()` argument as well; the wheels'
  smoke test compares the demo models within 1e-6 rather than V001 bit for
  bit; `Slope.slices` and `Slope.analyse_circle` are not built.

---

## 5. Determinism and numerics

### 5.1 Goals

| Comparison | Goal | Enforced by |
|---|---|---|
| Rust native vs Rust WASM vs Python, any OS, any thread count | **bit-identical** | `js::math` (no platform libm), no parallel float reductions, merge by index; CI parity job (§6.4) |
| Rust vs TS under V8 (Node/Electron), arithmetic-only modules | bit-identical | fixtures, `assert_eq!` on `f64::to_bits` (NaN = NaN) |
| Rust vs TS, transcendental modules | bit-identical once `js::math` is in; until then 1e-12 relative | as above |
| Whole searches (TS vs Rust) | identical plane set and per-plane FOS; minimum FOS bit-identical, or a documented tie divergence (spike V063: a last-bit tie, 1.7e-5) | per-surface fixtures first, then whole-search fixtures with an allowlist |
| FE strength reduction | bit-identical where no time limit applies | `Clock::Fixed` in fixture runs (TS: a `performance.now` stub) |
| FE bounds (Clarabel) | ≤ solver tolerance (1e-6 relative on F) | Clarabel runs natively on one side and inside wasm on the other, using its own `powf`/`ln` (not under our control) |

### 5.2 `js` module (lands first; every agent uses it)

- **`js::math`**: a port of V8 `src/base/ieee754.cc` (fdlibm) for `sin cos tan asin acos atan atan2 exp log pow`, plus V8's `Math.hypot` from Torque `math.tq` (max-abs scaling and Kahan-compensated sum). Also:
  - `js::math::max(a, b)` / `min(a, b)` with JS semantics: NaN propagates, `max(-0, +0) = +0`;
  - `max_of(&[f64])` / `min_of(&[f64])` for `Math.max(...xs)`, where empty gives -inf / +inf;
  - `round` for `Math.round`: ties toward +inf, `-0` kept, 0.49999999999999994 → 0;
  - `sign`; `sqrt` / `abs` / `floor` / `ceil` / `trunc` are std (exact IEEE).
  - The fdlibm and V8 licence notices go in `js/math.rs` and the third-party notices.
- **`js::num`**: `to_string` (ECMAScript Number::toString layout over Rust's shortest digits; exponent form for e ≥ 21 or e ≤ -7; `-0` → `"0"`), `to_fixed` (ties to the larger n), `to_precision` (same tie rule, needed for `Number(v.toPrecision(7))` in `fem/summary.ts`). Every error message or key that interpolates a number uses these.
- **`js::array`**:
  - `sort_by(slice, |a, b| -> f64)`: a port of V8's TimSort with the JS comparator contract (< 0 less, > 0 greater, 0 or NaN equal). This gives V8's exact order even for inconsistent comparators (NaN). Rust's own sorts may panic on those since 1.81.
  - `sum` (left fold from +0.0).
  - Notes for porters: `Int32Array.prototype.sort()` is numeric; `Array.prototype.sort()` without a comparator is lexicographic.

Until `js::math` is complete, the functions exist as thin wrappers over std, so agents call `js::math::sin` from day one. Switching to the V8 port is a one-file change.

### 5.3 Pitfall list (in PORTING.md; clippy enforces the mechanical part)

`clippy.toml` `disallowed-methods`:
- `f64::{sin, cos, tan, asin, acos, atan, atan2, exp, ln, powf, powi, hypot, round, min, max, mul_add}`
- `slice::{sort_unstable, sort_unstable_by}`
- `Iterator::sum` / `product` on floats, through a review checklist: `Sum for f64` starts at -0.0, while TS `reduce` starts at 0.

Further rules:
- `x ** y` is always `js::math::pow`, never `x*x` or `powi`: fdlibm `pow(x, 2)` is not always `x*x`.
- JS `||` vs `??` on 0 and NaN; `Number.isFinite` vs global `isFinite` (coerces); `NaN` comparisons (`!(a > b)` is not `a <= b`).
- `%` on negative numbers matches Rust `%` on f64. Integer division, `Math.imul` (`wrapping_mul` on i32), `| 0` truncation.
- Iteration order:
  - `Map`/`Set` use insertion order, so use `Vec` pairs. Never iterate a `HashMap` where order matters; `HashSet` is fine for membership only.
  - `Object.keys` puts integer-like keys first.
  - JS `Map` keys use SameValueZero (`-0` equals `0`).
- String keys built from numbers (`planeKey`) go through `js::num::to_string`, or become `(f64 bits with -0 normalised)` tuples, so that equality is the same as in JS.
- Errors thrown inside `try` blocks that TS filters by message (`SURFACE_GEOMETRY_ERRORS`) become typed `EngineError`s compared by message, exactly as in TS.

### 5.4 Validation

- **Fixture runtime is Node (V8), not Bun.**
  - Bun's JavaScriptCore uses the platform libm and would make the reference differ from the shipping runtime.
  - The `tools/fixtures/<area>.ts` scripts stay as they are. `tools/fixtures/run-node.ts` executes them under vitest's Node runtime (`bunx vitest run --config tools/fixtures/vitest.config.ts`), which also resolves the engine's extensionless imports.
  - Fixtures written under Bun already in agents' branches are regenerated.
- **`js::math` vs V8.** 10⁷ random arguments per function (uniform in bits and in ranges, plus special values: ±0, subnormals, ±inf, NaN, multiples of π/2, huge arguments for trig reduction) are generated by Node and compared bit for bit. This is a gating test for Phase 0.
- **Per surface.** For each verification problem (`verification/problems.ts` through `buildSlope`), the fixture records:
  - all generated planes, with `planeKey`;
  - for each plane, all slice fields, the FOS and flags of each method.
  
  Rust must reproduce them bit for bit. This separates slicing and solver errors from search-branching effects.
- **Per search.** Minimum FOS, critical plane key and `discardedBySize` per verification check. Tie divergences are listed in `tests/allowlist.toml` with plane keys and a reason.
- **Verification checks.** The Rust-native verification runner, fed with the problems exported as JSON, must pass every check with the existing tolerance. That tolerance is necessary but not sufficient: it is 0.5–5 %, so it cannot see last-bit drift.
- **After TS deletion.** A golden-digest file `packages/engine-rs/golden/verification.json` records the minimum FOS bits, critical plane key and surface count per check. CI compares exactly. A change that moves any of these must update the file in the same PR, with an explanation, so engine drift is always intentional.

---

## 6. Testing strategy end to end

### 6.1 Rust

- **Per module (PORTING rule 6):**
  - ported unit tests, same cases;
  - differential tests against fixtures (bit-exact by default, tolerance only with a reason in the test).
- **Property and invariance tests:**
  - serial vs rayon vs replay (§7) give identical `search` vectors;
  - fresh vs reused scratch gives identical results;
  - `Slope::clone` then analyse equals analysing the original.
- **Serde round trip.** For every API type, real TS JSON (fixtures) deserialises and serialises back equal, modulo unknown fields and key order. Unknown fields are ignored, never an error.

### 6.2 The existing TS suites against the facade

The ~1,540 tests in 98 files are sorted into a manifest `packages/engine/test-manifest.json` (file → mode + reason). Expected split:

| Mode | What | Share (rough) |
|---|---|---|
| **facade** (unchanged file) | buildSlope/analyseSlope/results, canonical, warnings, reliability, sgi3d, verification problems, build validation messages, summary/FE through the public API | ~80 % |
| **facade+testing** (unchanged file, `wasm-testing` build) | Tests of internal functions with serialisable inputs: search generators, `getSlicePropertyArrays`, `march`, strength/validation helpers, reinforcement envelopes, `davisB`, adapt indicators | ~12 % |
| **rust-ported** (deleted from TS at cutover; already ported under rule 6) | Kernels with mutable typed arrays or classes: `SparseCholesky`, `Anderson`, `returnMapInto`, `emptyState`/`runTrial` internals, mesh internals, HiGHS comparisons | ~6 % |
| **rewritten** | Tests that build partial internal objects (`{…} as never`, hand-built slices without `baseMaterial`) or pass JS closures (custom `sizeField`, `meshDomain` size callbacks) | ~2 % |

The gate is that every test has a mode, and the facade modes pass with no edits to the test files.

**Desktop tests** (51 files using the engine) run unchanged on the product wasm, with init added to `src/test/setup.ts`. `analysis.worker.test.ts` and `worker.test.ts` gain the `engine` module in their request messages.

### 6.3 Verification suite

`packages/engine/src/verification/*` stays TypeScript data plus runners over the facade, so the website generator and the PDF report keep working. Rust gets the problems as an exported fixture for its native runner, and in CI the native verification run (rayon) replaces the 10–15-minute TS run.

`website/scripts/generate-data.ts` caches on a hash of `engine/src`; it will hash `src/wasm/cslope_wasm_bg.wasm` plus the verification sources instead.

### 6.4 Parity job

A corpus of about 40 definitions (verification problems plus edge cases) is run through native Rust, through wasm in Node, and through the Python wheel. The JSON outputs are compared byte for byte, with f64 as bits and `elapsedMs` removed.

---

## 7. Parallelism

### 7.1 Where it is safe

- **`evaluate_planes`** is per-plane pure given `&Slope`. Planes are written by index. On error, the error of the lowest-index failing plane is returned, which is the error the serial loop would have thrown first. A deterministic merge falls out of the design.
- **Monte Carlo reliability.**
  1. Draw all sample values serially first: the resampling loop consumes the RNG based on the values only, never on FOS.
  2. Evaluate the samples in parallel, each thread with its own `slope.clone_model()` and `set_material_model`.
  3. Aggregate in sample order.
  
  The result is identical to serial. The Taylor terms (2 runs per variable) parallelise the same way.
- **Two directions** (`analyseBothDirections`) can run as two parallel tasks.
- **Not parallel:**
  - the optimiser's coordinate descent (`optimize.ts`, `evaluate([plane])` in sequence);
  - FE inside a trial (sparse Cholesky, reductions);
  - FE trials: `DEFAULT_TRIALS_PER_ROUND = 1`. `FemSearch::step` still allows it.

### 7.2 Evaluator

```rust
pub trait Evaluator: Sync {
    fn evaluate(&self, slope: &Slope, planes: &mut [SearchPlane], ctx: &EvalCtx) -> Result<()>;
}
pub struct Serial;                                         // default; wasm
#[cfg(feature = "rayon")] pub struct Rayon { pub min_batch: usize /* 32 */, pub pool: Option<Arc<ThreadPool>> }
// Rayon: slope.prepare(); planes.par_iter_mut().with_min_len(8).map_init(EvalScratch::new, eval_one)
```

`analyse_slope`, `block_search` and `optimise_non_circular` call `ctx.evaluator.evaluate(...)` wherever TS calls `evaluatePlanes` or `evaluate(batch)`. Batches below `min_batch` run serially. Reliability uses `ctx.evaluator.map_samples(...)`.

### 7.3 WASM: one thread per worker, several workers

- WASM threads (SharedArrayBuffer, atomics, `-Z build-std`) need nightly Rust and cross-origin isolation under `file://`. Rejected.
- Even serial, Rust/WASM is 8–11× faster than TS. Phase 6 ships with one engine per analysis worker.
- If more speed is wanted, the design for multi-worker evaluation is the **deterministic replay driver**. It needs no rewrite of the search into a state machine, so the port stays faithful:
  1. Helper workers each build the same `Slope` from `(definition, options)`. The build is deterministic, so all copies are identical.
  2. The coordinator runs `run_analysis` with `Evaluator = Replay { memo: Vec<Vec<PlaneOutcome>>, threshold }`.
  3. At the k-th batch of size ≥ threshold, if `memo[k]` exists it is applied. Otherwise the run aborts with `NeedBatch { k, planes }` (packed `Float64Array`, the spike's `eval_batch` layout).
  4. JS farms the batch out across helpers with `evaluate_batch(handle, packed) -> outcomes`, appends the outcomes and reruns.
  - Plane generation is cheap compared with evaluation, so k reruns cost little: there are about 3 + 12 batches for a circular search, and block search adds its batches.
  - `PlaneOutcome` is `{fos, converged, closestPair, equilibriumGap, lffArray, crack, composite, belowMinSize}`. Slices are not shipped: the coordinator evaluates the critical plane locally at the end and gets bit-identical slices.
  - The helper-worker protocol (pool, `{definition, options}` once, then batches) matches what the TS parallel-worker path being built now needs. Its pool code is reused, and its evaluation function becomes the wasm `evaluate_batch`.
  - Correctness test: replay = serial, bit for bit, on all verification problems.

---

## 8. Build, CI, release

### 8.1 Toolchain pins

- `rust-toolchain.toml`: 1.97.0 (exists).
- `wasm-bindgen = "=0.2.N"` in `[workspace.dependencies]`. The CLI is installed with `cargo install wasm-bindgen-cli --version 0.2.N --locked`, or in CI with `taiki-e/install-action` pinned to that version. `tools/build-wasm.ts` fails if `wasm-bindgen --version` differs from the version in `Cargo.lock`.
- New dependencies to approve (PORTING rule 5):
  - `wasm-bindgen`, `js-sys`, `serde-wasm-bindgen` (cslope-wasm only);
  - `pyo3`, `pythonize`, optional `numpy` (cslope-py only);
  - `rayon` (optional feature of cslope-engine, off for wasm);
  - serde feature `rc`; clarabel feature `wasm` (for the wasm target).

### 8.2 Build script

`tools/build-wasm.ts`:
- Build: `cargo build -p cslope-wasm --target wasm32-unknown-unknown --profile wasm-release [--features testing]`, then `wasm-bindgen --target web --omit-default-module-path --out-dir packages/engine/src/wasm[-testing]`.
- The `wasm-release` profile is release with `panic = "abort"` and `strip = true`.
- Reproducibility: `RUSTFLAGS="--remap-path-prefix=$PWD=/cslope --remap-path-prefix=$CARGO_HOME=/cargo"`, so panic locations carry no machine paths.
- It writes `BUILD-INFO.json`: `{ rustc, wasmBindgen, sourceHash: sha256(crates/** + Cargo.lock + Cargo.toml), wasmSha256, bytes }`.

### 8.3 Commit or build in CI

**Decision: commit the product build** (`packages/engine/src/wasm/`: `.wasm`, glue `.js`, `.d.ts`, `BUILD-INFO.json`). Build the testing wasm in CI and locally (`pretest` runs cargo, which is a no-op when up to date).

- Without committing:
  - the Vercel `tsc -b` would have no glue;
  - the Windows release would need Rust plus wasm-bindgen;
  - desktop-only work would need Rust.
- It matches the `clarabel.wasm` precedent.
- Repository growth is about 1–1.5 MB compressed per engine change. During the port the wasm is committed only at phase milestones. Revisit with LFS if growth becomes a problem.
- CI keeps the committed build honest:
  - **Freshness check.** It needs no Rust and runs in the `check` job: `bun packages/engine-rs/tools/check-wasm-fresh.ts` recomputes `sourceHash` and fails if it differs from `BUILD-INFO.json` ("the engine sources changed; run `bun run build:wasm` and commit `packages/engine/src/wasm`").
  - **Reproducibility.** The `wasm` job rebuilds on Linux and compares bytes with the committed file. On a mismatch it uploads its build as an artifact to commit instead. The Linux CI build is canonical.

### 8.4 CI jobs (`.github/workflows/ci.yml`)

| Job | What it runs |
|---|---|
| `check` | Adds the wasm freshness check (no Rust). Typecheck and the website build keep working on the committed glue and `.d.ts` |
| `rust` (new, ubuntu) | `cargo fmt --check`, `clippy --all-targets --all-features -D warnings`, `cargo test --release` (+ `--features rayon`). Fixtures regenerated under Node with a cache keyed on the engine TS hash, until the TS engine is deleted |
| `wasm` (new, ubuntu) | Build product and testing wasm, reproducibility compare, 4 MB size budget, parity job (§6.4) |
| `engine` | Facade vitest on the testing wasm (needs the `wasm` job's artifact or builds it) |
| `desktop` | Unchanged; uses the committed product wasm. Windows on main/PRs as today |
| `verification-full.yml` | Becomes `cargo test --release --features rayon verification_full`, plus the TS facade run once a week |

### 8.5 Release, Electron/Vite, website, Python

- **Release** (`release.yml`, Windows): no Rust needed. A step `bun packages/engine-rs/tools/check-wasm-fresh.ts` stops a release built on a stale wasm. `verification-report.ts` runs on the facade under Bun.
- **Electron/Vite:**
  - `@cslope/engine` adds the export `"./wasm": "./src/wasm/cslope_wasm_bg.wasm"` and drops `"./clarabel.wasm"`.
  - `main.tsx` imports it with `?base64` (the existing plugin); workers receive the compiled `Module`.
  - `--omit-default-module-path` means Vite sees no `new URL(..., import.meta.url)` and does not emit a second copy.
  - `jsts` and `highs` leave both package.jsons; the desktop does not use them directly (checked).
- **Website (Vercel):** the build only typechecks the scripts that import the engine and runs no analysis. `generate-data.ts` is run by developers and then needs only the committed wasm. Nothing changes for Vercel.
- **Python:** a new `python.yml` triggers on tags `py-v*`. It uses `PyO3/maturin-action` (manylinux x86_64/aarch64, macOS universal2, windows x64), runs a pytest smoke test per wheel (V001 Bishop must be 1.4041800301648426 bit for bit), and publishes to PyPI with trusted publishing.

---

## 9. Migration and cutover, in phases with gates

The TS engine is the reference until Phase 8. Each phase's gate must be green before work that depends on it is integrated.

| Phase | Work | Acceptance gate |
|---|---|---|
| **0. Preparation** (TS and infrastructure; now) | (a) Move the worker's `analyse` / `analyseBothDirections` / `displayPoints` / critical moments into `packages/engine/src/api/run-analysis.ts` (`runAnalysis(def, options, {onProgress})`); the desktop worker calls it. (b) Fixture runner under Node. (c) `js` module with wrappers, then the V8 port. (d) `EngineError` kind. (e) `PORTING-SYNC.json`: sha256 of every TS engine file at the commit its port was verified against; CI fails when a ported TS file changes without its Rust port and hash being updated, which stops the two engines diverging. (f) `clippy.toml` disallowed methods | Desktop tests green. `js::math` bit-identical to V8 on 10⁷ inputs per function. `js::num` and `js::array` exhaustive tests green |
| **1. Leaves** (in progress) | types, math, geometry-ops (jsts replaced), canonical, waternet; fem sparse, anderson, elements, mesh, conic | Per-module differential plus ported unit tests; geometry outputs (faces, order, holes) identical for all verification definitions and the importer fuzz corpus |
| **2. Model core** | slope, composite, surface, reinforcement, search, build-slope | `SlopeSnapshot` (all getters) identical for every verification definition and option variant; `setEntryExitPlanes` gives an identical plane list (keys and order) |
| **3. Slices and solvers** | slices, solvers, mp-march, drawdown, surface-slide, result-warnings | Per-surface fixtures bit-identical (all planes of all problems, all methods); whole circular searches: minimum FOS and critical key identical except allowlisted ties |
| **4. Search extras and the product path** | optimize, block-search, reliability, sgi3d, property-helpers, `api/run_analysis` | `run_analysis` output equal to TS `runAnalysis` (minus `elapsedMs`) for every verification check; all verification checks pass natively; Monte Carlo serial = rayon |
| **5. FE** | fem model, seepage, piles, bars, newton, bfgs, srm, initial-stress, transfer, adapt, then limit-common, lower/upper bound, bound-adapt, analysis, summary | SRM fixtures bit-identical with `Clock::Fixed`; bounds within solver tolerance; FE verification (`fem-cases.ts`) passes |
| **6. WASM and facade** | `cslope-wasm` (registry, product API, testing dispatcher), facade shims for every module, `test-manifest.json`. 6a: the desktop worker switches LE to wasm `runAnalysis` behind a setting, with a shadow mode in beta builds that runs the TS engine too and logs any difference (first 2–4 weeks). 6b: the main thread switches to the facade. 6c: FE switches | Facade-mode TS tests 100 % green, unedited; desktop tests green on Windows; parity job green; bundle ≤ 4 MB; no shadow-mode differences beyond the allowlist over the beta period |
| **7. Python** | `cslope-py`, stubs, wheels workflow | Smoke tests bit-identical to native on all wheel platforms |
| **8. Deletion** | See below | `bun run test`, `cargo test`, parity and golden digests green; `rg jsts\|highs` finds nothing |

Deleted in Phase 8:
- the TS implementations under `packages/engine/src/{types,math,model,fem}` (shims and TS type interfaces stay);
- the TS tests marked rust-ported in the manifest;
- `packages/engine/clarabel/` and `src/fem/clarabel.wasm`;
- the `jsts` and `highs` dependencies (engine and desktop);
- the `?base64` Clarabel import in `analysis.worker.ts`;
- the fixture exporters under `tools/fixtures/` and `PORTING-SYNC.json`. Fixtures are frozen into `golden/`; the TS data in `verification/` keeps exporting problem definitions;
- `experiments/rust-engine` (the spike branch).

After deletion, constants come from Rust: `cargo run -p xtask -- gen-ts` writes `src/types/constants.gen.ts`, and CI checks it is fresh. `MATERIAL_MODEL_LABELS` and other UI strings stay TS.

### After the cutover (2026-11-04)

Done as above, with these differences: the shims were merged into the modules they replaced (`src/<path>.ts` keeps the types, data and docs and calls the engine; no `wasm-api` directory); the TypeScript data constants stay hand-written TypeScript, checked equal to the engine's by `src/facade/facade.test.ts` and `fem.test.ts` (no generated `constants.gen.ts`); the fixtures were not frozen as such: the TypeScript-against-Rust differential tests were removed (decided by the user), and `golden/verification.json` holds the verification results of the shipped engine (F to 1e-6, the critical surface's key, the counts of surfaces), compared natively in CI; the parity job and Python wait for Phase 7.

What TypeScript remains in `packages/engine/src`, and why none of it is engine computation:

| Files | What | Why TypeScript |
|---|---|---|
| `engine.ts` | Starts the WebAssembly engine (async, sync, from a compiled module), restarts it after a trap | The boundary itself |
| `index.ts`, `*/index.ts` | Barrels | API |
| `types/*.ts` | Type declarations, data constants (defaults, ranges, partial factor presets, `MATERIAL_MODEL_LABELS`) and wrappers (`Material`, `Udl`, `LineLoad`, strength, validation) | Types and UI data the app reads at module load; the computation is the engine's |
| `math/*.ts`, `model/*.ts` (but those below), `fem/*.ts`, `api/run-analysis.ts` | One wrapper per engine function; `model/slope.ts` is the `Slope` class over an engine handle (snapshot cache, material identity, setters) | Thin API: each call goes to `wasm()` or, for the tests' internal functions, `testCall` |
| `model/steps.ts`, `api/run-analysis.ts` (`runAnalysisAsync`) | Drivers of the engine's step machines: hand each batch of surfaces to an evaluator (in the same thread or on a pool) and back | Control flow between workers; every surface is generated and evaluated by the engine |
| `parallel/*.ts` | The evaluator pool and its message protocol (chunks of surfaces to workers, results back in order) | Worker orchestration, no computation |
| `facade/*.ts` | Conversion at the boundary: slices and planes in bulk (`slice-codec.ts`), handles, material identity, write-back of changed slices | The boundary itself |
| `verification/*.ts` | The verification problems (data), the tolerance policy (`agrees`, `referenceTolerance`), presentation (labels, formatting), thin runners (`runVerification`, `runFemVerification`, `runReliabilityCase`) over the engine; `layered()` builds problem definitions for tests | Data and the comparison with published values, not analysis |
| `model/property-helpers.ts`, `model/verification-shard.ts`, `parallel/test-pool.ts` | Test support: seeded random models, test sharding, an in-process pool | Tests only, not exported |

---

## 10. Risks, mitigations and open decisions

### 10.1 Risks

| Risk | Mitigation |
|---|---|
| The two engines drift while TS keeps changing | `PORTING-SYNC.json` hash gate; TS engine changes after a module's port land with the Rust change in the same PR; shadow mode in beta |
| Last-bit drift goes unnoticed (verification tolerances of 0.5–5 %) | Bit-exact per-surface fixtures; golden digests after cutover; parity job |
| libm differences (the spike's 2e-13 in WASM) and Windows CRT | `js::math` V8 port everywhere; clippy bans; Node-generated fixtures |
| geo/jsts replacement changes face order or vertex order, and so the results | Phase 1 gate on geometry outputs, including the importer fuzz corpus; deterministic ring orientation and start-vertex rules ported from jsts behaviour, not redesigned |
| Rust ≥ 1.81 sorts panic on inconsistent comparators | `js::array::sort_by` (V8 TimSort port), `sort_unstable` banned |
| Facade semantics differ (snapshots, `setEarlierStage` clones, slices written back) | Documented; manifest review; no current test or desktop code depends on the difference (checked) |
| Memory: wasm32 limited to 4 GB, TS kept all slices | `SliceRetention::Critical` on the product path; FinalizationRegistry plus explicit `free()`; tests that create thousands of slopes use `using`/`free` |
| Panics trap and poison the instance | Rule 5 (no panics on input); panic hook logs; the facade reinstantiates; per-run workers are disposable |
| wasm-bindgen version lock and CLI drift | Exact pin, version check in the build script, CI install pinned |
| Repo growth from the committed wasm | Commit only at milestones during the port; LFS later if needed |
| Main-thread synchronous compile limits and jsdom typed-array realms | Async init before render; Module posted to workers; realm-safe byte copy in test setup |
| Time limits make FE bounds nondeterministic | `Clock` injection; fixed clock in tests and fixtures; only `elapsedMs` and time-limited paths are exempt |
| Hidden JS semantics in error messages (number formatting) | `js::num` used for every interpolated number; messages compared exactly in differential tests |

### 10.2 Open decisions and recommendations

1. **Bit identity with V8** (port V8's ieee754) or a 1e-12 tolerance against TS? **Recommend the V8 port.** It costs about 1,500 lines with exhaustive tests, and it makes native = WASM = Python = old TS exactly, which keeps the tolerances meaningful and the golden digests stable.
2. **Fixture runtime.** **Recommend Node (V8).** This amends PORTING.md, which says Bun.
3. **Commit the product wasm?** **Recommend yes**, with `BUILD-INFO` freshness and CI reproducibility checks. Build the testing wasm in CI.
4. **wasm-bindgen + serde-wasm-bindgen + a handle registry.** **Recommend all three** (§3.1).
5. **`AnalysisResult` assembly** moves into the engine (Phase 0, TS first). **Recommend yes**: Python and the report need it.
6. **Materials by `MaterialId` index, not `Rc`/`Arc` identity.** **Recommend the index.** Models themselves are `Arc<MaterialModel>`.
7. **Parallelism.** **Recommend:** rayon in native and Python from Phase 3 (`Evaluator` trait); WASM single-threaded at cutover; the replay driver only if profiling in the app shows the need.
8. **Where AnalysisResult types live in TS.** **Recommend:** hand-maintained TS interfaces (today's files) checked by serde round-trip fixtures, not code generation (ts-rs and specta are more dependencies; revisit after cutover).
9. **HiGHS.** **Recommend dropping it.** Tests comparing Clarabel with HiGHS are ported to Clarabel-only or deleted (manifest).
10. **SIMD and wasm-opt.** **Recommend both off at cutover;** measure later.

---

## Amendments to PORTING.md (for the integrator)

- **Rule 4/6:** fixtures are generated under Node/V8 with `tools/fixtures/run-node.ts`. Use `js::math`, `js::num` and `js::array` for every `Math.*`, `**`, number formatting and sort. The clippy disallowed-methods list is binding.
- **Rule 3:** `EngineError { kind, message }`; `RangeError` sites use `EngineError::range`.
- **Rule 5 dependencies** (approved for the named crates only): wasm-bindgen (exact pin), js-sys, serde-wasm-bindgen; pyo3, pythonize, numpy (optional); rayon (optional feature); serde `rc`; clarabel `wasm`.
- **Layout:** the new non-port modules `src/js/`, `src/api/` and `RunCtx`; scratch structs replace module-level buffers; lazy caches are `OnceLock`; module globals become atomics.
- **`PORTING-SYNC.json`:** record the TS file hash when a module is reported done.

---

### Critical files for implementation

- `/home/user/cslope/packages/engine/src/model/slope.ts`: state and mutation semantics that the Rust `Slope` and the facade class mirror.
- `/home/user/cslope/packages/engine/src/model/solvers.ts`: `analyseSlope` and `evaluatePlanes`, the evaluation boundary for `Evaluator`, retention and parallelism.
- `/home/user/cslope/packages/engine/src/model/slices.ts`: the hot path, scratch buffers, `SliceContext` and slice fields.
- `/home/user/cslope/packages/desktop/src/worker/analysis.worker.ts`: the `AnalysisResult` assembly that moves into the engine, and the worker init and progress protocol.
- `/home/user/cslope/packages/engine-rs/PORTING.md`, with the amendments above.
- Also central: `/home/user/cslope/packages/engine-rs/crates/cslope-engine/src/error.rs`, `/home/user/cslope/packages/engine/src/index.ts`, `/home/user/cslope/packages/desktop/src/store/slices/analysisSlice.ts`, `/home/user/cslope/.github/workflows/ci.yml`, `/home/user/cslope/.github/workflows/release.yml`.
