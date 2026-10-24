/** True for the error of a run that found no valid slip surface. */
export function isNoSlipSurfaceError(message: string | null | undefined): boolean {
  return /no valid slip surface/i.test(message ?? "");
}
