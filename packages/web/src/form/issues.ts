/**
 * The engine's validation issues (`validateDefinition`, by JSON pointer
 * into the analysis document) at the form's fields: the excavation
 * template writes the layers' materials first, in order, then the road's
 * fill, and one region assignment per layer, then the road's.
 */
import type { ValidationIssue } from "@cslope/engine";
import type { ExcavationParams } from "../templates/excavation";

const MATERIAL_KEYS: Record<string, string> = {
  unitWeight: "gamma",
  unitWeightSat: "gammaSat",
  undrainedShearStrength: "su",
  suRef: "su",
  rate: "suRate",
  cohesion: "c",
  frictionAngle: "phi",
};

const FACTOR_KEYS: Record<string, string> = {
  cu: "values.etaCu",
  cohesion: "values.etaDrained",
  tanPhi: "values.etaDrained",
  variableLoad: "values.variableLoadBase",
  basis: "values.safetyClass",
};

/**
 * The field of a material's issue that the engine reports on the model as
 * a whole ("/materials/0/model"), from the quantity its message names.
 */
function materialKey(message: string): string | undefined {
  // Not the material's name: a layer named "Rate" is not about the rate.
  const m = message.replace(/^Material "(?:[^"\\]|\\.)*":\s*/, "").toLowerCase();
  if (m.includes("saturated unit weight")) return "gammaSat";
  if (m.includes("unit weight")) return "gamma";
  if (m.includes("friction angle")) return "phi";
  if (m.includes("cohesion")) return "c";
  if (m.includes("rate") || m.includes("increase")) return "suRate";
  if (m.includes("shear strength") || /\bsu\b|\bcu\b/.test(m)) return "su";
  return undefined;
}

/** The field an issue is about, or null when it is about the model as a whole. */
export function issueField(path: string, params: Pick<ExcavationParams, "layers" | "road">, message = ""): string | null {
  const parts = path.split("/").slice(1);
  const [root, list, index, model, key] = parts;
  if (root === "options") {
    if (list === "partialFactors") return FACTOR_KEYS[index ?? ""] ?? "values.safetyClass";
    if (list === "tensionCrackDepth") return "tensionCrackDepth";
    return null;
  }
  if (root !== "definition") return null;
  const i = Number(index);
  const owner = (n: number) => (n < params.layers.length ? `layers.${n}` : params.road && n === params.layers.length ? "road" : null);
  switch (list) {
    case "materials": {
      const o = Number.isInteger(i) ? owner(i) : null;
      if (!o) return null;
      const k = model === "model" ? (MATERIAL_KEYS[key ?? ""] ?? materialKey(message)) : undefined;
      return k ? `${o}.${k}` : null;
    }
    case "regionAssignments": {
      const o = Number.isInteger(i) ? owner(i) : null;
      return o === "road" ? "road.height" : o && `${o}.bottomLevel`;
    }
    case "udls":
      return params.road ? "road.trafficLoad" : null;
    case "waterTable":
      return "waterLevel";
    default:
      return null;
  }
}

/**
 * The errors by field, the errors of the model as a whole (and those of a
 * field the form does not show), and the warnings, which are not about a
 * field the user must correct. `shown`: the fields the form shows.
 */
export function issuesByField(
  issues: ValidationIssue[],
  params: Pick<ExcavationParams, "layers" | "road">,
  shown: ReadonlySet<string>,
): { fields: Map<string, string>; general: ValidationIssue[]; warnings: ValidationIssue[] } {
  const fields = new Map<string, string>();
  const general: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  for (const issue of issues) {
    if (issue.severity !== "error") {
      warnings.push(issue);
      continue;
    }
    const field = issueField(issue.path, params, issue.message);
    if (field && shown.has(field)) {
      if (!fields.has(field)) fields.set(field, issue.message);
    } else general.push(issue);
  }
  return { fields, general, warnings };
}
