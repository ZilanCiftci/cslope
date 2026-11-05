/// <reference types="node" />
/**
 * Every project file format cSlope must keep opening, one small committed
 * file each (fixtures/): JSON projects of schema versions 1 and 3, the
 * first .cslp layout, and this version's layout: with a background of the
 * first backgrounds.json form (cslp-v1.cslp), and with a PDF placed in
 * two models (cslp-v1-drawings.cslp, made by scripts/make-project-fixture.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openProject, readProjectBytes } from "./cslp";

// (vitest runs from packages/desktop; under jsdom import.meta.url is not a file URL)
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "src/features/project/fixtures", name)));

describe("project file fixtures", () => {
  it("legacy-json-v1.json: a JSON project before versioning, migrated (datum rate sign, pore pressure head, free water)", async () => {
    const opened = await openProject(fixture("legacy-json-v1.json"));
    expect(opened.layout).toBe("json");
    const [model] = opened.file.models;
    expect(opened.file.models).toHaveLength(1);
    expect(model.id).toBe("model-1");
    expect(model.name).toBe("Legacy v1 slope");
    expect(model.materials[0].model).toMatchObject({ kind: "s-f-datum", suRef: 20, yRef: 5, rate: -1.5 });
    expect(model.options.porePressureHead).toBe("phreatic-correction");
    expect(model.piezometricLine.freeWater).toBe(false);
    expect(model.piezometricLine.lines[0].coordinates).toEqual([[0, 1], [30, 4]]);
    expect(model.runState).toBe("idle");
  });

  it("legacy-json-v3.json: a JSON project of schema version 3 with a result and an error", async () => {
    const file = await readProjectBytes(fixture("legacy-json-v3.json"));
    expect(file.version).toBe(3);
    expect(file.activeModelId).toBe("model-2");
    expect(file.models.map((m) => m.name)).toEqual(["Legacy v3 slope", "Second model"]);
    expect(file.models[0]).toMatchObject({ runState: "done", result: { minFOS: 1.25, method: "Bishop" } });
    expect(file.models[0].udls).toHaveLength(1);
    expect(file.models[0].udls[0]).toMatchObject({ id: "udl-1", x1: 22, x2: 28, magnitude: 10 });
    expect(file.models[1]).toMatchObject({ runState: "error", errorMessage: "No admissible surface", result: null });
  });

  it("cslp-3file.cslp: the first .cslp layout (project.json with the models, results.json)", async () => {
    const opened = await openProject(fixture("cslp-3file.cslp"));
    expect(opened.layout).toBe("cslp-3file");
    expect(opened.manifest).toMatchObject({ formatVersion: 1, minReaderVersion: 1, created: "2026-11-04T10:00:00.000Z" });
    const { file } = opened;
    expect(file.activeModelId).toBe("model-2");
    expect(file.models.map((m) => m.name)).toEqual(["Legacy v3 slope", "Second model"]);
    expect(file.models[0]).toMatchObject({ runState: "done", result: { minFOS: 1.25 } });
    expect(file.models[1]).toMatchObject({ runState: "error", errorMessage: "No admissible surface" });
    expect(file.created).toBe("2026-11-04T10:00:00.000Z");
  });

  it("cslp-v1.cslp: this version's layout, with a result, a background, its attachment and a thumbnail", async () => {
    const opened = await openProject(fixture("cslp-v1.cslp"));
    expect(opened.layout).toBe("cslp");
    expect(opened.manifest).toMatchObject({
      format: "cslope-project",
      formatVersion: 1,
      minReaderVersion: 1,
      created: "2026-11-04T09:00:00.000Z",
      modified: "2026-11-04T10:00:00.000Z",
    });
    const { file } = opened;
    expect(file.activeModelId).toBe("model-2");
    expect(file.models.map((m) => m.id)).toEqual(["model-1", "model-2"]);
    expect(file.models.map((m) => m.name)).toEqual(["Legacy v3 slope", "Second model"]);
    expect(file.models[0]).toMatchObject({ runState: "done", result: { minFOS: 1.25, method: "Bishop" } });
    expect(file.models[1]).toMatchObject({ runState: "error", errorMessage: "No admissible surface" });
    expect(opened.results.get("model-1")?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(opened.results.has("model-2")).toBe(true);
    // (backgrounds.json in its first form, origin and scale, converted to
    // the affine placement: the 1 × 1 px image's bottom-left corner at (0, -5))
    expect(file.models[0].backgrounds).toEqual([
      {
        id: "drawing-1",
        assetId: "0c8f4a2e-6b1d-4f3a-9e7b-2d5c8a1f6e43",
        calibration: { mode: "drawing", points: [] },
        transform: { a: 0.1, b: 0, c: 0, d: -0.1, e: 0, f: -4.9 },
        opacity: 0.6,
        visible: true,
        order: 0,
      },
    ]);
    expect(opened.assets).toEqual([
      {
        id: "0c8f4a2e-6b1d-4f3a-9e7b-2d5c8a1f6e43",
        path: "assets/0c8f4a2e-6b1d-4f3a-9e7b-2d5c8a1f6e43.png",
        mime: "image/png",
        bytes: 70,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        originalName: "section.png",
        addedAt: "2026-11-04T09:30:00.000Z",
      },
    ]);
    const png = await opened.readAsset("0c8f4a2e-6b1d-4f3a-9e7b-2d5c8a1f6e43");
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await opened.readThumbnail()).toEqual(png);
  });

  it("cslp-v1-drawings.cslp: one PDF placed in two models (page 1 and page 2, cropped), written once", async () => {
    const opened = await openProject(fixture("cslp-v1-drawings.cslp"));
    expect(opened.layout).toBe("cslp");
    const pdf = "5b1e0f6a-2c4d-4e8f-9a1b-3c5d7e9f1a2b";
    expect(opened.assets).toEqual([
      expect.objectContaining({ id: pdf, path: `assets/${pdf}.pdf`, mime: "application/pdf", originalName: "sections.pdf" }),
    ]);
    const [a, b] = opened.file.models;
    expect(a.backgrounds).toHaveLength(1);
    expect(a.backgrounds![0]).toMatchObject({
      id: "drawing-a",
      assetId: pdf,
      name: "Section A-A",
      page: 1,
      calibration: { mode: "axes" },
      opacity: 0.5,
      showInResults: true,
    });
    expect(a.backgrounds![0].calibration.axes?.x).toHaveLength(2);
    expect(a.locks).toEqual({ backgrounds: ["drawing-a"] });
    expect(b.backgrounds![0]).toMatchObject({ id: "drawing-b", assetId: pdf, page: 2, calibration: { mode: "points" } });
    expect(b.backgrounds![0].crop).toEqual(a.backgrounds![0].crop);
    const bytes = await opened.readAsset(pdf);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  });
});
