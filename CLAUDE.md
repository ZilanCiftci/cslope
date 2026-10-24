# cSlope

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

Report the summary row to the user.

The home page's example images are exported from the app and also go stale. Recapture them, then update the image sizes:

```
# from the repository root; in a container run as root, under a virtual display
CSLOPE_CAPTURE_NO_SANDBOX=1 CSLOPE_CAPTURE_ONLY=home- xvfb-run -a -s "-screen 0 3000x2000x24" bun run packages/desktop/tools/media-capture/capture-runner.ts
cd packages/website && bun scripts/media-sizes.ts
```

Check that the factors of safety in the images match the table. The examples are listed in packages/website/src/content/home-examples.ts.
