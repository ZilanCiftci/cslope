---
paths:
  - "packages/website/**"
---

# The website

- The documentation (`src/docs/*.mdx`) describes the app as it is on main: change it in the same PR as the behavior, with the names users see in the app (sentence case, the same words).
- The verification table, report and home-page images are generated locally and committed (see CLAUDE.md); never edit `src/content/generated/*` by hand.
- Only main deploys (Vercel); the build runs the name check and the content-security-policy check on the built pages (`bun run build`).
- No names of other programs (`bun scripts/check-names.ts --repo`); describe another program generically ("a commercial limit equilibrium program").
- Validate: `bun run typecheck && bun run lint && bun run test && bun run build`.
