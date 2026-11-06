---
name: review
description: Review a change in cSlope before it merges - a coordinator lists the changed files, starts one reviewer subagent per lens that the change touches (design rules, engine, desktop, tests), and merges their findings by file. Use on a sprint PR before enabling auto-merge, on any branch on request ("granska PR 42"), or on uncommitted work.
---

# review: one pass, several lenses

The reviewers read the change with fresh eyes; the coordinator (you) does not review, it dispatches and merges. Findings are claims to verify, not orders.

## 1. The diff, once

```
git fetch origin main
git diff --name-only origin/main...HEAD          # a branch or PR
git add -N . && git diff HEAD > "$SCRATCH/review.diff"   # uncommitted work
git diff origin/main...HEAD > "$SCRATCH/review.diff"     # a branch
```

`$SCRATCH` is the session's scratchpad. Every reviewer reads the same file.

## 2. Pick the lenses

Each lens in `reviewers/` names the paths it covers. Start only the lenses whose paths the change touched:

| Lens | Paths | File |
|---|---|---|
| design | `packages/desktop/src/**/*.tsx`, `packages/desktop/src/index.css`, `docs/design-rules.md` | [reviewers/design.md](reviewers/design.md) |
| desktop | `packages/desktop/**` | [reviewers/desktop.md](reviewers/desktop.md) |
| engine | `packages/engine-rs/**`, `packages/engine/**` | [reviewers/engine.md](reviewers/engine.md) |
| tests | any change to source code | [reviewers/tests.md](reviewers/tests.md) |

## 3. Dispatch

One subagent per lens, **all in one message**, each told: read `reviewers/_contract.md`, then its lens file, then the diff file; read the touched files on the branch for context; report in the contract's format only. Do not give them your own opinion of the change.

## 4. Merge and act

- Group the findings by file; drop duplicates; verify each `blocker` yourself against the code (a realistic path to the failure).
- `blocker`: fix before merge (in the same PR), then run the `verify` gate again.
- `suggestion`: fix if it is small and in the PR's scope; otherwise one line in the report.
- `nit`: fix only together with other edits to the same file.
- Report to the maintainer (Swedish) in a few lines: blockers fixed, suggestions taken or left and why.
