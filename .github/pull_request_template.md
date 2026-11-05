## What and why

<!-- What does this change, and why? Link the issue: "Fixes #123". -->

## How it was tested

<!-- Commands run, tests added, manual steps. For UI changes, screenshots before and after (light and dark theme). -->

## Checklist

- [ ] `bun run typecheck`, `bun run lint` and the tests of the packages I changed pass
- [ ] New or changed behavior has a test
- [ ] UI text: sentence case, American spelling
- [ ] No client or confidential data in code, fixtures or screenshots
- [ ] No names of other programs in tracked files (`bun packages/website/scripts/check-names.ts --repo`)
- [ ] Docs (packages/website/src/docs) and CHANGELOG.md updated if users will notice the change

## Results

- [ ] This change cannot move analysis results
- [ ] This change can move results: I ran the Rust tests (`cd packages/engine-rs && cargo test --release`), regenerated the verification data and recorded the effect in VERIFICATION-LOG.md (see CLAUDE.md)
