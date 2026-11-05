// Builds the DWG reader's WebAssembly (prototype; separate from the engine
// build, tools/build-wasm.ts of packages/engine-rs, which it does not touch):
//
//   bun packages/dwg-rs/tools/build-dwg-wasm.ts
//
// `cargo build --target wasm32-unknown-unknown --profile wasm-release` in
// packages/dwg-rs, then `wasm-bindgen --target web` into
// packages/desktop/src/dwg-wasm (cslope_dwg.js, cslope_dwg_bg.wasm, their
// .d.ts files and BUILD-INFO.json). The app loads it only when a DWG file
// is imported (src/features/project/dwg.worker.ts).
//
// Machine paths are remapped as in the engine build, so that panic
// messages, and so the bytes, do not depend on where the repository is.
// Needs the toolchain of rust-toolchain.toml and the wasm-bindgen CLI of
// the version in Cargo.lock (the engine's too):
//   cargo install wasm-bindgen-cli --version 0.2.130 --locked
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlib } from "node:zlib";

const CRATE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(CRATE, "../..");
const OUT = join(REPO, "packages/desktop/src/dwg-wasm");
/** Fails above this: the reader is loaded on demand, but still shipped. */
const SIZE_BUDGET = 6 * 1024 * 1024;

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const r = spawnSync(cmd, args, { cwd: CRATE, env: env ?? process.env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  return r.stdout;
}

function locked(name: string): string {
  const lock = readFileSync(join(CRATE, "Cargo.lock"), "utf8");
  const m = new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`).exec(lock);
  if (!m) throw new Error(`Cargo.lock has no ${name} package`);
  return m[1];
}

function main(): void {
  const wasmBindgen = locked("wasm-bindgen");
  const cli = run("wasm-bindgen", ["--version"]).trim().split(/\s+/)[1];
  if (cli !== wasmBindgen) {
    throw new Error(`wasm-bindgen CLI ${cli} differs from ${wasmBindgen} in Cargo.lock: cargo install wasm-bindgen-cli --version ${wasmBindgen} --locked --force`);
  }
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
  const remap = [`--remap-path-prefix=${REPO}=/cslope`, `--remap-path-prefix=${cargoHome}=/cargo`];
  const env = { ...process.env, RUSTFLAGS: [process.env.RUSTFLAGS ?? "", ...remap].join(" ").trim() };
  console.log("Building the DWG reader …");
  run("cargo", ["build", "--lib", "--target", "wasm32-unknown-unknown", "--profile", "wasm-release"], env);
  const input = join(CRATE, "target/wasm32-unknown-unknown/wasm-release/cslope_dwg.wasm");

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  run("wasm-bindgen", [input, "--target", "web", "--omit-default-module-path", "--remove-producers-section", "--out-dir", OUT, "--out-name", "cslope_dwg"]);

  const wasm = join(OUT, "cslope_dwg_bg.wasm");
  const bytes = readFileSync(wasm);
  const info = {
    rustc: run("rustc", ["-V"]).trim(),
    wasmBindgen,
    acadrust: locked("acadrust"),
    wasmSha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    brotliBytes: brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
  writeFileSync(join(OUT, "BUILD-INFO.json"), JSON.stringify(info, null, 2) + "\n");
  console.log(`  ${OUT}: ${readdirSync(OUT).join(", ")}`);
  console.log(`  ${(info.bytes / 1024).toFixed(0)} kB, ${(info.brotliBytes / 1024).toFixed(0)} kB brotli`);
  if (info.bytes > SIZE_BUDGET) throw new Error(`the DWG reader is ${info.bytes} bytes, above the budget of ${SIZE_BUDGET}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
