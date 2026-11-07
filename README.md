# cSlope

Slope stability analysis software. The analysis engine is written in Rust and runs as WebAssembly; the desktop app is built with TypeScript, React, Vite and Electron.

## Quick start

Run the desktop app from the source:

```bash
bun install
bun run dev
```

## Project structure

- `packages/desktop`: the desktop application (Electron, Vite and React).
- `packages/engine-rs`: the analysis engine (Rust), with the Python package in `crates/cslope-py` (`pip install cslope`).
- `packages/engine`: the engine's TypeScript API (`@cslope/engine`) over its WebAssembly build, and the verification problems.
- `packages/web`: cSlope in the browser (app.cslope.com).
- `packages/website`: the website and documentation (cslope.com).

## Getting help and contributing

- Questions: [Discussions](https://github.com/ZilanCiftci/cslope/discussions). Bugs, wrong results and feature requests: [issues](https://github.com/ZilanCiftci/cslope/issues/new/choose). See [SUPPORT.md](SUPPORT.md).
- Security problems: report them privately, see [SECURITY.md](SECURITY.md).
- Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).
- Never attach client or confidential data to issues or pull requests.

cSlope is beta software provided without warranty: check its results against independent calculations and engineering judgment before using them for design.

## License

MIT
