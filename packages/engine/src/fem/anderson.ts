/**
 * Anderson acceleration of a fixed-point iteration x ← G(x) (Anderson 1965,
 * J. ACM 12(4), 547–560; Walker & Ni 2011, SIAM J. Numer. Anal. 49(4),
 * 1715–1735, "Type II" with the residual f = G(x) − x): the next iterate
 * is G(x_k) − Σ γ_j ΔG_j, with γ minimising ‖f_k − Σ γ_j Δf_j‖ over the
 * last m differences.
 *
 * Implementation choices (not from the literature): the least squares
 * problem by its normal equations with a relative Tikhonov term of 10⁻¹⁰
 * on the trace, the Gram matrix of the differences kept and updated by one
 * row per iteration; the residual may be measured on a part of the vector
 * (`residualStart`): the viscoplastic iteration mixes its plastic strains
 * and body loads with the same coefficients and measures the residual on
 * the body loads (forces, one unit).
 */
export class Anderson {
  private readonly dG: Float64Array[] = [];
  private readonly dF: Float64Array[] = [];
  private readonly gram: number[][] = [];
  private prevG: Float64Array | null = null;
  private prevF: Float64Array | null = null;

  constructor(
    private readonly n: number,
    private readonly m: number,
    private readonly residualStart = 0,
  ) {}

  /** Forget the history (e.g. after the problem changed). */
  reset(): void {
    this.dG.length = 0; this.dF.length = 0; this.gram.length = 0;
    this.prevG = null; this.prevF = null;
  }

  /**
   * One step: `x` the iterate that went in, `g` = G(x) that came out; `g`
   * is overwritten by the accelerated next iterate.
   */
  step(x: Float64Array, g: Float64Array): void {
    const { n, m, residualStart: r0 } = this;
    const nr = n - r0;
    const f = new Float64Array(nr);
    for (let i = 0; i < nr; i++) f[i] = g[r0 + i] - x[r0 + i];
    const gCopy = g.slice();
    if (this.prevG && this.prevF) {
      const dg = new Float64Array(n), df = new Float64Array(nr);
      for (let i = 0; i < n; i++) dg[i] = gCopy[i] - this.prevG[i];
      for (let i = 0; i < nr; i++) df[i] = f[i] - this.prevF[i];
      if (this.dF.length === m) { this.dG.shift(); this.dF.shift(); this.gram.shift(); for (const row of this.gram) row.shift(); }
      const row: number[] = [];
      for (const other of this.dF) { let s = 0; for (let i = 0; i < nr; i++) s += df[i] * other[i]; row.push(s); }
      let self = 0;
      for (let i = 0; i < nr; i++) self += df[i] * df[i];
      for (let k = 0; k < this.gram.length; k++) this.gram[k].push(row[k]);
      row.push(self);
      this.gram.push(row);
      this.dG.push(dg); this.dF.push(df);
    }
    this.prevG = gCopy; this.prevF = f;
    const k = this.dF.length;
    if (k === 0) return;
    const A = new Float64Array(k * k), b = new Float64Array(k);
    let tr = 0;
    for (let a = 0; a < k; a++) {
      for (let c = 0; c < k; c++) A[a * k + c] = this.gram[a][c];
      tr += A[a * k + a];
      let s = 0;
      const d = this.dF[a];
      for (let i = 0; i < nr; i++) s += d[i] * f[i];
      b[a] = s;
    }
    if (!(tr > 0)) return;
    for (let a = 0; a < k; a++) A[a * k + a] += 1e-10 * tr;
    if (!solve(k, A, b)) return;
    for (let a = 0; a < k; a++) {
      const ga = b[a], d = this.dG[a];
      if (ga !== 0) for (let i = 0; i < n; i++) g[i] -= ga * d[i];
    }
  }
}

/** Gaussian elimination with partial pivoting in place; false if singular. */
function solve(n: number, a: Float64Array, b: Float64Array): boolean {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    if (!(Math.abs(a[p * n + c]) > 0)) return false;
    if (p !== c) {
      for (let q = 0; q < n; q++) { const t = a[c * n + q]; a[c * n + q] = a[p * n + q]; a[p * n + q] = t; }
      const t = b[c]; b[c] = b[p]; b[p] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / a[c * n + c];
      if (f === 0) continue;
      for (let q = c; q < n; q++) a[r * n + q] -= f * a[c * n + q];
      b[r] -= f * b[c];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let v = b[c];
    for (let q = c + 1; q < n; q++) v -= a[c * n + q] * b[q];
    b[c] = v / a[c * n + c];
  }
  return true;
}
