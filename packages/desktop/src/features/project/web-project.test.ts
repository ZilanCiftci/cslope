/**
 * A project the browser page downloads (packages/web, "Download .cslp",
 * issue #107) opens in the app: for each of the page's fixture documents
 * (packages/web/src/templates/fixtures, the templates' examples), the
 * page's run of the document and the engine's project writer
 * (`@cslope/engine/project`) give a file that the app's reader opens with
 * the model (its layers in their colours), and the result current; and
 * the app, running the model it opened, gets the page's F. A level water
 * table (the templates' "height") becomes the line it stands for, and
 * free water the model's `followBoundary`, without changing F.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_OPTIONS, publicDefaultOptions, runAnalysis, toCanonicalSlopeDefinition, type AnalysisOptions, type SlopeDefinition } from "@cslope/engine";
import { initProjectWriter, projectFromDefinition } from "@cslope/engine/project";
import { buildSlopeDTOFromModel } from "../../store/helpers";
import { isResultOutOfDate } from "../../store/out-of-date";
import { readProject } from "./cslp";
import { analysisInputHash } from "./input-hash";

interface WebDocument {
  definition: SlopeDefinition;
  options: Partial<AnalysisOptions>;
}

// (the tests run in packages/desktop)
const dir = join(process.cwd(), "../web/src/templates/fixtures/");
const fixtures = ["", "embankment/"].flatMap((sub) =>
  readdirSync(dir + sub)
    .filter((f) => f.endsWith(".json") && f !== "expected.json")
    .sort()
    .map((f) => ({ name: sub + f, doc: JSON.parse(readFileSync(dir + sub + f, "utf8")) as WebDocument })),
);

/** The colours a user picked for the layers (the page writes them into the document). */
const COLOURS = ["#8d6e63", "#4f7d4a", "#c9a227", "#5b7fa6", "#a0522d", "#708090"];

/** The page's run of a document (packages/web, analysis.worker.ts). */
function pageRun(doc: WebDocument) {
  const options = { ...DEFAULT_ANALYSIS_OPTIONS, ...publicDefaultOptions(), ...doc.options };
  return runAnalysis(toCanonicalSlopeDefinition(doc.definition), options);
}

/** The page's download (packages/web, src/engine/project.ts). */
function download(doc: WebDocument, result: ReturnType<typeof pageRun> | null) {
  return projectFromDefinition(doc.definition, result, {
    name: "Excavation in clay with a haul road",
    options: doc.options,
    date: "2026-11-07",
    modified: "2026-11-07T12:00:00.000Z",
    appVersion: "0.1.0",
    generator: "cSlope in the browser 0.1.0",
    engine: { version: "0.1.0", sourceHash: "" },
  });
}

beforeAll(() => initProjectWriter(readFileSync(createRequire(import.meta.url).resolve("@cslope/engine/project-wasm"))));

describe("a project downloaded from the browser page", () => {
  it("has the page's fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const { name, doc } of fixtures) {
    it(`opens with its model and its current result: ${name}`, async () => {
      const coloured = { ...doc, definition: { ...doc.definition, materials: doc.definition.materials.map((m, i) => ({ ...m, color: COLOURS[i % COLOURS.length] })) } };
      const result = pageRun(coloured);
      const file = download(coloured, result);
      expect(file.resultSaved).toBe(true);

      const read = await readProject(file.bytes);
      expect(read.assets).toEqual([]);
      expect(read.file.models).toHaveLength(1);
      const [model] = read.file.models;
      expect(read.file.activeModelId).toBe(model.id);
      expect(model.name).toBe("Excavation in clay with a haul road");
      expect(model.coordinates).toEqual(doc.definition.coordinates);
      expect(model.materials.map((m) => [m.name, m.color])).toEqual(coloured.definition.materials.map((m) => [m.name, m.color]));
      expect(model.options.tensionCrackAuto).toBe(doc.options.tensionCrackAuto);
      expect(model.runState).toBe("done");
      expect(isResultOutOfDate(model.result)).toBe(false);
      expect(model.result?.minFOS).toBe(result.minFOS);
      // The app's own run of the model it opened gives the page's F.
      expect(runAnalysis(buildSlopeDTOFromModel(model), model.options).minFOS).toBe(result.minFOS);
    });
  }

  it("without the layers' colours, gives them the app's and keeps the result current", async () => {
    const { doc } = fixtures.find((f) => f.name === "defaults.json")!;
    const file = download(doc, pageRun(doc));
    expect(file.resultSaved).toBe(true);
    const [model] = (await readProject(file.bytes)).file.models;
    expect(model.materials.every((m) => /^#[0-9a-f]{6}$/i.test(m.color))).toBe(true);
    expect(isResultOutOfDate(model.result)).toBe(false);
  });

  it("without a result opens without one", async () => {
    const { doc } = fixtures.find((f) => f.name === "embankment/clay-3m-ponded.json")!;
    const file = download(doc, null);
    expect(file.resultSaved).toBe(false);
    const [model] = (await readProject(file.bytes)).file.models;
    expect(model.runState).not.toBe("done");
    expect(model.result ?? null).toBeNull();
    expect(await analysisInputHash(model)).toMatch(/^[0-9a-f]{64}$/);
  });
});
