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

## No other products by name

The site must not name other slope stability programs or their vendors.
Cite verification problems by their literature reference, or as "a
commercial slope stability program". `bun run build` fails when a name
from `scripts/forbidden-names.ts` appears in `dist/`, and `bun run test`
checks the sources.
