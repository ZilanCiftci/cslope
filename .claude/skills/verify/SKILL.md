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

### Which tests first

Run the tests of what changed before the whole suite:

| Changed | Run first |
|---|---|
| `desktop/src/store/**` | `src/store` and the feature that uses the changed slice |
| `desktop/src/features/<x>/**` | `src/features/<x>` |
| `desktop/src/components/ui/**` | `src/components` and the features that import the component |
| `desktop/electron/**` | `electron` |
| `desktop/src/features/canvas/draw.ts`, `features/pdf/**`, `features/rendering/**` | `src/features/canvas`, `src/features/pdf`, `src/features/results` |
| `engine-rs/src/**` | `cargo test --release` (the verification checks are in it), then `bun run --filter @cslope/engine test` |
| `website/src/**` | `bun run test` and `bun run build` in packages/website |

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

## 6. Evidence

No claim without fresh evidence from this run:

| Claim | Evidence |
|---|---|
| "Tests pass" | The test runner's summary line from this run (files and tests passed, 0 failed) |
| "Types are fine" | `tsc` finished with no output, after the last edit |
| "It looks right" | Screenshots in both themes taken after the last edit, looked at |
| "Results did not move" | The verification log's summary row, or the engine tests against the golden values |
| "CI is green" | The check runs on the PR's current head commit, not an earlier one |
| "Fixed" (a bug) | A test that failed before the change and passes after it |

## 7. When CI is red

Sort the failure first:

- **Fix and push:** formatting, lint, a type error, a stale snapshot of UI text the change meant to alter, a stale committed WASM. Reproduce locally, fix, run this gate, push.
- **Re-run once:** a runner or network failure before any test ran (checkout, install, download), or a timeout in a test that passes alone. Never more than once; a second failure is real.
- **Stop and report:** a failing assertion in code the change did not mean to alter, a verification result that moved, a crash. Find the root cause; if it is outside the change, label `needs-human` and say what fails and why.

Never skip, disable or loosen a test, and never push an empty commit to start CI again.

## 8. Verdict

- All required steps green: commit (the trailers from the session's instructions), push, open the PR with `Fixes #<n>` for each issue it closes, and enable auto-merge.
- A step is red and cannot be fixed within the change: stop, do not push. Label the issue `needs-human` and comment which step failed, with its output.
