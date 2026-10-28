import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import { buildFeModel, solveElastic } from "./model";
import { vanGenuchtenMualem } from "./seepage";
import { meshDomain } from "./mesh";
import { nestedDissection, SparseCholesky } from "./sparse";

function layer(extra: Partial<SlopeDefinition> = {}): SlopeDefinition {
  return {
    coordinates: [[0, 0], [0, 10], [30, 10], [30, 0]],
    materials: [{ name: "Soil", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30 } }],
    ...extra,
  } as SlopeDefinition;
}

describe("meshDomain", () => {
  it("covers the domain with counter-clockwise triangles of bounded angle", () => {
    const boundary: [number, number][] = [[0, 0], [60, 0], [60, 20], [40, 20], [20, 10], [0, 10]];
    const m = meshDomain({ boundary, segments: [[[0, 5], [60, 5]], [[20, 10], [60, 12]]], size: () => 2 });
    let area = 0, minAngle = 180;
    for (let t = 0; t < m.count; t++) {
      const [a, b, c] = [m.tri[3 * t], m.tri[3 * t + 1], m.tri[3 * t + 2]];
      const ar = ((m.x[b] - m.x[a]) * (m.y[c] - m.y[a]) - (m.y[b] - m.y[a]) * (m.x[c] - m.x[a])) / 2;
      expect(ar).toBeGreaterThan(0);
      area += ar;
      const pts = [a, b, c];
      for (let k = 0; k < 3; k++) {
        const p = pts[k], q = pts[(k + 1) % 3], r = pts[(k + 2) % 3];
        const ux = m.x[q] - m.x[p], uy = m.y[q] - m.y[p], vx = m.x[r] - m.x[p], vy = m.y[r] - m.y[p];
        const ang = (Math.acos((ux * vx + uy * vy) / Math.hypot(ux, uy) / Math.hypot(vx, vy)) * 180) / Math.PI;
        minAngle = Math.min(minAngle, ang);
      }
    }
    expect(area).toBeCloseTo(900, 6);
    expect(minAngle).toBeGreaterThan(20);
    expect(m.capped).toBe(false);
  });
});

describe("SparseCholesky", () => {
  it("solves a positive definite system on a grid in nested dissection order", () => {
    // 2 unknowns per node of a 9 × 7 grid, coupled within each cell's 4 nodes.
    const nx = 9, ny = 7, nn = nx * ny;
    const x = Float64Array.from({ length: nn }, (_, i) => i % nx), y = Float64Array.from({ length: nn }, (_, i) => Math.floor(i / nx));
    const cells: number[] = [];
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) cells.push(j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i);
    const adj = Array.from({ length: nn }, () => new Set<number>());
    for (let c = 0; c < cells.length; c += 4) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) adj[cells[c + a]].add(cells[c + b]);
    const perm = nestedDissection(x, y, adj.map((s) => Int32Array.from(s)));
    expect([...perm].sort((a, b) => a - b)).toEqual([...Array(nn).keys()]);
    const pos = new Int32Array(nn);
    perm.forEach((v, k) => (pos[v] = k));
    const n = 2 * nn;
    const groups = new Int32Array(2 * cells.length);
    cells.forEach((v, k) => { groups[2 * k] = 2 * pos[v]; groups[2 * k + 1] = 2 * pos[v] + 1; });
    const K = SparseCholesky.fromGroups(n, groups, 8);
    // dense reference: diagonally dominant within the pattern
    const dense = Array.from({ length: n }, () => new Float64Array(n));
    for (let c = 0; c < groups.length; c += 8) {
      for (let a = 0; a < 8; a++) {
        for (let b = 0; b < 8; b++) {
          const i = groups[c + a], j = groups[c + b];
          dense[i][j] += i === j ? 10 : -0.1 - ((i + 2 * j + i * j) % 3) * 0.05;
        }
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) dense[i][j] = dense[j][i] = (dense[i][j] + dense[j][i]) / 2;
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) if (dense[i][j] !== 0) K.add(i, j, dense[i][j]);
    K.factor();
    const xTrue = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) b[i] += dense[i][j] * xTrue[j];
    K.solve(b);
    for (let i = 0; i < n; i++) expect(b[i]).toBeCloseTo(xTrue[i], 10);
    // a copy shares the pattern and starts from zero
    const K2 = K.emptyCopy();
    expect(K2.values.every((v) => v === 0)).toBe(true);
    expect(() => K2.factor()).toThrow(/not positive definite/);
  });
});

describe("buildFeModel, elastic gravity", () => {
  it("gives the K0 stresses of a horizontal layer", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(layer()));
    const model = buildFeModel(slope, { elementSize: 1.5 });
    const { stress } = solveElastic(model);
    const k0 = 0.3 / 0.7;
    let worst = 0;
    for (let i = 0; i < 3 * model.elementCount; i++) {
      const sy = -20 * (10 - model.gpY[i]);
      worst = Math.max(
        worst,
        Math.abs(stress[4 * i + 1] - sy),
        Math.abs(stress[4 * i] - k0 * sy),
        Math.abs(stress[4 * i + 2]),
        Math.abs(stress[4 * i + 3] - 0.3 * (1 + k0) * sy),
      );
    }
    expect(worst).toBeLessThan(1e-6 * 200);
  });

  it("carries the pore pressure of a water table in effective stress", () => {
    const def = layer({ waterTable: { mode: "custom", value: [[0, 6], [30, 6]], followBoundary: false } });
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const model = buildFeModel(slope, { elementSize: 1 });
    const { stress } = solveElastic(model);
    // Effective vertical stress at the base: γH − γw·6 (exactly, by equilibrium of the column)
    let sum = 0, n = 0;
    for (let i = 0; i < 3 * model.elementCount; i++) {
      if (model.gpY[i] < 0.5 && model.gpX[i] > 10 && model.gpX[i] < 20) {
        const expected = -(20 * (10 - model.gpY[i]) - WATER_UNIT_WEIGHT * (6 - model.gpY[i]));
        sum += (stress[4 * i + 1] - expected) / expected;
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(Math.abs(sum / n)).toBeLessThan(0.01);
  });

  it("applies a strip load over its width", () => {
    const def = layer({ udls: [{ magnitude: 50, x1: 0, x2: 30 }] });
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const model = buildFeModel(slope, { elementSize: 2 });
    const { stress } = solveElastic(model);
    let worst = 0;
    for (let i = 0; i < 3 * model.elementCount; i++) {
      worst = Math.max(worst, Math.abs(stress[4 * i + 1] - (-20 * (10 - model.gpY[i]) - 50)));
    }
    expect(worst).toBeLessThan(1e-4);
  });
});

describe("reinforcement bars", () => {
  it("meshes a reinforcement line that crosses a material boundary and adds bars along it", () => {
    const def = {
      coordinates: [[0, 0], [0, 6], [20, 6], [20, 0]],
      materials: [
        { name: "Fill", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 0, frictionAngle: 34 } },
        { name: "Facing", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 2.5, frictionAngle: 34 } },
      ],
      materialBoundaries: [{ coordinates: [[2, 0], [2, 6]], materialName: "" }],
      regionAssignments: [{ point: [1, 3], materialName: "Facing" }, { point: [10, 3], materialName: "Fill" }],
      reinforcements: [{ x1: 1, y1: 3, x2: 12, y2: 3, tensileCapacity: 20, application: "passive" }],
    } as unknown as SlopeDefinition;
    const model = buildFeModel(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 1 });
    expect(model.bars.count).toBeGreaterThan(5);
    // the bars cover the line's length (11 m) once
    let length = 0;
    for (let g = 0; g < 2 * model.bars.count; g++) length += model.bars.gp[7 * g + 6];
    expect(length).toBeCloseTo(11, 6);
    // capacity per metre of slope, the full tensile capacity (no pullout given)
    expect(Math.max(...model.bars.capacity)).toBeCloseTo(20, 9);
  });
});

describe("steady seepage", () => {
  it("gives hydrostatic pore pressure under a water table at the ground", () => {
    const def = layer({ waterTable: { mode: "custom", value: [[0, 10], [30, 10]], followBoundary: false } });
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const a = buildFeModel(slope, { elementSize: 2 });
    const b = buildFeModel(slope, { elementSize: 2, porePressure: "seepage" });
    expect(b.seepage?.converged).toBe(true);
    let worst = 0;
    for (let i = 0; i < a.gpU.length; i++) worst = Math.max(worst, Math.abs(a.gpU[i] - b.gpU[i]));
    expect(worst).toBeLessThan(1e-6 * 100);
  });

  it("lowers the phreatic surface through an embankment from the reservoir to the tail water", () => {
    // 2:1 embankment, reservoir 8 m deep on the left, tail water at the ground on the right
    const def = {
      coordinates: [[0, 0], [0, 2], [20, 12], [26, 12], [46, 2], [60, 2], [60, 0]],
      materials: [{ name: "Fill", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 10, frictionAngle: 30 } }],
      waterTable: { mode: "custom", value: [[0, 10], [16, 10], [46, 2], [60, 2]], followBoundary: false },
    } as unknown as SlopeDefinition;
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const m = buildFeModel(slope, { elementSize: 1.5, porePressure: "seepage" });
    expect(m.seepage?.converged).toBe(true);
    // pressure head under the crest centre: between the tail water and the reservoir
    let best = -1, d = Infinity;
    for (let i = 0; i < m.gpX.length; i++) {
      const dd = Math.hypot(m.gpX[i] - 23, m.gpY[i] - 2.5);
      if (dd < d) { d = dd; best = i; }
    }
    const h = m.gpU[best] / WATER_UNIT_WEIGHT + m.gpY[best];
    expect(h).toBeGreaterThan(2.5);
    expect(h).toBeLessThan(10);
    // no pore pressure at the crest
    for (let i = 0; i < m.gpX.length; i++) if (m.gpY[i] > 11.5) expect(m.gpU[i]).toBe(0);
  });
});

describe("steady seepage with a water table below the ground", () => {
  it("holds the water table at the model's sides instead of draining the slope", () => {
    // natural slope, water table 2 m below the crest, at the toe level downstream
    const def = {
      coordinates: [[0, 0], [0, 4], [20, 4], [40, 14], [60, 14], [60, 0]],
      materials: [{ name: "Soil", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 10, frictionAngle: 30 } }],
      waterTable: { mode: "custom", value: [[0, 4], [20, 4], [40, 12], [60, 12]], followBoundary: false },
    } as unknown as SlopeDefinition;
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const m = buildFeModel(slope, { elementSize: 1.5, porePressure: "seepage" });
    expect(m.seepage?.flow).toBe(true);
    expect(m.seepage?.converged).toBe(true);
    // near the side under the crest the head is the drawn water table's
    // (the model may be mirrored, so both sides are looked at)
    const headNear = (px: number) => {
      let best = -1, d = Infinity;
      for (let i = 0; i < m.gpX.length; i++) {
        const dd = Math.hypot(m.gpX[i] - px, m.gpY[i] - 5);
        if (dd < d) { d = dd; best = i; }
      }
      return m.gpU[best] / WATER_UNIT_WEIGHT + m.gpY[best];
    };
    expect(Math.max(headNear(1), headNear(59))).toBeGreaterThan(11.5);
    expect(Math.min(headNear(1), headNear(59))).toBeLessThan(4.5);
  });

  it("keeps each material's water line when no water reaches the boundary", () => {
    const def = layer({ waterTable: { mode: "custom", value: [[0, -5], [30, -5]], followBoundary: false } });
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const m = buildFeModel(slope, { elementSize: 2, porePressure: "seepage" });
    expect(m.seepage?.flow).toBe(false);
    expect(Math.max(...m.gpU)).toBe(0);
  });

  it("rejects van Genuchten n ≤ 1", () => {
    const def = layer({ waterTable: { mode: "custom", value: [[0, 10], [30, 10]], followBoundary: false } });
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    expect(() => buildFeModel(slope, { elementSize: 2, porePressure: "seepage", materialParameters: { "*": { vanGenuchtenN: 0.9 } } })).toThrow(/van Genuchten/);
  });
});

describe("rigid materials", () => {
  it("are stiffer than the stiffest soil and nearly impervious", () => {
    const def = {
      coordinates: [[0, 0], [0, 10], [30, 10], [30, 0]],
      materials: [
        { name: "Soil", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30 } },
        { name: "Rock", model: { kind: "impenetrable", unitWeight: 24 } },
      ],
      materialBoundaries: [{ coordinates: [[0, 4], [30, 4]], materialName: "" }],
      regionAssignments: [{ point: [15, 7], materialName: "Soil" }, { point: [15, 2], materialName: "Rock" }],
      waterTable: { mode: "custom", value: [[0, 10], [30, 10]], followBoundary: false },
    } as unknown as SlopeDefinition;
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const m = buildFeModel(slope, { elementSize: 2, materialParameters: { "*": { youngsModulus: 1e7 } } });
    let rock = 0;
    for (let e = 0; e < m.elementCount; e++) {
      if (!m.elElastic[e]) continue;
      rock++;
      expect(m.elE[e]).toBeGreaterThanOrEqual(1e9);
    }
    expect(rock).toBeGreaterThan(0);
    // hydrostatic still: the rock carries the water table's pressure
    const s = buildFeModel(slope, { elementSize: 2, porePressure: "seepage" });
    expect(s.seepage?.converged).toBe(true);
  });
});
describe("van Genuchten–Mualem relative permeability", () => {
  it("is 1 when saturated and matches the closed form for n = 2", () => {
    expect(vanGenuchtenMualem(0.5, 3.6, 1.56)).toBe(1);
    // n = 2, α|ψ| = 1: Se = 2^(−1/2), kr = Se^½ (1 − (1 − Se²)^½)²
    const se = 2 ** -0.5;
    expect(vanGenuchtenMualem(-1, 1, 2)).toBeCloseTo(Math.sqrt(se) * (1 - Math.sqrt(1 - se * se)) ** 2, 12);
    // decreasing with suction, bounded below
    expect(vanGenuchtenMualem(-2, 3.6, 1.56)).toBeLessThan(vanGenuchtenMualem(-1, 3.6, 1.56));
    expect(vanGenuchtenMualem(-1e6, 3.6, 1.56)).toBe(1e-6);
  });
});

