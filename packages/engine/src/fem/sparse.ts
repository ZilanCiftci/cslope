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
 * Implementation choices: parts of at most 32 nodes are not split, and the
 * separator is the smaller of the two boundary layers along the split.
 */

/** Size below which a part is not split further. */
const LEAF = 32;

/**
 * Nested dissection order of the nodes of a graph with node coordinates.
 * @returns perm[k] = node placed k-th.
 */
export function nestedDissection(x: ArrayLike<number>, y: ArrayLike<number>, adj: readonly Int32Array[]): Int32Array {
  const n = adj.length;
  const out = new Int32Array(n);
  let pos = 0;
  const label = new Int32Array(n);
  let stamp = 0;
  const split = (nodes: Int32Array): void => {
    if (nodes.length <= LEAF) {
      for (const v of nodes) out[pos++] = v;
      return;
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of nodes) {
      x0 = Math.min(x0, x[v]); x1 = Math.max(x1, x[v]);
      y0 = Math.min(y0, y[v]); y1 = Math.max(y1, y[v]);
    }
    const c = x1 - x0 >= y1 - y0 ? x : y;
    const sorted = Int32Array.from(nodes).sort((a, b) => c[a] - c[b] || a - b);
    const mid = sorted.length >> 1;
    const left = sorted.subarray(0, mid), right = sorted.subarray(mid);
    const lL = ++stamp, lR = ++stamp;
    for (const v of left) label[v] = lL;
    for (const v of right) label[v] = lR;
    // Separator: the nodes of the smaller boundary layer.
    const touching = (side: Int32Array, other: number) =>
      side.filter((v) => {
        for (const w of adj[v]) if (label[w] === other) return true;
        return false;
      });
    const sepL = touching(left, lR), sepR = touching(right, lL);
    const fromLeft = sepL.length <= sepR.length;
    const sep = fromLeft ? sepL : sepR;
    const lS = ++stamp;
    for (const v of sep) label[v] = lS;
    const a = fromLeft ? left.filter((v) => label[v] !== lS) : left;
    const b = fromLeft ? right : right.filter((v) => label[v] !== lS);
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
}

export class SparseCholesky {
  readonly n: number;
  /** Values of the lower triangle of A, in the order of the row pattern. */
  readonly values: Float64Array;
  /** Index of the diagonal of each row in `values`. */
  readonly diag: Int32Array;
  private readonly sym: Symbolic;
  private readonly Lx: Float64Array;
  factored = false;

  private constructor(sym: Symbolic) {
    this.sym = sym;
    this.n = sym.n;
    this.values = new Float64Array(sym.rowCols.length);
    this.diag = new Int32Array(sym.n);
    for (let i = 0; i < sym.n; i++) this.diag[i] = sym.rowPtr[i + 1] - 1;
    this.Lx = new Float64Array(sym.Li.length);
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

  /** A zero matrix with the same pattern (and symbolic factorisation). */
  emptyCopy(): SparseCholesky {
    return new SparseCholesky(this.sym);
  }

  /** Add v to entry (i, j); entries above the diagonal are mirrored. */
  add(i: number, j: number, v: number): void {
    if (j > i) { const t = i; i = j; j = t; }
    const { rowPtr, rowCols } = this.sym;
    let lo = rowPtr[i], hi = rowPtr[i + 1] - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rowCols[mid] < j) lo = mid + 1;
      else hi = mid;
    }
    if (rowCols[lo] !== j) throw new Error(`entry (${i}, ${j}) is outside the matrix pattern`);
    this.values[lo] += v;
  }

  /** Cholesky factorisation A = L Lᵀ. Throws if A is not positive definite. */
  factor(): void {
    const { n, rowPtr, rowCols, Lp, Li, parent } = this.sym;
    const a = this.values, Lx = this.Lx;
    const x = new Float64Array(n);
    const next = new Int32Array(n);
    for (let j = 0; j < n; j++) next[j] = Lp[j] + 1;
    const mark = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n), pattern = new Int32Array(n);
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

  /** Solve L Lᵀ x = b in place (after `factor`). */
  solve(b: Float64Array): void {
    const { n, Lp, Li } = this.sym;
    const Lx = this.Lx;
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
