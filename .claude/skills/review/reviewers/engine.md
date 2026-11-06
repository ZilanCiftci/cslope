# Lens: engine

Paths: `packages/engine-rs/**`, `packages/engine/**`. Read [.claude/rules/engine.md](../../../rules/engine.md).

- Can the change move results? If yes, the PR must show `cargo test --release`, regenerated verification data and a VERIFICATION-LOG.md entry; a golden value edited to pass is a blocker.
- Formulas: check them against the cited source (author, year, equation); units and signs; degrees versus radians; tolerances and iteration limits.
- Edge cases: vertical and overhanging segments, zero-width slices, no water, a surface outside the model, empty material lists, NaN propagation.
- The committed WASM is rebuilt when the Rust sources changed; the TypeScript facade types match the Rust structs.
