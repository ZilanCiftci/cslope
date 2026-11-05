import type { ShansepModel } from "@cslope/engine";

/**
 * The stress history that replaces OCR (as in the engine: the earlier
 * stage, then POP, then the yield stress), in words, or null for none.
 */
export function ocrOverrideText(model: ShansepModel): string | null {
  const fmt = (v: number) => String(Number(v.toFixed(4)));
  if (model.yieldFromEarlierStage) {
    return `Overridden by the yield stress from the earlier stage${model.pop ? ` + POP ${fmt(model.pop)} kPa` : ""}`;
  }
  if (model.pop !== undefined) return `Overridden by POP ${fmt(model.pop)} kPa`;
  if (model.yieldStress !== undefined) return `Overridden by the yield stress σ′y ${fmt(model.yieldStress)} kPa`;
  return null;
}
