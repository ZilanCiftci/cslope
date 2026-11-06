---
name: verify
description: The verification gate every change must pass before it is pushed or a PR is opened in cSlope. Runs the checks CI runs for the packages a change touched (typecheck, lint, tests, name check) and the engine's extra steps (Rust tests, WASM rebuild, verification data and log). Use after making a change and before committing, from the main session and from every agent.
---

# verify: the gate before a push

Never report a change as done, and never push or open a PR, because "the edit applied". Verify it the way CI would. If a step fails, fix it and run the steps again from the top.

## 0. Hard stops (no fix is worth these)

Read the hard rules in [CLAUDE.md](../../../CLAUDE.md). A change is rejected outright if it:

- adds client data (project files, drawings, PDFs or screenshots from real projects) anywhere in the repository, fixtures included;
- names another program in a tracked file;
- puts a literal color in a component, or breaks a rule in [docs/design-rules.md](../../../docs/design-rules.md) without changing the rule in the same PR;
- skips, disables or loosens a test to get green;
- can move analysis results without the engine steps in section 4.

## 1. Scope

`git diff --name-only origin/main...HEAD` (and the working tree). Decide which sections apply:

- `packages/desktop/**` → section 2
- `packages/website/**` → section 3
- `packages/engine-rs/**` or `packages/engine/**` → section 4 (and section 2 for the app's use of the engine)
- user-visible text or behavior → the docs in `packages/website/src/docs` and, for a release, `CHANGELOG.md`

## 2. Desktop app (`packages/desktop`)

```
npx tsc -b --noEmit
npx eslint src electron
npx vitest run <the folders you changed>
```

Then once, before the push, the whole suite: `CSLOPE_QUICK_TESTS=1 npx vitest run`. Several agents share the machine: a file that times out under load is rerun alone before it counts as a failure, and the report says so.

For a change to a screen: capture it in both themes with the design-review runner and look at it (see `packages/desktop/tools/design-review/`):

```
CSLOPE_CAPTURE_NO_SANDBOX=1 DESIGN_REVIEW_ONLY=<scene ids> xvfb-run -a -s "-screen 0 3000x2000x24" bun packages/desktop/tools/design-review/run.ts
```

## 3. Website (`packages/website`)

```
bun run typecheck && bun run lint && bun run test
bun run build      # includes the name check and the CSP check of the built pages
```

## 4. Engine (`packages/engine-rs`, `packages/engine`)

Follow "After major changes to the engine" in CLAUDE.md:

```
cd packages/engine-rs && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test --release --all-features
bun packages/engine-rs/tools/build-wasm.ts product  # when the Rust sources changed: the committed engine
bun packages/engine-rs/tools/check-wasm-fresh.ts    # the committed WASM matches the sources
bun run --filter @cslope/engine test
cd packages/website && bun scripts/generate-data.ts && bun scripts/verification-log.ts "<change>"
```

Run `generate-data.ts` on an otherwise idle machine. Report the summary row of the verification log (mean, mean absolute, RMS and largest error, and which results moved).

## 5. Always

```
bun run typecheck && bun run lint                   # all packages, as CI
bun packages/website/scripts/check-names.ts --repo
git diff --check            # whitespace; the repository is LF
```

## 6. Verdict

- All required steps green: commit (the trailers from the session's instructions), push, open the PR with `Fixes #<n>` for each issue it closes, and enable auto-merge.
- A step is red and cannot be fixed within the change: stop, do not push. Label the issue `needs-human` and comment which step failed, with its output.
