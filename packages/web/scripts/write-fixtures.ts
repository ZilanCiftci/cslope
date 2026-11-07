/**
 * Writes the analysis documents of the excavation template's named
 * parameter sets (src/templates/excavation-examples.ts) to
 * src/templates/fixtures/<name>.json, and F of each, computed by the
 * engine, to fixtures/expected.json. The tests check that the committed
 * fixtures are these documents and run to these F (within 1e-6); run this
 * after a change to the template or the sets, and commit the result.
 *
 *   bun scripts/write-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXCAVATION_EXAMPLES } from "../src/templates/excavation-examples";
import { excavationDocument } from "../src/templates/excavation";
import { runDocument } from "../src/templates/run-document";
import { dumps } from "../src/engine/document";

export const FIXTURES = join(import.meta.dirname, "../src/templates/fixtures");

if (import.meta.main) {
  mkdirSync(FIXTURES, { recursive: true });
  const expected: Record<string, { fos: number; fosLabel: string }> = {};
  for (const [name, params] of Object.entries(EXCAVATION_EXAMPLES)) {
    const doc = excavationDocument(params);
    writeFileSync(join(FIXTURES, `${name}.json`), dumps(doc));
    const { summary } = await runDocument(doc);
    expected[name] = { fos: summary.fos!, fosLabel: summary.fosLabel };
    console.log(`${name}: F ${summary.fosText} (${summary.fosLabel})`);
  }
  writeFileSync(join(FIXTURES, "expected.json"), dumps(expected));
  console.log(`Wrote ${Object.keys(expected).length} fixtures and expected.json to ${FIXTURES}`);
}
