# cSlope

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

## CI

CI runs the engine jobs (Rust format, lints and tests including the verification checks against packages/engine-rs/golden/verification.json; the TypeScript API tests over the WebAssembly engine, quick set) only when packages/engine-rs or packages/engine changed; the app and website checks run on every push (desktop on Linux on working branches, on Windows on main and pull requests). A weekly workflow (verification-full.yml) runs everything. Before pushing an engine change to main, run the Rust tests locally (`cd packages/engine-rs && cargo test --release`) and rebuild the committed engine if its sources changed (`bun packages/engine-rs/tools/build-wasm.ts`).
