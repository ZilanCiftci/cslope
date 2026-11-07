// The source hash of the WebAssembly engine (ARCHITECTURE.md §8.3): the
// sha256 of every file the build reads from the repository, so that
// check-wasm-fresh.ts can tell, without Rust, whether the committed build
// is older than the sources. Hashed: the workspace Cargo.toml, Cargo.lock,
// rust-toolchain.toml, and per crate the build compiles its Cargo.toml and
// src/ (not tests/, benches/ or target/). The crates are the build's own
// (cslope-wasm for the engine, cslope-project-wasm for the project writer)
// and its path dependencies, recursively; the product build leaves out the
// optional ones, so a crate a build does not compile (cslope-py, for the
// engine cslope-project) does not mark it stale. Line endings are
// normalised (a Windows checkout with autocrlf hashes the same), paths are
// relative with forward slashes.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

/**
 * The path dependencies of a crate (its directory) in its `[dependencies]`
 * table, as directories; without the optional ones unless `optional`.
 */
export function pathDependencies(crate: string, optional: boolean): string[] {
  const out: string[] = [];
  let section = "";
  for (const line of readFileSync(join(crate, "Cargo.toml"), "utf8").split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (section !== "dependencies") continue;
    const path = /\bpath\s*=\s*"([^"]+)"/.exec(line);
    if (!path) continue;
    if (!optional && /\boptional\s*=\s*true\b/.test(line)) continue;
    out.push(join(crate, path[1]));
  }
  return out;
}

/** The crate each build compiles to WebAssembly. */
export const BUILD_CRATE: Record<BuildInfo["flavour"], string> = {
  product: "cslope-wasm",
  testing: "cslope-wasm",
  project: "cslope-project-wasm",
};

/** The crates a build compiles: its own crate and its path dependencies (recursively), as directories. */
export function buildCrates(flavour: BuildInfo["flavour"], root = ENGINE_RS): string[] {
  const seen = new Set<string>();
  const visit = (crate: string) => {
    const dir = resolve(crate);
    if (seen.has(dir)) return;
    seen.add(dir);
    for (const dep of pathDependencies(dir, flavour === "testing")) visit(dep);
  };
  visit(join(root, "crates", BUILD_CRATE[flavour]));
  return [...seen];
}

/** The files the hash covers, relative to packages/engine-rs, sorted. */
export function sourceFiles(flavour: BuildInfo["flavour"] = "product", root = ENGINE_RS): string[] {
  const files = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml"].map((f) => join(root, f));
  for (const crate of buildCrates(flavour, root)) {
    if (!statSync(crate).isDirectory()) continue;
    files.push(join(crate, "Cargo.toml"));
    walk(join(crate, "src"), files);
  }
  return files.map((f) => relative(root, f).split(sep).join("/")).sort();
}

export function sourceHash(flavour: BuildInfo["flavour"] = "product", root = ENGINE_RS): string {
  const h = createHash("sha256");
  for (const rel of sourceFiles(flavour, root)) {
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
  /**
   * "product" (the engine, packages/engine/src/wasm), "testing" (the
   * engine with its test exports, src/wasm-testing) or "project" (the
   * project writer, src/wasm-project).
   */
  flavour: "product" | "testing" | "project";
  /** `rustc -V`. */
  rustc: string;
  /** The wasm-bindgen crate and CLI version. */
  wasmBindgen: string;
  /** sourceHash(flavour) of the sources the build was made from. */
  sourceHash: string;
  /** sha256 of cslope_wasm_bg.wasm. */
  wasmSha256: string;
  /** Size of cslope_wasm_bg.wasm in bytes. */
  bytes: number;
  /** Its size compressed with brotli (quality 11), for the size budget. */
  brotliBytes: number;
}
