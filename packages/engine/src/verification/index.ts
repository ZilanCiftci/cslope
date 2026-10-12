/**
 * The verification problems and their published values, for the test
 * suite, the verification report and the website's data generator. Kept
 * out of the main entry (src/index.ts) so that the desktop app does not
 * bundle them.
 */
export {
  VERIFICATION_CASES,
  VERIFICATION_OPTIONS,
  runVerification,
  runReliabilityCase,
} from "./cases";
export { RELIABILITY_CASES } from "./reliability-cases";
export type { ReliabilityCaseData, ReliabilityQuantity } from "./reliability-cases";
export { FHWA_PULLOUT_TABLES } from "./pullout-tables";
export type { PulloutTable } from "./pullout-tables";
export type { VerificationCase, VerificationCheck, ReliabilityCheckResult } from "./cases";
