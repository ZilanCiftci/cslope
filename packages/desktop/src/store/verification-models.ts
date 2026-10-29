/**
 * The verification problems as app models, for the Benchmarks button and
 * the website's result images: each runs one of its analyses (by cSlope's
 * name for it, the first by default) with the full search, as the
 * published verification table runs it.
 */

import {
  FULL_VERIFICATION_OPTIONS,
  NON_CIRCULAR_VERIFICATION_OPTIONS,
  VERIFICATION_CASES,
  VERIFICATION_OPTIONS,
  presentedAnalyses,
  type VerificationCase,
} from "@cslope/engine/verification";
import { modelFromDefinition } from "./definition-model";
import type { ModelEntry } from "./types";

/** One verification problem as an app model, run as the analysis named `method`. */
export function verificationModel(c: VerificationCase, method?: string, name = c.title): ModelEntry {
  const analyses = presentedAnalyses(c);
  const a = method ? analyses.find((x) => x.label === method) : analyses[0];
  if (!a) {
    if (method) throw new Error(`No verification problem ${c.id} with the analysis "${method}"`);
    // A problem checked by finite elements only: the app's default analysis.
    return modelFromDefinition(c.definition, {
      id: `verification-${c.id}`,
      name,
      options: { ...VERIFICATION_OPTIONS, ...FULL_VERIFICATION_OPTIONS },
    });
  }
  return modelFromDefinition(c.definition, {
    id: `verification-${c.id}`,
    name,
    options: {
      method: a.method,
      ...VERIFICATION_OPTIONS,
      ...FULL_VERIFICATION_OPTIONS,
      ...(a.options.nonCircularOptimization ? NON_CIRCULAR_VERIFICATION_OPTIONS : {}),
      ...a.options,
    },
  });
}

/** Every verification problem, named by its id and title ("V001 Arai & Tagyo (1985) example 1"). */
export function verificationModels(): ModelEntry[] {
  return VERIFICATION_CASES.map((c) => verificationModel(c, undefined, `${c.id} ${c.title}`));
}
