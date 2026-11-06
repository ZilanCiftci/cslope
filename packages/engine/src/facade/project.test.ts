/**
 * The app model conversion of the testing build (crate cslope-project,
 * issue #57; `project::` in `__test_call`): the Rust port of the app's
 * `buildModelSpaceSlopeDTO` and `modelFromDefinition`, which its golden
 * corpus (packages/engine-rs/golden/project-corpus.json, made by the app's
 * code) holds field for field. Here: that the wasm binding passes the
 * values through as JSON.
 */
import { describe, expect, it } from "vitest";
import { testCall, testingEngine } from "./internal";

interface Corpus {
  models: { name: string; model: unknown; definition: unknown }[];
  definitions: { name: string; info: unknown; definition: unknown; model: unknown; roundTrip: unknown }[];
  refused: { name: string; definition: unknown; error: string }[];
}

// Vite's import.meta.glob (the engine package has no Vite or Node types)
declare global {
  interface ImportMeta {
    glob(patterns: string[], options?: { query?: string; import?: string; eager?: boolean }): Record<string, unknown>;
  }
}

const [corpusText] = Object.values(
  import.meta.glob(["../../../engine-rs/golden/project-corpus.json"], { query: "?raw", import: "default", eager: true }),
) as string[];
const corpus = JSON.parse(corpusText) as Corpus;

describe("app model conversion (testing build)", () => {
  it("is in the testing build", () => {
    const known = new Set(testingEngine().__test_functions());
    expect(known.has("project::modelToDefinition")).toBe(true);
    expect(known.has("project::definitionToModel")).toBe(true);
  });

  it("gives the app's definition of every model of the corpus", () => {
    for (const m of corpus.models) expect(testCall("project::modelToDefinition", [m.model]), m.name).toEqual(m.definition);
  });

  it("gives the app's model of a definition, and refuses what the app refuses", () => {
    for (const d of corpus.definitions) expect(testCall("project::definitionToModel", [d.definition, d.info]), d.name).toEqual(d.model);
    for (const r of corpus.refused) {
      expect(() => testCall("project::definitionToModel", [r.definition, { id: "x", name: "x" }]), r.name).toThrow(r.error);
    }
  });

  it("names the field of a model it cannot read", () => {
    expect(() => testCall("project::modelToDefinition", [{ id: "m", materials: [{ id: "a" }] }])).toThrow(/materials\[0\]/);
  });
});
