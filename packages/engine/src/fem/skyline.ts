/**
 * Symmetric positive definite systems in skyline (envelope) storage.
 *
 * Equations are ordered by the reverse Cuthill–McKee algorithm on the
 * node graph (Cuthill & McKee 1969; George & Liu, Computer Solution of
 * Large Sparse Positive Definite Systems, 1981, §4.3), which keeps the
 * envelope narrow, and factorised in place by row-oriented Cholesky.
 * Row i stores columns first[i] … i contiguously, so the inner products
 * of the factorisation and of the substitutions run over contiguous memory.
 */

/**
 * Reverse Cuthill–McKee order of the nodes of a graph given as adjacency
 * lists. Each connected component starts from a pseudo-peripheral node
 * (George & Liu 1979).
 *
 * @returns perm[k] = node placed k-th.
 */
export function reverseCuthillMcKee(adj: readonly Int32Array[]): Int32Array {
  const n = adj.length;
  const order = new Int32Array(n);
  const placed = new Uint8Array(n);
  const level = new Int32Array(n);
  let count = 0;

  const bfsLevels = (start: number): { last: number; depth: number } => {
    level.fill(-1);
    const queue = [start];
    level[start] = 0;
    let last = start;
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h];
      for (const w of adj[v]) if (level[w] < 0) { level[w] = level[v] + 1; queue.push(w); }
      last = v;
    }
    // smallest degree among the deepest level
    const depth = level[last];
    let best = last;
    for (const v of queue) if (level[v] === depth && adj[v].length < adj[best].length) best = v;
    return { last: best, depth };
  };

  for (let s = 0; s < n; s++) {
    if (placed[s]) continue;
    // pseudo-peripheral start node
    let start = s;
    let { last, depth } = bfsLevels(start);
    for (let k = 0; k < 8; k++) {
      const r = bfsLevels(last);
      if (r.depth <= depth) break;
      start = last; last = r.last; depth = r.depth;
    }
    const begin = count;
    order[count++] = start;
    placed[start] = 1;
    for (let h = begin; h < count; h++) {
      const v = order[h];
      const next = adj[v].filter((w) => !placed[w]).sort((a, b) => adj[a].length - adj[b].length);
      for (const w of next) { placed[w] = 1; order[count++] = w; }
    }
  }
  order.reverse();
  return order;
}

export class SkylineMatrix {
  readonly n: number;
  /** First stored column of each row. */
  readonly first: Int32Array;
  /** Index of the diagonal of each row in `values`; row i starts at diag[i] − (i − first[i]). */
  readonly diag: Int32Array;
  readonly values: Float64Array;
  factored = false;

  constructor(first: Int32Array) {
    this.n = first.length;
    this.first = first;
    this.diag = new Int32Array(this.n);
    let p = -1;
    for (let i = 0; i < this.n; i++) { p += i - first[i] + 1; this.diag[i] = p; }
    this.values = new Float64Array(p + 1);
  }

  /** Add v to entry (i, j); entries above the diagonal are mirrored. */
  add(i: number, j: number, v: number): void {
    if (j > i) { const t = i; i = j; j = t; }
    this.values[this.diag[i] - (i - j)] += v;
  }

  /** In-place Cholesky factorisation A = L Lᵀ. Throws if A is not positive definite. */
  factor(): void {
    const { n, first, diag, values: a } = this;
    for (let i = 0; i < n; i++) {
      const fi = first[i], ri = diag[i] - i; // a[ri + j] = A(i, j)
      for (let j = fi; j < i; j++) {
        const fj = first[j], rj = diag[j] - j;
        const k0 = fi > fj ? fi : fj;
        let s = a[ri + j];
        for (let k = k0; k < j; k++) s -= a[ri + k] * a[rj + k];
        a[ri + j] = s / a[diag[j]];
      }
      let s = a[diag[i]];
      for (let k = fi; k < i; k++) s -= a[ri + k] * a[ri + k];
      if (!(s > 0)) throw new Error(`stiffness matrix not positive definite at equation ${i}`);
      a[diag[i]] = Math.sqrt(s);
    }
    this.factored = true;
  }

  /** Solve L Lᵀ x = b in place (after `factor`). */
  solve(b: Float64Array): void {
    const { n, first, diag, values: a } = this;
    for (let i = 0; i < n; i++) {
      const ri = diag[i] - i;
      let s = b[i];
      for (let k = first[i]; k < i; k++) s -= a[ri + k] * b[k];
      b[i] = s / a[diag[i]];
    }
    for (let i = n - 1; i >= 0; i--) {
      const ri = diag[i] - i;
      const bi = (b[i] /= a[diag[i]]);
      if (bi !== 0) for (let k = first[i]; k < i; k++) b[k] -= a[ri + k] * bi;
    }
  }
}
