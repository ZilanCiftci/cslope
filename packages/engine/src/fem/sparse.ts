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
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts). The matrix's
 * pattern and factors live in the engine; `values` and `upper` are kept
 * here, where callers write them, and sent with `factor()`.
 */
import { engineEpoch } from "../engine";
import { testCall } from "../facade/internal";

/**
 * Nested dissection order of the nodes of a graph with node coordinates.
 * @returns perm[k] = node placed k-th.
 */
export function nestedDissection(x: ArrayLike<number>, y: ArrayLike<number>, adj: readonly Int32Array[]): Int32Array {
  return testCall("fem/sparse::nestedDissection", [Array.from(x), Array.from(y), adj]);
}

/** Adjacency of the nodes of a T6 mesh (nodes of a common element). */
export function nodeGraph(el: Int32Array, ne: number, nn: number): Int32Array[] {
  return testCall("fem/sparse::nodeGraph", [el, ne, nn]);
}

interface MatrixHandle {
  handle: number;
  epoch: number;
}
const finalizer = new FinalizationRegistry<MatrixHandle>((h) => {
  if (h.epoch === engineEpoch()) testCall("fem/sparse::$free", [h.handle]);
});

interface MatrixData {
  handle: number;
  n: number;
  diag: Int32Array;
  values: Float64Array;
  upper: Float64Array | null;
}

export class SparseCholesky {
  readonly n: number;
  /** Values of the lower triangle of A, in the order of the row pattern. */
  readonly values: Float64Array;
  /** Index of the diagonal of each row in `values`. */
  readonly diag: Int32Array;
  /** Unsymmetric matrices: A(j, i) above the diagonal at the position of A(i, j) (i > j) in `values`; null for a symmetric matrix. */
  readonly upper: Float64Array | null;
  factored = false;
  private readonly h: MatrixHandle;

  private constructor(d: MatrixData) {
    this.h = { handle: d.handle, epoch: engineEpoch() };
    finalizer.register(this, this.h);
    this.n = d.n;
    this.values = d.values;
    this.diag = d.diag;
    this.upper = d.upper;
  }

  /**
   * Matrix of n equations whose nonzeros are the couplings within each
   * group of `size` equations in `groups` (an element's degrees of
   * freedom; −1 entries are skipped). Equations should already be in a
   * fill-reducing order.
   */
  static fromGroups(n: number, groups: Int32Array, size: number): SparseCholesky {
    return new SparseCholesky(testCall<MatrixData>("fem/sparse::$fromGroups", [n, groups, size]));
  }

  /** A zero matrix with the same pattern (and symbolic factorisation), with its own upper triangle if `unsymmetric`. */
  emptyCopy(unsymmetric = false): SparseCholesky {
    return new SparseCholesky(testCall<MatrixData>("fem/sparse::$emptyCopy", [this.h.handle, unsymmetric]));
  }

  /** Add v to entries (i, j) and (j, i) (once on the diagonal): a symmetric contribution. */
  add(i: number, j: number, v: number): void {
    const p = this.indexOf(i, j);
    this.values[p] += v;
    if (this.upper && i !== j) this.upper[p] += v;
  }

  /** Position of entry (i, j) (or (j, i)) in `values`; throws outside the pattern. */
  indexOf(i: number, j: number): number {
    return testCall("fem/sparse::$indexOf", [this.h.handle, i, j]);
  }

  /** Cholesky factorisation A = L Lᵀ (L U for an unsymmetric matrix). Throws if A is not positive definite (has a zero pivot). */
  factor(): void {
    this.factored = false;
    testCall("fem/sparse::$factor", [this.h.handle, this.values, this.upper]);
    this.factored = true;
  }

  /** Solve A x = b in place (after `factor`). */
  solve(b: Float64Array): void {
    b.set(testCall<Float64Array>("fem/sparse::$solve", [this.h.handle, b]));
  }
}
