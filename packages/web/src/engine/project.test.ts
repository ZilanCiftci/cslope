// @vitest-environment node
/**
 * The project download with the engine's real writer (the page's
 * WebAssembly, from disk here): a project of each template's first
 * visit, with the result of its run, keeps the result (the model reads
 * back as the document); the same time gives the same bytes; without a
 * result the file has none. That the app opens it with the result
 * current is the desktop app's test
 * (packages/desktop/src/features/project/web-project.test.ts).
 */
import { describe, expect, it } from "vitest";
import { SPECS } from "../form/specs";
import { EMBANKMENT_EXAMPLES } from "../templates/embankment-examples";
import { runDocument } from "../templates/run-document";
import { projectFileName, writeProject } from "./project";

/** The writer's WebAssembly from disk (`initProjectWriter()` without a source). */
const writer = null;
const NOW = new Date("2026-11-07T12:00:00Z");

describe("the project download", () => {
  // The excavation's first visit (a haul road, dry) and an embankment with ponded water.
  const cases = [
    { spec: SPECS[0], doc: SPECS[0].template.toDocument(SPECS[0].defaults!) },
    { spec: SPECS[1], doc: SPECS[1].template.toDocument(EMBANKMENT_EXAMPLES["clay-3m-ponded"]) },
  ];
  for (const { spec, doc } of cases) {
    it(`writes ${projectFileName(spec.fileName)} with its result`, async () => {
      const { result } = await runDocument(doc);
      const file = await writeProject(doc, result, spec.template.title, writer, NOW);
      expect(file.resultSaved).toBe(true);
      expect([...file.bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
      const again = await writeProject(doc, result, spec.template.title, writer, NOW);
      expect(again.bytes).toEqual(file.bytes);
      const bare = await writeProject(doc, null, spec.template.title, writer, NOW);
      expect(bare.resultSaved).toBe(false);
      expect(bare.bytes.length).toBeLessThan(file.bytes.length);
    });
  }

  it("names the file after the template", () => {
    expect(SPECS.map((s) => projectFileName(s.fileName))).toEqual(["cslope-excavation.cslp", "cslope-embankment.cslp"]);
  });
});
