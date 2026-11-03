// Fixtures for js::array::sort_by (the port of V8's TimSort): the order in
// which V8's Array.prototype.sort leaves random arrays, for consistent and
// inconsistent comparators (NaN keys, a - b with infinities, a comparator
// that is not an order at all), on lengths and patterns that reach every
// path (binary insertion, run detection, merges, galloping in both
// directions).
//
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts js-sort
//
// Must run under Node (V8): the order for inconsistent comparators is V8's.
// Writes fixtures/js-sort/orders.json: for each case the values, the name
// of the comparator and the resulting order of the indices.
import { rng } from "../../../engine/src/model/property-helpers";
import { writeFixture } from "./write";

it("exports the sort fixtures", () => {
  // V8's order, not JavaScriptCore's
  expect(process.versions.v8).toBeTruthy();
  expect((globalThis as { Bun?: unknown }).Bun).toBeUndefined();
  const r = rng(20261103);
  const int = (n: number) => Math.floor(r() * n);

  // The comparators; tests/js_sort_fixtures.rs has the same ones.
  const comparators: Record<string, (a: number, b: number) => number> = {
    sub: (a, b) => a - b,
    desc: (a, b) => b - a,
    mod10: (a, b) => (a % 10) - (b % 10),
    hash: (a, b) => ((a * 7 + b * 13) % 5) - 2,
    lessOnly: (a, b) => (a < b ? -1 : 0),
  };

  const lengths = [0, 1, 2, 3, 5, 10, 31, 32, 33, 63, 64, 65, 100, 127, 128, 129, 200, 500, 1000, 1500, 3000];
  const patterns = ["random", "ascending", "descending", "sawtooth", "fewSwaps", "dups", "runs"];
  const cases: { comparator: string; values: number[]; order: number[] }[] = [];
  for (const n of lengths) {
    for (const pattern of patterns) {
      for (const nanRate of [0, 0.01, 0.2]) {
        for (const name of Object.keys(comparators)) {
          if (n > 500 && r() < 0.6) continue;
          let values: number[];
          if (pattern === "random") values = Array.from({ length: n }, () => int(1000));
          else if (pattern === "ascending") values = Array.from({ length: n }, (_, i) => i * 3);
          else if (pattern === "descending") values = Array.from({ length: n }, (_, i) => (n - i) * 3);
          else if (pattern === "sawtooth") {
            const k = 1 + int(80);
            values = Array.from({ length: n }, (_, i) => (i % k) * 2);
          } else if (pattern === "fewSwaps") {
            values = Array.from({ length: n }, (_, i) => i);
            for (let s = 0; s < 1 + int(5) && n > 1; s++) {
              const a = int(n);
              const b = int(n);
              [values[a], values[b]] = [values[b], values[a]];
            }
          } else if (pattern === "dups") values = Array.from({ length: n }, () => int(4));
          else {
            // long ascending and descending runs of mixed lengths, which
            // make one run win many times in a row (galloping)
            values = [];
            while (values.length < n) {
              const len = 1 + int(150);
              const start = int(2000);
              const up = r() < 0.5;
              for (let i = 0; i < len && values.length < n; i++) values.push(up ? start + i : start - i);
            }
          }
          for (let i = 0; i < n; i++) {
            if (r() < nanRate) values[i] = NaN;
            else if (nanRate > 0 && r() < nanRate / 4) values[i] = r() < 0.5 ? Infinity : -Infinity;
          }
          const cmp = comparators[name];
          const order = Array.from({ length: n }, (_, i) => i);
          order.sort((i, j) => cmp(values[i], values[j]));
          cases.push({ comparator: name, values, order });
        }
      }
    }
  }
  writeFixture("js-sort", "orders", cases);
  console.log(`js-sort: ${cases.length} cases`);
});
