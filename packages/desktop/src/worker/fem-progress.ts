/**
 * The progress of a finite element analysis as the status bar shows it:
 * the stage the engine reports (FemStage) and the strength reduction's
 * trials, e.g. "Finite elements: strength reduction, mesh 1 of 2, trial
 * F = 1.23 (5)" or "Finite elements: Davis B lower bound, mesh 2 of up to 4".
 * The analysis has no measure of the work left, so the fraction only creeps
 * up as the stages pass (the text and the elapsed time show that it runs).
 */
import type { FemStage } from "@cslope/engine";

export interface FemProgressTracker {
  /** A stage starts: its text and the run's progress fraction. */
  stage(stage: FemStage): { text: string; progress: number };
  /** A strength reduction trial ended with factor `F`. */
  trial(F: number): { text: string; progress: number };
}

const PREFIX = "Finite elements: ";

function meshText(mesh: number, meshes: number, upTo: boolean): string {
  if (meshes <= 1) return "";
  return `, mesh ${mesh + 1} of ${upTo ? "up to " : ""}${meshes}`;
}

/** The text of a stage without the trials. */
export function femStageText(stage: FemStage): string {
  switch (stage.stage) {
    case "mesh":
      return `${PREFIX}mesh and initial stresses`;
    case "strengthReduction":
      return `${PREFIX}strength reduction${meshText(stage.mesh, stage.meshes, true)}`;
    case "upperBound":
    case "lowerBound": {
      const bound = stage.stage === "upperBound" ? "upper bound" : "lower bound";
      return `${PREFIX}${stage.davis ? `Davis B ${bound}` : bound}${meshText(stage.mesh, stage.meshes, true)}`;
    }
  }
}

/**
 * A tracker of one run: the strength reduction's share of the progress
 * fraction is 0.3–0.6, the bounds' 0.6–0.9 (Davis B's in the last part).
 */
export function femProgressTracker(): FemProgressTracker {
  let text = `${PREFIX}starting`;
  let trials = 0;
  let progress = 0.3;
  const advance = (to: number) => {
    progress = Math.max(progress, Math.min(0.9, to));
    return progress;
  };
  return {
    stage(stage) {
      text = femStageText(stage);
      if (stage.stage === "strengthReduction") advance(0.3 + 0.1 * stage.mesh);
      else if (stage.stage === "upperBound" || stage.stage === "lowerBound") {
        const base = stage.davis ? 0.8 : 0.6;
        const span = stage.davis ? 0.1 : 0.2;
        const part = (2 * stage.mesh + (stage.stage === "lowerBound" ? 1 : 0)) / (2 * Math.max(1, stage.meshes));
        advance(base + span * part);
      }
      return { text, progress };
    },
    trial(F) {
      trials++;
      // no measure of the remaining trials: each one a little further, within the strength reduction's share
      advance(Math.min(0.6, progress + 0.01));
      return { text: `${text}, trial F = ${F.toFixed(2)} (${trials})`, progress };
    },
  };
}
