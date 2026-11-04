/** Characters of a plain decimal number, "," or "." as the separator. */
const DECIMAL = /^[+-]?(\d+[.,]?\d*|[.,]\d+)([eE][+-]?\d+)?$/;

/**
 * The number a user typed, with "," or "." as the decimal separator; NaN
 * for anything else (partial input such as "-" or "", text).
 */
export function parseDecimalText(text: string): number {
  const t = text.trim();
  return DECIMAL.test(t) ? Number(t.replace(",", ".")) : NaN;
}
