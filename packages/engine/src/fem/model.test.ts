import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { WATER_UNIT_WEIGHT } from "../types/constants";
import { buildFeModel, solveElastic } from "./model";
import { meshDomain } from "./mesh";
import { reverseCuthillMcKee, SkylineMatrix } from "./skyline";

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

describe("SkylineMatrix", () => {
  it("solves a banded positive definite system", () => {
    const n = 40;
    const adj = Array.from({ length: n }, (_, i) => Int32Array.from([i - 1, i + 1, i + 7].filter((j) => j >= 0 && j < n)));
    // symmetric adjacency
    const sets = adj.map((a) => new Set(a));
    for (let i = 0; i < n; i++) for (const j of adj[i]) sets[j].add(i);
    const perm = reverseCuthillMcKee(sets.map((s) => Int32Array.from(s)));
    expect([...perm].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
    const pos = new Int32Array(n);
    perm.forEach((v, k) => (pos[v] = k));
    const dense = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      dense[i][i] = 10;
      for (const j of sets[i]) dense[i][j] = -1 - ((i + j) % 3) * 0.1;
    }
    const first = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      first[pos[i]] = pos[i];
    }
    for (let i = 0; i < n; i++) for (const j of sets[i]) first[pos[i]] = Math.min(first[pos[i]], pos[j]);
    const K = new SkylineMatrix(first);
    for (let i = 0; i < n; i++) {
      K.add(pos[i], pos[i], dense[i][i]);
      for (const j of sets[i]) if (j < i) K.add(pos[i], pos[j], dense[i][j]);
    }
    K.factor();
    const xTrue = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += dense[i][j] * xTrue[j];
      b[pos[i]] = s;
    }
    K.solve(b);
    for (let i = 0; i < n; i++) expect(b[pos[i]]).toBeCloseTo(xTrue[i], 10);
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
