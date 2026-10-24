import { describe, expect, it } from "vitest";
import { analyseSlope, buildSlope } from "@cslope/engine";
import { VERIFICATION_CASES, presentedAnalyses, runVerification } from "@cslope/engine/verification";
import { useAppStore } from "./app-store";
import { buildSlopeDTOFromModel } from "./helpers";
import { verificationModel } from "./verification-models";
import { viewLockContains } from "../features/view/viewLock";

describe("verification models", () => {
  it("Benchmarks opens every verification problem", () => {
    useAppStore.getState().loadBenchmarks();
    const names = useAppStore.getState().models.map((m) => m.name);
    expect(names).toHaveLength(VERIFICATION_CASES.length);
    for (const c of VERIFICATION_CASES) expect(names).toContain(`${c.id} ${c.title}`);
  });

  // On a given surface the search settings do not matter: the app must
  // give the verification result. Problems with reinforcement, piles and
  // several water lines, the parts the app model carries over itself.
  const fixed = VERIFICATION_CASES.filter(
    (c) => c.surface === "fixed" && (c.definition.reinforcements?.length || c.definition.piles?.length || c.definition.waterTables?.length),
  );

  it.each(fixed.map((c) => [c.id, c] as const))("%s: the app gives the verification result", (_, c) => {
    const a = presentedAnalyses(c)[0];
    const model = verificationModel(c);
    const slope = buildSlope(buildSlopeDTOFromModel(model));
    slope.updateAnalysisOptions(model.options);
    const app = analyseSlope(slope);
    const { fos } = runVerification(c.definition, a.method, a.options);
    expect(app).not.toBeNull();
    expect(app!).toBeCloseTo(fos!, 6);
  });
});

describe("verification paper frame", () => {
  const model = (id: string) => verificationModel(VERIFICATION_CASES.find((c) => c.id === id)!);

  it("keeps the pool level of V041b on the paper", () => {
    const m = model("V041b");
    const lock = m.resultViewSettings!.viewLock!;
    const poolTop = Math.max(...m.piezometricLine.lines.flatMap((l) => l.coordinates.map(([, y]) => y)));
    expect(lock.topRight[1]).toBeGreaterThan(poolTop);
  });

  it("leaves a margin around every model and its reinforcement", () => {
    for (const c of VERIFICATION_CASES) {
      const m = verificationModel(c);
      const lock = m.resultViewSettings!.viewLock!;
      const ends = (m.reinforcements ?? []).flatMap((r) => [[r.x1, r.y1], [r.x2, r.y2]] as [number, number][]);
      const inside = { bottomLeft: [lock.bottomLeft[0] + 1e-3, lock.bottomLeft[1] + 1e-3], topRight: [lock.topRight[0] - 1e-3, lock.topRight[1] - 1e-3] } as typeof lock;
      expect(viewLockContains(inside, [...m.coordinates, ...ends]), c.id).toBe(true);
    }
  });
});
