import { describe, expect, it } from "vitest";
import { analyseSlope, buildSlope } from "@cslope/engine";
import { VERIFICATION_CASES, presentedAnalyses, runVerification } from "@cslope/engine/verification";
import { useAppStore } from "./app-store";
import { buildSlopeDTOFromModel } from "./helpers";
import { shortReference, verificationModel } from "./verification-models";
import { paperTopBand, viewLockContains } from "../features/view/viewLock";

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

describe("benchmarks from the Help menu: the title block", () => {
  const byId = (id: string) => VERIFICATION_CASES.find((c) => c.id === id)!;
  const opened = (id: string, method?: string) => {
    const c = byId(id);
    return verificationModel(c, method, `${c.id} ${c.title}`, { titleBlock: true });
  };
  const text = (m: ReturnType<typeof opened>, id: string) =>
    m.resultViewSettings!.annotations.find((a) => a.id === `anno-benchmark-${id}`)?.text;

  it("gives a searched problem its title, source, FOS, reference values and material table", () => {
    const m = opened("V001");
    expect(m.projectInfo).toMatchObject({ title: "V001 Arai & Tagyo (1985) example 1", subtitle: "Arai & Tagyo (1985), example 1" });
    expect(text(m, "title")).toBe("#Title");
    expect(text(m, "subtitle")).toBe("#Subtitle");
    expect(text(m, "fos")).toBe("Calculated FOS: #FOS");
    // The published value and the other programs' range, the programs unnamed.
    expect(text(m, "reference")).toBe("Reference for Bishop simplified: 1.451 Arai & Tagyo (1985)\n    other programs 1.409–1.417 (2)");
    expect(m.resultViewSettings!.annotations.some((a) => a.type === "material-table")).toBe(true);
    expect(m.resultViewSettings!.showFosLabel).toBe(true);
  });

  it("says when the surface is given, and gives one program's value alone", () => {
    expect(text(opened("V010"), "reference")).toBe("Reference for Morgenstern-Price (half-sine), given surface: another program 1.171");
  });

  it("marks a disputed published value, without a program range when there is none", () => {
    expect(text(opened("V096d", "Bishop simplified"), "reference")).toBe(
      "Reference for Bishop simplified, given surface: 1.429 Zhu & Lee (2002) (disputed)",
    );
  });

  it("gives the finite element reference of a problem checked by finite elements only", () => {
    expect(presentedAnalyses(byId("V099"))).toHaveLength(0);
    expect(text(opened("V099"), "reference")).toBe("Reference, finite elements: 1.48 another program's verification manual");
  });

  it("puts every benchmark's block clear of the model and the material table", () => {
    useAppStore.getState().loadBenchmarks();
    for (const m of useAppStore.getState().models) {
      const anns = m.resultViewSettings!.annotations;
      const reference = anns.find((a) => a.id === "anno-benchmark-reference")!.text!;
      expect(m.projectInfo!.title.startsWith(m.name.split(" ")[0]), m.name).toBe(true);
      // Lines that fit beside the table, and no program named.
      for (const line of reference.split("\n")) expect(line.length, `${m.name}: ${line}`).toBeLessThanOrEqual(86);
      expect(reference).not.toMatch(/\b[Pp]rogram [A-Z]\b/);
      expect(m.projectInfo!.subtitle.length).toBeLessThanOrEqual(73);
      // The model starts below the block.
      const lock = m.resultViewSettings!.viewLock!;
      const band = paperTopBand(anns);
      const top = lock.topRight[1] - band * (lock.topRight[1] - lock.bottomLeft[1]);
      expect(Math.max(...m.coordinates.map(([, y]) => y)), m.name).toBeLessThan(top);
    }
  });

  it("shortens a long source to the authors, year and title", () => {
    expect(
      shortReference(
        "Cheng, Y.M., Lansivaara, T. & Wei, W.B. (2007). Two-dimensional slope stability analysis by limit equilibrium and strength reduction methods. Computers and Geotechnics 34(3), 137–150.",
      ),
    ).toBe("Cheng et al. (2007). Two-dimensional slope stability analysis by limit…");
    expect(shortReference("Baker, R. & Leshchinsky, D. (2001). Spatial distribution of safety factors. J. Geotech. Geoenviron. Eng. 127(2), 135–145.")).toBe(
      "Baker & Leshchinsky (2001). Spatial distribution of safety factors",
    );
    expect(shortReference("Arai & Tagyo (1985), example 1.")).toBe("Arai & Tagyo (1985), example 1");
  });

  it("leaves the website's plots plain", () => {
    for (const c of VERIFICATION_CASES) {
      const m = verificationModel(c);
      expect(m.resultViewSettings!.annotations, c.id).toEqual([]);
      expect(m.resultViewSettings!.showFosLabel, c.id).toBe(false);
      expect(m.projectInfo!.subtitle, c.id).toBe("");
    }
  });
});
