import { evaluate, resolveParameters } from "../utils/expression";
import type { CoordinateExpression } from "../utils/expression";
import type { ModelEntry } from "./types";

/**
 * Expressions of a model that cannot be evaluated with its current
 * parameters (e.g. a deleted or renamed parameter).
 *
 * The stores keep the last good value when an expression fails, so the
 * analysis would otherwise run silently with stale numbers.
 */
export function findExpressionErrors(model: ModelEntry): string[] {
  const { resolved, errors } = resolveParameters(model.parameters ?? []);
  const problems = Object.entries(errors).map(
    ([name, message]) => `parameter "${name}": ${message}`,
  );

  const check = (label: string, expression: string | undefined) => {
    if (!expression || expression.trim().length === 0) return;
    try {
      evaluate(expression, resolved);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      problems.push(`${label} "${expression}": ${reason}`);
    }
  };
  const checkPoints = (
    label: string,
    exprs: CoordinateExpression[] | undefined,
  ) => {
    exprs?.forEach((e, i) => {
      check(`${label} point ${i + 1} x`, e?.x);
      check(`${label} point ${i + 1} y`, e?.y);
    });
  };

  checkPoints("Exterior boundary", model.coordinateExpressions);
  model.materialBoundaries.forEach((b, i) =>
    checkPoints(`Boundary ${i + 1}`, b.coordinateExpressions),
  );
  model.piezometricLine.lines.forEach((l) =>
    checkPoints(`Piezometric line "${l.name}"`, l.coordinateExpressions),
  );
  for (const m of model.materials) {
    for (const [field, expr] of Object.entries(m.modelExpressions ?? {})) {
      check(`Material "${m.name}" ${field}`, expr);
    }
  }
  model.udls.forEach((u, i) => {
    for (const [field, expr] of Object.entries(u.expressions ?? {})) {
      check(`UDL ${i + 1} ${field}`, expr);
    }
  });
  model.lineLoads.forEach((l, i) => {
    for (const [field, expr] of Object.entries(l.expressions ?? {})) {
      check(`Line load ${i + 1} ${field}`, expr);
    }
  });
  return problems;
}
