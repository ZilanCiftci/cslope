import { inferOrientationFromCoordinates } from "@cslope/engine";
import { useAppStore } from "../../store/app-store";
import { importedGeometryLocks } from "../../store/canvas-selection";
import { dxfToGeometry, parseDxf, type DxfDrawing } from "../../utils/dxf";

/**
 * Import a DXF drawing as a new model: outline, material boundaries and
 * water lines. Returns a summary for the user; throws with an
 * explanation when the drawing cannot be used.
 */
export function importDxf(text: string, fileName: string): string {
  return importDrawing(parseDxf(text), fileName.replace(/\.dxf$/i, "") || "DXF import");
}

/**
 * Add a parsed drawing (from a DXF or a DWG file) as a new model named
 * `name`. Returns the summary for the user; throws when the drawing has no
 * outline.
 */
export function importDrawing(drawing: DxfDrawing, name: string): string {
  const geometry = dxfToGeometry(drawing);
  const store = useAppStore.getState();
  store.addModel(name);
  const s = useAppStore.getState();
  s.setCoordinates(geometry.coordinates);
  // The sliding direction follows the drawing (crest on the left or right).
  s.setOrientation(inferOrientationFromCoordinates(geometry.coordinates));
  for (const boundary of geometry.materialBoundaries) s.addMaterialBoundary(boundary);
  for (const line of geometry.waterLines) s.addPiezoLine(line);
  // The new model's default search limits belong to the default geometry.
  s.setAnalysisLimits({ enabled: false });
  // The imported geometry starts locked against stray drags (the status bar offers to unlock it).
  s.setModelLocks(importedGeometryLocks(useAppStore.getState().materialBoundaries.map((b) => b.id)));
  useAppStore.setState({ _pendingFitToScreen: true });
  // One import, not a series of edits to undo one by one (as after Open).
  useAppStore.temporal.getState().clear();

  const parts = [
    `Imported "${name}": outline with ${geometry.coordinates.length} points`,
    `${geometry.materialBoundaries.length} material boundar${geometry.materialBoundaries.length === 1 ? "y" : "ies"}`,
    `${geometry.waterLines.length} water line${geometry.waterLines.length === 1 ? "" : "s"}`,
  ];
  let message = parts.join(", ") + ". Assign materials to the regions before running.";
  if (drawing.unitNote) message += ` ${drawing.unitNote}`;
  for (const note of drawing.notes ?? []) message += ` ${note}`;
  const skipped = Object.entries(drawing.skipped);
  if (skipped.length > 0) {
    message += ` Not imported: ${skipped.map(([t, n]) => `${n} ${t}`).join(", ")} (only polylines and lines are read).`;
  }
  return message;
}
