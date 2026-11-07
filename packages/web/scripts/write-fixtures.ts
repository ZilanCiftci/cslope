/**
 * Writes the analysis documents of the templates' named parameter sets
 * (src/templates/excavation-examples.ts, embankment-examples.ts) to
 * src/templates/fixtures/<name>.json (the excavation's) and
 * fixtures/embankment/<name>.json, and F of each, computed by the engine,
 * to expected.json beside them. The tests check that the committed
 * fixtures are these documents and run to these F (within 1e-6); run this
 * after a change to a template or its sets, and commit the result.
 *
 *   bun scripts/write-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EMBANKMENT_EXAMPLES } from "../src/templates/embankment-examples";
import { embankmentDocument } from "../src/templates/embankment";
import { EXCAVATION_EXAMPLES } from "../src/templates/excavation-examples";
import { excavationDocument } from "../src/templates/excavation";
import { runDocument } from "../src/templates/run-document";
import { dumps, type AnalysisDocument } from "../src/engine/document";

export const FIXTURES = join(import.meta.dirname, "../src/templates/fixtures");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function write(dir: string, examples: Record<string, any>, toDocument: (params: any) => AnalysisDocument) {
  mkdirSync(dir, { recursive: true });
  const expected: Record<string, { fos: number; fosLabel: string }> = {};
  for (const [name, params] of Object.entries(examples)) {
    const doc = toDocument(params);
    writeFileSync(join(dir, `${name}.json`), dumps(doc));
    const { summary } = await runDocument(doc);
    expected[name] = { fos: summary.fos!, fosLabel: summary.fosLabel };
    console.log(`${name}: F ${summary.fosText} (${summary.fosLabel})`);
  }
  writeFileSync(join(dir, "expected.json"), dumps(expected));
  console.log(`Wrote ${Object.keys(expected).length} fixtures and expected.json to ${dir}`);
}

if (import.meta.main) {
  await write(FIXTURES, EXCAVATION_EXAMPLES, excavationDocument);
  await write(join(FIXTURES, "embankment"), EMBANKMENT_EXAMPLES, embankmentDocument);
}
