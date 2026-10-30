#!/bin/sh
# Build the Clarabel WebAssembly module used by the limit analysis bounds
# (needs rustup with the wasm32-unknown-unknown target). The output is
# committed, so that the engine needs no Rust toolchain.
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/cslope_clarabel.wasm ../src/fem/clarabel.wasm
