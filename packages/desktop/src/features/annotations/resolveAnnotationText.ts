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
  Method: (_projectInfo, result) => result?.method ?? "",
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

function applyStaticTags(
  text: string,
  projectInfo: Partial<ProjectInfo>,
  result?: AnalysisResult | null,
): string {
  let next = text;
  for (const [tag, resolver] of Object.entries(STATIC_TAG_RESOLVERS)) {
    next = next.replace(
      new RegExp(`#${tag}`, "gi"),
      resolver(projectInfo, result),
    );
  }
  return next;
}

function applyExpressionBlocks(
  text: string,
  vars: Record<string, number>,
): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (full, rawExpr: string) => {
    const expr = rawExpr.trim();
    if (expr.length === 0) return full;
    try {
      return formatNumber(evaluate(expr, vars));
    } catch {
      return full;
    }
  });
}

function applyParameterHashTags(
  text: string,
  vars: Record<string, number>,
): string {
  return text.replace(/#([a-zA-Z_][a-zA-Z0-9_]*)/g, (full, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      return full;
    }
    return formatNumber(vars[name]);
  });
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

  let out = text;
  out = applyStaticTags(out, projectInfo, result);
  out = applyExpressionBlocks(out, resolved);
  out = applyParameterHashTags(out, resolved);
  out = out.replace(/\\n/g, "\n");

  return out;
}
