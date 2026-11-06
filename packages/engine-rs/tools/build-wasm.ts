// Builds the WebAssembly engine (ARCHITECTURE.md §8.2):
//
//   bun packages/engine-rs/tools/build-wasm.ts            product and testing
//   bun packages/engine-rs/tools/build-wasm.ts product    packages/engine/src/wasm
//   bun packages/engine-rs/tools/build-wasm.ts testing    packages/engine/src/wasm-testing
//
// Each build is `cargo build -p cslope-wasm --target wasm32-unknown-unknown
// --profile wasm-release [--features testing]`, then `wasm-bindgen --target
// web --omit-default-module-path` into the output directory, plus
// BUILD-INFO.json (wasm-source-hash.ts).
//
// The build is reproducible, and CI's rust job compares its own build with
// the committed product build byte for byte: machine paths are remapped
// (--remap-path-prefix), so that panic messages, and so the bytes, do not
// depend on where the repository or the Cargo home is; the producers
// section, which would record the CLI's own dependency versions, is left
// out; and the wasm-bindgen CLI is built from its own lockfile (--locked)
// on both sides, so that it transforms the engine the same way.
//
// Needs the toolchain of rust-toolchain.toml (with the wasm32 target) and
// the wasm-bindgen CLI of the version in Cargo.lock:
//   cargo install wasm-bindgen-cli --version <version> --locked
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import { ENGINE_RS, fileSha256, sourceHash, type BuildInfo } from "./wasm-source-hash";

const REPO = resolve(ENGINE_RS, "../..");
const ENGINE_SRC = join(REPO, "packages/engine/src");

type Flavour = BuildInfo["flavour"];
const OUT_DIR: Record<Flavour, string> = {
  product: join(ENGINE_SRC, "wasm"),
  testing: join(ENGINE_SRC, "wasm-testing"),
};

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const r = spawnSync(cmd, args, { cwd: ENGINE_RS, env: env ?? process.env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
  return r.stdout;
}

/** The wasm-bindgen version Cargo.lock pins. */
export function lockedWasmBindgen(): string {
  const lock = readFileSync(join(ENGINE_RS, "Cargo.lock"), "utf8");
  const m = /\[\[package\]\]\r?\nname = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock);
  if (!m) throw new Error("Cargo.lock has no wasm-bindgen package");
  return m[1];
}

function checkWasmBindgenCli(locked: string): void {
  let out: string;
  try {
    out = run("wasm-bindgen", ["--version"]);
  } catch {
    throw new Error(`wasm-bindgen is not installed: cargo install wasm-bindgen-cli --version ${locked} --locked`);
  }
  const cli = out.trim().split(/\s+/)[1];
  if (cli !== locked) {
    throw new Error(
      `wasm-bindgen CLI ${cli} differs from the crate version ${locked} in Cargo.lock: ` +
        `cargo install wasm-bindgen-cli --version ${locked} --locked --force`,
    );
  }
}

/**
 * The glue keeps its instance in module variables and `initSync` returns
 * early once it has one, so after a trap (a panic) the instance could not
 * be replaced. `__wbg_reset` forgets it; the facade (src/engine.ts) then
 * instantiates the compiled module again.
 */
function addReset(out: string): void {
  const js = join(out, "cslope_wasm.js");
  const src = readFileSync(js, "utf8");
  for (const v of ["let wasmModule, wasmInstance, wasm;", "let __wbg_init_promise;"]) {
    if (!src.includes(v)) throw new Error(`the wasm-bindgen glue changed (no "${v}"): update addReset in build-wasm.ts`);
  }
  writeFileSync(
    js,
    src +
      "\n// Added by packages/engine-rs/tools/build-wasm.ts: forget the instance, so that\n" +
      "// initSync can instantiate the module again after a trap.\n" +
      "export function __wbg_reset() {\n" +
      "    wasm = undefined;\n    wasmInstance = undefined;\n    wasmModule = undefined;\n    __wbg_init_promise = undefined;\n}\n",
  );
  const dts = join(out, "cslope_wasm.d.ts");
  writeFileSync(dts, readFileSync(dts, "utf8") + "\n/** Forgets the instance (added by build-wasm.ts), so that initSync can instantiate again after a trap. */\nexport function __wbg_reset(): void;\n");
}

function build(flavour: Flavour, wasmBindgen: string): BuildInfo {
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
  const remap = [`--remap-path-prefix=${REPO}=/cslope`, `--remap-path-prefix=${cargoHome}=/cargo`];
  const env = { ...process.env, RUSTFLAGS: [process.env.RUSTFLAGS ?? "", ...remap].join(" ").trim() };
  const features = flavour === "testing" ? ["--features", "testing"] : [];
  console.log(`Building the ${flavour} engine …`);
  run("cargo", ["build", "-p", "cslope-wasm", "--target", "wasm32-unknown-unknown", "--profile", "wasm-release", ...features], env);
  const input = join(ENGINE_RS, "target/wasm32-unknown-unknown/wasm-release/cslope_wasm.wasm");

  const out = OUT_DIR[flavour];
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  run("wasm-bindgen", [input, "--target", "web", "--omit-default-module-path", "--remove-producers-section", "--out-dir", out, "--out-name", "cslope_wasm"]);
  addReset(out);

  const wasm = join(out, "cslope_wasm_bg.wasm");
  const bytes = readFileSync(wasm);
  const info: BuildInfo = {
    flavour,
    rustc: run("rustc", ["-V"]).trim(),
    wasmBindgen,
    sourceHash: sourceHash(flavour),
    wasmSha256: fileSha256(wasm),
    bytes: bytes.length,
    brotliBytes: brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
  writeFileSync(join(out, "BUILD-INFO.json"), JSON.stringify(info, null, 2) + "\n");
  console.log(`  ${out}: ${readdirSync(out).join(", ")}`);
  console.log(`  ${(info.bytes / 1024).toFixed(0)} kB, ${(info.brotliBytes / 1024).toFixed(0)} kB brotli`);
  return info;
}

/** Fails above this (ARCHITECTURE.md §3.5). */
const SIZE_BUDGET = 4 * 1024 * 1024;

function main(): void {
  const arg = process.argv[2] ?? "all";
  const flavours: Flavour[] = arg === "all" ? ["product", "testing"] : arg === "product" || arg === "testing" ? [arg] : [];
  if (flavours.length === 0) throw new Error(`usage: build-wasm.ts [all|product|testing], not "${arg}"`);
  const locked = lockedWasmBindgen();
  checkWasmBindgenCli(locked);
  for (const f of flavours) {
    const info = build(f, locked);
    if (f === "product" && info.bytes > SIZE_BUDGET) {
      throw new Error(`the product engine is ${info.bytes} bytes, above the budget of ${SIZE_BUDGET}`);
    }
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
