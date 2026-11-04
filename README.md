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

## License

MIT
