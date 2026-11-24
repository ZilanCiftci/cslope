/**
 * V085's benchmark sheet (Help › Benchmarks) after a run, with a color bar
 * placed by the Color bar button: the sheet laid out on `paperSize` as it
 * opens there, then the result (the published critical circle, its F
 * label at the circle's centre high above the slope), which lays the sheet
 * out again. On A4 its material table then goes to the left under the
 * title block and the model is drawn smaller to the right of it.
 */

import type { AnalysisResult } from "@cslope/engine";
import { useAppStore } from "../store/app-store";
import { benchmarkSheetOf, layoutBenchmarkSheet } from "../store/benchmark-sheet";
import type { ModelEntry, PaperSize } from "../store/types";
import { paperContentOf } from "../features/view/extents";
import { surfaceYAtX } from "../features/view/surface";

type Pt = [number, number];

/** The circle Duncan, Wright & Brandon give (in the problem's frame), on which cSlope gives F = 1.765. */
const CIRCLE = { cx: 126.25, cy: 117.6, radius: 151.27 };

/** A result with that circle as the critical surface, entering on the crest and leaving at the toe. */
function v085Result(coordinates: Pt[]): AnalysisResult {
  const { cx, cy, radius } = CIRCLE;
  const off = (x: number) => Math.hypot(x - cx, surfaceYAtX(coordinates, x)! - cy) - radius;
  const root = (a: number, b: number) => {
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2;
      if (Math.sign(off(m)) === Math.sign(off(a))) a = m;
      else b = m;
    }
    return a;
  };
  const entry = root(0, 45);
  const exit = root(83.4, 145);
  const surface = {
    cx,
    cy,
    radius,
    fos: 1.765,
    entryPoint: [entry, surfaceYAtX(coordinates, entry)!] as Pt,
    exitPoint: [exit, surfaceYAtX(coordinates, exit)!] as Pt,
    converged: true,
  };
  return {
    minFOS: 1.765,
    maxFOS: 3.2,
    criticalSurface: surface,
    allSurfaces: [surface, { ...surface, fos: 3.2, radius: radius + 5 }],
    criticalSlices: [],
    method: "Bishop",
    elapsedMs: 1,
  } as unknown as AnalysisResult;
}

/** V085's sheet on `paperSize` after a run, with a new color bar: the active model's entry (in the store). */
export function v085AfterRunWithColorBar(paperSize: PaperSize): ModelEntry {
  const store = useAppStore;
  store.getState().loadBenchmarks();
  store.getState().switchModel(store.getState().models.find((m) => m.name.startsWith("V085 "))!.id);
  const s = store.getState();
  const paperFrame = { ...s.resultViewSettings.paperFrame, paperSize };
  // As the sheet opens on that paper.
  const laid = layoutBenchmarkSheet(benchmarkSheetOf(s), paperContentOf(s), s.resultViewSettings.annotations, paperFrame);
  s.setResultViewSettings({ paperFrame, annotations: laid.annotations, viewLock: laid.viewLock ?? undefined });
  // The run: the sheet is laid out again with the result's F label.
  store.setState({ result: v085Result(s.coordinates) });
  store.getState().addAnnotation("color-bar");
  const after = store.getState();
  return { ...after.models.find((m) => m.id === after.activeModelId)!, result: after.result };
}
