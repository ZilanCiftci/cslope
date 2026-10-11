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
import type { CoordinateExpression } from "../../utils/expression";
import { isClosedBoundary } from "../../utils/regions";

type Point = [number, number];

const samePoint = (a: Point, b: Point) =>
  Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

const hasExpression = (e: CoordinateExpression | undefined) =>
  !!(e?.x?.trim() || e?.y?.trim());

/**
 * Keep shared vertices together after re-resolving expressions, the same
 * way direct edits do: a boundary/piezo point without its own expression
 * that sat on an exterior vertex follows that vertex, and a closed
 * boundary keeps its first and last points equal.
 */
function keepVerticesAttached(
  before: Point[],
  exprs: CoordinateExpression[],
  after: Point[],
  moves: { from: Point; to: Point }[],
): Point[] {
  const next = after.map((p, i) => {
    if (hasExpression(exprs[i])) return p;
    const move = moves.find((m) => samePoint(m.from, before[i]));
    return move ? move.to : p;
  });
  if (isClosedBoundary(before) && next.length > 1) {
    const last = next.length - 1;
    if (!samePoint(next[0], next[last])) {
      if (hasExpression(exprs[last]) && !hasExpression(exprs[0])) {
        next[0] = next[last];
      } else {
        next[last] = next[0];
      }
    }
  }
  return next;
}

type ParametersState = AppState;

/** The model fields that parameter expressions can drive. */
export type ParameterDrivenFields = Pick<
  AppState,
  | "coordinates"
  | "coordinateExpressions"
  | "materials"
  | "materialBoundaries"
  | "piezometricLine"
  | "udls"
  | "lineLoads"
>;

/**
 * Re-resolve every expression of a model with the given parameter
 * definitions; returns the updated geometry, materials and loads.
 */
export function resolveModelParameters(
  state: ParameterDrivenFields,
  parameters: ParametersSlice["parameters"],
) {
  const { resolved } = resolveParameters(parameters);

  const resolvedCoordinates = resolveCoordinates(
    state.coordinates,
    state.coordinateExpressions,
    resolved,
  );

  // Exterior vertices moved by the new parameter values.
  const moves = state.coordinates
    .map((from, i) => ({ from, to: resolvedCoordinates[i] }))
    .filter((m) => m.to && !samePoint(m.from, m.to));

  const resolvedMaterialBoundaries = state.materialBoundaries.map((b) => ({
    ...b,
    coordinates: keepVerticesAttached(
      b.coordinates,
      b.coordinateExpressions ?? [],
      resolveCoordinates(b.coordinates, b.coordinateExpressions ?? [], resolved),
      moves,
    ),
  }));

  const resolvedPiezo = {
    ...state.piezometricLine,
    lines: state.piezometricLine.lines.map((line) => ({
      ...line,
      coordinates: keepVerticesAttached(
        line.coordinates,
        line.coordinateExpressions ?? [],
        resolveCoordinates(
          line.coordinates,
          line.coordinateExpressions ?? [],
          resolved,
        ),
        moves,
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

  return {
    parameters,
    coordinates: resolvedCoordinates,
    materials: resolvedMaterials,
    materialBoundaries: resolvedMaterialBoundaries,
    piezometricLine: resolvedPiezo,
    udls: resolvedUdls,
    lineLoads: resolvedLineLoads,
  };
}

const syncActiveModelParameters = (
  state: ParametersState,
  parameters: ParametersSlice["parameters"],
) => {
  const modelPatch = resolveModelParameters(state, parameters);
  return {
    ...modelPatch,
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

/** Smallest load magnitude the load dialogs accept (kPa or kN/m). */
export const MIN_LOAD_MAGNITUDE = 0.1;

function resolveUdlRow(row: UdlRow, vars: Record<string, number>): UdlRow {
  return {
    ...row,
    // Same floor as the load dialogs: a parameter must not turn a load
    // into an upward (negative) one behind the user's back.
    magnitude: Math.max(
      MIN_LOAD_MAGNITUDE,
      resolveNumberExpression(row.magnitude, row.expressions?.magnitude, vars),
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
    magnitude: Math.max(
      MIN_LOAD_MAGNITUDE,
      resolveNumberExpression(row.magnitude, row.expressions?.magnitude, vars),
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
          name: "",
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
