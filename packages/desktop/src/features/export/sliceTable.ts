import type { AnalysisResult, PartialFactors } from "@cslope/engine";
import type { XlsxCell } from "../../utils/xlsx";
import { sliceShearStrength } from "../annotations/slicePlotData";

export interface SliceTableMeta {
  modelName: string;
  /** Export date, written in the header block. */
  date?: string;
  /**
   * Partial factors of the run. The slices then carry design values:
   * strengths divided and surface loads multiplied by the factors.
   */
  partialFactors?: PartialFactors | null;
}

const HEADERS = [
  "Slice",
  "x left (m)",
  "x right (m)",
  "x mid (m)",
  "Width (m)",
  "y top (m)",
  "y base (m)",
  "Height (m)",
  "Area (m²)",
  "Base angle α (°, + dipping in the sliding direction)",
  "Base length (m)",
  "Weight (kN/m)",
  "Surface load (kN/m)",
  "Base material",
  "Cohesion c (kPa)",
  "Friction angle φ (°)",
  "Pore pressure u (kPa)",
  "Effective normal force N' (kN/m)",
  "Shear strength c·l + N'·tan φ (kN/m)",
];

/**
 * Slice data of the critical surface as a table (header block, blank
 * row, column headers, one row per slice), for CSV and Excel export.
 */
export function buildSliceTable(
  result: AnalysisResult,
  meta: SliceTableMeta,
): XlsxCell[][] {
  const cs = result.criticalSurface;
  const pf = meta.partialFactors ?? null;
  const rows: XlsxCell[][] = [
    ["Model", meta.modelName],
    ["Method", result.method],
    [pf ? "Over-design factor (design values)" : "Minimum FOS", round(result.minFOS, 4)],
  ];
  if (pf) {
    rows.push(
      ["Values", "design values: strengths divided, surface loads multiplied by the partial factors"],
      ["γcu", pf.cu],
      ["γc'", pf.cohesion],
      ["γφ' (on tan φ')", pf.tanPhi],
      ["γQ", pf.variableLoad],
    );
  } else {
    rows.push(["Values", "characteristic (no partial factors)"]);
  }
  if (cs) {
    if (cs.points) {
      rows.push(["Critical surface", `non-circular, ${cs.points.length} points`]);
    } else {
      rows.push(["Critical surface", "circle"], ["Centre x (m)", round(cs.cx, 4)], ["Centre y (m)", round(cs.cy, 4)], ["Radius (m)", round(cs.radius, 4)]);
    }
    rows.push(
      ["Entry x (m)", round(cs.entryPoint[0], 4)],
      ["Exit x (m)", round(cs.exitPoint[0], 4)],
    );
  }
  if (meta.date) rows.push(["Exported", meta.date]);
  rows.push([], pf ? HEADERS.map(designHeader) : HEADERS);
  // Slices are numbered from the entry (crest) to the exit (toe).
  result.criticalSlices.forEach((s, i) => {
    const phi = s.frictionAngle;
    const strength = sliceShearStrength(s);
    rows.push([
      i + 1,
      round(s.xLeft, 4),
      round(s.xRight, 4),
      round(s.x, 4),
      round(s.width, 4),
      round(s.yTop, 4),
      round(s.yBottom, 4),
      round(s.height, 4),
      round(s.area, 4),
      round((s.alpha * 180) / Math.PI, 3),
      round(s.baseLength, 4),
      round(s.weight, 3),
      round(s.surfaceLoad ?? 0, 3),
      s.baseMaterial?.name ?? "",
      round(s.cohesion, 3),
      round(phi, 3),
      round(s.porePressure, 3),
      round(s.normalForce, 3),
      round(strength, 3),
    ]);
  });
  return rows;
}

/** Column header of a value that is a design value under partial factors. */
function designHeader(h: string): string {
  if (h.startsWith("Surface load")) return "Surface load, design (kN/m)";
  if (h.startsWith("Cohesion c")) return "Design cohesion c_d (kPa)";
  if (h.startsWith("Friction angle")) return "Design friction angle φ_d (°)";
  if (h.startsWith("Shear strength")) return "Design shear strength c_d·l + N'·tan φ_d (kN/m)";
  return h;
}

function round(v: number, digits: number): number | null {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * CSV text. With `decimalComma` the decimal separator is a comma and the
 * field separator a semicolon (what Excel expects with Swedish settings).
 */
export function toCsv(rows: XlsxCell[][], decimalComma = false): string {
  const sep = decimalComma ? ";" : ",";
  const cell = (v: XlsxCell): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") {
      const s = String(v);
      return decimalComma ? s.replace(".", ",") : s;
    }
    // Text a spreadsheet would run as a formula is quoted as text.
    if (/^[=+\-@\t\r]/.test(v)) return `"'${v.replace(/"/g, '""')}"`;
    return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return rows.map((r) => r.map(cell).join(sep)).join("\r\n") + "\r\n";
}
