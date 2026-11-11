# Decisions

A log of the decisions behind cSlope's behavior and look, newest first, so that later work knows why something is the way it is. One entry per decision: the date, what was decided, the alternatives that were turned down, and where it is implemented. The rules that follow from them live in [docs/design-rules.md](docs/design-rules.md) and [CLAUDE.md](CLAUDE.md); this file keeps the reasons.

Add an entry when the maintainer chooses between options (an issue labeled `needs-decision`, a design review), in the same PR as the change.

## Engine

### 2026-11-10: Rust is the only engine; no bit identity with the removed TypeScript engine

The engine is optimised as Rust code in its own right. A change must keep the verification checks against the golden values (F within 1e-6) and keep native, WebAssembly and Python bit-identical to each other; it need not reproduce the TypeScript engine's arithmetic. Turned down: keeping TypeScript's operation order everywhere, which blocked restructuring the slice builder and the solvers.

## Process

### 2026-11-06: Work flows through issues and sprints

Bugs and wishes are GitHub issues; the maintainer picks a sprint's issues (`sprint: <n>` label); agents build them in groups, one PR per group, which merge on their own after the verify gate and CI. See [.claude/workflow.md](.claude/workflow.md). While in beta, fixes merge without a human review; **revisit before the first non-beta release** (then PRs wait for approval).

### 2026-11-06: The website deploys on every merge to main

Vercel builds only main; "skip deployments when there are no changes" is off, because the site reads files outside its folder (CHANGELOG.md, the app's version). Vercel does not comment on pull requests.

### 2026-11: Pull requests with auto-merge; main protected

Every change goes through a PR with auto-merge (squash); main requires the `check` and `desktop` checks and an up-to-date branch, no approvals. The repository is LF throughout (`.gitattributes`).

## Design review (2026-11-05), decisions D-01–D-22

The review is in `packages/desktop/tools/design-review`; each decision had two options with mockups. Chosen options:

| Id | Decision | Chosen | Turned down |
|---|---|---|---|
| D-01 | Selection in the Models tree | All selected rows light blue, active model semibold, running model a grey spinner | A 1 px accent frame on the active model |
| D-02 | Menus | One `Menu`/`MenuItem`, 12 px, no icons | Optional icons per menu |
| D-03 | Lists of records in windows | One `RecordTable`: editable cells (22 px editor in a 24 px row) or read-only rows with a detail form | Keep the components, shared cell style, a toolbar above |
| D-04 | Frames of the drawing windows | The standard frame: heading and sentence, workspace, full-width `.dialog-buttons` | A documented exception with buttons in the side panel |
| D-05 | The error after a failed run | The whole sentence only in the banner; "Analysis failed" in the status bar and the summary | Only the banner |
| D-06 | The "…" convention (decided 2026-11-06, issue #39) | D: "…" only on a command that asks for something before it acts (a file, a file name, a calibration, lines to pick), in menus, small ribbon buttons and tooltips; a command that shows a window has none; large ribbon buttons never (their menu items or tooltip carry it); otherwise only for truncated text | A ("…" on every command that opens a window, from menus and small buttons) and B (the same everywhere): "…" would mark most of the ribbon and stop meaning anything; C (menus only): the ribbon and the menus would follow different conventions |
| D-07 | Icons | One per concept: settings the gear, parameters Variable, properties Info | Keep the slider icon for Parameters |
| D-08 | Placed drawings in the dark theme | Inverted, with an "Invert in dark theme" switch per drawing | A multiply/darken blend |
| D-09 | Selection handles on the canvas | Keep round handles (accent dot with a ring, 8–10 px); the rule changed | 6–7 px squares |
| D-10 | Material table and color bar on the sheet | B: keep the position, opaque fill, a minimum text size on screen | Move them to free paper space, text in points |
| D-11 | The result sidebar | Panel "Results"; the last section named after the selection, scrolled into view | Keep "Properties", a "Selection · Text" section |
| D-12 | About | B: a dialog in the window (`ModalFrame`) | The system message box |
| D-13 | Window sizes | Height fitted to the content on opening, one width per family | Smaller fixed sizes, remembered by the user |
| D-14 | Wording in the result windows | F, Fm, Ff and λ throughout, "F against λ" | "Factor of safety" written out |
| D-15 | The Results tab before a run | Commands stay enabled, with a hint | Disable Display and Annotations |
| D-16 | Attachments without files | Shown, with "No files." and "+ Add drawing…" | Hidden until the first drawing |
| D-17 | The layer list of a DWG drawing | An eye per layer; Show all / Hide all as text links | Checkboxes |
| D-18 | Result lines in the dark theme | The theme ink everywhere with a thin halo | Contrast-adapted colors |
| D-19 | Order and removal of drawings | Grip and × on the row on hover, Alt+↑/↓ | Buttons in the settings box |
| D-20 | The floating toolbar over the sheet's x-axis | A screen-only band reserved below the sheet | Dock the toolbar under the canvas |
| D-21 | Canvas width/height in Model properties | Removed from the dialog (kept in the file) | Give them a function |
| D-22 | CSV export | B: one split button "Export CSV ▾", decimal point or comma, remembered | The separator chosen as a file type in the save dialog |

Implemented in PRs #28–#30, #32–#35 and #37.

## Engine

### 2026-11-11: The unit weight of water is a per-model analysis option

γw is `AnalysisOptions.waterUnitWeight` (kN/m³, finite and > 0, else an error; absent: `WATER_UNIT_WEIGHT`, 9.807), not a `SlopeDefinition` field, because the comparable model-level physical inputs already live there: the seismic coefficients kh and kv, the pore pressure head convention and the water in a tension crack are analysis options, and the app edits them in one panel (Model › Analysis › Options, *Water and tension crack*), where the new field sits. The slope takes it from the options and gives it to everything that turns a head into a pressure: the slices (pore pressure, suction, free water, water in a crack, the Rankine crack depth), the waternet, the effective stress of reinforcement and SHANSEP, the earlier stage and the state before rapid drawdown (the same water), and the finite element models and bounds. `validate` warns outside 9–11 kN/m³ (a unit mistake, mostly). Projects store it only when a model sets its own value, so files and input hashes of models at the default do not change, and nothing moves for a model without it (the verification is unchanged). The importers take the file's γw (in kN/m³) into the model instead of noting the difference, and the exporters write the model's. Turned down: a `SlopeDefinition` field (the definition holds geometry, materials, water lines and loads; the physical constants that are settings sit with the options, and the earlier stage would carry a second copy that could disagree); a global app preference (a project would give other results on another machine).

### 2026-11-11: The unit weight of water is 9.807 kN/m³

γw = ρw·g with ρw = 1000 kg/m³ and standard gravity g = 9.80665 m/s² (CGPM 1901), rounded to 9.807 kN/m³, in the engine and everywhere the app writes or compares it (the importers' unit checks and notes, the exporters, the docs and the verification report). Was 9.81. Problems that publish their own unit weights keep them; the engine has no per-model γw. Turned down: keeping 9.81 (0.03 % more pore pressure than standard gravity gives).

### 2026-11-10: The slice base of a circle is the straight chord, with the shear arm to the chord

A slice of a circle stands on the straight chord between its two base points, the conventional discretisation of a circle and the only behaviour: the weight is that of the soil above the chord, the base length the chord's length, α the chord's inclination, and the pore pressure and strength are taken at the chord's midpoint. The base shear force's moment arm about the centre is the perpendicular distance from the centre to the chord, R·cos(Δθ/2) (Δθ the angle the slice subtends), and the normal force's arm is 0, after the general limit equilibrium formulation of Fredlund & Krahn (1977), where the shear force's arm is measured to the base line; every moment equation (ordinary, Bishop, Spencer, Morgenstern-Price) takes the per-slice arm. The weight's arm stays W·(x − xc). The steep ends of a circle are still cut into narrower slices, so that a chord does not cut far below a steeply turning arc (the published V068 and the accuracy checks of a submerged vertical cut need it). On the same circle F rises by about 0.01–0.15 % (mean +0.014 % over the golden circle analyses); on 45 example surfaces the gap to the conventional method's values on the same surfaces falls from −0.10 % to −0.05 % on average (median −0.02 %). The arc-consistent base (arc length, α at the middle of the arc, the weight under the arc, arm R; from 2026-11-02) and the experiment switch `CSLOPE_SLICE_BASE` are removed. Turned down: the chord without the end cut (gap −0.004 %, but V068 1.8 % from Low (1989) at 50 slices and a coarser discretisation at steep ends); keeping the arc (it converges faster with the slice count, but its results differ from the conventional method's on the same slices, which users compare with); making the base an option (a setting that moves results for little gain, and a second code path to test and document). Recorded in VERIFICATION-LOG.md.

### 2026-11-07: The browser page's `.cslp` writer is a second WebAssembly module, loaded on demand (issue #107)

"Download .cslp" in the browser writes the project with the Rust writer of `cslope-project` (feature `write`: the ZIP writer and miniz_oxide's deflate in memory, no files), so the page writes what the app and the Python package write. In the engine's module it added 2.4 MB (5.8 MB, above the 4 MB budget of ARCHITECTURE.md §3.5): the app's model with its strict reading and the writer are mostly serde code. It is a module of its own, `crates/cslope-project-wasm` (2.1 MB, 0.4 MB brotli, built for size), committed in `packages/engine/src/wasm-project` and fetched by the page only when a project is downloaded. The page's result is saved with the input hash of the definition it ran (a level water table written as the line it stands for, missing colours as the model's), and the save policy keeps it only when the model reads back as that input: the app opens it current, and its own run gives the same F (`web-project.test.ts`). A result of other input (a change before its run) is left out, not saved out of date. Turned down: the writer in the engine (over budget); a writer in TypeScript in the page (a second writer of the format to keep equal to the app's); saving a stale result marked out of date (the Rust writer's save policy drops one, and a result the page no longer shows is of no use in the app).

### 2026-11-06: D-23, the public defaults are the app's (issue #55)

`cslope.analyse` in Python and the command line take the app's options for a new model (`APP_DEFAULT_ANALYSIS_OPTIONS` in packages/desktop/src/store/defaults.ts: Morgenstern-Price, 30 slices, 1000 + 500 trial surfaces, composite surfaces) as the defaults, under the options of an analysis document and those given; `public_default_options()` in the engine (types/analysis.rs) holds them, and `cslope.default_options()` returns them. The same model then gives the same F in the app and in Python. The engine's internal default (`default_analysis_options`: Bishop, 25 slices, circles) is unchanged, so the verification problems, the golden results and `cslope.Slope` keep it. Turned down: changing the engine's default (it would move every result that relies on it, and the verification options); keeping the engine's defaults in Python (an agent's run would differ from the app's without a word). Noted as a change in the Python README.

### 2026-11-06: D-24, `freeWater` replaces `followBoundary`; a boundary's `materialName` is deprecated (issue #55)

`waterTable.followBoundary` (and that of `waterTables` entries) reads the wrong way round: true means *no* free water. A `freeWater` field with the documented meaning is added (true: water above the ground is free water whose weight acts on the ground; false, the default: the line is clipped to the ground); it takes precedence, and `followBoundary` is read only without it. A `waterTables` entry with neither takes the main line's `freeWater` when that is given (the app writes `followBoundary` on every line and never `freeWater`, so its files read as before); the app reads `freeWater` when it opens a definition (store/definition-model.ts). `materialBoundaries[].materialName` is optional (absent is "") and deprecated: with a name and no `regionAssignments` the engine assigns the region below the boundary's midpoint. The engine reads both old fields as before, the schema marks them deprecated, the examples show only the new names, and `validate` reports `followBoundary: true` (a warning) and a `materialName` that the engine would use (an error). No app change: the app still writes `followBoundary` and `materialName: ""`. Turned down: removing the old names (older files and the app's own output use them); renaming without the engine reading both (a breaking change for the app).

### 2026-11: A slip surface may not leave through the model's side

With "Both" directions and no search limits, a surface could exit through a vertical side of the model. `VERTICAL_SIDE_SLOPE` in `geometry_ops.rs` rejects it; the verification results did not move.
