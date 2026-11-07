// Checks, without Rust, that a committed WebAssembly build matches the
// engine sources (ARCHITECTURE.md §8.3): the source hash in its
// BUILD-INFO.json against the sources now, and the recorded wasm hash
// against the file.
//
//   bun packages/engine-rs/tools/check-wasm-fresh.ts [product|testing|project]
//
// Run by CI's check job and by the release, before packaging: the app
// ships the committed product build (packages/engine/src/wasm); the
// browser page also the project writer (src/wasm-project, CI's check job). This is a
// freshness check, not a reproduction: both hashes come from the build that
// is committed. CI's rust job rebuilds the engine when it changes and
// compares the bytes with the committed build (.github/workflows/ci.yml).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ENGINE_RS, fileSha256, sourceHash, type BuildInfo } from "./wasm-source-hash";

const arg = process.argv[2] ?? "product";
if (arg !== "product" && arg !== "testing" && arg !== "project") {
  console.error(`usage: check-wasm-fresh.ts [product|testing|project], not "${arg}"`);
  process.exit(2);
}
const flavour: BuildInfo["flavour"] = arg;
const folder = { product: "wasm", testing: "wasm-testing", project: "wasm-project" }[flavour];
const name = flavour === "project" ? "cslope_project_wasm" : "cslope_wasm";
const dir = resolve(ENGINE_RS, "../engine/src", folder);
const rebuild = `run \`bun packages/engine-rs/tools/build-wasm.ts ${flavour}\`${flavour === "testing" ? "" : ` and commit packages/engine/src/${folder}`}`;

function fail(message: string): never {
  console.error(`${message}: ${rebuild}.`);
  process.exit(1);
}

const infoPath = join(dir, "BUILD-INFO.json");
if (!existsSync(infoPath)) fail(`No ${flavour} build (${infoPath})`);
const info = JSON.parse(readFileSync(infoPath, "utf8")) as BuildInfo;
const wasm = join(dir, `${name}_bg.wasm`);
if (!existsSync(wasm)) fail(`The ${flavour} build has no ${name}_bg.wasm`);
if (fileSha256(wasm) !== info.wasmSha256) fail(`${name}_bg.wasm is not the file BUILD-INFO.json records`);
const now = sourceHash(flavour);
if (now !== info.sourceHash) fail(`The engine sources changed since the ${flavour} build (source hash ${now.slice(0, 12)}, built from ${info.sourceHash.slice(0, 12)})`);
console.log(`The ${flavour} build is fresh (source hash ${now.slice(0, 12)}, ${info.bytes} bytes).`);
