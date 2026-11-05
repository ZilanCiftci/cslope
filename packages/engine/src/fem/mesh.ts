/**
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { testCall } from "../facade/internal";
/**
 * Triangular meshing of a slope for the finite element module.
 *
 * Method and sources:
 * - Delaunay triangulation by incremental insertion (Bowyer 1981, Comput.
 *   J. 24(2), 162–166; Watson 1981, Comput. J. 24(2), 167–172) of the
 *   planar straight-line graph formed by the external boundary and every
 *   material boundary.
 * - Delaunay refinement by Ruppert's algorithm (Ruppert 1995, J. Algorithms
 *   18(3), 548–585; Shewchuk 2002, Comput. Geom. 22, 21–74): encroached
 *   segments are split, and poor triangles (smallest angle below
 *   `minAngle`, or larger than the size field) get a vertex at their
 *   circumcentre unless that vertex would encroach a segment, in which
 *   case the segment is split instead. A segment with an input vertex at
 *   one end is split on concentric shells around that vertex (Ruppert 1995;
 *   Shewchuk 2002), so that the subsegments at a small input angle become
 *   equally long.
 *
 * Implementation choices (not from the literature), with their reasons:
 * - Smallest angle 25° by default (Ruppert's guarantee is about 20.7°,
 *   and the algorithm usually terminates up to about 33°; Shewchuk 2002).
 * - Small input angles (thin layers meeting the ground at a shallow
 *   angle), where Ruppert's algorithm need not terminate, are handled by
 *   refining for angle only triangles whose circumradius exceeds `minSize`
 *   (default 1/8 of the smallest size) and by a vertex cap.
 * - A triangle is split for size when its longest edge exceeds 1.4 × the
 *   size field.
 * - Constraint segments that cross (a reinforcement line through a
 *   material boundary) get a vertex at the crossing.
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

export function pointInPolygon(px: number, py: number, poly: readonly [number, number][]): boolean {
  return testCall("fem/mesh::pointInPolygon", [px, py, poly]);
}

/** The mesher calls `input.size` (a JavaScript function) from the engine. */
export function meshDomain(input: MeshInput): TriMesh {
  return testCall("fem/mesh::meshDomain", [input]);
}
