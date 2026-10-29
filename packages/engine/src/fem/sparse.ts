/**
 * Sparse symmetric positive definite systems: nested dissection ordering
 * and sparse Cholesky factorisation.
 *
 * The nodes are ordered by geometric nested dissection (George 1973, SIAM
 * J. Numer. Anal. 10, 345–363; George & Liu, Computer Solution of Large
 * Sparse Positive Definite Systems, 1981, ch. 8): the mesh is split at the
 * median of its longer extent, the nodes of one half that touch the other
 * form the separator and are numbered last, and both halves are split in
 * turn. On a two-dimensional mesh the factor then holds O(n log n) entries
 * instead of the O(n^1.5) of a banded (envelope) ordering, and the
 * substitutions, which the viscoplastic iteration repeats thousands of
 * times, cost in proportion.
 *
 * The factorisation is the up-looking (row) Cholesky of Davis, Direct
 * Methods for Sparse Linear Systems, SIAM 2006, ch. 4: the elimination
 * tree gives the pattern of each row of L, computed once (symbolic
 * analysis) and shared by every matrix of the same pattern.
 *
 * The separator of a split is the minimum vertex cover of the bipartite
 * graph of the edges that cross it (König's theorem; the vertex separator
 * from an edge separator of Pothen, Simon & Liou 1990, SIAM J. Matrix Anal.
 * Appl. 11(3), 430–452), found by a maximum matching with augmenting paths
 * (Kuhn 1955, Nav. Res. Logist. Q. 2, 83–97).
 *
 * A matrix with an upper triangle of its own (`unsymmetric`, the tangent
 * of non-associated plasticity) is factorised A = L U without pivoting on
 * the same symbolic structure (the pattern of A is symmetric, so U has the
 * pattern of Lᵀ): row k of L and column k of U are the two triangular
 * solves of the up-looking method (Davis 2006, § 6.1 for the left-looking
 * form of the same recurrence).
 *
 * Implementation choices: both coordinate directions are tried and the
 * smaller separator kept, and parts of at most 8 nodes are not split
 * (measured 2026-10-29 on V055, V056, V063, V068: 30 % fewer entries in L
 * and half the work of the factorisation of the earlier choice, the longer
 * extent, the smaller boundary layer and parts of 32 nodes).
 */

/** Size below which a part is not split further. */
const LEAF = 8;

/**
 * Nested dissection order of the nodes of a graph with node coordinates.
 * @returns perm[k] = node placed k-th.
 */
export function nestedDissection(x: ArrayLike<number>, y: ArrayLike<number>, adj: readonly Int32Array[]): Int32Array {
  const n = adj.length;
  const out = new Int32Array(n);
  let pos = 0;
  const label = new Int32Array(n);
  const local = new Int32Array(n).fill(-1);
  let stamp = 0;
  // Split `nodes` at the median of coordinate c: the two halves and a
  // vertex separator between them, the minimum vertex cover of the
  // bipartite graph of the edges that cross the split.
  const trySplit = (nodes: Int32Array, c: ArrayLike<number>) => {
    const sorted = Int32Array.from(nodes).sort((a, b) => c[a] - c[b] || a - b);
    const mid = sorted.length >> 1;
    const left = sorted.subarray(0, mid), right = sorted.subarray(mid);
    const lL = ++stamp, lR = ++stamp;
    for (const v of left) label[v] = lL;
    for (const v of right) label[v] = lR;
    const bL = left.filter((v) => { for (const w of adj[v]) if (label[w] === lR) return true; return false; });
    const bR = right.filter((v) => { for (const w of adj[v]) if (label[w] === lL) return true; return false; });
    return { left, right, sep: minimumCover(bL, bR, lR) };
  };
  // König's theorem: a maximum matching of the crossing edges (augmenting
  // paths), then the cover (L \ Z) ∪ (R ∩ Z), Z the vertices reachable
  // from unmatched left vertices by alternating paths.
  const minimumCover = (bL: Int32Array, bR: Int32Array, lR: number): Int32Array => {
    bR.forEach((v, j) => (local[v] = j));
    const nbr: Int32Array[] = Array.from(bL, (v) => {
      const r: number[] = [];
      for (const w of adj[v]) if (label[w] === lR && local[w] >= 0) r.push(local[w]);
      return Int32Array.from(r);
    });
    const matchR = new Int32Array(bR.length).fill(-1), matchL = new Int32Array(bL.length).fill(-1);
    const seen = new Int32Array(bR.length).fill(-1);
    const augment = (u: number, round: number): boolean => {
      for (const j of nbr[u]) {
        if (seen[j] === round) continue;
        seen[j] = round;
        if (matchR[j] < 0 || augment(matchR[j], round)) { matchR[j] = u; matchL[u] = j; return true; }
      }
      return false;
    };
    for (let i = 0; i < bL.length; i++) augment(i, i);
    const zL = new Uint8Array(bL.length), zR = new Uint8Array(bR.length);
    const stack: number[] = [];
    for (let i = 0; i < bL.length; i++) if (matchL[i] < 0) { zL[i] = 1; stack.push(i); }
    while (stack.length) {
      const u = stack.pop()!;
      for (const j of nbr[u]) {
        if (zR[j]) continue;
        zR[j] = 1;
        const m = matchR[j];
        if (m >= 0 && !zL[m]) { zL[m] = 1; stack.push(m); }
      }
    }
    for (const v of bR) local[v] = -1;
    const cover: number[] = [];
    bL.forEach((v, i) => { if (!zL[i]) cover.push(v); });
    bR.forEach((v, j) => { if (zR[j]) cover.push(v); });
    return Int32Array.from(cover);
  };
  const split = (nodes: Int32Array): void => {
    if (nodes.length <= LEAF) {
      for (const v of nodes) out[pos++] = v;
      return;
    }
    let best: ReturnType<typeof trySplit> | null = null;
    for (const c of [x, y]) {
      const r = trySplit(nodes, c);
      if (!best || r.sep.length < best.sep.length) best = r;
    }
    const { left, right, sep } = best!;
    const lS = ++stamp;
    for (const v of sep) label[v] = lS;
    const a = left.filter((v) => label[v] !== lS);
    const b = right.filter((v) => label[v] !== lS);
    if (a.length === nodes.length || b.length === nodes.length) {
      for (const v of nodes) out[pos++] = v;
      return;
    }
    split(Int32Array.from(a));
    split(Int32Array.from(b));
    for (const v of sep) out[pos++] = v;
  };
  split(Int32Array.from({ length: n }, (_, i) => i));
  return out;
}

/** Adjacency of the nodes of a T6 mesh (nodes of a common element). */
export function nodeGraph(el: Int32Array, ne: number, nn: number): Int32Array[] {
  const nbr: Set<number>[] = Array.from({ length: nn }, () => new Set<number>());
  for (let e = 0; e < ne; e++) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (a !== b) nbr[el[6 * e + a]].add(el[6 * e + b]);
  return nbr.map((s) => Int32Array.from(s));
}

/** Pattern and symbolic factorisation, shared by matrices of the same structure. */
interface Symbolic {
  n: number;
  /** Lower triangle of A by rows: columns rowCols[rowPtr[i] … rowPtr[i+1]) ascending, the diagonal last. */
  rowPtr: Int32Array;
  rowCols: Int32Array;
  /** L by columns: rows Li[Lp[j] … Lp[j+1]) ascending, the diagonal first. */
  Lp: Int32Array;
  Li: Int32Array;
  parent: Int32Array;
  /** Work arrays of `factor`, shared by the matrices of this pattern (one factorisation at a time per thread). */
  work?: { x: Float64Array; next: Int32Array; mark: Int32Array; stack: Int32Array; pattern: Int32Array };
  /** Second work vector of the LU factorisation. */
  workY?: Float64Array;
}

export class SparseCholesky {
  readonly n: number;
  /** Values of the lower triangle of A, in the order of the row pattern. */
  readonly values: Float64Array;
  /** Index of the diagonal of each row in `values`. */
  readonly diag: Int32Array;
  private readonly sym: Symbolic;
  private readonly Lx: Float64Array;
  /**
   * Unsymmetric matrices: A(j, i) above the diagonal at the position of
   * A(i, j) (i > j) in `values`; null for a symmetric matrix.
   */
  readonly upper: Float64Array | null;
  /** U of A = L U by rows, in the layout of Lx (U(j, j) first, then U(j, Li[p])). */
  private readonly Ux: Float64Array | null;
  factored = false;

  private constructor(sym: Symbolic, unsymmetric = false) {
    this.sym = sym;
    this.n = sym.n;
    this.values = new Float64Array(sym.rowCols.length);
    this.diag = new Int32Array(sym.n);
    for (let i = 0; i < sym.n; i++) this.diag[i] = sym.rowPtr[i + 1] - 1;
    this.Lx = new Float64Array(sym.Li.length);
    this.upper = unsymmetric ? new Float64Array(sym.rowCols.length) : null;
    this.Ux = unsymmetric ? new Float64Array(sym.Li.length) : null;
  }

  /**
   * Matrix of n equations whose nonzeros are the couplings within each
   * group of `size` equations in `groups` (an element's degrees of
   * freedom; −1 entries are skipped). Equations should already be in a
   * fill-reducing order.
   */
  static fromGroups(n: number, groups: Int32Array, size: number): SparseCholesky {
    // Row patterns of the lower triangle.
    const rows: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    for (let g = 0; g < groups.length; g += size) {
      for (let a = 0; a < size; a++) {
        const i = groups[g + a];
        if (i < 0) continue;
        for (let b = 0; b < size; b++) {
          const j = groups[g + b];
          if (j >= 0 && j <= i) rows[i].add(j);
        }
      }
    }
    const rowPtr = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) { rows[i].add(i); rowPtr[i + 1] = rowPtr[i] + rows[i].size; }
    const rowCols = new Int32Array(rowPtr[n]);
    for (let i = 0; i < n; i++) rowCols.set(Int32Array.from(rows[i]).sort(), rowPtr[i]);

    // Elimination tree (Davis 2006, ch. 4).
    const parent = new Int32Array(n).fill(-1), ancestor = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      for (let p = rowPtr[k]; p < rowPtr[k + 1] - 1; p++) {
        let i = rowCols[p];
        while (i !== -1 && i < k) {
          const next = ancestor[i];
          ancestor[i] = k;
          if (next === -1) parent[i] = k;
          i = next;
        }
      }
    }
    // Column counts and row patterns of L from the row subtrees.
    const count = new Int32Array(n).fill(1);
    const mark = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    const reach = (k: number, visit: (i: number) => void) => {
      mark[k] = k;
      for (let p = rowPtr[k]; p < rowPtr[k + 1] - 1; p++) {
        let len = 0;
        for (let i = rowCols[p]; mark[i] !== k; i = parent[i]) { stack[len++] = i; mark[i] = k; }
        while (len > 0) visit(stack[--len]);
      }
    };
    for (let k = 0; k < n; k++) reach(k, (i) => count[i]++);
    const Lp = new Int32Array(n + 1);
    for (let j = 0; j < n; j++) Lp[j + 1] = Lp[j] + count[j];
    // Diagonal first, then row k of every column in the pattern of row k:
    // taking k in increasing order sorts each column.
    const Li = new Int32Array(Lp[n]);
    const next = new Int32Array(n);
    for (let j = 0; j < n; j++) { Li[Lp[j]] = j; next[j] = Lp[j] + 1; }
    mark.fill(-1);
    for (let k = 0; k < n; k++) reach(k, (i) => { Li[next[i]++] = k; });
    return new SparseCholesky({ n, rowPtr, rowCols, Lp, Li, parent });
  }

  /** A zero matrix with the same pattern (and symbolic factorisation), with its own upper triangle if `unsymmetric`. */
  emptyCopy(unsymmetric = false): SparseCholesky {
    return new SparseCholesky(this.sym, unsymmetric);
  }

  /** Add v to entries (i, j) and (j, i) (once on the diagonal): a symmetric contribution. */
  add(i: number, j: number, v: number): void {
    const p = this.indexOf(i, j);
    this.values[p] += v;
    if (this.upper && i !== j) this.upper[p] += v;
  }

  /** Position of entry (i, j) (or (j, i)) in `values`; throws outside the pattern. */
  indexOf(i: number, j: number): number {
    if (j > i) { const t = i; i = j; j = t; }
    const { rowPtr, rowCols } = this.sym;
    let lo = rowPtr[i], hi = rowPtr[i + 1] - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rowCols[mid] < j) lo = mid + 1;
      else hi = mid;
    }
    if (rowCols[lo] !== j) throw new Error(`entry (${i}, ${j}) is outside the matrix pattern`);
    return lo;
  }

  /** Cholesky factorisation A = L Lᵀ (L U for an unsymmetric matrix). Throws if A is not positive definite (has a zero pivot). */
  factor(): void {
    if (this.upper) { this.factorLU(); return; }
    const { n, rowPtr, rowCols, Lp, Li, parent } = this.sym;
    const a = this.values, Lx = this.Lx;
    const w = (this.sym.work ??= {
      x: new Float64Array(n), next: new Int32Array(n), mark: new Int32Array(n), stack: new Int32Array(n), pattern: new Int32Array(n),
    });
    const { x, next, mark, stack, pattern } = w;
    x.fill(0);
    for (let j = 0; j < n; j++) next[j] = Lp[j] + 1;
    mark.fill(-1);
    for (let k = 0; k < n; k++) {
      // Pattern of row k of L in topological order, and A(k, 0…k) scattered into x.
      let top = n;
      mark[k] = k;
      for (let p = rowPtr[k]; p < rowPtr[k + 1] - 1; p++) {
        let i = rowCols[p], len = 0;
        x[i] = a[p];
        for (; mark[i] !== k; i = parent[i]) { stack[len++] = i; mark[i] = k; }
        while (len > 0) pattern[--top] = stack[--len];
      }
      let d = a[rowPtr[k + 1] - 1];
      for (; top < n; top++) {
        const i = pattern[top];
        const lki = x[i] / Lx[Lp[i]];
        x[i] = 0;
        const end = next[i];
        for (let p = Lp[i] + 1; p < end; p++) x[Li[p]] -= Lx[p] * lki;
        d -= lki * lki;
        Lx[next[i]++] = lki;
      }
      if (!(d > 0)) throw new Error(`stiffness matrix not positive definite at equation ${k}`);
      Lx[Lp[k]] = Math.sqrt(d);
    }
    this.factored = true;
  }

  /**
   * A = L U without pivoting, L unit lower triangular. For row k, with the
   * pattern of row k of L (the reach of A(k, 0…k−1) in the elimination
   * tree, which is also the pattern of column k of U), in topological order:
   * L(k, i) = x_i / U(i, i), x_r −= L(k, i)·U(i, r); U(i, k) = y_i,
   * y_r −= L(r, i)·U(i, k); then U(k, k) = A(k, k) − Σ L(k, i)·U(i, k).
   */
  private factorLU(): void {
    const { n, rowPtr, rowCols, Lp, Li, parent } = this.sym;
    const a = this.values, au = this.upper!, Lx = this.Lx, Ux = this.Ux!;
    const w = (this.sym.work ??= {
      x: new Float64Array(n), next: new Int32Array(n), mark: new Int32Array(n), stack: new Int32Array(n), pattern: new Int32Array(n),
    });
    const { x, next, mark, stack, pattern } = w;
    const y = (this.sym.workY ??= new Float64Array(n));
    x.fill(0);
    y.fill(0);
    for (let j = 0; j < n; j++) { next[j] = Lp[j] + 1; Lx[Lp[j]] = 1; }
    mark.fill(-1);
    for (let k = 0; k < n; k++) {
      let top = n;
      mark[k] = k;
      for (let p = rowPtr[k]; p < rowPtr[k + 1] - 1; p++) {
        let i = rowCols[p], len = 0;
        x[i] = a[p];
        y[i] = au[p];
        for (; mark[i] !== k; i = parent[i]) { stack[len++] = i; mark[i] = k; }
        while (len > 0) pattern[--top] = stack[--len];
      }
      const akk = a[rowPtr[k + 1] - 1];
      let d = akk;
      for (; top < n; top++) {
        const i = pattern[top];
        const lki = x[i] / Ux[Lp[i]], uik = y[i];
        x[i] = 0;
        y[i] = 0;
        const end = next[i];
        for (let p = Lp[i] + 1; p < end; p++) {
          const r = Li[p];
          x[r] -= Ux[p] * lki;
          y[r] -= Lx[p] * uik;
        }
        d -= lki * uik;
        Lx[end] = lki;
        Ux[end] = uik;
        next[i]++;
      }
      if (!(Math.abs(d) > 1e-12 * Math.abs(akk))) throw new Error(`zero pivot at equation ${k}`);
      Ux[Lp[k]] = d;
    }
    this.factored = true;
  }

  /** Solve A x = b in place (after `factor`). */
  solve(b: Float64Array): void {
    const { n, Lp, Li } = this.sym;
    const Lx = this.Lx, Ux = this.Ux;
    if (Ux) {
      for (let j = 0; j < n; j++) {
        const bj = b[j];
        if (bj !== 0) for (let p = Lp[j] + 1; p < Lp[j + 1]; p++) b[Li[p]] -= Lx[p] * bj;
      }
      for (let j = n - 1; j >= 0; j--) {
        let s = b[j];
        for (let p = Lp[j] + 1; p < Lp[j + 1]; p++) s -= Ux[p] * b[Li[p]];
        b[j] = s / Ux[Lp[j]];
      }
      return;
    }
    for (let j = 0; j < n; j++) {
      const bj = (b[j] /= Lx[Lp[j]]);
      if (bj !== 0) for (let p = Lp[j] + 1; p < Lp[j + 1]; p++) b[Li[p]] -= Lx[p] * bj;
    }
    for (let j = n - 1; j >= 0; j--) {
      let s = b[j];
      for (let p = Lp[j] + 1; p < Lp[j + 1]; p++) s -= Lx[p] * b[Li[p]];
      b[j] = s / Lx[Lp[j]];
    }
  }
}
