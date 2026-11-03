//! Regression tests from the review of the geometry port (the exact
//! TypeScript outputs of these cases are in the differential fixtures:
//! split_polygon "point …", "bowtie …", "spike", "one vertex", "short py",
//! …; layer_top "NaN …").

use cslope_engine::model::geometry_ops::*;

fn closed(px: &[f64], py: &[f64]) -> SplitPolygonResult {
    let mut px = px.to_vec();
    let mut py = py.to_vec();
    px.push(px[0]);
    py.push(py[0]);
    SplitPolygonResult {
        pieces: vec![PolygonXY { px, py }],
        split_failed: false,
    }
}

#[test]
fn a_cutting_line_of_one_point_meets_a_polygon_only_at_its_first_vertex() {
    // jsts's relate drops a line of fewer than two distinct points; what is
    // left is the polygon's only graph node, its first vertex. So the
    // polygon comes back unchanged (not re-noded) unless the point is that
    // vertex.
    let (px, py) = ([0.0, 10.0, 5.0], [0.0, 0.0, 8.0]);
    for (lx, ly) in [
        ([10.0, 10.0], [0.0, 0.0]), // another vertex
        ([5.0, 5.0], [0.0, 0.0]),   // on an edge
        ([5.0, 5.0], [3.0, 3.0]),   // inside
        ([20.0, 20.0], [1.0, 1.0]), // outside
    ] {
        let r = split_polygon_by_polyline_detailed(&px, &py, &lx, &ly).unwrap();
        assert_eq!(r, closed(&px, &py), "point ({}, {})", lx[0], ly[0]);
    }
    // at the first vertex the split runs (and finds nothing to cut)
    let r =
        split_polygon_by_polyline_detailed(&px, &py, &[0.0, 0.0, 0.0], &[0.0, 0.0, 0.0]).unwrap();
    assert_eq!(r.pieces.len(), 1);
    assert!(!r.split_failed);
}

#[test]
fn a_cutting_line_of_one_point_meets_a_rectangle_anywhere_on_it() {
    // A rectangle takes jsts's RectangleIntersects path: the point's
    // envelope is in the rectangle's. The split then runs and leaves one
    // piece (re-noded, so its start vertex may move).
    let (px, py) = ([0.0, 10.0, 10.0, 0.0, 0.0], [0.0, 0.0, 10.0, 10.0, 0.0]);
    for (x, y) in [(5.0, 5.0), (10.0, 5.0), (10.0, 10.0), (0.0, 0.0)] {
        let r = split_polygon_by_polyline_detailed(&px, &py, &[x, x], &[y, y]).unwrap();
        assert_eq!(r.pieces.len(), 1);
        assert!(!r.split_failed);
    }
    // the same square with a repeated vertex is not a rectangle to jsts
    let (px, py) = (
        [0.0, 10.0, 10.0, 10.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 10.0, 10.0, 0.0],
    );
    let r = split_polygon_by_polyline_detailed(&px, &py, &[5.0, 5.0], &[5.0, 5.0]).unwrap();
    assert_eq!(
        r.pieces,
        vec![PolygonXY {
            px: px.to_vec(),
            py: py.to_vec()
        }]
    );
}

#[test]
fn a_self_touching_outline_throws_as_jsts() {
    // TypeScript's polygon.intersects(line) throws outside the try.
    let err = split_polygon_by_polyline_detailed(
        &[6.0, 6.0, 1.0, 9.0, 9.0],
        &[6.0, 9.0, 6.0, 6.0, 6.0],
        &[6.0, 6.0],
        &[6.0, 9.0],
    )
    .unwrap_err();
    assert_eq!(err.message, "side location conflict [ (6, 6, NaN) ]");
    let err = split_polygon_by_polyline_detailed(
        &[0.0, 4.0, 8.0, 4.0, 0.0, 4.0],
        &[0.0, 4.0, 0.0, 8.0, 4.0, 4.0],
        &[4.0, 4.0],
        &[-1.0, 9.0],
    )
    .unwrap_err();
    assert_eq!(err.message, "side location conflict [ (4, 4, NaN) ]");
    // a large coordinate is printed as JavaScript prints it
    let o = 6.5e6 + 0.125;
    let err = split_polygon_by_polyline_detailed(
        &[6.0 + o, 6.0 + o, 1.0 + o, 9.0 + o, 9.0 + o],
        &[6.0, 9.0, 6.0, 6.0, 6.0],
        &[6.0 + o, 6.0 + o],
        &[6.0, 9.0],
    )
    .unwrap_err();
    assert_eq!(
        err.message,
        "side location conflict [ (6500006.125, 6, NaN) ]"
    );
}

#[test]
fn a_one_vertex_polygon_fails_as_a_line_string() {
    let err =
        split_polygon_by_polyline_detailed(&[1.0], &[1.0], &[0.0, 10.0], &[5.0, 5.0]).unwrap_err();
    assert_eq!(
        err.message,
        "Invalid number of points in LineString (found 1 - must be 0 or >= 2)"
    );
    let err =
        split_polygon_by_polyline_detailed(&[1.0, 2.0], &[1.0, 1.0], &[0.0, 10.0], &[5.0, 5.0])
            .unwrap_err();
    assert_eq!(
        err.message,
        "Invalid number of points in LinearRing (found 3 - must be 0 or >= 4)"
    );
}

#[test]
fn unequal_x_and_y_lengths_do_not_panic() {
    // TypeScript reads a missing value as undefined (NaN in arithmetic);
    // Rust reads NaN. Outputs are compared with TypeScript where they
    // agree (fixtures); here every public function just has to return.
    let long = [0.0, 10.0, 10.0, 0.0, 0.0];
    let short = [0.0, 0.0, 10.0];
    let empty: [f64; 0] = [];
    for (a, b) in [
        (&long[..], &short[..]),
        (&short[..], &long[..]),
        (&long[..], &empty[..]),
    ] {
        let _ = split_polygon_by_polyline_detailed(a, b, &[-1.0, 11.0], &[5.0, 5.0]);
        let _ = split_polygon_by_polyline_detailed(&long, &long, a, b);
        let _ = polyline_y_at_x(a, b, 5.0);
        let _ = get_surface_line(a, b);
        let _ = polyline_y_at_side(a, b, 5.0, Side::Left);
        let _ = polyline_y_from(a, b, 5.0, Side::Right);
        let _ = polyline_y_from(a, b, 50.0, Side::Right);
        let _ = clip_line_to_surface(a, b, &long, &long);
        let _ = clip_line_to_surface(&long, &long, a, b);
        let _ = polygonize_regions_detailed(a, b, &[vec![[-1.0, 5.0], [11.0, 5.0]]]);
        let g = create_geometry_with_material(a, b, MaterialId(0), true);
        let _ = material_layer_top_at(&[g], MaterialId(0), 5.0, 2.0);
        let g = create_geometry_with_material(a, b, MaterialId(0), false);
        let _ = material_layer_top_at(&[g], MaterialId(0), 5.0, 2.0);
    }
    // the cases that agree with TypeScript
    let r = split_polygon_by_polyline_detailed(
        &[0.0, 10.0, 10.0, 0.0],
        &short,
        &[-1.0, 11.0],
        &[5.0, 5.0],
    );
    assert_eq!(
        r.unwrap_err().message,
        "Points of LinearRing do not form a closed linestring"
    );
    let g = create_geometry_with_material(
        &[0.0, 10.0, 10.0, 0.0],
        &[0.0, 0.0, 5.0],
        MaterialId(0),
        false,
    );
    assert_eq!(material_layer_top_at(&[g], MaterialId(0), 5.0, 2.0), None);
}

#[test]
fn nan_coordinates_in_layer_tops_do_not_panic() {
    // The review's reproduction: zigzag outlines with a NaN vertex made the
    // sort of the extents panic (std's sort on an inconsistent comparator).
    let mut s: u64 = 12345;
    let mut rnd = || {
        s = s
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (s >> 11) as f64 / (1u64 << 53) as f64
    };
    for _ in 0..300 {
        let mut px = vec![];
        let mut py = vec![];
        for _ in 0..80 {
            px.push(0.0);
            py.push(rnd() * 100.0);
            px.push(1.0);
            py.push(rnd() * 100.0);
        }
        let nan_at = (rnd() * 160.0) as usize;
        py[nan_at] = f64::NAN;
        let g = create_geometry_with_material(&px, &py, MaterialId(0), false);
        let _ = material_layer_top_at(&[g], MaterialId(0), 0.5, 10.0);
    }
    let g = create_geometry_with_material(
        &[0.0, 10.0, 10.0, 0.0],
        &[0.0, 0.0, 5.0, 5.0],
        MaterialId(0),
        true,
    );
    assert_eq!(
        material_layer_top_at(std::slice::from_ref(&g), MaterialId(0), 5.0, f64::NAN),
        None
    );
    assert_eq!(
        material_layer_top_at(&[g], MaterialId(0), f64::NAN, 2.0),
        None
    );
}
