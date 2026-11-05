# cSlope

Slope stability analysis software. The analysis engine is written in Rust and runs as WebAssembly; the desktop app is built with TypeScript, React, Vite and Electron.

## Quick Start

```bash
bun install
bun run dev
```

## Project Structure

- `packages/desktop` — Desktop application (Electron + Vite + React)
- `packages/engine-rs` — The analysis engine (Rust)
- `packages/engine` — Its TypeScript API (`@cslope/engine`) over the engine's WebAssembly build, and the verification problems
- `packages/website` — Project landing page

## Getting help and contributing

- Questions: [Discussions](https://github.com/ZilanCiftci/cslope/discussions). Bugs, wrong results and feature requests: [issues](https://github.com/ZilanCiftci/cslope/issues/new/choose). See [SUPPORT.md](SUPPORT.md).
- Security problems: report them privately, see [SECURITY.md](SECURITY.md).
- Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).
- Never attach client or confidential data to issues or pull requests.

cSlope is beta software provided without warranty: check its results against independent calculations and engineering judgment before using them for design.

## License

MIT
