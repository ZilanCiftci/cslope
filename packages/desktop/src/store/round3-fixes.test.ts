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
});
