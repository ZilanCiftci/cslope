import type { AnalysisResult } from "@cslope/engine";
import type { ParameterDef, ProjectInfo } from "../../store/types";
import { evaluate, resolveParameters } from "../../utils/expression";

const STATIC_TAG_RESOLVERS: Record<
  string,
  (projectInfo: Partial<ProjectInfo>, result?: AnalysisResult | null) => string
> = {
  Title: (projectInfo) => projectInfo.title ?? "",
  Subtitle: (projectInfo) => projectInfo.subtitle ?? "",
  Client: (projectInfo) => projectInfo.client ?? "",
  ProjectNumber: (projectInfo) => projectInfo.projectNumber ?? "",
  Revision: (projectInfo) => projectInfo.revision ?? "",
  Author: (projectInfo) => projectInfo.author ?? "",
  Checker: (projectInfo) => projectInfo.checker ?? "",
  Date: (projectInfo) => projectInfo.date ?? "",
  Description: (projectInfo) => projectInfo.description ?? "",
  Method: (_projectInfo, result) => result?.method ?? "N/A",
  FOS: (_projectInfo, result) =>
    Number.isFinite(result?.minFOS) ? result!.minFOS.toFixed(3) : "N/A",
  MinFOS: (_projectInfo, result) =>
    Number.isFinite(result?.minFOS) ? result!.minFOS.toFixed(3) : "N/A",
};

function formatNumber(value: number): string {
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
  const staticTags = new Map(
    Object.entries(STATIC_TAG_RESOLVERS).map(([tag, fn]) => [tag.toLowerCase(), fn]),
  );

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
      const tag = staticTags.get(name.toLowerCase());
      return tag ? tag(projectInfo, result) : full;
    },
  );
}
