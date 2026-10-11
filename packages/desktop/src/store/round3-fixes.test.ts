import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { findExpressionErrors } from "./expression-check";
import { PROJECT_FILE_VERSION, parseProjectFile, serializeProject } from "./persistence";
import { buildSlopeDTOFromModel } from "./helpers";
import { evaluate } from "../utils/expression";
import type { AnalysisResult } from "@cslope/engine";
import type { ModelEntry } from "./types";

const activeModel = (): ModelEntry => {
  const s = useAppStore.getState();
  return { ...s.models.find((m) => m.id === s.activeModelId)!, ...s } as ModelEntry;
};

describe("round 3 store fixes", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
  });

  it("selecting or renaming a piezometric line keeps the result", () => {
    useAppStore.getState().addPiezoLine();
    const id = useAppStore.getState().piezometricLine.lines[0].id;
    useAppStore.setState({
      runState: "done",
      result: { minFOS: 1.2 } as unknown as AnalysisResult,
    });
    useAppStore.getState().setActivePiezoLine(null);
    useAppStore.getState().setActivePiezoLine(id);
    useAppStore.getState().renamePiezoLine(id, "Renamed");
    expect(useAppStore.getState().runState).toBe("done");
    expect(useAppStore.getState().result).not.toBeNull();
  });

  it("a parameter cannot turn a load negative", () => {
    useAppStore.getState().addUdl();
    const udl = useAppStore.getState().udls[0];
    useAppStore
      .getState()
      .updateUdl(udl.id, { expressions: { magnitude: "q" } });
    useAppStore.getState().setParameters([{ id: "p", name: "q", expression: "-20" }]);
    expect(useAppStore.getState().udls[0].magnitude).toBe(0.1);
  });

  it("reports expressions that no longer evaluate", () => {
    const s = useAppStore.getState();
    useAppStore.setState({
      coordinateExpressions: s.coordinates.map((_, i) => (i === 1 ? { x: "H" } : {})),
    });
    const errors = findExpressionErrors(activeModel());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Exterior boundary point 2 x");
  });

  it("typing a coordinate through a neighbour's position leaves its boundary point", () => {
    const s = useAppStore.getState();
    const [ax, ay] = s.coordinates[2];
    useAppStore.setState({
      materialBoundaries: [
        { id: "b", coordinates: [[ax, ay], [0, ay - 2]], coordinateExpressions: [{}, {}] },
      ],
    });
    const y3 = s.coordinates[3][1];
    // Intermediate value lands exactly on vertex 2, then moves on.
    useAppStore.getState().setCoordinate(3, [ax, ay]);
    useAppStore.getState().setCoordinate(3, [ax + 0.5, y3]);
    expect(useAppStore.getState().materialBoundaries[0].coordinates[0]).toEqual([ax, ay]);
  });
});

describe("expression syntax", () => {
  it("accepts unary plus and scientific notation", () => {
    expect(evaluate("+5", {})).toBe(5);
    expect(evaluate("1e3", {})).toBe(1000);
    expect(evaluate("1.5E-2*2", {})).toBeCloseTo(0.03, 12);
    expect(evaluate("2-+3", {})).toBe(-1);
  });
});

describe("pore pressure head option", () => {
  it("is saved, reloaded and validated", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().setOptions({ porePressureHead: "phreatic-correction" });
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options?.porePressureHead).toBe(
      "phreatic-correction",
    );
    raw.models[0].options.porePressureHead = "bogus";
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options?.porePressureHead).toBe("vertical");
  });

  it("keeps version 1 files on the phreatic correction they were analysed with", () => {
    useAppStore.getState().newProject();
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    raw.version = 1;
    delete raw.models[0].options.porePressureHead;
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options?.porePressureHead).toBe(
      "phreatic-correction",
    );
    delete raw.models[0].options;
    const parsed = parseProjectFile(JSON.stringify(raw));
    expect(parsed.models[0].options?.porePressureHead).toBe("phreatic-correction");
    expect(parsed.version).toBe(PROJECT_FILE_VERSION);
  });
});

describe("S = f(datum) sign convention", () => {
  it("flips the rate (and its expression) of version 1 files to positive-with-depth", () => {
    useAppStore.getState().newProject();
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    raw.version = 1;
    raw.models[0].materials[0] = {
      ...raw.models[0].materials[0],
      model: { kind: "s-f-datum", unitWeight: 17, suRef: 19, yRef: -1.7, rate: -12.7 },
      modelExpressions: { rate: "k*2" },
    };
    const v1 = parseProjectFile(JSON.stringify(raw)).models[0].materials[0];
    expect(v1.model).toMatchObject({ kind: "s-f-datum", rate: 12.7 });
    expect(v1.modelExpressions?.rate).toBe("-(k*2)");

    raw.version = 2;
    const v2 = parseProjectFile(JSON.stringify(raw)).models[0].materials[0];
    expect(v2.model).toMatchObject({ rate: -12.7 });
    expect(v2.modelExpressions?.rate).toBe("k*2");
  });
});

describe("free water above ground", () => {
  const withLine = () => {
    useAppStore.getState().newProject();
    useAppStore.getState().enablePiezoWithDefault();
    return JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
  };

  it("is on for new models and reaches the engine as an unclipped line", () => {
    const raw = withLine();
    const model = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(model.piezometricLine.freeWater).not.toBe(false);
    expect(buildSlopeDTOFromModel(model).waterTable?.followBoundary).toBe(false);
  });

  it("stays off for files from before version 3", () => {
    const raw = withLine();
    raw.version = 2;
    const model = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(model.piezometricLine.freeWater).toBe(false);
    expect(buildSlopeDTOFromModel(model).waterTable?.followBoundary).toBe(true);
  });

  it("can be switched off", () => {
    withLine();
    useAppStore.getState().setPiezoFreeWater(false);
    expect(useAppStore.getState().piezometricLine.freeWater).toBe(false);
  });

  it("comes from the chosen main line, which unassigned materials follow", () => {
    withLine();
    const s = useAppStore.getState();
    s.addPiezoLine([[0, -3], [100, -3]]);
    const second = useAppStore.getState().piezometricLine.lines[1].id;
    useAppStore.getState().setPiezoMainLine(second);
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    const model = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(model.piezometricLine.mainLineId).toBe(second);
    const dto = buildSlopeDTOFromModel(model);
    expect(dto.waterTable?.value).toEqual([[0, -3], [100, -3]]);
    expect(dto.materials.every((m) => m.waterTableId === undefined)).toBe(true);
    // A main line that no longer exists falls back to the first line.
    raw.models[0].piezometricLine.mainLineId = "gone";
    const stale = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(stale.piezometricLine.mainLineId).toBeUndefined();
    expect(buildSlopeDTOFromModel(stale).waterTable?.value).toEqual(stale.piezometricLine.lines[0].coordinates);
  });
});

describe("tension crack options", () => {
  it("are saved, reloaded and clamped", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().setOptions({ tensionCrackDepth: 2.5, tensionCrackWater: 0.5 });
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    const opts = parseProjectFile(JSON.stringify(raw)).models[0].options!;
    expect(opts.tensionCrackDepth).toBe(2.5);
    expect(opts.tensionCrackWater).toBe(0.5);
    raw.models[0].options.tensionCrackDepth = -1;
    raw.models[0].options.tensionCrackWater = 3;
    const bad = parseProjectFile(JSON.stringify(raw)).models[0].options!;
    expect(bad.tensionCrackDepth).toBe(0);
    expect(bad.tensionCrackWater).toBe(1);
  });

  it("automatic depth is saved and reloaded", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().setOptions({ tensionCrackAuto: true });
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options!.tensionCrackAuto).toBe(true);
  });
});

describe("saturated unit weight", () => {
  it("is saved with the material and reaches the engine", () => {
    useAppStore.getState().newProject();
    const mat = useAppStore.getState().materials[0];
    useAppStore.getState().updateMaterial(mat.id, { model: { ...mat.model, unitWeightSat: 21 } });
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    const model = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(model.materials[0].model.unitWeightSat).toBe(21);
    expect(buildSlopeDTOFromModel(model).materials[0].model?.unitWeightSat).toBe(21);
  });
});

describe("partial factors option", () => {
  it("is saved and reloaded; invalid factors fall back to 1, a missing block to none", () => {
    useAppStore.getState().newProject();
    const factors = { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 };
    useAppStore.getState().setOptions({ partialFactors: factors });
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options?.partialFactors).toEqual(factors);
    raw.models[0].options.partialFactors.cu = -2;
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options?.partialFactors?.cu).toBe(1);
    delete raw.models[0].options.partialFactors;
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options?.partialFactors).toBeUndefined();
  });
});

describe("non-circular surfaces in the model", () => {
  it("are saved, reloaded and reach the engine as customSurfaces", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().addCustomSearchPlane("polyline");
    const id = useAppStore.getState().customSearchPlanes[0].id;
    useAppStore.getState().updateCustomSearchPlane(id, { points: [[1, 2], [3, 1], [6, 4]] });
    useAppStore.getState().addCustomSearchPlane("circle");
    useAppStore.getState().setOptions({ nonCircularOptimization: true, minSlipDepth: 1.5, minSlipArea: 0 });
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    const model = parseProjectFile(JSON.stringify(raw)).models[0];
    expect(model.customSearchPlanes[0].points).toEqual([[1, 2], [3, 1], [6, 4]]);
    expect(model.options?.nonCircularOptimization).toBe(true);
    expect(model.options?.minSlipDepth).toBe(1.5);
    // 0 (no limit) is kept; it differs from the automatic default.
    expect(model.options?.minSlipArea).toBe(0);
    const dto = buildSlopeDTOFromModel(model);
    expect(dto.customSearchPlanes).toHaveLength(1);
    expect(dto.customSurfaces).toHaveLength(1);
  });

  it("an unfinished polyline (under two points) is left out of the analysis", () => {
    useAppStore.getState().newProject();
    useAppStore.getState().addCustomSearchPlane("polyline");
    const model = parseProjectFile(JSON.stringify(serializeProject(useAppStore.getState()))).models[0];
    expect(buildSlopeDTOFromModel(model).customSurfaces).toBeUndefined();
  });
});
