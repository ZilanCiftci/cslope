import type { MaterialModel } from "@cslope/engine";
import type { MaterialRow, ModelWaternet } from "../../store/types";

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** The notice for imported head and reference lines. */
export function waternetNoticeText(waternet: ModelWaternet): string {
  return (
    `Pore pressure comes from ${count(waternet.headLines.length, "imported head line")} and ` +
    `${count(waternet.referenceLines.length, "reference line")}. The piezometric lines below still set the ` +
    "phreatic level (saturated unit weight, free water, strength above the water) but not the pore pressure. " +
    "Remove the head lines to use the piezometric lines for pore pressure."
  );
}

/** Whether a model (or its strength above the water line) takes its yield stress from the earlier stage. */
function usesEarlierStage(model: MaterialModel | undefined): boolean {
  if (!model) return false;
  if (model.kind === "shansep" && model.yieldFromEarlierStage) return true;
  return usesEarlierStage(model.aboveWater);
}

/** The materials whose yield stress comes from the earlier stage. */
export function earlierStageMaterials(materials: MaterialRow[]): MaterialRow[] {
  return materials.filter((m) => usesEarlierStage(m.model));
}

/** The notice for an imported earlier construction stage (which has no name of its own). */
export function earlierStageNoticeText(materials: MaterialRow[]): string {
  const affected = earlierStageMaterials(materials).map((m) => `Material "${m.name}"`);
  const which =
    affected.length === 0
      ? "No material takes its yield stress from it."
      : `Its effective stresses set the yield stress of ${affected.join(", ")} (marked "stage" in the list). ` +
        `Removing it makes ${affected.length === 1 ? "this material" : "these materials"} use ${affected.length === 1 ? "its" : "their"} POP or OCR instead.`;
  return `An earlier stage was imported. ${which}`;
}
