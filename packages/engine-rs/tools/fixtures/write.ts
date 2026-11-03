// Shared writer for differential fixtures: JSON with non-finite numbers
// encoded as the strings "NaN", "Infinity" and "-Infinity" (plain JSON has
// none), and undefined object fields left out as JSON.stringify does.
// Each fixture area has its own exporter beside this one, <area>.fixture.ts,
// with one `it(...)` that calls the TypeScript engine and writes
// fixtures/<area>/<name>.json. Exporters run under Node (V8), the runtime
// the app ships with, through vitest:
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts [area]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

export function encode(value: unknown): unknown {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    return value;
  }
  if (Array.isArray(value)) return value.map(encode);
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), encode(v)]));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== "function") out[k] = encode(v);
    return out;
  }
  return value;
}

/** Writes fixtures/<area>/<name>.json; `cases` is usually an array of {input, output}. */
export function writeFixture(area: string, name: string, cases: unknown): void {
  const path = join(FIXTURES, area, `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(encode(cases)));
}
