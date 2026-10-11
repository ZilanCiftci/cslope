import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import { findExpressionErrors } from "./expression-check";
import { parseProjectFile, serializeProject } from "./persistence";
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
    useAppStore.getState().setOptions({ porePressureHead: "vertical" });
    const raw = JSON.parse(JSON.stringify(serializeProject(useAppStore.getState())));
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options?.porePressureHead).toBe("vertical");
    raw.models[0].options.porePressureHead = "bogus";
    expect(parseProjectFile(JSON.stringify(raw)).models[0].options?.porePressureHead).toBe(
      "phreatic-correction",
    );
  });
});
