// Differential fixtures for model/geometry-ops.ts (the jsts replacement):
// inputs and outputs of every public function on the geometry of every
// verification problem, on the unit-test inputs and on randomized stress
// cases (polylines crossing a polygon, near-coincident vertices within the
// snap tolerance, collinear overlaps, T-junctions, lenses).
//
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts geometry
//
// (Node/V8, as the app runs.) The importer fuzz corpus is exported
// by geometry-corpus.fixture.ts (the same command runs both).
//
// Writes fixtures/geometry/<name>.json. Each polygonize/split case also
// records how often jsts fell back to its snapping overlay (SnapOverlayOp)
// and that succeeded; the Rust port does not reproduce it (see PORTING.md,
// Decisions), so such a case is reported, not compared.
import SnapOverlayOp from "../../../engine/node_modules/jsts/org/locationtech/jts/operation/overlay/snap/SnapOverlayOp.js";
import GeometryFactory from "../../../engine/node_modules/jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Coordinate from "../../../engine/node_modules/jsts/org/locationtech/jts/geom/Coordinate.js";
import Polygonizer from "../../../engine/node_modules/jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "../../../engine/node_modules/jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import GeometryNoder from "../../../engine/node_modules/jsts/org/locationtech/jts/noding/snapround/GeometryNoder.js";
import PrecisionModel from "../../../engine/node_modules/jsts/org/locationtech/jts/geom/PrecisionModel.js";
import ArrayList from "../../../engine/node_modules/jsts/java/util/ArrayList.js";
import {
  clipLineToSurface,
  createGeometryWithMaterial,
  getSurfaceLine,
  keyholeRing,
  lineSegmentIntersection,
  materialLayerTopAt,
  polygonizeRegionsDetailed,
  polylineYAtSide,
  polylineYAtX,
  polylineYFrom,
  splitPolygonByPolylineDetailed,
} from "../../../engine/src/model/geometry-ops";
import { buildSlope } from "../../../engine/src/model/build-slope";
import { toCanonicalSlopeDefinition } from "../../../engine/src/model/canonical";
import { rng } from "../../../engine/src/model/property-helpers";
import { PROBLEMS } from "../../../engine/src/verification/problems";
import { Material } from "../../../engine/src/types/material";
import type { GeometryWithMaterial } from "../../../engine/src/types/geometry";
import { writeFixture } from "./write";

it("exports the geometry fixtures", () => {
  type Pt = [number, number];

  // Count the snapping-overlay fallbacks of jsts.
  let snapOverlays = 0;
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = SnapOverlayOp as any;
    const orig = S.overlayOp;
    S.overlayOp = (...args: unknown[]) => {
      const result = orig.apply(S, args);
      snapOverlays++; // counted only when the snapping overlay succeeds
      return result;
    };
  }
  // Quiet the engine's diagnostics (split failures are recorded in the output).
  console.warn = () => {};

  const r = rng(20261103);
  const uni = (a: number, b: number) => a + (b - a) * r();
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];

  function attempt<T>(f: () => T): { output: T } | { error: string } {
    try {
      return { output: f() };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Inputs from the verification problems ────────────────────────
  interface ProblemGeometry {
    id: string;
    px: number[];
    py: number[];
    lines: Pt[][];
    water: Pt[][];
    surfX: number[];
    surfY: number[];
    geometries: readonly GeometryWithMaterial[];
    materials: Material[];
  }
  const problems: ProblemGeometry[] = [];
  for (const p of PROBLEMS) {
    const canon = toCanonicalSlopeDefinition(p.definition);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let slope: any;
    try {
      slope = buildSlope(canon);
    } catch {
      continue;
    }
    const water: Pt[][] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wt = (canon as any).waterTable;
    if (wt && Array.isArray(wt.value) && wt.value.length >= 2) water.push(wt.value as Pt[]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const w of ((canon as any).waterTables ?? []) as { coordinates?: Pt[] }[]) {
      if (w.coordinates && w.coordinates.length >= 2) water.push(w.coordinates);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const pz of ((canon as any).piezometricLines ?? []) as { coordinates?: Pt[] }[]) {
      if (pz.coordinates && pz.coordinates.length >= 2) water.push(pz.coordinates);
    }
    const geometries = slope.materialGeometries as readonly GeometryWithMaterial[];
    const materials: Material[] = [];
    for (const g of geometries) if (!materials.includes(g.material)) materials.push(g.material);
    problems.push({
      id: p.id,
      px: [...slope._externalBoundaryPx],
      py: [...slope._externalBoundaryPy],
      lines: (canon.materialBoundaries ?? []).map((b) => b.coordinates as Pt[]),
      water,
      surfX: [...slope._surfaceLineX],
      surfY: [...slope._surfaceLineY],
      geometries,
      materials,
    });
  }

  // ── lineSegmentIntersection ──────────────────────────────────────
  {
    const inputs: number[][] = [
      [0, 0, 10, 10, 0, 10, 10, 0],
      [0, 0, 10, 0, 0, 5, 10, 5],
      [0, 0, 1, 0, 5, 5, 10, 5],
      [0, 0, 5, 0, 5, 0, 5, 5],
      [0, 0, 2, 2, 0, 2, 2, 0],
      [0, 0, 1, 0, 1, 0, 1, 1],
      [0, 0, 1, 0, 0, 1, 1, 1],
      [0, 0, 1, 0, 2, -1, 2, 1],
      [0, 0, 1, 0, 1 + 5e-10, -1, 1 + 5e-10, 1],
      [0, 0, 1, 1e-13, 0, 1, 1, 1],
    ];
    for (const pg of problems) {
      const segs: number[][] = [];
      const add = (pts: Pt[]) => {
        for (let i = 0; i + 1 < pts.length; i++) segs.push([...pts[i], ...pts[i + 1]]);
      };
      add(pg.px.map((x, i) => [x, pg.py[i]] as Pt));
      for (const l of pg.lines) add(l);
      for (const w of pg.water) add(w);
      for (let k = 0; k < 20 && segs.length > 1; k++) inputs.push([...pick(segs), ...pick(segs)]);
    }
    for (let k = 0; k < 300; k++) inputs.push(Array.from({ length: 8 }, () => Math.round(uni(-10, 10) * 4) / 4));
    for (let k = 0; k < 300; k++) inputs.push(Array.from({ length: 8 }, () => uni(-10, 10)));
    writeFixture(
      "geometry",
      "segment_intersection",
      inputs.map((input) => ({
        input,
        output: lineSegmentIntersection(...(input as [number, number, number, number, number, number, number, number])),
      })),
    );
  }

  // ── polylineYAtX / polylineYAtSide / polylineYFrom ───────────────
  {
    const lines: { x: number[]; y: number[] }[] = [
      { x: [0, 10], y: [0, 10] },
      { x: [10, 0], y: [10, 0] },
      { x: [0, 5, 5, 10], y: [0, 0, 4, 4] },
      { x: [0, 5, 5, 10], y: [0, 2, 4, 4] },
      { x: [5, 5], y: [0, 4] },
    ];
    for (const pg of problems) {
      lines.push({ x: pg.surfX, y: pg.surfY });
      for (const w of pg.water) lines.push({ x: w.map((p) => p[0]), y: w.map((p) => p[1]) });
    }
    const cases: unknown[] = [];
    for (const l of lines) {
      const lo = Math.min(...l.x);
      const hi = Math.max(...l.x);
      const xs = [...l.x, lo - 1, hi + 1, lo - 1e-10, hi + 1e-10];
      for (let k = 0; k < 8; k++) xs.push(uni(lo, hi));
      for (const x of xs) {
        const atX = polylineYAtX(l.x, l.y, x);
        cases.push({
          x: l.x,
          y: l.y,
          at: x,
          atX: atX === undefined ? null : atX,
          left: polylineYAtSide(l.x, l.y, x, "left"),
          right: polylineYAtSide(l.x, l.y, x, "right"),
          fromLeft: polylineYFrom(l.x, l.y, x, "left"),
          fromRight: polylineYFrom(l.x, l.y, x, "right"),
        });
      }
    }
    writeFixture("geometry", "polyline_y", cases);
  }

  // ── getSurfaceLine ───────────────────────────────────────────────
  const randomPolygon = (n: number, rad: number): Pt[] => {
    const ang = Array.from({ length: n }, () => r() * 2 * Math.PI).sort((a, b) => a - b);
    return ang.map((a) => [rad * Math.cos(a), rad * Math.sin(a)] as Pt);
  };
  {
    const polys: { px: number[]; py: number[] }[] = [
      { px: [0, 10, 10, 0, 0], py: [0, 0, -10, -10, 0] },
      { px: [0, 5, 25, 30, 30, 0, 0], py: [0, 0, -10, -10, -15, -15, 0] },
      { px: [0, 20, 40, 50, 50, 0, 0], py: [0, 0, -10, -10, -15, -15, 0] },
      { px: [0, 10, 5, 0], py: [0, 0, -8, 0] },
      { px: [0, 1], py: [0, 1] },
      { px: [0, 0, 5, 5, 10, 10, 0], py: [-5, 4, 4, 0, 0, -5, -5] },
      { px: [0, 10, 10, 5, 5, 0], py: [-5, -5, 0, 0, 4, 4] },
    ];
    for (const pg of problems) polys.push({ px: pg.px, py: pg.py });
    for (let k = 0; k < 60; k++) {
      const p = randomPolygon(3 + Math.floor(r() * 8), uni(1, 30));
      polys.push({ px: p.map((q) => q[0]), py: p.map((q) => q[1]) });
    }
    writeFixture(
      "geometry",
      "surface_line",
      polys.map((p) => ({ ...p, ...attempt(() => getSurfaceLine(p.px, p.py)) })),
    );
  }

  // ── clipLineToSurface ────────────────────────────────────────────
  {
    const cases: { wx: number[]; wy: number[]; sx: number[]; sy: number[] }[] = [
      { wx: [0], wy: [1], sx: [0, 1], sy: [0, 0] },
      { wx: [20, 30], wy: [1, 1], sx: [0, 10], sy: [0, 0] },
      { wx: [0, 10], wy: [2, 2], sx: [0, 5, 5, 10], sy: [4, 4, 0, 0] },
      { wx: [0, 10], wy: [3, 3], sx: [0, 10], sy: [6, 0] },
      { wx: [0, 50], wy: [-5, -5], sx: [0, 20, 40, 50], sy: [0, 0, -10, -10] },
      { wx: [0, 20], wy: [5, 5], sx: [0, 10, 10, 20], sy: [10, 10, 0, 0] },
      { wx: [60, 70], wy: [0, 0], sx: [0, 50], sy: [0, 0] },
    ];
    for (const pg of problems) {
      for (const w of pg.water) {
        const wx = w.map((p) => p[0]);
        const wy = w.map((p) => p[1]);
        cases.push({ wx, wy, sx: pg.surfX, sy: pg.surfY });
        // raised and lowered copies cross the ground
        for (const dy of [-3, 2, 6]) cases.push({ wx, wy: wy.map((y) => y + dy), sx: pg.surfX, sy: pg.surfY });
      }
      const lo = Math.min(...pg.surfX);
      const hi = Math.max(...pg.surfX);
      const ys = pg.surfY;
      const ymin = Math.min(...ys);
      const ymax = Math.max(...ys);
      for (let k = 0; k < 3; k++) {
        const n = 2 + Math.floor(r() * 6);
        const wx = Array.from({ length: n }, (_, i) => lo - 2 + ((hi - lo + 4) * i) / (n - 1));
        const wy = wx.map(() => uni(ymin - 2, ymax + 2));
        cases.push({ wx, wy, sx: pg.surfX, sy: pg.surfY });
      }
    }
    writeFixture(
      "geometry",
      "clip_line",
      cases.map((c) => ({ ...c, output: clipLineToSurface(c.wx, c.wy, c.sx, c.sy) })),
    );
  }

  // ── splitPolygonByPolylineDetailed ───────────────────────────────
  {
    const BOX: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const xs = (pts: Pt[]) => pts.map((p) => p[0]);
    const ys = (pts: Pt[]) => pts.map((p) => p[1]);
    const lens: Pt[] = [[3, 3], [7, 3], [7, 6], [3, 6], [3, 3]];
    const cases: { name: string; px: number[]; py: number[]; lx: number[]; ly: number[] }[] = [
      { name: "rect", px: [0, 10, 10, 0, 0], py: [0, 0, -10, -10, 0], lx: [0, 10], ly: [-5, -5] },
      { name: "slope", px: [0, 20, 40, 50, 50, 0, 0], py: [0, 0, -10, -10, -15, -15, 0], lx: [0, 50], ly: [-5, -5] },
      { name: "miss", px: [0, 10, 10, 0, 0], py: [0, 0, -10, -10, 0], lx: [0, 10], ly: [5, 5] },
      { name: "layers", px: [0, 10, 10, 0, 0], py: [0, 0, -15, -15, 0], lx: [0, 10], ly: [-5, -5] },
      { name: "outside", px: xs(BOX), py: ys(BOX), lx: [20, 30], ly: [0, 0] },
      { name: "point", px: xs(BOX), py: ys(BOX), lx: [5], ly: [5] },
      { name: "along", px: [0, 10, 10, 0], py: [0, 0, 10, 10], lx: [0, 10], ly: [0, 0] },
      { name: "open", px: [0, 10, 10, 0], py: [0, 0, 10, 10], lx: [-1, 11], ly: [4, 6] },
      { name: "lens", px: xs(BOX), py: ys(BOX), lx: xs(lens), ly: ys(lens) },
      { name: "vertex", px: xs(BOX), py: ys(BOX), lx: [-1, 11], ly: [-1, 11] },
      { name: "touch", px: xs(BOX), py: ys(BOX), lx: [5, 5, 12], ly: [-3, 0, 0] },
      { name: "zigzag", px: xs(BOX), py: ys(BOX), lx: [-1, 3, 5, 7, 11], ly: [5, 9, 1, 9, 5] },
      { name: "tooFew", px: [0, 1], py: [0, 1], lx: [0, 1], ly: [0, 1] },
      { name: "one vertex", px: [1], py: [1], lx: [0, 10], ly: [5, 5] },
      { name: "two vertices", px: [1, 2], py: [1, 1], lx: [0, 10], ly: [5, 5] },
      // Cutting lines of one distinct point: jsts's relate drops them, so
      // they meet a polygon only at its first vertex (its graph's only
      // node), and a rectangle (RectangleIntersects) anywhere on it.
      { name: "point at first vertex", px: [0, 10, 5], py: [0, 0, 8], lx: [0, 0], ly: [0, 0] },
      { name: "point at other vertex", px: [0, 10, 5], py: [0, 0, 8], lx: [10, 10], ly: [0, 0] },
      { name: "point on edge", px: [0, 10, 5], py: [0, 0, 8], lx: [5, 5], ly: [0, 0] },
      { name: "point inside", px: [0, 10, 5], py: [0, 0, 8], lx: [5, 5, 5], ly: [3, 3, 3] },
      { name: "point outside", px: [0, 10, 5], py: [0, 0, 8], lx: [20, 20], ly: [1, 1] },
      { name: "rectangle point inside", px: xs(BOX), py: ys(BOX), lx: [5, 5], ly: [5, 5] },
      { name: "rectangle point on edge", px: xs(BOX), py: ys(BOX), lx: [10, 10], ly: [5, 5] },
      { name: "rectangle point on corner", px: xs(BOX), py: ys(BOX), lx: [10, 10], ly: [10, 10] },
      { name: "rectangle point at first", px: xs(BOX), py: ys(BOX), lx: [0, 0], ly: [0, 0] },
      { name: "six-point square, point inside", px: [0, 10, 10, 10, 0, 0], py: [0, 0, 0, 10, 10, 0], lx: [5, 5], ly: [5, 5] },
      { name: "six-point square, point at first", px: [0, 10, 10, 10, 0, 0], py: [0, 0, 0, 10, 10, 0], lx: [0, 0], ly: [0, 0] },
      // Self-crossing and self-touching outlines (invalid polygons): the
      // relate computation fails at some ("side location conflict").
      { name: "bowtie through crossing", px: [0, 10, 10, 0], py: [0, 10, 0, 10], lx: [-1, 11], ly: [5, 5] },
      { name: "bowtie vertical", px: [0, 10, 10, 0], py: [0, 10, 0, 10], lx: [2, 2], ly: [-1, 11] },
      { name: "bowtie diagonal", px: [0, 10, 10, 0], py: [0, 10, 0, 10], lx: [0, 10], ly: [0, 10] },
      { name: "loop", px: [0, 10, 10, 4, 4, 6, 6, 0], py: [0, 0, 10, 10, -3, -3, 5, 5], lx: [5, 5], ly: [-5, 12] },
      { name: "spike", px: [6, 6, 1, 9, 9], py: [6, 9, 6, 6, 6], lx: [6, 6], ly: [6, 9] },
      { name: "touching", px: [0, 4, 8, 4, 0, 4], py: [0, 4, 0, 8, 4, 4], lx: [4, 4], ly: [-1, 9] },
      // x and y arrays of different lengths (a missing value is undefined,
      // NaN in Rust; these cases agree)
      { name: "short py", px: [0, 10, 10, 0], py: [0, 0, 10], lx: [-1, 11], ly: [5, 5] },
      { name: "short py closed", px: [0, 10, 10, 0, 0], py: [0, 0, 10, 10], lx: [-1, 11], ly: [5, 5] },
      { name: "long py", px: [0, 10, 10, 0], py: [0, 0, 10, 10, 3], lx: [-1, 11], ly: [5, 5] },
      { name: "short ly", px: [0, 10, 10, 0], py: [0, 0, 10, 10], lx: [-1, 11, 12], ly: [5, 5] },
      { name: "long ly", px: [0, 10, 10, 0], py: [0, 0, 10, 10], lx: [-1, 11], ly: [5, 5, 7] },
      { name: "empty px", px: [], py: [0, 0, 10, 10], lx: [-1, 11], ly: [5, 5] },
      { name: "NaN vertex", px: [0, 10, NaN, 0], py: [0, 0, 10, 10], lx: [-1, 11], ly: [5, 5] },
    ];
    // Problem outlines split by each boundary, as setMaterialBoundary does
    // (successively, every piece by the next line).
    const sequential: unknown[] = [];
    for (const pg of problems) {
      for (const [k, l] of pg.lines.entries()) {
        if (l.length < 2) continue;
        cases.push({ name: `${pg.id} line ${k}`, px: pg.px, py: pg.py, lx: xs(l), ly: ys(l) });
      }
      if (pg.lines.length > 1) {
        let pieces = [{ px: pg.px, py: pg.py }];
        for (const l of pg.lines) {
          if (l.length < 2) continue;
          const next: { px: number[]; py: number[] }[] = [];
          for (const piece of pieces) {
            cases.push({ name: `${pg.id} sequential`, px: piece.px, py: piece.py, lx: xs(l), ly: ys(l) });
            next.push(...splitPolygonByPolylineDetailed(piece.px, piece.py, xs(l), ys(l)).pieces);
          }
          pieces = next;
        }
        sequential.push(pieces.length);
      }
    }
    // The property test of geometry-props: random polylines across random
    // convex polygons, and stress cases.
    for (let i = 0; i < 80; i++) {
      const n = 3 + Math.floor(r() * 6);
      const rad = uni(5, 20);
      const poly = randomPolygon(n, rad);
      const k = 2 + Math.floor(r() * 3);
      const lx = Array.from({ length: k }, (_, j) => -30 + (60 * j) / (k - 1));
      const ly = lx.map(() => uni(-rad, rad));
      cases.push({ name: `random ${i}`, px: xs(poly), py: ys(poly), lx, ly });
    }
    for (let i = 0; i < 40; i++) {
      // through vertices of the polygon, along edges, near-coincident
      const poly = randomPolygon(4 + Math.floor(r() * 4), uni(3, 10));
      const a = pick(poly);
      const b = pick(poly);
      const eps = pick([0, 1e-12, 1e-9, 1e-7]);
      cases.push({
        name: `vertices ${i}`,
        px: xs(poly),
        py: ys(poly),
        lx: [a[0] * 1.5, a[0] + eps, b[0] - eps, b[0] * 1.5],
        ly: [a[1] * 1.5, a[1], b[1], b[1] * 1.5],
      });
    }
    for (let i = 0; i < 300; i++) {
      // small integer grids: self-crossing and self-touching outlines,
      // repeated vertices, lines through vertices, lines of one point
      const g = pick([4, 6, 10]);
      const off = pick([0, 0, 1e6, 6.5e6 + 0.125]);
      const gp = (): Pt => [Math.floor(r() * (g + 1)) + off, Math.floor(r() * (g + 1)) + off];
      const poly: Pt[] = Array.from({ length: 3 + Math.floor(r() * 5) }, gp);
      if (r() < 0.2) {
        const k = Math.floor(r() * poly.length);
        poly.splice(k, 0, poly[k]);
      }
      let line: Pt[] = Array.from({ length: 2 + Math.floor(r() * 3) }, gp);
      const kind = r();
      if (kind < 0.25) line = line.map(() => line[0]);
      else if (kind < 0.35) line = [poly[0], poly[1]];
      else if (kind < 0.4) line = line.map(() => poly[0]);
      cases.push({ name: `grid ${i}`, px: xs(poly), py: ys(poly), lx: xs(line), ly: ys(line) });
    }
    writeFixture(
      "geometry",
      "split_polygon",
      cases.map((c) => {
        snapOverlays = 0;
        const res = attempt(() => splitPolygonByPolylineDetailed(c.px, c.py, c.lx, c.ly));
        return { ...c, ...res, snapOverlays };
      }),
    );
  }

  // ── keyholeRing ──────────────────────────────────────────────────
  const keyholeCases: { outer: Pt[]; holes: Pt[][] }[] = [];
  {
    const BOX: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole: Pt[] = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    keyholeCases.push({ outer: BOX, holes: [hole] });
    keyholeCases.push({ outer: BOX, holes: [[...hole].reverse()] });
    keyholeCases.push({ outer: BOX, holes: [[[1, 1], [2, 2]]] });
    keyholeCases.push({ outer: BOX.slice(0, -1), holes: [hole.slice(0, -1)] });
    keyholeCases.push({
      outer: BOX,
      holes: [
        [[1, 1], [3, 1], [3, 3], [1, 3]],
        [[6, 6], [9, 6], [9, 9], [6, 9]],
      ],
    });
    keyholeCases.push({ outer: BOX, holes: [] });
  }

  // ── polygonizeRegionsDetailed ────────────────────────────────────
  {
    const cases: { name: string; px: number[]; py: number[]; lines: Pt[][] }[] = [];
    const ringOf = (pts: Pt[]) => ({ px: pts.map((p) => p[0]), py: pts.map((p) => p[1]) });
    const add = (name: string, ring: Pt[], lines: Pt[][]) => cases.push({ name, ...ringOf(ring), lines });
    for (const pg of problems) {
      if (pg.lines.length > 0) cases.push({ name: pg.id, px: pg.px, py: pg.py, lines: pg.lines });
    }
    // geometry-props.test.ts
    cases.push({ name: "too few", px: [0, 1], py: [0, 1], lines: [] });
    add("no usable", [[0, 0], [10, 0], [10, 10], [0, 10]], [[[1, 1]]]);
    add("outside", [[0, 0], [10, 0], [10, 10], [0, 10]], [[[20, 0], [30, 5]]]);
    const slope: Pt[] = [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]];
    for (let i = 0; i < 40; i++) {
      const lines: Pt[][] = [];
      const nLayers = 1 + Math.floor(r() * 3);
      for (let k = 0; k < nLayers; k++) {
        const y0 = uni(-9, 8);
        lines.push([[-1, y0], [20, y0 + uni(-3, 3)], [41, y0 + uni(-4, 2)]]);
      }
      if (r() < 0.6) {
        const cx = uni(5, 35);
        const cy = uni(-8, -3);
        const w = uni(1, 4);
        const h = uni(0.5, 1.5);
        lines.push([[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h], [cx - w, cy - h]]);
      }
      add(`layers ${i}`, slope, lines);
    }
    // review-round4.test.ts
    add("on face", [[0, -10], [0, 10], [10, 10], [20, 2], [21, 0], [40, 0], [40, -10]], [
      [[0, 5], [17.142857142857142, 4.285714285714286], [40, -3]],
    ]);
    add("on face nudged", [[0, -10], [0, 10], [10, 10], [20, 2], [21, 0], [40, 0], [40, -10]], [
      [[0, 5], [17.142857142857142, 4.285714285714286 - 1e-6], [40, -3]],
    ]);
    for (const dx of [0, 0.5, 220]) {
      const ring: Pt[] = [[-220, -15], [-220, 19], [-210, 19], [-189, 7], [-184.66515835176665, 6.868245269066714], [-177.86896225530654, 0], [-164, 0], [-164, -15]];
      const line: Pt[] = [[-220, 7], [-202, 9], [-182.9971442414437, 5.1825478790327], [-174, 0]];
      add(`shifted ${dx}`, ring.map(([x, y]) => [x + dx, y] as Pt), [line.map(([x, y]) => [x + dx, y] as Pt)]);
    }
    const ring40: Pt[] = [[0, -10], [0, 10], [10, 10], [30, 0], [40, 0], [40, -10]];
    for (const gap of [0, 1e-12, 1e-3, 0.999e-3 * 40, 0.1]) add(`gap ${gap}`, ring40, [[[0, 3], [40 - gap, -1]]]);
    add("dangling numbered", ring40, [[[5, 5]], [[0, 3], [40 - 0.1, -1]]]);
    for (let k = 1; k < 50; k++) {
      const t = k / 50 + 1e-7;
      const end: Pt = [10 + 20 * t, 10 - 10 * t - 1e-12];
      add(`sloping face ${k}`, ring40, [[[0, 2], end]]);
    }
    // result-warnings.test.ts
    add("T-junction", ring40, [[[0, -3], [40, -5]], [[20, -4 + 0.02], [20, 5]]]);
    add("lens gap", ring40, [[[10, -2], [20, -6], [30, -2], [10.01, -2]]]);
    add("far end", ring40, [[[0, -3], [40, -5]], [[20, -4 + 0.5], [20, 5]]]);
    add("past outline", ring40, [[[-1, 2], [41, -3]]]);
    // Stress: T-junctions off by rounding errors, collinear overlaps,
    // near-coincident vertices within the snap tolerance, lenses touching
    // the outline or another boundary, boundaries through outline vertices,
    // large map coordinates.
    for (let i = 0; i < 60; i++) {
      const lines: Pt[][] = [];
      const y0 = uni(-8, 6);
      const y1 = y0 + uni(-2, 2);
      const main: Pt[] = [[0, y0], [20, (y0 + y1) / 2], [40, y1]];
      lines.push(main);
      const kind = i % 6;
      if (kind === 0) {
        // T-junction ending on the main line by a rounding error
        const x = uni(2, 38);
        const yOn = x <= 20 ? y0 + ((x / 20) * ((y0 + y1) / 2 - y0)) : (y0 + y1) / 2 + ((x - 20) / 20) * (y1 - (y0 + y1) / 2);
        lines.push([[x, yOn + pick([0, 1e-13, -1e-13, 1e-9, 1e-5])], [x + uni(-2, 2), Math.min(9, yOn + uni(2, 6))]]);
      } else if (kind === 1) {
        // collinear overlap with the main line
        lines.push([[5, y0 + ((5 / 20) * ((y0 + y1) / 2 - y0))], [20, (y0 + y1) / 2], [30, (y0 + y1) / 2 + 0.5 * (y1 - (y0 + y1) / 2)]]);
      } else if (kind === 2) {
        // a boundary running along the outline bottom and up
        lines.push([[0, -10], [15, -10], [15, y0 - 1], [40, y1 - 1]]);
      } else if (kind === 3) {
        // a lens touching the main line
        const cx = uni(8, 32);
        const cyOn = (y0 + y1) / 2;
        lines.push([[cx - 2, cyOn - 3], [cx + 2, cyOn - 3], [cx, cyOn], [cx - 2, cyOn - 3]]);
      } else if (kind === 4) {
        // through vertices of the outline and nearly through
        lines.push([[0, 10], [10 + pick([0, 1e-10, 1e-6]), 10 - pick([0, 1e-11])], [30, 0], [40, -10]]);
      } else {
        // near-coincident vertices: a second line almost on the first
        const d = pick([1e-12, 1e-10, 1e-8, 1e-6]);
        lines.push([[0, y0 + d], [20, (y0 + y1) / 2 - d], [40, y1 + d]]);
      }
      add(`stress ${i}`, ring40, lines);
    }
    for (let i = 0; i < 12; i++) {
      // large map coordinates
      const ox = 6.5e6 + uni(0, 1e5);
      const oy = 1.5e5 + uni(0, 1e4);
      const y0 = uni(-8, 6);
      add(
        `map ${i}`,
        ring40.map(([x, y]) => [x + ox, y + oy] as Pt),
        [[[ox, y0 + oy], [ox + 20, y0 + uni(-2, 2) + oy], [ox + 40 + pick([0, -1e-9]), y0 + uni(-2, 2) + oy]]],
      );
    }
    for (let i = 0; i < 80; i++) {
      // Vertices computed onto sloping outline edges and onto other
      // boundaries (off them by rounding errors): the cases that need snap
      // rounding.
      const h = uni(5, 20);
      const crest = uni(5, 15);
      const toe = crest + uni(5, 25);
      const w = toe + uni(5, 20);
      const ring: Pt[] = [[0, -10], [0, h], [crest, h], [toe, 0], [w, 0], [w, -10]];
      const onFace = (t: number): Pt => [crest + (toe - crest) * t, h + (0 - h) * t];
      const a = onFace(uni(0.05, 0.95));
      const b = onFace(uni(0.05, 0.95));
      const lines: Pt[][] = [];
      const kind = i % 4;
      if (kind === 0) lines.push([[0, a[1] - uni(0, 3)], a, [w, uni(-8, -1)]]);
      else if (kind === 1) lines.push([[0, uni(-8, h - 1)], a]);
      else if (kind === 2) {
        const first: Pt[] = [[0, uni(-5, 0)], [w, uni(-9, -6)]];
        lines.push(first);
        const t = uni(0.1, 0.9);
        const on: Pt = [first[0][0] + (first[1][0] - first[0][0]) * t, first[0][1] + (first[1][1] - first[0][1]) * t];
        lines.push([on, b]);
      } else {
        lines.push([[0, a[1]], a]);
        lines.push([b, [w, uni(-8, -1)]]);
      }
      add(`snap ${i}`, ring, lines);
    }
    for (let i = 0; i < 20; i++) {
      // random lines crossing a random polygon
      const poly = randomPolygon(4 + Math.floor(r() * 6), uni(5, 20));
      const lines: Pt[][] = [];
      const nl = 1 + Math.floor(r() * 4);
      for (let k = 0; k < nl; k++) {
        const m = 2 + Math.floor(r() * 4);
        lines.push(Array.from({ length: m }, () => [uni(-25, 25), uni(-25, 25)] as Pt));
      }
      add(`random ${i}`, poly, lines);
    }

    const out = cases.map((c) => {
      snapOverlays = 0;
      const res = attempt(() => polygonizeRegionsDetailed(c.px, c.py, c.lines));
      if ("output" in res) for (const f of res.output.faces) keyholeCases.push({ outer: f.outer, holes: f.holes });
      return { ...c, ...res, snapOverlays };
    });
    writeFixture("geometry", "polygonize", out);

    // The jsts primitives themselves on the same linework (outline and
    // every line of two or more points): the unary union, snap-rounding
    // noding (grid 1e-9 of the model size, about the outline's lower-left
    // corner, as polygonizeRegions does) and the polygonizer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gf: any = new GeometryFactory();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coordsOf = (g: any): Pt[] => g.getCoordinates().map((c: { x: number; y: number }) => [c.x, c.y] as Pt);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linesOf = (g: any): Pt[][] => {
      const res: Pt[][] = [];
      for (let i = 0; i < g.getNumGeometries(); i++) res.push(coordsOf(g.getGeometryN(i)));
      return res;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mls = (ls: Pt[][]) => gf.createMultiLineString(ls.map((l) => gf.createLineString(l.map(([x, y]) => new Coordinate(x, y)))));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const union = (ls: Pt[][]) => linesOf((UnaryUnionOp as any).union(mls(ls)));
    const polygonize = (ls: Pt[][]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pz: any = new Polygonizer();
      pz.add(mls(ls));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const polys = pz.getPolygons().array.map((p: any) => {
        const holes: Pt[][] = [];
        for (let h = 0; h < p.getNumInteriorRing(); h++) holes.push(coordsOf(p.getInteriorRingN(h)));
        return { shell: coordsOf(p.getExteriorRing()), holes };
      });
      return { polygons: polys, dangles: pz.getDangles().size() };
    };
    const primitives = cases.map((c) => {
      const ring: Pt[] = c.px.map((x, i) => [x, c.py[i]] as Pt);
      if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0]);
      const ls = ring.length >= 4 ? [ring, ...c.lines.filter((l) => l.length >= 2)] : [];
      if (ls.length === 0) return { name: c.name, lines: ls };
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9);
      const [ox, oy] = [Math.min(...xs), Math.min(...ys)];
      const local = ls.map((l) => l.map(([x, y]) => [x - ox, y - oy] as Pt));
      const scale = 1 / (1e-9 * size);
      const unionRes = attempt(() => union(ls));
      const nodedRes = attempt(() => {
        const list = new (ArrayList as unknown as new () => { add(x: unknown): void })();
        for (const l of local) list.add(gf.createLineString(l.map(([x, y]) => new Coordinate(x, y))));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (new GeometryNoder(new PrecisionModel(scale)) as any).node(list).toArray().map(coordsOf) as Pt[][];
      });
      const nodedUnion = "output" in nodedRes ? attempt(() => union(nodedRes.output)) : undefined;
      const polys = "output" in unionRes ? attempt(() => polygonize(unionRes.output)) : undefined;
      return { name: c.name, lines: ls, local, scale, union: unionRes, noded: nodedRes, nodedUnion, polygonize: polys };
    });
    writeFixture("geometry", "jts_primitives", primitives);
    console.log(
      `polygonize: ${out.length} cases, ${out.filter((c) => c.snapOverlays > 0).length} with snapping overlay, ` +
        `${out.filter((c) => "error" in c).length} errors`,
    );
  }

  writeFixture(
    "geometry",
    "keyhole",
    keyholeCases.map((c) => ({ ...c, output: keyholeRing(c.outer, c.holes) })),
  );

  // ── createGeometryWithMaterial and materialLayerTopAt ────────────
  {
    const mat = new Material({ name: "M" });
    const gwm = [
      { px: [0, 10, 10, 0], py: [0, 0, 5, 5], calculateBounds: true },
      { px: [0, 10, 10, 0], py: [0, 0, 5, 5], calculateBounds: false },
      { px: [], py: [], calculateBounds: true },
      { px: [3, -1, 7], py: [2, 8, -4], calculateBounds: true },
    ].map((c) => {
      const g = createGeometryWithMaterial(c.px, c.py, mat, c.calculateBounds);
      return { ...c, output: { px: g.px, py: g.py, xMin: g.xMin, xMax: g.xMax, yMax: g.yMax } };
    });
    writeFixture("geometry", "geometry_with_material", gwm);

    const cases: unknown[] = [];
    for (const pg of problems) {
      const geos = pg.geometries.map((g) => ({
        px: g.px,
        py: g.py,
        material: pg.materials.indexOf(g.material),
        xMin: g.xMin,
        xMax: g.xMax,
        yMax: g.yMax,
      }));
      const xMin = Math.min(...pg.px);
      const xMax = Math.max(...pg.px);
      const yMin = Math.min(...pg.py);
      const yMax = Math.max(...pg.py);
      const queries: { material: number; x: number; y: number; output: number | null }[] = [];
      for (let k = 0; k < 30; k++) {
        const x = k < 4 ? pick(pg.px) : uni(xMin - 1, xMax + 1);
        const y = uni(yMin - 1, yMax + 1);
        for (let m = 0; m < pg.materials.length; m++) {
          queries.push({ material: m, x, y, output: materialLayerTopAt(pg.geometries, pg.materials[m], x, y) });
        }
      }
      cases.push({ name: pg.id, geometries: geos, queries });
    }
    // geometry-ops.test.ts / geometry-props.test.ts
    const clay = new Material({ name: "Clay" });
    const sand = new Material({ name: "Sand" });
    const rect = (x0: number, x1: number, y0: number, y1: number, m: Material) =>
      createGeometryWithMaterial([x0, x1, x1, x0], [y0, y0, y1, y1], m);
    const unit: { name: string; geos: GeometryWithMaterial[]; mats: Material[]; q: [number, number, number][] }[] = [
      {
        name: "stack",
        geos: [rect(0, 10, -10, -4, clay), rect(0, 10, -4, 0, clay), rect(0, 10, 0, 5, sand), rect(4, 6, 2, 3, clay)],
        mats: [clay, sand],
        q: [[0, 5, -8], [0, 5, -6], [1, 5, 1], [0, 5, 2.5], [0, 5, 2], [0, 20, -5], [1, 5, 5], [0, 0, 0]],
      },
      {
        name: "sloping",
        geos: [createGeometryWithMaterial([0, 10, 10, 0], [-10, -10, 4, 0], clay)],
        mats: [clay],
        q: [[0, 5, -6], [0, 0, -6], [0, 10, 4]],
      },
      {
        name: "unbounded",
        geos: [createGeometryWithMaterial([0, 10, 10, 0], [0, 0, 5, 5], clay, false)],
        mats: [clay],
        q: [[0, 5, 2], [0, 12, 2]],
      },
      // NaN coordinates and queries: NaN extents make the sorts'
      // comparators inconsistent (V8's TimSort order decides the result)
      {
        name: "NaN query",
        geos: [rect(0, 10, -10, -4, clay), rect(0, 10, -4, 0, clay), rect(0, 10, 0, 5, sand)],
        mats: [clay, sand],
        q: [[0, 5, NaN], [0, NaN, -5], [1, 5, NaN], [0, NaN, NaN]],
      },
      {
        name: "short py",
        geos: [createGeometryWithMaterial([0, 10, 10, 0], [0, 0, 5], clay, false)],
        mats: [clay],
        q: [[0, 5, 2], [0, 2, 1], [0, 0, 0]],
      },
    ];
    {
      // zigzag outlines with NaN vertices: many extents at one x
      const zig = (n: number, nanAt: (i: number) => boolean, yOf: (k: number) => [number, number]) => {
        const px: number[] = [];
        const py: number[] = [];
        for (let k = 0; k < n; k++) {
          const [a, b] = yOf(k);
          px.push(0, 1);
          py.push(a, b);
        }
        for (let i = 0; i < py.length; i++) if (nanAt(i)) py[i] = NaN;
        return createGeometryWithMaterial(px, py, clay, false);
      };
      const qs: [number, number, number][] = [[0, 0.5, 10], [0, 0.5, 50], [0, 0.25, 3], [0, 0.75, 90]];
      unit.push({
        name: "NaN zigzag",
        geos: [zig(120, (i) => i % 7 === 3, (k) => [k, k + 0.5])],
        mats: [clay],
        q: qs,
      });
      for (let t = 0; t < 40; t++) {
        const nanAt = Math.floor(r() * 160);
        unit.push({
          name: `NaN random ${t}`,
          geos: [zig(80, (i) => i === nanAt || r() < 0.02, () => [r() * 100, r() * 100])],
          mats: [clay],
          q: qs,
        });
      }
    }
    for (const u of unit) {
      cases.push({
        name: u.name,
        geometries: u.geos.map((g) => ({ px: g.px, py: g.py, material: u.mats.indexOf(g.material), xMin: g.xMin, xMax: g.xMax, yMax: g.yMax })),
        queries: u.q.map(([m, x, y]) => ({ material: m, x, y, output: materialLayerTopAt(u.geos, u.mats[m], x, y) })),
      });
    }
    writeFixture("geometry", "layer_top", cases);
  }

  console.log(`geometry fixtures written (${problems.length} verification problems)`);
});
