// Differential fixtures of the finite element leaves: fem/sparse.ts,
// anderson.ts, elements.ts, mesh.ts and conic.ts (Clarabel).
//
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts fem-leaves
//
// writes fixtures/fem-leaves/*.json:
// - mesh-<case>.json: every meshDomain call made while building the finite
//   element models of verification problems (and the unit test's domain):
//   the input, the size field as a table of the points it was asked at, and
//   the mesh. The size field is a closure; Rust replays the table, so a mesh
//   that departs from the TypeScript one asks at a point not in it.
// - sparse-<case>.json: the matrices factorised in a real run (the elastic
//   stiffness of V055 and the seepage matrices of V099): the groups given to
//   fromGroups, the symbolic factorisation, the values, L and a solve; an LU
//   factorisation of an unsymmetric matrix of the same pattern; the nested
//   dissection order of the model's nodes.
// - elements.json: shape functions and derivatives at many points, the
//   Gauss data and element stiffnesses of a real mesh, Lamé constants.
// - anderson.json: the steps of Anderson acceleration on fixed-point problems.
// - conic-<case>.json: lower and upper bound programs of verification
//   problems at several reductions F with the TypeScript (Clarabel
//   WebAssembly) solution and its time.
//
// fem/mesh is mocked (vi.mock) with a meshDomain that records its calls;
// SparseCholesky's methods are wrapped on the class.
import { writeFixture } from "./write";
import { buildSlope } from "../../../engine/src/model/build-slope";
import { toCanonicalSlopeDefinition } from "../../../engine/src/model/canonical";
import { PROBLEMS } from "../../../engine/src/verification/problems";
import { buildFeModel, solveElastic } from "../../../engine/src/fem/model";
import { meshDomain } from "../../../engine/src/fem/mesh";
import { SparseCholesky, nestedDissection, nodeGraph } from "../../../engine/src/fem/sparse";
import { Anderson } from "../../../engine/src/fem/anderson";
import { shapeT6, shapeDerivT6, gaussData, stiffnessT6, lame, GP_STRIDE } from "../../../engine/src/fem/elements";
import { loadClarabel, solveClarabel, ProgramBuilder, affine } from "../../../engine/src/fem/conic";
import { lowerBoundProblem } from "../../../engine/src/fem/lower-bound";
import { upperBoundProblem } from "../../../engine/src/fem/upper-bound";

const AREA = "fem-leaves";

// ── meshDomain recorder ───────────────────────────────────────────

interface MeshCall { input: Record<string, unknown>; size: { x: number[]; y: number[]; v: number[] }; output: Record<string, unknown> }
const meshCalls: MeshCall[] = [];
(globalThis as Record<string, unknown>).__cslopeMeshHook = (
  orig: (input: Record<string, unknown>) => Record<string, unknown>,
  input: Record<string, unknown> & { size: (x: number, y: number) => number },
) => {
  const table = { x: [] as number[], y: [] as number[], v: [] as number[] };
  const size = input.size;
  const recorded = (px: number, py: number) => {
    const v = size(px, py);
    table.x.push(px); table.y.push(py); table.v.push(v);
    return v;
  };
  const out = orig({ ...input, size: recorded });
  const { size: _s, ...rest } = input;
  meshCalls.push({
    input: rest,
    size: table,
    output: { x: Array.from(out.x as Float64Array), y: Array.from(out.y as Float64Array), tri: Array.from(out.tri as Int32Array), count: out.count, capped: out.capped, missingSegments: out.missingSegments },
  });
  return out;
};

// Every importer of fem/mesh (fem/model.ts) gets the recording meshDomain.
vi.mock("../../../engine/src/fem/mesh", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await importOriginal<any>();
  return {
    ...mod,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meshDomain: (input: any) => (globalThis as any).__cslopeMeshHook(mod.meshDomain, input),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const problem = (id: string): Any => {
  const p = PROBLEMS.find((q: Any) => q.id === id);
  if (!p) throw new Error(`no problem ${id}`);
  return p;
};
const slopeOf = (id: string) => buildSlope(toCanonicalSlopeDefinition(problem(id).definition));
const femOptions = (id: string): Any => {
  const f = problem(id).fem ?? {};
  return { materialParameters: f.materialParameters, porePressure: f.porePressure, elementSize: f.elementSize, reinforcementStiffness: f.reinforcementStiffness, reduceReinforcement: f.reduceReinforcement };
};
const arr = (a: ArrayLike<number>) => Array.from(a);

it("exports the fem-leaves fixtures", async () => {
  // A fixed clock for the engine (Clarabel's time limit and the solve's time
  // left); the timings recorded for information use the real one.
  const realNow = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockReturnValue(0);

  // ── sparse: wrap SparseCholesky to capture factorisations ─────────

  interface Captured { groups: number[]; n: number; size: number; K: Any }
  const created: Captured[] = [];
  const origFromGroups = SparseCholesky.fromGroups;
  SparseCholesky.fromGroups = function (n: number, groups: Int32Array, size: number) {
    const K = origFromGroups.call(this, n, groups, size);
    created.push({ groups: arr(groups), n, size, K });
    return K;
  };
  const factorRecords = new Map<Any, Any>();
  const origFactor = SparseCholesky.prototype.factor;
  SparseCholesky.prototype.factor = function (this: Any) {
    if (!factorRecords.has(this.sym)) {
      const rec: Any = { values: arr(this.values), upper: this.upper ? arr(this.upper) : null };
      try {
        origFactor.call(this);
        rec.lx = arr(this.Lx);
        rec.error = null;
      } catch (e) {
        rec.error = (e as Error).message;
        factorRecords.set(this.sym, rec);
        throw e;
      }
      rec.solves = [];
      rec.matrix = this;
      factorRecords.set(this.sym, rec);
      return;
    }
    origFactor.call(this);
  };
  const origSolve = SparseCholesky.prototype.solve;
  SparseCholesky.prototype.solve = function (this: Any, b: Float64Array) {
    const rec = factorRecords.get(this.sym);
    const record = rec && rec.matrix === this && rec.solves.length < 2;
    const input = record ? arr(b) : null;
    origSolve.call(this, b);
    if (record) rec.solves.push({ b: input, x: arr(b) });
  };

  function sparseCase(name: string, run: () => Any) {
    created.length = 0;
    factorRecords.clear();
    const model = run();
    const matrices = created.map((c) => {
      const rec = factorRecords.get(c.K.sym);
      const sym = c.K.sym;
      return {
        n: c.n, size: c.size, groups: c.groups,
        rowPtr: arr(sym.rowPtr), rowCols: arr(sym.rowCols), lp: arr(sym.Lp), li: arr(sym.Li), parent: arr(sym.parent),
        factor: rec ? { values: rec.values, lx: rec.lx, error: rec.error, solves: rec.solves } : null,
      };
    });
    // LU of an unsymmetric matrix of the first pattern: the stiffness with its
    // upper triangle perturbed (a non-associated tangent's structure).
    let lu: Any = null;
    const first = created[0], rec = first && factorRecords.get(first.K.sym);
    if (rec) {
      const K = first.K.emptyCopy(true);
      K.values.set(rec.values);
      for (let p = 0; p < K.values.length; p++) {
        const i = rec.values[p];
        K.upper[p] = i * (1 + 0.05 * Math.sin(0.37 * p));
      }
      for (let i = 0; i < K.n; i++) K.upper[K.diag[i]] = 0;
      // `add` adds to both triangles: the first off-diagonal entry of the first row that has one
      let addAt: number[] = [];
      for (let k = 0; k < K.n && !addAt.length; k++) if (K.sym.rowPtr[k + 1] - K.sym.rowPtr[k] >= 2) addAt = [k, K.sym.rowCols[K.sym.rowPtr[k]]];
      K.add(addAt[0], addAt[1], 0.5);
      origFactor.call(K);
      const b = Float64Array.from({ length: K.n }, (_, i) => Math.cos(0.1 * i));
      const b0 = arr(b);
      origSolve.call(K, b);
      lu = { addAt, values: arr(K.values), upper: arr(K.upper), lx: arr(K.Lx), ux: arr(K.Ux), b: b0, x: arr(b) };
    }
    // Timing (information): factorisation and solve of the first matrix, medians of repeated runs.
    let bench: Any = null;
    if (rec && rec.error === null) {
      const K = first.K.emptyCopy();
      const median = (f: () => void, reps: number) => {
        const t: number[] = [];
        for (let r = 0; r < reps; r++) { const t0 = realNow(); f(); t.push(realNow() - t0); }
        return t.sort((a, b) => a - b)[reps >> 1];
      };
      K.values.set(rec.values);
      const factorMs = median(() => origFactor.call(K), 7);
      const b = Float64Array.from({ length: K.n }, (_, i) => Math.cos(0.1 * i));
      const solveMs = median(() => origSolve.call(K, b.slice()), 21);
      bench = { factorMs, solveMs };
    }
    // Nested dissection of the model's nodes.
    const adj = nodeGraph(model.el, model.elementCount, model.x.length);
    const perm = nestedDissection(model.x, model.y, adj);
    writeFixture(AREA, `sparse-${name}`, {
      x: arr(model.x), y: arr(model.y), el: arr(model.el), ne: model.elementCount,
      adj: adj.map(arr), perm: arr(perm), matrices, lu, bench,
    });
    console.log(`sparse-${name}: ${matrices.length} matrices, n = ${matrices.map((m) => m.n).join(", ")}`);
    return model;
  }

  // ── meshes ─────────────────────────────────────────────────────

  const MESH_PROBLEMS = ["V001", "V012", "V026", "V046a", "V055", "V056", "V063", "V067", "V068", "V077", "V094", "V099"];
  function meshCase(name: string, run: () => void) {
    meshCalls.length = 0;
    run();
    writeFixture(AREA, `mesh-${name}`, meshCalls);
    console.log(`mesh-${name}: ${meshCalls.map((c) => `${(c.output.x as number[]).length} vertices, ${c.output.count} triangles`).join("; ")}`);
  }
  meshCase("unit", () => {
    const boundary: [number, number][] = [[0, 0], [60, 0], [60, 20], [40, 20], [20, 10], [0, 10]];
    meshDomain({ boundary, segments: [[[0, 5], [60, 5]], [[20, 10], [60, 12]]], size: () => 2 });
    // crossing constraint lines, a graded size field, a larger angle, a vertex cap, minSize given
    meshDomain({ boundary, segments: [[[0, 5], [60, 5]], [[10, 2], [50, 15]], [[30, 1], [30, 14]]], size: (x: number, y: number) => 0.5 + 0.05 * x + 0.1 * y, minAngle: 30 });
    meshDomain({ boundary, segments: [], size: () => 0.5, maxVertices: 300 });
    meshDomain({ boundary, segments: [[[0, 5], [60, 5]]], size: () => 3, minSize: 0.5, sizeMin: 1 });
    // a thin layer meeting the ground at a shallow angle
    meshDomain({ boundary: [[0, 0], [50, 0], [50, 10], [0, 10]], segments: [[[0, 9.5], [50, 10]]], size: () => 1.5 });
  });
  for (const id of MESH_PROBLEMS) meshCase(id, () => { buildFeModel(slopeOf(id), femOptions(id)); });

  // ── sparse ─────────────────────────────────────────────────────

  const v055 = sparseCase("V055", () => {
    const model = buildFeModel(slopeOf("V055"), femOptions("V055"));
    solveElastic(model);
    return model;
  });
  sparseCase("V099", () => buildFeModel(slopeOf("V099"), femOptions("V099")));

  // ── elements ───────────────────────────────────────────────────

  {
    const points: number[][] = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; i + j <= 10; j++) points.push([i / 10, j / 10]);
    for (let k = 0; k < 50; k++) points.push([Math.sin(k) * 1.3, Math.cos(1.7 * k) * 0.9]);
    const shapes = points.map(([xi, eta]) => {
      const N = new Float64Array(6), d = new Float64Array(12);
      shapeT6(xi, eta, N);
      shapeDerivT6(xi, eta, d);
      return { xi, eta, n: arr(N), d: arr(d) };
    });
    const ne = v055.elementCount;
    const gp = gaussData(v055.x, v055.y, v055.el, ne);
    const ke = new Float64Array(144);
    const stiffness: Any[] = [];
    for (let e = 0; e < ne; e += Math.max(1, Math.floor(ne / 60))) {
      const E = 1e5 * (1 + (e % 7)), nu = 0.1 + 0.05 * (e % 7);
      stiffnessT6(gp, e, E, nu, ke);
      stiffness.push({ e, E, nu, ke: arr(ke) });
    }
    const lames = [[1e5, 0.3], [2e5, 0.25], [14000, 0.3], [1, 0.49], [3e7, 0]].map(([E, nu]) => ({ E, nu, ...lame(E, nu) }));
    // an element turned clockwise: the Jacobian check
    const bad = Int32Array.from(v055.el.subarray(0, 12));
    [bad[7], bad[8]] = [bad[8], bad[7]];
    [bad[9], bad[11]] = [bad[11], bad[9]];
    let badError = "";
    try { gaussData(v055.x, v055.y, bad, 2); } catch (e) { badError = (e as Error).message; }
    writeFixture(AREA, "elements", {
      gpStride: GP_STRIDE, shapes, x: arr(v055.x), y: arr(v055.y), el: arr(v055.el), ne, gauss: arr(gp), stiffness, lames,
      bad: { el: arr(bad), error: badError },
    });
    console.log(`elements: ${shapes.length} points, ${ne} elements, ${stiffness.length} stiffnesses, bad: ${badError}`);
  }

  // ── Anderson ───────────────────────────────────────────────────

  {
    const cases: Any[] = [];
    const record = (name: string, n: number, m: number, r0: number, steps: number, G: (x: Float64Array, k: number) => Float64Array, resetAt = -1) => {
      const aa = new Anderson(n, m, r0);
      let x = new Float64Array(n);
      const out: Any[] = [];
      for (let k = 0; k < steps; k++) {
        if (k === resetAt) aa.reset();
        const g = G(x, k);
        const gIn = arr(g);
        aa.step(x, g);
        out.push({ x: arr(x), g: gIn, out: arr(g), reset: k === resetAt });
        x = g;
      }
      cases.push({ name, n, m, residualStart: r0, steps: out });
    };
    // the unit tests' problems
    record("linear", 20, 5, 0, 40, (x) => Float64Array.from(x, (v, i) => (i === 0 ? 0.99 : 0.5) * v + 1));
    record("partial residual", 2, 3, 1, 20, (x) => Float64Array.from([2 * x[1], 0.9 * x[1] + 1]));
    // nonlinear, the history full and shifting, a reset half way
    record("nonlinear", 30, 4, 10, 60, (x) => Float64Array.from(x, (v, i) => 0.6 * Math.cos(v + 0.1 * i) + 0.3 * x[(i + 1) % 30] + 0.05 * i), 30);
    writeFixture(AREA, "anderson", cases);
    console.log(`anderson: ${cases.length} cases`);
  }

  // ── conic programs ─────────────────────────────────────────────

  {
    const clarabel = await loadClarabel();
    const plain = (prog: Any) => ({
      names: prog.names, nonneg: Array.from(prog.nonneg as Uint8Array, (v) => v === 1), scale: arr(prog.scale), sense: prog.sense,
      objective: arr(prog.objective), eqCols: prog.eqCols, eqVals: prog.eqVals, eqRhs: prog.eqRhs, cones: prog.cones,
    });
    // Small programs: the builder (duplicate and zero terms) and every status.
    {
      const small: Any[] = [];
      const run = (name: string, build: (pb: Any) => void) => {
        const pb = new ProgramBuilder();
        build(pb);
        const prog = pb.build();
        const sol = solveClarabel(prog, clarabel, 300);
        small.push({ name, program: plain(prog), solution: { status: sol.status, detail: sol.detail, objective: sol.objective, x: arr(sol.x), z: sol.z ? arr(sol.z) : undefined } });
        console.log(`conic-small ${name}: ${sol.detail} ${sol.objective}`);
      };
      // max λ: a stress state (sx, sy, txy) within a cone of radius 2 + λ-dependent load
      const socp = (pb: Any) => {
        const sx = pb.col("sx", false, 10), sy = pb.col("sy", false, 10), txy = pb.col("txy"), lam = pb.col("lam", true);
        pb.sense = "max";
        pb.addObjective(lam, 1); pb.addObjective(lam, 0.5); pb.addObjective(sx, 0);
        pb.eq([[sx, 1], [sy, 1], [sx, 0], [lam, -1]], 0);
        pb.eq([[txy, 1], [txy, -0.25], [lam, -0.5]], 0.1);
        pb.cone(affine([[sx, -0.5], [sy, -0.5]], 2), affine([[sx, 1], [sy, -1], [sx, 0.5], [sx, -0.5]]), affine([[txy, 2]]), "facets");
        pb.cone(affine([], 3), affine([[sx, 0.5]]), affine([[sy, 0.5]]), "vertices");
        if (pb.col("sx") !== sx || !pb.has("lam") || pb.has("nope")) throw new Error("builder");
      };
      run("socp", socp);
      run("socp min", (pb: Any) => { socp(pb); pb.sense = "min"; });
      run("lp", (pb: Any) => {
        const a = pb.col("a", true), b = pb.col("b", true, 100);
        pb.addObjective(a, 1); pb.addObjective(b, 2);
        pb.eq([[a, 1], [b, 1]], 3);
      });
      run("infeasible", (pb: Any) => {
        const a = pb.col("a", true);
        pb.addObjective(a, 1);
        pb.eq([[a, 1]], -1);
      });
      run("unbounded", (pb: Any) => {
        const a = pb.col("a"), b = pb.col("b", true);
        pb.addObjective(a, 1);
        pb.eq([[a, 1], [b, 1]], 0);
      });
      run("no objective", (pb: Any) => {
        const a = pb.col("a"), b = pb.col("b");
        pb.eq([[a, 2], [b, -1]], 1);
        pb.cone(affine([[a, 1]], 1), affine([[b, 1]]), affine([], 0.5), "facets");
      });
      writeFixture(AREA, "conic-small", small);
    }
    const CONIC: [string, number, number[]][] = [
      // problem, element size (m; 0: the default), reductions F
      ["V055", 0, [0.8, 1.0, 1.4, 3]],
      ["V046a", 0, [1.0, 1.33]],
      ["V067", 0, [1.0, 1.2]],
    ];
    for (const [id, h, Fs] of CONIC) {
      const opts = { ...femOptions(id), ...(h > 0 ? { elementSize: h } : {}) };
      const slope = slopeOf(id);
      const cases: Any[] = [];
      for (const [bound, make] of [["lower", lowerBoundProblem], ["upper", upperBoundProblem]] as const) {
        const prob = (make as Any)(slope, opts);
        for (const F of Fs) {
          const prog = prob.program(F);
          const t0 = realNow();
          const sol = solveClarabel(prog, clarabel, 300);
          const seconds = (realNow() - t0) / 1000;
          cases.push({ bound, F, timeLimit: 300, program: plain(prog), solution: { status: sol.status, detail: sol.detail, objective: sol.objective, x: arr(sol.x), z: sol.z ? arr(sol.z) : undefined }, seconds });
          console.log(`conic-${id} ${bound} F = ${F}: ${prog.names.length} columns, ${prog.eqRhs.length} equalities, ${prog.cones.length} cones: ${sol.detail} ${sol.objective} (${seconds.toFixed(2)} s)`);
        }
      }
      writeFixture(AREA, `conic-${id}`, cases);
    }
  }
});
