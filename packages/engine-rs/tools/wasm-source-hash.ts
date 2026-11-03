// The source hash of the WebAssembly engine (ARCHITECTURE.md §8.3): the
// sha256 of every file the build reads from the repository, so that
// check-wasm-fresh.ts can tell, without Rust, whether the committed build
// is older than the sources. Hashed: the workspace Cargo.toml, Cargo.lock,
// rust-toolchain.toml, and per crate its Cargo.toml and src/ (not tests/,
// benches/ or target/). Line endings are normalised (a Windows checkout
// with autocrlf hashes the same), paths are relative with forward slashes.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** packages/engine-rs */
export const ENGINE_RS = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

/** The files the hash covers, relative to packages/engine-rs, sorted. */
export function sourceFiles(root = ENGINE_RS): string[] {
  const files = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"].map((f) => join(root, f));
  const crates = join(root, "crates");
  for (const name of readdirSync(crates)) {
    const crate = join(crates, name);
    if (!statSync(crate).isDirectory()) continue;
    files.push(join(crate, "Cargo.toml"));
    walk(join(crate, "src"), files);
  }
  return files.map((f) => relative(root, f).split(sep).join("/")).sort();
}

export function sourceHash(root = ENGINE_RS): string {
  const h = createHash("sha256");
  for (const rel of sourceFiles(root)) {
    const text = readFileSync(join(root, rel)).toString("utf8").replace(/\r\n/g, "\n");
    h.update(rel);
    h.update("\0");
    h.update(text);
    h.update("\0");
  }
  return h.digest("hex");
}

export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** What tools/build-wasm.ts records next to each build. */
export interface BuildInfo {
  /** "product" (packages/engine/src/wasm) or "testing" (src/wasm-testing). */
  flavour: "product" | "testing";
  /** `rustc -V`. */
  rustc: string;
  /** The wasm-bindgen crate and CLI version. */
  wasmBindgen: string;
  /** sourceHash() of the sources the build was made from. */
  sourceHash: string;
  /** sha256 of cslope_wasm_bg.wasm. */
  wasmSha256: string;
  /** Size of cslope_wasm_bg.wasm in bytes. */
  bytes: number;
  /** Its size compressed with brotli (quality 11), for the size budget. */
  brotliBytes: number;
}
