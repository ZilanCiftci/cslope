import { finishDrawing } from "../../utils/dxf";
import { readDwgFile } from "./dwg-reader";
import { importDrawing } from "./importDxf";

/** AutoCAD releases by DWG version code. */
const RELEASES: Record<string, string> = {
  AC1009: "Release 11/12",
  AC1012: "Release 13",
  AC1014: "Release 14",
  AC1015: "2000",
  AC1018: "2004",
  AC1021: "2007",
  AC1024: "2010",
  AC1027: "2013",
  AC1032: "2018",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Import a DWG drawing as a new model, as a DXF drawing is imported
 * (importDxf.ts): the DWG reader (packages/dwg-rs, loaded on first use)
 * reads the model space's polylines and lines, and the DXF import's steps
 * make the model. Returns the summary for the user; rejects with the reason
 * when the file cannot be read or used.
 */
export async function importDwg(bytes: Uint8Array, fileName: string): Promise<string> {
  const dwg = await readDwgFile(bytes);
  const notes: string[] = [];
  const release = RELEASES[dwg.version];
  notes.push(`DWG format: ${release ? `AutoCAD ${release}` : "unknown"} (${dwg.version}).`);
  if (dwg.bulgedPolylines > 0) {
    notes.push(`${plural(dwg.bulgedPolylines, "polyline has", "polylines have")} arc segments, imported as straight segments.`);
  }
  if (dwg.paperSpaceEntities > 0) {
    notes.push(`${plural(dwg.paperSpaceEntities, "entity", "entities")} in paper space (layouts) not read.`);
  }
  if (dwg.warnings.length > 0) {
    // The first warning says that the file was read in recovery mode, and why.
    notes.push(`${dwg.warnings[0]} Check the imported geometry.`);
  }
  const drawing = finishDrawing({
    polylines: dwg.polylines,
    segments: dwg.segments,
    skipped: dwg.skipped,
    insunits: dwg.insunits,
    notes,
  });
  return importDrawing(drawing, fileName.replace(/\.dwg$/i, "") || "DWG import");
}
