/**
 * Start-up time and call overhead of the Rust engine (WebAssembly) against
 * the TypeScript engine, for a few functions of the facade:
 *
 *   bun scripts/wasm-bench.ts                  (from packages/engine)
 *
 * Needs the product build (`bun packages/engine-rs/tools/build-wasm.ts
 * product`). Calls the facade shims directly, so no test config is needed;
 * functions of the testing build are not measured.
 */
import { readFileSync } from "node:fs";
import { brotliCompressSync } from "node:zlib";
import { initEngine } from "../src/engine";
import * as tsInterp from "../src/math/interpolation";
import * as rsInterp from "../src/facade/math/interpolation";
import * as tsPoly from "../src/math/polygon";
import * as rsPoly from "../src/facade/math/polygon";
import * as tsCanon from "../src/model/canonical";
import * as rsCanon from "../src/facade/model/canonical";
import * as tsStrength from "../src/types/strength";
import * as rsStrength from "../src/facade/types/strength";
import * as tsValidation from "../src/types/validation";
import * as rsValidation from "../src/facade/types/validation";
import * as tsGeo from "../src/model/geometry-ops";
import * as rsGeo from "../src/facade/model/geometry-ops";
import type { MaterialModel } from "../src/types/material-models";
import type { SlopeDefinition } from "../src/types/slope-definition";

const wasmUrl = new URL("../src/wasm/cslope_wasm_bg.wasm", import.meta.url);
const bytes = readFileSync(wasmUrl);
console.log(`product wasm: ${(bytes.length / 1024).toFixed(0)} kB raw, ${(brotliCompressSync(bytes).length / 1024).toFixed(0)} kB brotli`);

let t = performance.now();
const module = await WebAssembly.compile(new Uint8Array(bytes));
const compileMs = performance.now() - t;
t = performance.now();
await initEngine(module);
const instantiateMs = performance.now() - t;
console.log(`compile ${compileMs.toFixed(1)} ms, instantiate + start ${instantiateMs.toFixed(2)} ms`);

/** Mean time per call (µs) over enough calls for about 200 ms. */
function perCall(f: () => unknown): number {
  for (let i = 0; i < 200; i++) f();
  let n = 1;
  for (;;) {
    const s = performance.now();
    for (let i = 0; i < n; i++) f();
    const ms = performance.now() - s;
    if (ms > 200) return (ms * 1000) / n;
    n *= 2;
  }
}

const xs = Array.from({ length: 20 }, (_, i) => i * 5);
const ys = xs.map((x) => 10 + Math.sin(x / 7) * 3);
const polyX = Array.from({ length: 50 }, (_, i) => 10 * Math.cos((2 * Math.PI * i) / 50));
const polyY = Array.from({ length: 50 }, (_, i) => 10 * Math.sin((2 * Math.PI * i) / 50));
const model: MaterialModel = { kind: "mohr-coulomb", unitWeight: 19, cohesion: 5, frictionAngle: 32, cohesionRefDepth: 0, cohesionRateOfChange: 0.5 };
const ctx = { yBottom: 2, x: 10, yGround: 10, alpha: 0.2 };
const def: SlopeDefinition = {
  orientation: "rtl",
  coordinates: [[0, 10], [20, 10], [40, 0], [60, 0], [60, -10], [0, -10]],
  materials: [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 } }, { name: "Sand", model }],
  materialBoundaries: [{ coordinates: [[0, -2], [60, -4]], materialName: "Sand" }],
  udls: [{ magnitude: 10, x1: 2, x2: 8 }],
};
const outline = def.coordinates.concat([def.coordinates[0]]);
const ox = outline.map((p) => p[0]);
const oy = outline.map((p) => p[1]);
const lines: [number, number][][] = [[[0, -2], [60, -4]], [[0, 5], [30, 5]]];

const cases: [string, () => unknown, () => unknown][] = [
  ["getYAtX (20 points)", () => tsInterp.getYAtX(xs, ys, 33.3), () => rsInterp.getYAtX(xs, ys, 33.3)],
  ["isPointInPolygon (50 vertices)", () => tsPoly.isPointInPolygon(1, 2, polyX, polyY), () => rsPoly.isPointInPolygon(1, 2, polyX, polyY)],
  ["mirrorX (numbers only)", () => tsCanon.mirrorX(3, 0, 10), () => rsCanon.mirrorX(3, 0, 10)],
  ["resolveStrength (objects)", () => tsStrength.resolveStrength(model, ctx), () => rsStrength.resolveStrength(model, ctx)],
  ["validateMaterialModel", () => tsValidation.validateMaterialModel(model), () => rsValidation.validateMaterialModel(model)],
  ["toCanonicalSlopeDefinition (rtl)", () => tsCanon.toCanonicalSlopeDefinition(def), () => rsCanon.toCanonicalSlopeDefinition(def)],
  ["polygonizeRegions (2 boundaries)", () => tsGeo.polygonizeRegions(ox, oy, lines), () => rsGeo.polygonizeRegions(ox, oy, lines)],
];

console.log("\nfunction | TypeScript µs/call | Rust (wasm) µs/call | ratio");
for (const [name, ts, rs] of cases) {
  const a = perCall(ts);
  const b = perCall(rs);
  console.log(`${name} | ${a.toFixed(3)} | ${b.toFixed(3)} | ${(b / a).toFixed(2)}`);
}
