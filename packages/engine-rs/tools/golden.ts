// Writes golden/verification.json, the reference results of the
// verification analyses that tests/verification_native.rs compares the Rust
// engine with in CI (ARCHITECTURE.md §9, Phase 8):
//
//   bun packages/engine-rs/tools/golden.ts
//
// The values are those of the engine the app ships: the committed product
// WebAssembly build, through @cslope/engine, as generate-data.ts runs it.
// Per analysis of the verification checks (problem, method and the check's
// options): the minimum F, the key of the critical surface and the counts
// of surfaces. The file also carries the problems with their checks (the
// definitions and the merged options), so that the native tests need
// nothing else. Regenerate it only for a deliberate change of results,
// recorded in VERIFICATION-LOG.md; the test then compares with the new
// values.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initEngine } from "../../engine/src/index";
import { VERIFICATION_CASES, runVerification, verificationOptions } from "../../engine/src/verification/cases";
import { planeKey } from "../../engine/src/model/search";
import { ENGINE_RS } from "./wasm-source-hash";

await initEngine();

const cases = VERIFICATION_CASES.map((c) => ({
  id: c.id,
  title: c.title,
  surface: c.surface,
  definition: c.definition,
  checks: c.checks.map((k) => ({
    method: k.method,
    label: k.label,
    published: k.published,
    publishedBy: k.publishedBy,
    tolerance: k.tolerance,
    options: verificationOptions(k.method, k.options),
    ...(k.pending !== undefined ? { pending: k.pending } : {}),
  })),
  // the finite element setup and references (verification/fem-cases.ts), for
  // the limit analysis checks of tests/verification_bounds.rs
  ...(c.fem ? { fem: c.fem } : {}),
}));

const searches: Record<string, unknown>[] = [];
const seen = new Set<string>();
const t0 = performance.now();
for (const c of VERIFICATION_CASES) {
  for (const check of c.checks) {
    // the analysis key of tests/allowlist.toml: problem|method|the check's own options
    const key = `${c.id}|${check.method}|${JSON.stringify(check.options ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const options = verificationOptions(check.method, check.options);
    try {
      const { fos, slope } = runVerification(c.definition, check.method, check.options ?? {});
      const search = slope.search;
      const critical = search.find((p) => p.fos != null);
      searches.push({
        key,
        id: c.id,
        options,
        fos,
        critical: critical ? planeKey(critical) : null,
        planes: search.length,
        valid: search.filter((p) => p.fos != null).length,
      });
      slope.free();
    } catch (e) {
      searches.push({ key, id: c.id, options, error: (e as Error).message });
    }
  }
}

const dir = join(ENGINE_RS, "golden");
mkdirSync(dir, { recursive: true });
const text =
  JSON.stringify(
    {
      $comment:
        "Reference results of the verification analyses, from the engine the app ships (WebAssembly; tools/golden.ts): per analysis the minimum F, the critical surface's key and the counts of surfaces; and the problems with their checks (and their finite element setups, for tests/verification_bounds.rs). tests/verification_native.rs compares the native engine with them (F within 1e-6, near-ties in tests/allowlist.toml).",
      cases,
      searches,
    },
    null,
    0,
  ) + "\n";
writeFileSync(join(dir, "verification.json"), text);
console.log(`golden/verification.json: ${cases.length} problems, ${searches.length} analyses, ${(text.length / 1024).toFixed(0)} kB, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
