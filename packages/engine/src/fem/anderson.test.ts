import { describe, it, expect } from "vitest";
import { Anderson } from "./anderson";

describe("Anderson", () => {
  it("accelerates a slowly contracting linear fixed-point iteration", () => {
    // G(x) = A x + b with a contraction of 0.99 along one direction
    const n = 20;
    const G = (x: Float64Array) => {
      const g = new Float64Array(n);
      for (let i = 0; i < n; i++) g[i] = (i === 0 ? 0.99 : 0.5) * x[i] + 1;
      return g;
    };
    const solution = (i: number) => 1 / (1 - (i === 0 ? 0.99 : 0.5));
    const run = (accelerate: boolean) => {
      const aa = new Anderson(n, 5);
      let x = new Float64Array(n);
      for (let k = 1; k <= 2000; k++) {
        const g = G(x);
        if (accelerate) aa.step(x, g);
        x = g;
        let err = 0;
        for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(x[i] - solution(i)));
        if (err < 1e-8) return k;
      }
      return Infinity;
    };
    const plain = run(false), fast = run(true);
    expect(plain).toBeGreaterThan(1500);
    expect(fast).toBeLessThan(30);
  });

  it("measures the residual on a part of the vector and mixes all of it", () => {
    // x = (a, b): G(a, b) = (2 b, 0.9 b + 1), the residual on b alone
    const aa = new Anderson(2, 3, 1);
    let x = new Float64Array([0, 0]);
    for (let k = 0; k < 20; k++) {
      const g = new Float64Array([2 * x[1], 0.9 * x[1] + 1]);
      aa.step(x, g);
      x = g;
    }
    expect(x[1]).toBeCloseTo(10, 6);
    expect(x[0]).toBeCloseTo(20, 4);
  });
});
