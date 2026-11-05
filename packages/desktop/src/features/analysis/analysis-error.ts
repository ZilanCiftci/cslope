/** True for the error of a run that found no valid slip surface. */
export function isNoSlipSurfaceError(message: string | null | undefined): boolean {
  return /no valid slip surface/i.test(message ?? "");
}

/**
 * The sliding direction the search limits are drawn for, when it is not the
 * model's: the entry range (the crest) lies wholly on the toe side of the
 * exit range. Such limits find no surface. Null when they agree, or when
 * the limits are off or overlap (no direction to tell).
 */
export function limitsDirectionMismatch(
  limits: { enabled: boolean; entryLeftX: number; entryRightX: number; exitLeftX: number; exitRightX: number },
  orientation: "ltr" | "rtl",
): "ltr" | "rtl" | null {
  if (!limits.enabled) return null;
  const entryMin = Math.min(limits.entryLeftX, limits.entryRightX);
  const entryMax = Math.max(limits.entryLeftX, limits.entryRightX);
  const exitMin = Math.min(limits.exitLeftX, limits.exitRightX);
  const exitMax = Math.max(limits.exitLeftX, limits.exitRightX);
  if (orientation === "rtl" && entryMax <= exitMin) return "ltr";
  if (orientation === "ltr" && entryMin >= exitMax) return "rtl";
  return null;
}

/** The warning for `limitsDirectionMismatch`, in a sentence. */
export function limitsDirectionMessage(drawnFor: "ltr" | "rtl"): string {
  return drawnFor === "ltr"
    ? "The entry range lies left of the exit range, but the sliding direction is right to left."
    : "The entry range lies right of the exit range, but the sliding direction is left to right.";
}
