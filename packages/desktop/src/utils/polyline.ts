/** Text form of polyline points ("x, y; x, y; …"). */

/** Parse "x,y; x,y; …"; null when any pair is not two numbers. */
export function parsePolyline(text: string): [number, number][] | null {
  const pairs = text
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const out: [number, number][] = [];
  for (const pair of pairs) {
    const parts = pair.split(",").map((v) => v.trim());
    if (parts.length !== 2) return null;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (parts.some((v) => v === "") || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    out.push([x, y]);
  }
  return out;
}

export function formatPolyline(points: [number, number][]): string {
  return points.map(([x, y]) => `${x}, ${y}`).join("; ");
}
