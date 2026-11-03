import { describe, expect, it } from "vitest";
import { layered, mc, runVerification } from "../verification/cases";

describe("pseudostatic seismic load", () => {
  const def = {
    ...layered([[0, 10], [10, 10], [25, 0], [45, 0]], -10, [{ name: "S", topY: null, model: mc(5, 30, 19) }]),
    customSearchPlanes: [{ cx: 20, cy: 20, radius: 21 }],
    customPlanesOnly: true,
  };
  const run = (opts: Record<string, number> = {}) => runVerification(def, "Morgenstern-Price", { slices: 30, ...opts });

  it("kh·W in the sliding direction at the slice's centre of gravity, kv·W on the slice", () => {
    const still = run().slope.search[0].slices!;
    const shaken = run({ seismicHorizontal: 0.1, seismicVertical: 0.05 }).slope.search[0].slices!;
    shaken.forEach((s, i) => {
      const w = still[i].weight;
      expect(s.hForce! - (still[i].hForce ?? 0)).toBeCloseTo(0.1 * w, 9);
      expect(s.udl - still[i].udl).toBeCloseTo(0.05 * w, 9);
      // the centre of gravity lies between the base and the top
      expect(s.yCentroid!).toBeGreaterThan(s.yBottom - 1e-9);
      expect(s.yCentroid!).toBeLessThan(s.yTop + 1e-9);
      expect(s.extraMoment! - (still[i].extraMoment ?? 0)).toBeCloseTo(0.1 * w * (20 - s.yCentroid!), 6);
    });
  });

  it("lowers the factor of safety with kh, and an upward kv lowers it further", () => {
    const f0 = run().fos!, f1 = run({ seismicHorizontal: 0.1 }).fos!, f2 = run({ seismicHorizontal: 0.1, seismicVertical: -0.05 }).fos!;
    expect(f1).toBeLessThan(f0);
    expect(f2).toBeLessThan(f1);
    expect(() => run({ seismicHorizontal: 2 })).toThrow(/seismicHorizontal/);
  });

  it("the centre of gravity of a rectangle-like slice is at mid-height", () => {
    // flat ground: the slice centroids at the middle of each column
    const flat = layered([[0, 10], [40, 10]], -10, [{ name: "S", topY: null, model: mc(5, 30, 19) }]);
    const r = runVerification({ ...flat, customSurfaces: [{ points: [[5, 10], [10, 4], [30, 4], [35, 10]] }], customPlanesOnly: true }, "Morgenstern-Price", { slices: 20, seismicHorizontal: 0.1 });
    for (const s of r.slope.search[0].slices!) {
      if (s.y0Bottom !== 4 || s.y1Bottom !== 4) continue;
      expect(s.yCentroid!).toBeCloseTo(7, 9);
    }
  });
});

describe("inclined line loads", () => {
  const base = layered([[0, 10], [10, 10], [25, 0], [45, 0]], -10, [{ name: "S", topY: null, model: mc(5, 30, 19) }]);
  const circle = { customSearchPlanes: [{ cx: 20, cy: 20, radius: 21 }], customPlanesOnly: true };
  const run = (ll: { magnitude: number; x: number; angle?: number; y?: number }[], orientation?: "rtl") =>
    runVerification({ ...base, lineLoads: ll, ...circle, ...(orientation ? { orientation } : {}) }, "Morgenstern-Price", { slices: 30 });

  it("splits into its vertical part and a horizontal force at the load point", () => {
    const [vertical, inclined] = [run([{ magnitude: 50, x: 6 }]), run([{ magnitude: 100, x: 6, angle: 60, y: 9 }])];
    const at = (r: typeof vertical) => r.slope.search[0].slices!.find((s) => s.xLeft <= 6 && s.xRight > 6)!;
    expect(at(inclined).ll).toBeCloseTo(at(vertical).ll, 9); // 100 cos 60°
    expect(at(inclined).hForce!).toBeCloseTo(100 * Math.sin(Math.PI / 3), 9);
    expect(at(inclined).extraMoment!).toBeCloseTo(100 * Math.sin(Math.PI / 3) * (20 - 9), 9);
  });

  it("pushing towards the sliding direction lowers the factor of safety, against it raises it; the same mirrored", () => {
    const f0 = run([{ magnitude: 100, x: 6 }]).fos!;
    const towards = run([{ magnitude: 100, x: 6, angle: 30 }]).fos!;
    const against = run([{ magnitude: 100, x: 6, angle: -30 }]).fos!;
    expect(towards).toBeLessThan(f0);
    expect(against).toBeGreaterThan(f0);
    // mirrored model: the geometry and the load mirrored give the same factor
    const m = (x: number) => 45 - x;
    const mirrored = runVerification({
      ...layered([[0, 0], [20, 0], [35, 10], [45, 10]], -10, [{ name: "S", topY: null, model: mc(5, 30, 19) }]),
      orientation: "rtl",
      lineLoads: [{ magnitude: 100, x: m(6), angle: -30 }],
      customSearchPlanes: [{ cx: m(20), cy: 20, radius: 21 }],
      customPlanesOnly: true,
    }, "Morgenstern-Price", { slices: 30 }).fos!;
    expect(mirrored).toBeCloseTo(towards, 9);
  });
});
