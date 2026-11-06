---
paths:
  - "packages/engine-rs/**"
  - "packages/engine/**"
---

# The engine

- The engine is Rust (`packages/engine-rs`), compiled to WebAssembly and committed in `packages/engine/src/wasm`; `packages/engine` is the TypeScript facade. Rebuild the committed WASM after a change to the Rust sources (`bun packages/engine-rs/tools/build-wasm.ts product`); CI checks it is fresh.
- A change that can move results (solver, search, slices, materials, water, loads, reinforcement, the verification problems) follows "After major changes to the engine" in CLAUDE.md: `cargo test --release`, regenerate the verification data on an idle machine, record the effect in VERIFICATION-LOG.md, report the summary row. Also when nothing moved.
- Results are checked against the golden values in `packages/engine-rs/golden/verification.json`. Never edit a golden value to make a test pass; a moved result is explained (with a reference) or the change is wrong.
- Physics and methods follow the literature; cite the source (author, year, equation) in a comment where a formula comes from one, and in the website's theory pages when users see it.
- Ask before changing a default that moves results for existing models (a method, a tolerance, a search setting).
- Validate with the engine section of the `verify` skill.
