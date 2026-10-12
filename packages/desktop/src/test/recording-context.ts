/**
 * A recording stand-in for CanvasRenderingContext2D (jsdom has no canvas).
 *
 * Every method call is recorded with its arguments and a snapshot of the
 * drawing state at the time of the call (styles, line dash, save depth and
 * the current transform). Paths are tracked so tests can assert on what was
 * actually stroked or filled, in device (transformed) or user coordinates.
 */

export type Matrix = [number, number, number, number, number, number];

export interface DrawState {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineDash: number[];
  transform: Matrix;
}

export interface RecordedCall {
  name: string;
  args: unknown[];
  state: DrawState;
  depth: number;
}

export type Segment =
  | { op: "moveTo"; x: number; y: number }
  | { op: "lineTo"; x: number; y: number }
  | { op: "arc"; x: number; y: number; r: number }
  | { op: "rect"; x: number; y: number; w: number; h: number }
  | { op: "closePath" };

export interface PaintedPath {
  /** "stroke" or "fill". */
  kind: "stroke" | "fill" | "clip";
  segments: Segment[];
  state: DrawState;
  fillRule?: string;
}

export interface TextCall {
  text: string;
  x: number;
  y: number;
  state: DrawState;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export interface RecordingContext {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCall[];
  paths: PaintedPath[];
  texts: TextCall[];
  /** Calls with the given method name. */
  callsOf(name: string): RecordedCall[];
  /** Stroked paths (optionally only those with the given stroke colour). */
  strokes(color?: string): PaintedPath[];
  /** Filled paths (optionally only those with the given fill colour). */
  fills(color?: string): PaintedPath[];
  /** Text strings drawn with fillText. */
  textStrings(): string[];
  /** First text call matching the string or predicate. */
  findText(match: string | RegExp): TextCall | undefined;
  /** Current save() depth; 0 when balanced. */
  depth(): number;
  /** Clear recorded calls (keeps state). */
  reset(): void;
}

/** Points (moveTo/lineTo/arc centres) of a path. */
export function pathPoints(p: PaintedPath): [number, number][] {
  const pts: [number, number][] = [];
  for (const s of p.segments) {
    if (s.op === "moveTo" || s.op === "lineTo" || s.op === "arc") pts.push([s.x, s.y]);
  }
  return pts;
}

export function createRecordingContext(
  width = 800,
  height = 600,
  options: { measureCharWidth?: number } = {},
): RecordingContext {
  const charW = options.measureCharWidth ?? 6;
  const calls: RecordedCall[] = [];
  const paths: PaintedPath[] = [];
  const texts: TextCall[] = [];
  let current: Segment[] = [];
  let state: DrawState = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    lineCap: "butt",
    lineJoin: "miter",
    lineDash: [],
    transform: [...IDENTITY] as Matrix,
  };
  const stack: DrawState[] = [];

  const snapshot = (): DrawState => ({
    ...state,
    lineDash: [...state.lineDash],
    transform: [...state.transform] as Matrix,
  });

  const record = (name: string, args: unknown[]) => {
    calls.push({ name, args, state: snapshot(), depth: stack.length });
  };

  const methods: Record<string, (...args: never[]) => unknown> = {
    save() {
      record("save", []);
      stack.push(snapshot());
    },
    restore() {
      record("restore", []);
      const prev = stack.pop();
      if (prev) state = prev;
    },
    beginPath() {
      record("beginPath", []);
      current = [];
    },
    closePath() {
      record("closePath", []);
      current.push({ op: "closePath" });
    },
    moveTo(x: number, y: number) {
      record("moveTo", [x, y]);
      current.push({ op: "moveTo", x, y });
    },
    lineTo(x: number, y: number) {
      record("lineTo", [x, y]);
      current.push({ op: "lineTo", x, y });
    },
    arc(x: number, y: number, r: number, ...rest: number[]) {
      record("arc", [x, y, r, ...rest]);
      current.push({ op: "arc", x, y, r });
    },
    ellipse(...args: number[]) {
      record("ellipse", args);
      current.push({ op: "arc", x: args[0], y: args[1], r: args[2] });
    },
    rect(x: number, y: number, w: number, h: number) {
      record("rect", [x, y, w, h]);
      current.push({ op: "rect", x, y, w, h });
    },
    quadraticCurveTo(...args: number[]) {
      record("quadraticCurveTo", args);
      current.push({ op: "lineTo", x: args[2], y: args[3] });
    },
    bezierCurveTo(...args: number[]) {
      record("bezierCurveTo", args);
      current.push({ op: "lineTo", x: args[4], y: args[5] });
    },
    stroke() {
      record("stroke", []);
      paths.push({ kind: "stroke", segments: [...current], state: snapshot() });
    },
    fill(rule?: string) {
      record("fill", rule === undefined ? [] : [rule]);
      paths.push({ kind: "fill", segments: [...current], state: snapshot(), fillRule: rule });
    },
    clip(rule?: string) {
      record("clip", rule === undefined ? [] : [rule]);
      paths.push({ kind: "clip", segments: [...current], state: snapshot(), fillRule: rule });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      record("fillRect", [x, y, w, h]);
      paths.push({ kind: "fill", segments: [{ op: "rect", x, y, w, h }], state: snapshot() });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      record("strokeRect", [x, y, w, h]);
      paths.push({ kind: "stroke", segments: [{ op: "rect", x, y, w, h }], state: snapshot() });
    },
    clearRect(...args: number[]) {
      record("clearRect", args);
    },
    fillText(text: string, x: number, y: number) {
      record("fillText", [text, x, y]);
      texts.push({ text: String(text), x, y, state: snapshot() });
    },
    strokeText(text: string, x: number, y: number) {
      record("strokeText", [text, x, y]);
    },
    measureText(text: string) {
      record("measureText", [text]);
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10);
      return {
        width: String(text).length * charW * (size / 10),
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
      } as TextMetrics;
    },
    setLineDash(dash: number[]) {
      record("setLineDash", [dash]);
      state.lineDash = [...dash];
    },
    getLineDash() {
      return [...state.lineDash];
    },
    translate(x: number, y: number) {
      record("translate", [x, y]);
      state.transform = multiply(state.transform, [1, 0, 0, 1, x, y]);
    },
    scale(x: number, y: number) {
      record("scale", [x, y]);
      state.transform = multiply(state.transform, [x, 0, 0, y, 0, 0]);
    },
    rotate(a: number) {
      record("rotate", [a]);
      const c = Math.cos(a);
      const s = Math.sin(a);
      state.transform = multiply(state.transform, [c, s, -s, c, 0, 0]);
    },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      record("transform", [a, b, c, d, e, f]);
      state.transform = multiply(state.transform, [a, b, c, d, e, f]);
    },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      record("setTransform", [a, b, c, d, e, f]);
      state.transform = [a, b, c, d, e, f];
    },
    resetTransform() {
      record("resetTransform", []);
      state.transform = [...IDENTITY] as Matrix;
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createPattern() {
      return null;
    },
    drawImage(...args: unknown[]) {
      record("drawImage", args);
    },
  };

  const target: Record<string | symbol, unknown> = {
    canvas: { width, height },
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalCompositeOperation: "source-over",
    ...methods,
  };
  const stateKeys = new Set([
    "fillStyle",
    "strokeStyle",
    "lineWidth",
    "globalAlpha",
    "font",
    "textAlign",
    "textBaseline",
    "lineCap",
    "lineJoin",
  ]);

  const ctx = new Proxy(target, {
    get(t, k) {
      if (typeof k === "string" && stateKeys.has(k)) return state[k as keyof DrawState];
      if (k in t) return t[k];
      // Unknown methods are recorded no-ops so new drawing code does not crash.
      return (...args: unknown[]) => record(String(k), args);
    },
    set(t, k, v) {
      if (typeof k === "string" && stateKeys.has(k)) {
        (state as unknown as Record<string, unknown>)[k] = v;
      } else {
        t[k] = v;
      }
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  const norm = (c: string) => c.toLowerCase();

  return {
    ctx,
    calls,
    paths,
    texts,
    callsOf: (name) => calls.filter((c) => c.name === name),
    strokes: (color) =>
      paths.filter(
        (p) => p.kind === "stroke" && (color === undefined || norm(p.state.strokeStyle) === norm(color)),
      ),
    fills: (color) =>
      paths.filter(
        (p) => p.kind === "fill" && (color === undefined || norm(p.state.fillStyle) === norm(color)),
      ),
    textStrings: () => texts.map((t) => t.text),
    findText: (match) =>
      texts.find((t) => (typeof match === "string" ? t.text === match : match.test(t.text))),
    depth: () => stack.length,
    reset: () => {
      calls.length = 0;
      paths.length = 0;
      texts.length = 0;
    },
  };
}
