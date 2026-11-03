import type { ModelWaternet } from "../../store/types";

/** The notice for an imported waternet (head and reference lines). */
export function waternetNoticeText(waternet: ModelWaternet): string {
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
  return `Pore pressure from imported head and reference lines (${count(waternet.headLines.length, "head line")}, ${count(waternet.referenceLines.length, "reference line")}); the piezometric lines below do not set it.`;
}

/** The notice for an imported earlier construction stage. */
export const EARLIER_STAGE_NOTICE =
  "Earlier stage imported: its effective stresses set the yield stress of the materials marked so.";
