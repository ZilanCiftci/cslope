import { DEFAULT_PARAMETERS } from "../defaults";
import { nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import type { AppState, LineLoadRow, ParametersSlice, UdlRow } from "../types";
import {
  evaluate,
  resolveCoordinates,
  resolveMaterialModel,
  resolveParameters,
} from "../../utils/expression";

type ParametersState = AppState;

const syncActiveModelParameters = (
  state: ParametersState,
  parameters: ParametersSlice["parameters"],
) => {
  const { resolved } = resolveParameters(parameters);

  const resolvedCoordinates = resolveCoordinates(
    state.coordinates,
    state.coordinateExpressions,
    resolved,
  );

  const resolvedMaterialBoundaries = state.materialBoundaries.map((b) => ({
    ...b,
    coordinates: resolveCoordinates(
      b.coordinates,
      b.coordinateExpressions ?? [],
      resolved,
    ),
  }));

  const resolvedPiezo = {
    ...state.piezometricLine,
    lines: state.piezometricLine.lines.map((line) => ({
      ...line,
      coordinates: resolveCoordinates(
        line.coordinates,
        line.coordinateExpressions ?? [],
        resolved,
      ),
    })),
  };

  const resolvedMaterials = state.materials.map((material) => ({
    ...material,
    model: resolveMaterialModel(
      material.model,
      material.modelExpressions,
      resolved,
    ),
  }));

  const resolvedUdls = state.udls.map((udl) => resolveUdlRow(udl, resolved));
  const resolvedLineLoads = state.lineLoads.map((lineLoad) =>
    resolveLineLoadRow(lineLoad, resolved),
  );

  const modelPatch = {
    parameters,
    coordinates: resolvedCoordinates,
    materials: resolvedMaterials,
    materialBoundaries: resolvedMaterialBoundaries,
    piezometricLine: resolvedPiezo,
    udls: resolvedUdls,
    lineLoads: resolvedLineLoads,
  };

  return {
    parameters,
    coordinates: resolvedCoordinates,
    materials: resolvedMaterials,
    materialBoundaries: resolvedMaterialBoundaries,
    piezometricLine: resolvedPiezo,
    udls: resolvedUdls,
    lineLoads: resolvedLineLoads,
    models: state.models.map((m) =>
      m.id === state.activeModelId ? { ...m, ...modelPatch } : m,
    ),
  };
};

function resolveNumberExpression(
  current: number,
  expression: string | undefined,
  vars: Record<string, number>,
): number {
  if (!expression || expression.trim().length === 0) return current;
  try {
    return evaluate(expression, vars);
  } catch {
    return current;
  }
}

function resolveUdlRow(row: UdlRow, vars: Record<string, number>): UdlRow {
  return {
    ...row,
    magnitude: resolveNumberExpression(
      row.magnitude,
      row.expressions?.magnitude,
      vars,
    ),
    x1: resolveNumberExpression(row.x1, row.expressions?.x1, vars),
    x2: resolveNumberExpression(row.x2, row.expressions?.x2, vars),
  };
}

function resolveLineLoadRow(
  row: LineLoadRow,
  vars: Record<string, number>,
): LineLoadRow {
  return {
    ...row,
    magnitude: resolveNumberExpression(
      row.magnitude,
      row.expressions?.magnitude,
      vars,
    ),
    x: resolveNumberExpression(row.x, row.expressions?.x, vars),
  };
}

export const createParametersSlice: SliceCreator<ParametersSlice> = (
  set,
  get,
) => ({
  parameters: [...DEFAULT_PARAMETERS],

  addParameter: () => {
    set((s) =>
      syncActiveModelParameters(s, [
        ...s.parameters,
        {
          id: nextId("param"),
          name: `param_${s.parameters.length + 1}`,
          expression: "0",
        },
      ]),
    );
    get().invalidateAnalysis();
  },

  updateParameter: (id, patch) => {
    set((s) =>
      syncActiveModelParameters(
        s,
        s.parameters.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      ),
    );
    get().invalidateAnalysis();
  },

  removeParameter: (id) => {
    set((s) =>
      syncActiveModelParameters(
        s,
        s.parameters.filter((p) => p.id !== id),
      ),
    );
    get().invalidateAnalysis();
  },

  setParameters: (params) => {
    set((s) => syncActiveModelParameters(s, [...params]));
    get().invalidateAnalysis();
  },
});
