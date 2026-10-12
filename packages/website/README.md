# cSlope website

The public site for cSlope: product pages, verification results and the
user documentation. Vite, React, Tailwind CSS and react-router.

## Commands

```bash
bun run dev        # development server
bun run build      # typecheck, build to dist/, check for forbidden names
bun run test       # unit tests
bun run lint
bun run typecheck
```

## Deployment

Vercel builds the site from this directory (Root Directory
`packages/website`, settings in `vercel.json`). Pushes to `main` publish
to production; pull requests get a preview deployment. The pages listed in
`src/routes.tsx` rewrite to `index.html` so react-router handles them; any
other URL gets `404.html` with a real 404 status. `src/routes.test.tsx`
checks that the two lists agree.

## Screenshots

The images in `public/media/generated/` come from the desktop app and are
regenerated, not drawn by hand. The scenes are defined in
`src/content/media-scenes.ts`. On a machine with a display:

```bash
bun run media:capture
```

In a container (for example a cloud development session), under a virtual
display and as root:

```bash
CSLOPE_CAPTURE_NO_SANDBOX=1 xvfb-run -a -s "-screen 0 1440x900x24" bun run media:capture
```

The images are deterministic, so a `git diff` shows when the UI changed.

## Verification data

`src/content/generated/verification.json` holds every published
verification problem with the engine's result, for the verification
table and the figures on the home page. Regenerate it after changing the
engine or the problems:

```bash
bun scripts/generate-data.ts            # runs the engine (about 2 minutes)
bun scripts/generate-data.ts --cached   # reuse the last run, e.g. after editing anonymise.ts
```

`bun run test` fails when the file no longer matches the problems in the
engine.

## Verification report

The verification page links to the public edition of the verification
report (no other program named), which the release workflow attaches to
every GitHub release. To check it locally:

```bash
cd packages/desktop && bun scripts/verification-report.ts ../website/public/verification-report.pdf --public
```

It runs every problem (about 15 minutes) and stops if any text would still
name another program or show an engine id. `bun run test` then checks the
file's text as well (with poppler's `pdftotext`). The file is not committed.

## Releases and the download page

The download page links to the latest GitHub release. To publish one, set
the version in `packages/desktop/package.json`, add its section to
`CHANGELOG.md`, and push a tag `v<version>` on a commit whose CI is green.
`.github/workflows/release.yml` builds the Windows installer and publishes
the release with its SHA-256 checksum, the public verification report
and the changelog section.

## Share image

`public/og-image.png` is rendered from `scripts/og-image.html`:

```bash
bun scripts/render-og-image.ts
# in a container: CHROMIUM_PATH=/opt/pw-browsers/chromium CSLOPE_CAPTURE_NO_SANDBOX=1 bun scripts/render-og-image.ts
```

## No other products by name

The site must not name other slope stability programs or their vendors.
Cite verification problems by their literature reference, or as "a
commercial slope stability program". `bun run build` fails when a name
from `scripts/forbidden-names.ts` appears in `dist/`, and `bun run test`
checks the sources.
