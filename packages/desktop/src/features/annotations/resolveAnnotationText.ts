import type { AnalysisResult } from "@cslope/engine";
import type { ParameterDef, ProjectInfo } from "../../store/types";
import { evaluate, resolveParameters } from "../../utils/expression";

/** What a tag is resolved from. */
export interface AnnotationTagContext {
  projectInfo: Partial<ProjectInfo>;
  result?: AnalysisResult | null;
}

/** A built-in text tag (`#tag`), the one list of them. */
export interface AnnotationTag {
  /** The name after `#`, as inserted (matching is case-insensitive). */
  tag: string;
  /** One line for the Insert variable menu, including what it shows without a value (for project information, the group heading says it). */
  description: string;
  /** Its value, or null when the model has none (it then shows `missing`). */
  value: (ctx: AnnotationTagContext) => string | null;
  /** What the tag shows without a value. */
  missing: string;
  /** Listed under a heading in the Insert variable menu: project information. */
  group?: "project";
}

const info = (
  tag: string,
  key: keyof ProjectInfo,
  description: string,
): AnnotationTag => ({
  tag,
  description,
  group: "project",
  value: ({ projectInfo }) => {
    const v = projectInfo[key];
    return typeof v === "string" && v !== "" ? v : null;
  },
  missing: "",
});

const fos = (ctx: AnnotationTagContext): string | null => {
  const v = ctx.result?.minFOS;
  return v !== undefined && Number.isFinite(v) ? v.toFixed(3) : null;
};

/**
 * The built-in tags. Both the resolver and the Insert variable menu read
 * this table, so the menu lists exactly what the sheet replaces.
 */
export const ANNOTATION_TAGS: readonly AnnotationTag[] = [
  info("Title", "title", "Title"),
  info("Subtitle", "subtitle", "Subtitle"),
  info("Client", "client", "Client"),
  info("ProjectNumber", "projectNumber", "Project number"),
  info("Revision", "revision", "Revision"),
  info("Author", "author", "Author"),
  info("Checker", "checker", "Checker"),
  info("Date", "date", "Date"),
  info("Description", "description", "Description"),
  {
    tag: "Method",
    description: "Analysis method (N/A without a result)",
    value: ({ result }) => result?.method || null,
    missing: "N/A",
  },
  {
    tag: "FOS",
    description: "Minimum factor of safety (N/A without a result)",
    value: fos,
    missing: "N/A",
  },
  {
    tag: "MinFOS",
    description: "Minimum factor of safety, same as #FOS",
    value: fos,
    missing: "N/A",
  },
  {
    tag: "FOS3D",
    description:
      "Smallest 3D factor of safety after SGI Vägledning 8 (N/A without the 3D effects option)",
    value: ({ result }) => {
      const v = result?.sgi3d?.factorOfSafety;
      return v !== undefined && Number.isFinite(v) ? v.toFixed(3) : null;
    },
    missing: "N/A",
  },
];

const TAGS_BY_NAME = new Map(
  ANNOTATION_TAGS.map((t) => [t.tag.toLowerCase(), t]),
);

/** What a built-in tag shows on the sheet. */
export function annotationTagText(
  tag: AnnotationTag,
  ctx: AnnotationTagContext,
): string {
  return tag.value(ctx) ?? tag.missing;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(8)).toString();
}

export function resolveAnnotationText(params: {
  text: string;
  projectInfo: Partial<ProjectInfo>;
  result?: AnalysisResult | null;
  parameters?: ParameterDef[];
}): string {
  const { text, projectInfo, result, parameters = [] } = params;
  if (!text) return "";

  const { resolved } = resolveParameters(parameters);
  const ctx: AnnotationTagContext = { projectInfo, result };

  // One pass, so text inserted for a tag (e.g. a title containing "#H",
  // "{{...}}" or "\n") is never processed again.  A parameter name wins
  // over a built-in tag of the same name (exact case); built-in tags are
  // case-insensitive.
  return text.replace(
    /\{\{([^{}]+)\}\}|\\n|#([a-zA-Z_][a-zA-Z0-9_]*)/g,
    (full, rawExpr: string | undefined, name: string | undefined) => {
      if (rawExpr !== undefined) {
        const expr = rawExpr.trim();
        if (expr.length === 0) return full;
        try {
          return formatNumber(evaluate(expr, resolved));
        } catch {
          return full;
        }
      }
      if (name === undefined) return "\n";
      if (Object.prototype.hasOwnProperty.call(resolved, name)) {
        return formatNumber(resolved[name]);
      }
      const tag = TAGS_BY_NAME.get(name.toLowerCase());
      return tag ? annotationTagText(tag, ctx) : full;
    },
  );
}
