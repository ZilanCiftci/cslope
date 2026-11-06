/**
 * Triangular meshing of a slope for the finite element module: the types of
 * the mesher's input and output.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/mesh.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */

export interface MeshInput {
  /** Polygon of the whole domain (closed implicitly). */
  boundary: [number, number][];
  /** Further constraint polylines inside the domain (material boundaries). */
  segments: [number, number][][];
  /** Target element size at a point (m). */
  size: (x: number, y: number) => number;
  /** Smallest acceptable angle in degrees (default 25). */
  minAngle?: number;
  /** No triangle is split for its angle below this circumradius, and no segment shorter than it for encroachment (default: 1/8 of the smallest size, see `sizeMin`). */
  minSize?: number;
  /** Smallest value of `size` anywhere, when known (the default minSize also looks at the input vertices). */
  sizeMin?: number;
  /** Upper bound on the number of vertices (default 60 000). */
  maxVertices?: number;
}

export interface TriMesh {
  /** Vertex coordinates. */
  x: Float64Array;
  y: Float64Array;
  /** Corner vertices of each triangle, counter-clockwise (3 per triangle). */
  tri: Int32Array;
  /** Number of triangles. */
  count: number;
  /** Whether refinement stopped at the vertex cap. */
  capped: boolean;
  /** Constraint segments missing from the triangulation (shorter than the merge tolerance); normally 0. */
  missingSegments: number;
}
