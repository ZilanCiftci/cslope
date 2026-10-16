import { describe, expect, it } from "vitest";
import { analyseSlope, buildSlope } from "@cslope/engine";
import { VERIFICATION_CASES, presentedAnalyses, runVerification } from "@cslope/engine/verification";
import { useAppStore } from "./app-store";
import { buildSlopeDTOFromModel } from "./helpers";
import { verificationModel } from "./verification-models";

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
