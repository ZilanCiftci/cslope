/**
 * The title line of the PDF's page 1 (the model's name, its minimum F and
 * method) and its out-of-date note, as the result view previews them in
 * the top margin of its sheet: the same text drawingTitleParts gives the
 * PDF (pdf-summary.ts) from the same summary.
 */

import type { AppState } from "../../store/types";
import { isResultOutOfDate } from "../../store/out-of-date";
import { drawingTitleParts } from "../pdf/pdf-summary";
import { pdfPageOptions } from "../pdf/pdf-export";
import { buildAnalysisSummary } from "./analysisSummary";

/** What the top margin of page 1 shows. */
export interface PageTitleLine {
  /** The title line (empty when the PDF has none: its menu turned it off). */
  name: string;
  result: string;
  /** The result is out of date: the PDF says so right-aligned on that line. */
  outOfDate: boolean;
}

type TitleState = Pick<
  AppState,
  | "result"
  | "resultViewSettings"
  | "options"
  | "analysisLimits"
  | "orientation"
  | "piezometricLine"
  | "materials"
  | "udls"
  | "lineLoads"
  | "reinforcements"
  | "piles"
  | "customPlanesOnly"
  | "customSearchPlanes"
  | "waternet"
  | "earlierStage"
  | "projectInfo"
  | "models"
  | "activeModelId"
>;

/** The title line of page 1 for a state with a result, as "Export as PDF…" writes it; null without a result. */
export function pageTitleLine(state: TitleState): PageTitleLine | null {
  if (!state.result) return null;
  const outOfDate = isResultOutOfDate(state.result);
  if (!pdfPageOptions(state.resultViewSettings).titleLine) return { name: "", result: "", outOfDate };
  // The same input as the PDF export's summary (ResultsMenu), of which the title line reads the result section.
  const sections = buildAnalysisSummary({
    result: state.result,
    options: state.options,
    analysisLimits: state.analysisLimits,
    orientation: state.orientation,
    piezometricLine: state.piezometricLine,
    materials: state.materials,
    udls: state.udls,
    lineLoads: state.lineLoads,
    reinforcements: state.reinforcements,
    piles: state.piles,
    customPlanesOnly: state.customPlanesOnly && state.customSearchPlanes.length > 0,
    customSurfaceCount: state.customSearchPlanes.length,
    waternet: state.waternet,
    earlierStage: state.earlierStage,
  });
  const { name, result } = drawingTitleParts(sections, {
    projectInfo: state.projectInfo,
    modelName: state.models.find((m) => m.id === state.activeModelId)?.name,
    version: "",
    date: "",
    outOfDate,
  });
  return { name, result, outOfDate };
}
