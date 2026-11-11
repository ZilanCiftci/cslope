# cSlope

## Hard rules

- No client data in the repository, issues, fixtures or screenshots (project files, drawings, PDFs from real projects). Use synthetic models or copies saved with File › Save as anonymized….
- No names of other programs in tracked files (`bun packages/website/scripts/check-names.ts --repo`).
- Never skip, disable or loosen a test to get green; never edit a golden verification value to pass.
- Keep the change to what was asked: no drive-by refactors of untouched code.
- When unsure, stop and ask; do not guess. Above all for anything that can move analysis results, a default that changes existing models, or the file format.

## How work flows

Bugs and wishes are GitHub issues, built in sprints: see [.claude/workflow.md](.claude/workflow.md) and the skills `issue`, `triage`, `sprint`, `review` and `verify` in `.claude/skills` (sprint groups are built by the `sprint-worker` agent in `.claude/agents`). Every change passes the `verify` gate before it is pushed. Path-scoped rules for each package are in `.claude/rules`. Decisions and their reasons go in [DECISIONS.md](DECISIONS.md).

## UI and UX

Follow docs/design-rules.md for every change to the app's screens (dialogs, panels, lists, canvas, wording). It is short; read it before adding or changing a dialog or a control.

## After major changes to the engine or the verification problems

The website's verification data is generated locally and committed, not built on Vercel. After a change that can move results (solver, search, slices, materials, or the problems in packages/engine/src/verification), regenerate it and commit the result:

```
cd packages/website
bun scripts/generate-data.ts   # verification table (src/content/generated/verification.json), about 1 min
bun run report                 # public PDF report (public/cSlope-verification-report.pdf), about 3 min
```

Then record the effect of the change in VERIFICATION-LOG.md, before committing, for traceability: which verification results moved and the mean, mean absolute, RMS and largest error before and after. Do this after every major change, also when nothing moved:

```
cd packages/website
bun scripts/verification-log.ts "Short description of the change"   # compares with the committed table
```

Run generate-data.ts while the machine is otherwise idle (no other test runs or agents working), so the recorded run times are comparable; the log notes the load at the start. Report the summary row to the user.

The home page's example images are exported from the app and also go stale. Recapture them, then update the image sizes:

```
# from the repository root; in a container run as root, under a virtual display
CSLOPE_CAPTURE_NO_SANDBOX=1 CSLOPE_CAPTURE_ONLY=home- xvfb-run -a -s "-screen 0 3000x2000x24" bun run packages/desktop/tools/media-capture/capture-runner.ts
cd packages/website && bun scripts/media-sizes.ts
```

Check that the factors of safety in the images match the table. The examples are listed in packages/website/src/content/home-examples.ts.

The home page also shows a screenshot of the browser version (packages/web), in light and dark. After a change to packages/web that shows on the page (the form, the drawing, the result card or the example link), recapture it:

```
(cd packages/web && bun run build) && cd packages/website && bun scripts/capture-web.ts && bun scripts/media-sizes.ts
```

Check that F in the screenshot matches the example link (SITE.appExample in packages/website/src/site.ts).

## CI

CI runs the engine jobs (Rust format, lints and tests including the verification checks against packages/engine-rs/golden/verification.json; the TypeScript API tests over the WebAssembly engine, quick set) only when packages/engine-rs or packages/engine changed; the app and website checks run on every pull request and on main (desktop on Windows). A push to a working branch without a pull request starts no run. A weekly workflow (verification-full.yml) runs everything. Before pushing an engine change to main, run the Rust tests locally (`cd packages/engine-rs && cargo test --release`) and rebuild the committed engine if its sources changed (`bun packages/engine-rs/tools/build-wasm.ts`).
