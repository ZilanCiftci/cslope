# Clarabel for the limit analysis bounds

`src/lib.rs` wraps [Clarabel](https://github.com/oxfordcontrol/Clarabel.rs)
(Goulart & Chen 2024, arXiv:2405.12762), an interior point solver for conic
programs, in a C ABI for WebAssembly. The engine's limit analysis bounds
(`../src/fem/conic.ts`) solve their second-order cone programs with it.

`build.sh` builds the module (Rust with the `wasm32-unknown-unknown` target)
and copies it to `../src/fem/clarabel.wasm`, which is committed so that the
engine and the app need no Rust toolchain. Rebuild it after changing
`src/lib.rs` or the Clarabel version in `Cargo.toml`; `Cargo.lock` pins the
dependencies.

Clarabel is licensed under the Apache License 2.0
(https://www.apache.org/licenses/LICENSE-2.0); its copyright notice is in the
crate's sources (https://crates.io/crates/clarabel).
