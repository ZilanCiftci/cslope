/**
 * JSON with one serialization for one value: the keys of every object
 * sorted, 2-space indentation, LF line ends, numbers as JSON.stringify
 * gives them (undefined members left out, NaN and the infinities null, as
 * JSON.stringify does). A project saved twice is byte-identical, and two
 * saves can be compared line by line.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortKeys, 2) + "\n";
}

/** JSON.stringify replacer: a plain object with its keys in sorted order. */
function sortKeys(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const o = value as Record<string, unknown>;
  // (JSON.stringify calls toJSON before the replacer; here only plain data)
  return Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
}
