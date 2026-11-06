/** The decimal separator of an exported CSV file, remembered between exports. */
export type CsvDecimal = "point" | "comma";

/** Setting (localStorage): the decimal separator chosen last. */
export const CSV_DECIMAL_KEY = "cslope-csv-decimal";

/** The separator chosen last (decimal point when none was or storage is off). */
export function readCsvDecimal(): CsvDecimal {
  try {
    return globalThis.localStorage?.getItem(CSV_DECIMAL_KEY) === "comma" ? "comma" : "point";
  } catch {
    return "point";
  }
}

/** Remember the separator for the next export, in every window. */
export function rememberCsvDecimal(value: CsvDecimal): void {
  try {
    globalThis.localStorage?.setItem(CSV_DECIMAL_KEY, value);
  } catch {
    // (not remembered; the export itself still works)
  }
}
