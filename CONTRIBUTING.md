# Contributing to cSlope

Thanks for your interest. Bug reports, wrong-result reports with a reproducible model, verification problems from published sources, documentation fixes and code are all welcome.

## Before you start

- For anything larger than a small fix, open an issue (or a discussion) first, so we can agree on the approach.
- Never commit client or confidential data (project files, drawings, borehole logs, screenshots of client projects).
- Do not name other slope stability programs in tracked files; describe them generically ("a commercial limit equilibrium program"). CI checks this: `bun packages/website/scripts/check-names.ts --repo`.

## Setup

Requirements: [Bun](https://bun.sh), and for the engine [Rust](https://rustup.rs) with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.130.

```bash
bun install --frozen-lockfile
bun run dev            # the desktop app
```

## Repository layout

- `packages/desktop`: the desktop app (Electron, React, Vite).
- `packages/engine-rs`: the analysis engine (Rust), built to WebAssembly; `packages/engine`: its TypeScript API and the verification problems.
- `packages/dwg-rs`: the DWG reader (its own WebAssembly build).
- `packages/website`: the website, the documentation and the verification report.

## Checks

Run the checks of the packages you changed before opening a pull request:

```bash
cd packages/desktop && bun run typecheck && bun run lint && CSLOPE_QUICK_TESTS=1 bunx vitest run
cd packages/engine-rs && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test --release
```

## Changes that can move results

The solver, the search, slices, materials and the verification problems determine the published verification results. If your change can move them, also:

1. run the Rust tests (`cargo test --release`, including the golden verification checks),
2. rebuild the committed engine if its sources changed (`bun packages/engine-rs/tools/build-wasm.ts`),
3. regenerate the verification data and record the effect in VERIFICATION-LOG.md, as described in CLAUDE.md.

A pull request that moves results without this will not be merged.

## Style

- UI text: sentence case and American spelling; never change the case of text the user typed.
- Keep CRLF line endings in files that have them.
- Tests for new behavior; don't weaken existing tests to make a change pass.
- Commits: a short summary line, then what and why.

## License

By contributing you agree that your contribution is licensed under the [MIT license](LICENSE) of this project.
