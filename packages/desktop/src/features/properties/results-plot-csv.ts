/** The CSV files of the Results plot window ("Export CSV"). */
import { toCsv } from "../export/sliceTable";

/** Four decimals for a CSV cell; empty when not a number. */
function csvNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null;
}

/** CSV of the slice plot: every quantity of the plot's select, one row per slice. */
export function slicePlotCsv<K extends string>(
  points: ReadonlyArray<{ sliceNumber: number; xValue: number } & Record<K, number>>,
  columns: ReadonlyArray<{ key: K; label: string; unit: string }>,
  decimalComma = false,
): string {
  return toCsv(
    [
      ["Slice", "x (m)", ...columns.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label))],
      ...points.map((p) => [p.sliceNumber, csvNumber(p.xValue), ...columns.map((c) => csvNumber(p[c.key]))]),
    ],
    decimalComma,
  );
}

/** CSV of the plot of F against λ: λ, Fm and Ff. */
export function lambdaPlotCsv(
  points: ReadonlyArray<{ lambda: number; momentFos: number; forceFos: number }>,
  decimalComma = false,
): string {
  return toCsv(
    [["λ", "Fm", "Ff"], ...points.map((p) => [csvNumber(p.lambda), csvNumber(p.momentFos), csvNumber(p.forceFos)])],
    decimalComma,
  );
}
