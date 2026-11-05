/**
 * Write src/features/project/fixtures/cslp-v1-drawings.cslp: the fixture of
 * this version's .cslp layout with drawings, made by the app's writer from
 * the legacy-json-v3 fixture (two models, one result, one error): one PDF
 * of two pages (made here with jsPDF) placed in both models, a section of
 * page 1 in the first (axes calibration, with vertical exaggeration) and
 * one of page 2 in the second (points calibration), each cropped; the PDF
 * is written once. With a thumbnail, at a fixed time. Run it again when
 * the layout or the project schema changes, and commit the file; the
 * fixtures test opens it.
 *
 * (cslp-v1.cslp, beside it, was made by this script's first version and
 * is kept as it is: it holds a background in the first form of
 * backgrounds.json, origin and scale, which readers convert.)
 *
 *   bun scripts/make-project-fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initEngineSync } from "@cslope/engine";
import { jsPDF } from "jspdf";

const require = createRequire(import.meta.url);
initEngineSync(readFileSync(require.resolve("@cslope/engine/wasm")));
// The versions Vite defines for the app (src/utils/app-version.ts), so the
// manifest and the results name the real app and engine.
const engineDir = join(import.meta.dirname, "../../engine");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
Object.assign(globalThis, {
  __APP_VERSION__: json(join(import.meta.dirname, "../package.json")).version,
  __ENGINE_BUILD__: { version: json(join(engineDir, "package.json")).version, sourceHash: json(join(engineDir, "src/wasm/BUILD-INFO.json")).sourceHash },
});
const { writeProjectArchive, openProject } = await import("../src/features/project/cslp");
const { parseProjectFile } = await import("../src/store/persistence");

const fixtures = join(import.meta.dirname, "../src/features/project/fixtures");
const file = parseProjectFile(readFileSync(join(fixtures, "legacy-json-v3.json"), "utf8"));

/** A 1 × 1 PNG (70 bytes), the thumbnail. */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

/** Two A4 landscape pages (mm), a slope section on each, with axes. */
function sectionsPdf(): Uint8Array {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setCreationDate(new Date("2026-11-04T09:00:00Z"));
  doc.setFileId("00000000000000000000000000000000");
  const section = (title: string, ground: [number, number][]) => {
    doc.setFontSize(12);
    doc.text(title, 30, 25);
    doc.setLineWidth(0.3);
    doc.line(30, 150, 230, 150); // x axis
    doc.line(30, 150, 30, 50); // y axis
    for (let i = 0; i <= 4; i++) doc.line(30 + i * 50, 150, 30 + i * 50, 153);
    for (let i = 0; i <= 2; i++) doc.line(27, 150 - i * 50, 30, 150 - i * 50);
    doc.setLineWidth(0.6);
    for (let i = 1; i < ground.length; i++) doc.line(...ground[i - 1], ...ground[i]);
  };
  section("Section A-A", [[30, 70], [100, 70], [160, 130], [230, 130]]);
  doc.addPage();
  section("Section B-B", [[30, 80], [120, 80], [170, 120], [230, 120]]);
  return new Uint8Array(doc.output("arraybuffer"));
}

const PDF = sectionsPdf();
const ASSET_ID = "5b1e0f6a-2c4d-4e8f-9a1b-3c5d7e9f1a2b";
const MM = 72 / 25.4;

// Page 1: the x axis 0 to 40 m over 200 mm, the y axis 0 to 10 m over 100 mm
// (vertical exaggeration 2).
file.models[0].backgrounds = [
  {
    id: "drawing-a",
    assetId: ASSET_ID,
    name: "Section A-A",
    page: 1,
    crop: { x0: 20 * MM, y0: 15 * MM, x1: 240 * MM, y1: 160 * MM },
    calibration: {
      mode: "axes",
      points: [],
      axes: {
        x: [{ source: [30 * MM, 150 * MM], value: 0 }, { source: [230 * MM, 150 * MM], value: 40 }],
        y: [{ source: [30 * MM, 150 * MM], value: 0 }, { source: [30 * MM, 50 * MM], value: 10 }],
      },
    },
    // (x = 0 at u = 30 mm, y = 0 at v = 150 mm)
    transform: { a: 40 / (200 * MM), b: 0, c: 0, d: -10 / (100 * MM), e: -6, f: 15 },
    opacity: 0.5,
    visible: true,
    order: 0,
    showInResults: true,
  },
];
file.models[0].locks = { backgrounds: ["drawing-a"] };
// Page 2: two points on the x axis, true to scale (0.2 m per mm of the sheet).
file.models[1].backgrounds = [
  {
    id: "drawing-b",
    assetId: ASSET_ID,
    name: "Section B-B",
    page: 2,
    crop: { x0: 20 * MM, y0: 15 * MM, x1: 240 * MM, y1: 160 * MM },
    calibration: { mode: "points", points: [{ source: [30 * MM, 150 * MM], model: [0, 0] }, { source: [230 * MM, 150 * MM], model: [40, 0] }] },
    transform: { a: 0.2 / MM, b: 0, c: 0, d: -0.2 / MM, e: -6, f: 30 },
    opacity: 0.6,
    visible: true,
    order: 0,
  },
];

const bytes = await writeProjectArchive(file, {
  modified: new Date("2026-11-04T10:00:00Z"),
  created: "2026-11-04T09:00:00.000Z",
  thumbnail: PNG,
  assets: [{ id: ASSET_ID, mime: "application/pdf", originalName: "sections.pdf", addedAt: "2026-11-04T09:30:00.000Z", data: () => PDF }],
});
const out = join(fixtures, "cslp-v1-drawings.cslp");
writeFileSync(out, bytes);
const back = await openProject(bytes);
console.log(`${out}: ${bytes.length} bytes, ${back.file.models.length} models, ${back.assets.length} attachment(s), PDF ${PDF.length} bytes`);
