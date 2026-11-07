/**
 * The engine's validation issues (`validateDefinition`, by JSON pointer
 * into the analysis document) at the form's fields. The templates write
 * the layers' materials first, in order, then the fill's (the road, the
 * embankment), and one region assignment per layer, then the fill's; the
 * template's form says which field each is (`IssueTargets`).
 */
import type { ValidationIssue } from "@cslope/engine";

/** The fields of a document's parts, by index, as a template writes them. */
export interface IssueTargets {
  /** The owner of each material's fields ("layers.0", "road", "fill"). */
  materials: string[];
  /** The field of each region assignment ("layers.0.thickness", "road.height"). */
  regions: string[];
  /** The field of the distributed loads, or null for none. */
  udl: string | null;
}

const MATERIAL_KEYS: Record<string, string> = {
  unitWeight: "gamma",
  unitWeightSat: "gamma",
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
  // "Both c and φ are zero": at c′, the first of the two.
  if (m.includes("both c and φ")) return "c";
  if (m.includes("unit weight")) return "gamma";
  if (m.includes("friction angle")) return "phi";
  if (m.includes("cohesion")) return "c";
  if (m.includes("rate") || m.includes("increase")) return "suRate";
  if (m.includes("shear strength") || /\bsu\b|\bcu\b/.test(m)) return "su";
  return undefined;
}

/** The field an issue is about, or null when it is about the model as a whole. */
export function issueField(path: string, targets: IssueTargets, message = ""): string | null {
  const parts = path.split("/").slice(1);
  const [root, list, index, model, key] = parts;
  if (root === "options") {
    if (list === "partialFactors") return FACTOR_KEYS[index ?? ""] ?? "values.safetyClass";
    return null;
  }
  if (root !== "definition") return null;
  const i = Number(index);
  switch (list) {
    case "materials": {
      const o = Number.isInteger(i) ? targets.materials[i] : undefined;
      if (!o) return null;
      const k = model === "model" ? (MATERIAL_KEYS[key ?? ""] ?? materialKey(message)) : undefined;
      return k ? `${o}.${k}` : null;
    }
    case "regionAssignments":
      return (Number.isInteger(i) && targets.regions[i]) || null;
    case "udls":
      return targets.udl;
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
  targets: IssueTargets,
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
    const field = issueField(issue.path, targets, issue.message);
    if (field && shown.has(field)) {
      if (!fields.has(field)) fields.set(field, issue.message);
    } else general.push(issue);
  }
  return { fields, general, warnings };
}
