/**
 * vitest setup file of the renderer tests: starts the engine (the product
 * build, as the app ships it) before the tests call it. The bytes are read
 * here, in Node, and initEngineSync copies them into the test realm's
 * Uint8Array (jsdom replaces the typed-array constructors).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initEngineSync } from "@cslope/engine";

initEngineSync(readFileSync(createRequire(import.meta.url).resolve("@cslope/engine/wasm")));
