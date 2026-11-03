//! Ported unit tests: packages/engine/src/model/geometry-ops.test.ts and
//! geometry-props.test.ts (the parts that test geometry-ops directly),
//! plus property tests of the region split.

use cslope_engine::model::geometry_ops::*;

use cslope_engine::math::polygon::{calculate_polygon_area, is_point_in_polygon};

/// `rng` of model/property-helpers.ts (mulberry32).
fn rng(seed: u32) -> impl FnMut() -> f64 {
    let mut a = seed;
    move || {
        a = a.wrapping_add(0x6d2b79f5);
        let mut t = a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

fn uniform(r: &mut impl FnMut() -> f64, lo: f64, hi: f64) -> f64 {
    lo + (hi - lo) * r()
}

fn close(a: f64, b: f64, digits: i32) -> bool {
    (a - b).abs() < 10f64.powi(-digits) / 2.0
}

fn ring_area(r: &[Pt]) -> f64 {
    let x: Vec<f64> = r.iter().map(|p| p[0]).collect();
    let y: Vec<f64> = r.iter().map(|p| p[1]).collect();
    calculate_polygon_area(&x, &y)
}

fn xs(r: &[Pt]) -> Vec<f64> {
    r.iter().map(|p| p[0]).collect()
}

fn ys(r: &[Pt]) -> Vec<f64> {
    r.iter().map(|p| p[1]).collect()
}

const BOX: [Pt; 5] = [[0., 0.], [10., 0.], [10., 10.], [0., 10.], [0., 0.]];

// ── geometry-ops.test.ts ──────────────────────────────────────────

#[test]
fn line_segment_intersection_cases() {
    let pt = line_segment_intersection(0., 0., 10., 10., 0., 10., 10., 0.).unwrap();
    assert!(close(pt[0], 5., 6) && close(pt[1], 5., 6));
    assert!(line_segment_intersection(0., 0., 10., 0., 0., 5., 10., 5.).is_none());
    assert!(line_segment_intersection(0., 0., 1., 0., 5., 5., 10., 5.).is_none());
    let pt = line_segment_intersection(0., 0., 5., 0., 5., 0., 5., 5.).unwrap();
    assert!(close(pt[0], 5., 6) && close(pt[1], 0., 6));
}

#[test]
fn surface_line_cases() {
    let s = get_surface_line(&[0., 10., 10., 0., 0.], &[0., 0., -10., -10., 0.]).unwrap();
    assert_eq!((s.x, s.y), (vec![0., 10.], vec![0., 0.]));
    let s = get_surface_line(
        &[0., 5., 25., 30., 30., 0., 0.],
        &[0., 0., -10., -10., -15., -15., 0.],
    )
    .unwrap();
    assert_eq!(
        (s.x, s.y),
        (vec![0., 5., 25., 30.], vec![0., 0., -10., -10.])
    );
    let s = get_surface_line(
        &[0., 20., 40., 50., 50., 0., 0.],
        &[0., 0., -10., -10., -15., -15., 0.],
    )
    .unwrap();
    assert_eq!(
        (s.x, s.y),
        (vec![0., 20., 40., 50.], vec![0., 0., -10., -10.])
    );
    let s = get_surface_line(&[0., 10., 5., 0.], &[0., 0., -8., 0.]).unwrap();
    assert_eq!((s.x, s.y), (vec![0., 10.], vec![0., 0.]));
    assert!(get_surface_line(&[0., 1.], &[0., 1.]).is_err());
}

#[test]
fn split_rectangle_horizontally() {
    let pieces = split_polygon_by_polyline(
        &[0., 10., 10., 0., 0.],
        &[0., 0., -10., -10., 0.],
        &[0., 10.],
        &[-5., -5.],
    )
    .unwrap();
    assert_eq!(pieces.len(), 2);
    let mut areas: Vec<f64> = pieces
        .iter()
        .map(|p| calculate_polygon_area(&p.px, &p.py))
        .collect();
    areas.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert!(close(areas[0], 50., 1) && close(areas[1], 50., 1));
    assert!(close(areas[0] + areas[1], 100., 1));
}

#[test]
fn split_slope_horizontally() {
    let px = [0., 20., 40., 50., 50., 0., 0.];
    let py = [0., 0., -10., -10., -15., -15., 0.];
    let pieces = split_polygon_by_polyline(&px, &py, &[0., 50.], &[-5., -5.]).unwrap();
    assert_eq!(pieces.len(), 2);
    let orig = calculate_polygon_area(&px, &py);
    let areas: Vec<f64> = pieces
        .iter()
        .map(|p| calculate_polygon_area(&p.px, &p.py))
        .collect();
    assert!(close(areas[0] + areas[1], orig, 1));
    let upper = cslope_engine::js::math::min(areas[0], areas[1]);
    let lower = cslope_engine::js::math::max(areas[0], areas[1]);
    assert!(close(upper, 125., 0));
    assert!(close(lower, orig - 125., 0));
}

#[test]
fn split_misses() {
    let pieces = split_polygon_by_polyline(
        &[0., 10., 10., 0., 0.],
        &[0., 0., -10., -10., 0.],
        &[0., 10.],
        &[5., 5.],
    )
    .unwrap();
    assert_eq!(pieces.len(), 1);
}

#[test]
fn two_successive_splits() {
    let pieces1 = split_polygon_by_polyline(
        &[0., 10., 10., 0., 0.],
        &[0., 0., -15., -15., 0.],
        &[0., 10.],
        &[-5., -5.],
    )
    .unwrap();
    assert_eq!(pieces1.len(), 2);
    let mut all = Vec::new();
    for p in &pieces1 {
        all.extend(split_polygon_by_polyline(&p.px, &p.py, &[0., 10.], &[-10., -10.]).unwrap());
    }
    assert_eq!(all.len(), 3);
    for p in &all {
        assert!(close(calculate_polygon_area(&p.px, &p.py), 50., 0));
    }
}

fn rect(x0: f64, x1: f64, y0: f64, y1: f64, m: MaterialId) -> GeometryWithMaterial {
    create_geometry_with_material(&[x0, x1, x1, x0], &[y0, y0, y1, y1], m, true)
}

const CLAY: MaterialId = MaterialId(0);
const SAND: MaterialId = MaterialId(1);

#[test]
fn layer_top_of_the_region_containing_the_point() {
    let geos = [rect(0., 10., -10., 0., CLAY), rect(0., 10., 0., 5., SAND)];
    assert_eq!(material_layer_top_at(&geos, CLAY, 5., -6.), Some(0.));
    assert_eq!(material_layer_top_at(&geos, SAND, 5., 1.), Some(5.));
}

#[test]
fn layer_top_follows_a_sloping_top() {
    let geos = [create_geometry_with_material(
        &[0., 10., 10., 0.],
        &[-10., -10., 4., 0.],
        CLAY,
        true,
    )];
    assert!(close(
        material_layer_top_at(&geos, CLAY, 5., -6.).unwrap(),
        2.,
        12
    ));
}

#[test]
fn layer_top_joins_adjoining_regions() {
    let geos = [
        rect(0., 10., -10., -4., CLAY),
        rect(0., 10., -4., 0., CLAY),
        rect(0., 10., 0., 5., SAND),
    ];
    assert_eq!(material_layer_top_at(&geos, CLAY, 5., -8.), Some(0.));
}

#[test]
fn layer_top_ignores_a_lens_above_another_material() {
    let geos = [
        rect(0., 10., -10., 0., CLAY),
        rect(0., 10., 0., 5., SAND),
        rect(4., 6., 2., 3., CLAY),
    ];
    assert_eq!(material_layer_top_at(&geos, CLAY, 5., -6.), Some(0.));
    assert_eq!(material_layer_top_at(&geos, CLAY, 5., 2.5), Some(3.));
}

#[test]
fn layer_top_outside_the_material() {
    let geos = [rect(0., 10., -10., 0., CLAY), rect(0., 10., 0., 5., SAND)];
    assert_eq!(material_layer_top_at(&geos, CLAY, 5., 2.), None);
    assert_eq!(material_layer_top_at(&geos, CLAY, 20., -5.), None);
}

// ── geometry-props.test.ts ────────────────────────────────────────

#[test]
fn segment_intersection_crossing_touching_parallel_apart() {
    assert_eq!(
        line_segment_intersection(0., 0., 2., 2., 0., 2., 2., 0.),
        Some([1., 1.])
    );
    assert_eq!(
        line_segment_intersection(0., 0., 1., 0., 1., 0., 1., 1.),
        Some([1., 0.])
    );
    assert_eq!(
        line_segment_intersection(0., 0., 1., 0., 0., 1., 1., 1.),
        None
    );
    assert_eq!(
        line_segment_intersection(0., 0., 1., 0., 2., -1., 2., 1.),
        None
    );
}

#[test]
fn polyline_y_at_x_cases() {
    assert!(close(
        polyline_y_at_x(&[0., 10.], &[0., 10.], 4.).unwrap(),
        4.,
        12
    ));
    assert!(close(
        polyline_y_at_x(&[10., 0.], &[10., 0.], 4.).unwrap(),
        4.,
        12
    ));
    assert_eq!(
        polyline_y_at_x(&[0., 5., 5., 10.], &[0., 0., 4., 4.], 5.),
        Some(0.)
    );
    assert_eq!(
        polyline_y_at_x(&[0., 5., 5., 10.], &[0., 2., 4., 4.], 5.),
        Some(2.)
    );
    assert_eq!(polyline_y_at_x(&[5., 5.], &[0., 4.], 5.), Some(2.));
    assert_eq!(polyline_y_at_x(&[0., 10.], &[0., 10.], 11.), None);
    assert_eq!(polyline_y_at_x(&[0., 10.], &[0., 10.], -1.), None);
}

#[test]
fn one_sided_values_at_a_vertical_step() {
    let x = [0., 5., 5., 10.];
    let y = [0., 0., 4., 4.];
    assert_eq!(polyline_y_at_side(&x, &y, 5., Side::Left), 0.);
    assert_eq!(polyline_y_at_side(&x, &y, 5., Side::Right), 4.);
    assert!(polyline_y_at_side(&x, &y, 0., Side::Left).is_nan());
    assert_eq!(polyline_y_from(&x, &y, 0., Side::Left), 0.);
    assert_eq!(polyline_y_from(&x, &y, 10., Side::Right), 4.);
}

#[test]
fn surface_line_vertical_faces_and_orientation() {
    let e = get_surface_line(&[0., 1.], &[0., 1.]).unwrap_err();
    assert!(e.message.contains("at least 3"));
    let s = get_surface_line(
        &[0., 0., 5., 5., 10., 10., 0.],
        &[-5., 4., 4., 0., 0., -5., -5.],
    )
    .unwrap();
    assert_eq!(s.x, vec![0., 5., 5., 10.]);
    assert_eq!(s.y, vec![4., 4., 0., 0.]);
    let cw = get_surface_line(&[0., 10., 10., 5., 5., 0.], &[-5., -5., 0., 0., 4., 4.]).unwrap();
    assert_eq!(cw, s);
}

#[test]
fn clipping_a_water_line() {
    assert!(clip_line_to_surface(&[0.], &[1.], &[0., 1.], &[0., 0.]).is_none());
    assert!(clip_line_to_surface(&[20., 30.], &[1., 1.], &[0., 10.], &[0., 0.]).is_none());
    let c =
        clip_line_to_surface(&[0., 10.], &[2., 2.], &[0., 5., 5., 10.], &[4., 4., 0., 0.]).unwrap();
    assert_eq!(c.x, vec![0., 5., 5., 10.]);
    assert_eq!(c.y, vec![2., 2., 0., 0.]);
    let d = clip_line_to_surface(&[0., 10.], &[3., 3.], &[0., 10.], &[6., 0.]).unwrap();
    assert_eq!(d.x, vec![0., 5., 10.]);
    assert!(close(d.y[1], 3., 12));
    assert_eq!(d.y[2], 0.);
}

#[test]
fn water_table_clip_cases() {
    // water-table.test.ts (clipLineToSurface)
    let out = clip_line_to_surface(
        &[0., 50.],
        &[-5., -5.],
        &[0., 20., 40., 50.],
        &[0., 0., -10., -10.],
    )
    .unwrap();
    assert_eq!(out.x, vec![0., 20., 30., 40., 50.]);
    assert_eq!(out.y, vec![-5., -5., -5., -10., -10.]);
    assert!(clip_line_to_surface(&[60., 70.], &[0., 0.], &[0., 50.], &[0., 0.]).is_none());
}

#[test]
fn splits_that_leave_the_polygon_whole() {
    assert_eq!(
        split_polygon_by_polyline(&xs(&BOX), &ys(&BOX), &[20., 30.], &[0., 0.])
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        split_polygon_by_polyline(&xs(&BOX), &ys(&BOX), &[5.], &[5.])
            .unwrap()
            .len(),
        1
    );
    let along = split_polygon_by_polyline_detailed(
        &[0., 10., 10., 0.],
        &[0., 0., 10., 10.],
        &[0., 10.],
        &[0., 0.],
    )
    .unwrap();
    assert_eq!(along.pieces.len(), 1);
    assert!(!along.split_failed);
}

#[test]
fn open_polygon_is_closed_and_pieces_ordered_top_first() {
    let pieces = split_polygon_by_polyline(
        &[0., 10., 10., 0.],
        &[0., 0., 10., 10.],
        &[-1., 11.],
        &[4., 6.],
    )
    .unwrap();
    assert_eq!(pieces.len(), 2);
    let avg = |p: &PolygonXY| p.py.iter().sum::<f64>() / p.py.len() as f64;
    assert!(avg(&pieces[0]) > avg(&pieces[1]));
    let total: f64 = pieces
        .iter()
        .map(|p| calculate_polygon_area(&p.px, &p.py))
        .sum();
    assert!(close(total, 100., 9));
}

#[test]
fn a_lens_gives_a_lens_and_a_piece_with_a_hole() {
    let lens: [Pt; 5] = [[3., 3.], [7., 3.], [7., 6.], [3., 6.], [3., 3.]];
    let pieces = split_polygon_by_polyline(&xs(&BOX), &ys(&BOX), &xs(&lens), &ys(&lens)).unwrap();
    assert_eq!(pieces.len(), 2);
    let mut areas: Vec<f64> = pieces
        .iter()
        .map(|p| calculate_polygon_area(&p.px, &p.py))
        .collect();
    areas.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert!(close(areas[0], 12., 9) && close(areas[1], 88., 9));
    let outer = pieces
        .iter()
        .find(|p| (calculate_polygon_area(&p.px, &p.py) - 88.).abs() < 1e-6)
        .unwrap();
    assert!(!is_point_in_polygon(5., 4.5, &outer.px, &outer.py));
    assert!(is_point_in_polygon(1., 1., &outer.px, &outer.py));
}

#[test]
fn property_random_polylines_conserve_the_area() {
    // The same cases as the TS test (seed 77).
    let mut r = rng(77);
    for i in 0..40 {
        let n = 3 + (r() * 6.0).floor() as usize;
        let mut ang: Vec<f64> = (0..n).map(|_| r() * 2.0 * std::f64::consts::PI).collect();
        ang.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let rad = uniform(&mut r, 5., 20.);
        let px: Vec<f64> = ang.iter().map(|a| rad * a.cos()).collect();
        let py: Vec<f64> = ang.iter().map(|a| rad * a.sin()).collect();
        let k = 2 + (r() * 3.0).floor() as usize;
        let lx: Vec<f64> = (0..k)
            .map(|j| -30. + (60. * j as f64) / (k - 1) as f64)
            .collect();
        let ly: Vec<f64> = lx.iter().map(|_| uniform(&mut r, -rad, rad)).collect();
        let pieces = split_polygon_by_polyline(&px, &py, &lx, &ly).unwrap();
        let total: f64 = pieces
            .iter()
            .map(|p| calculate_polygon_area(&p.px, &p.py))
            .sum();
        assert!(
            close(total, calculate_polygon_area(&px, &py), 6),
            "case {i}"
        );
    }
}

#[test]
fn regions_degenerate_inputs() {
    assert_eq!(
        polygonize_regions_detailed(&[0., 1.], &[0., 1.], &[]).unwrap(),
        RegionFacesResult {
            faces: vec![],
            failed: false,
            dangling_boundaries: vec![]
        }
    );
    let whole =
        polygonize_regions(&[0., 10., 10., 0.], &[0., 0., 10., 10.], &[vec![[1., 1.]]]).unwrap();
    assert_eq!(whole.len(), 1);
    assert_eq!(whole[0].outer.len(), 5);
}

#[test]
fn regions_boundaries_outside() {
    let r = polygonize_regions_detailed(
        &[0., 10., 10., 0.],
        &[0., 0., 10., 10.],
        &[vec![[20., 0.], [30., 5.]]],
    )
    .unwrap();
    assert_eq!(r.faces.len(), 1);
    assert!(!r.failed);
}

/// Area of faces (outer − holes), and the faces do not overlap (a point
/// inside one face is in no other).
fn check_faces(faces: &[RegionFace], total: f64, case: &str) {
    let sum: f64 = faces
        .iter()
        .map(|f| ring_area(&f.outer) - f.holes.iter().map(|h| ring_area(h)).sum::<f64>())
        .sum();
    assert!(close(sum, total, 6), "{case}: {sum} vs {total}");
    let sum_rings: f64 = faces
        .iter()
        .map(|f| ring_area(&keyhole_ring(&f.outer, &f.holes)))
        .sum();
    assert!(close(sum_rings, total, 6), "{case} keyhole");
    let rings: Vec<Vec<Pt>> = faces
        .iter()
        .map(|f| keyhole_ring(&f.outer, &f.holes))
        .collect();
    for (i, f) in faces.iter().enumerate() {
        // a point just inside an edge midpoint of the face's outer ring
        let a = f.outer[0];
        let b = f.outer[1];
        let m = [(a[0] + b[0]) / 2., (a[1] + b[1]) / 2.];
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len = (dx * dx + dy * dy).sqrt();
        for s in [1e-4, -1e-4] {
            let p = [m[0] - dy / len * s, m[1] + dx / len * s];
            if !is_point_in_polygon(p[0], p[1], &xs(&rings[i]), &ys(&rings[i])) {
                continue;
            }
            let inside = rings
                .iter()
                .filter(|r| is_point_in_polygon(p[0], p[1], &xs(r), &ys(r)))
                .count();
            assert_eq!(inside, 1, "{case}: faces overlap at {p:?}");
        }
    }
}

#[test]
fn property_faces_add_up_for_random_layers_and_lenses() {
    let mut r = rng(78);
    let slope: [Pt; 6] = [
        [0., -10.],
        [0., 10.],
        [10., 10.],
        [25., 0.],
        [40., 0.],
        [40., -10.],
    ];
    let total = ring_area(&slope);
    for i in 0..25 {
        let mut lines: Vec<Vec<Pt>> = Vec::new();
        let n_layers = 1 + (r() * 3.0).floor() as usize;
        for _ in 0..n_layers {
            let y0 = uniform(&mut r, -9., 8.);
            let y1 = y0 + uniform(&mut r, -3., 3.);
            let y2 = y0 + uniform(&mut r, -4., 2.);
            lines.push(vec![[-1., y0], [20., y1], [41., y2]]);
        }
        if r() < 0.6 {
            let cx = uniform(&mut r, 5., 35.);
            let cy = uniform(&mut r, -8., -3.);
            let w = uniform(&mut r, 1., 4.);
            let h = uniform(&mut r, 0.5, 1.5);
            lines.push(vec![
                [cx - w, cy - h],
                [cx + w, cy - h],
                [cx + w, cy + h],
                [cx - w, cy + h],
                [cx - w, cy - h],
            ]);
        }
        let faces = polygonize_regions(&xs(&slope), &ys(&slope), &lines).unwrap();
        check_faces(&faces, total, &format!("case {i}"));
    }
}

#[test]
fn property_faces_tile_the_slope_with_snapped_t_junctions() {
    // Boundaries ending on sloping faces and on each other by rounding
    // errors (the snap-rounding path): the faces still tile the slope.
    let mut r = rng(79);
    let ring: [Pt; 6] = [
        [0., -10.],
        [0., 10.],
        [10., 10.],
        [30., 0.],
        [40., 0.],
        [40., -10.],
    ];
    let total = ring_area(&ring);
    for i in 0..40 {
        let t = uniform(&mut r, 0.05, 0.95);
        let end = [10. + 20. * t, 10. - 10. * t - 1e-12];
        let y0 = uniform(&mut r, -8., -2.);
        let lines = vec![
            vec![[0., 2.], end],
            vec![[0., y0], [40., y0 + uniform(&mut r, -1., 1.)]],
        ];
        let res = polygonize_regions_detailed(&xs(&ring), &ys(&ring), &lines).unwrap();
        assert!(!res.failed);
        assert_eq!(res.faces.len(), 3, "case {i}");
        check_faces(&res.faces, total, &format!("case {i}"));
    }
}

#[test]
fn keyhole_rings() {
    let hole: Vec<Pt> = vec![[2., 2.], [4., 2.], [4., 4.], [2., 4.], [2., 2.]];
    let mut rev = hole.clone();
    rev.reverse();
    for h in [hole.clone(), rev] {
        let ring = keyhole_ring(&BOX, &[h]);
        assert!(close(ring_area(&ring), 96., 12));
        assert!(!is_point_in_polygon(3., 3., &xs(&ring), &ys(&ring)));
        assert!(is_point_in_polygon(8., 8., &xs(&ring), &ys(&ring)));
    }
    assert!(close(
        ring_area(&keyhole_ring(&BOX, &[vec![[1., 1.], [2., 2.]]])),
        100.,
        12
    ));
    assert!(close(
        ring_area(&keyhole_ring(&BOX[..4], &[hole[..4].to_vec()])),
        96.,
        12
    ));
}

#[test]
fn keyhole_two_holes() {
    let a: Vec<Pt> = vec![[1., 1.], [3., 1.], [3., 3.], [1., 3.]];
    let b: Vec<Pt> = vec![[6., 6.], [9., 6.], [9., 9.], [6., 9.]];
    assert!(close(
        ring_area(&keyhole_ring(&BOX, &[a, b])),
        100. - 4. - 9.,
        12
    ));
}

#[test]
fn layer_top_stacked_regions() {
    let (m1, m2) = (MaterialId(0), MaterialId(1));
    let geos = [
        create_geometry_with_material(&[0., 10., 10., 0.], &[0., 0., 5., 5.], m1, true),
        create_geometry_with_material(&[0., 10., 10., 0.], &[5., 5., 8., 8.], m1, true),
        create_geometry_with_material(&[0., 10., 10., 0.], &[8., 8., 9., 9.], m2, true),
        create_geometry_with_material(&[0., 10., 10., 0.], &[9., 9., 12., 12.], m1, true),
    ];
    assert_eq!(material_layer_top_at(&geos, m1, 5., 1.), Some(8.));
    assert_eq!(material_layer_top_at(&geos, m1, 5., 10.), Some(12.));
    assert_eq!(material_layer_top_at(&geos, m2, 5., 8.5), Some(9.));
    assert_eq!(material_layer_top_at(&geos, m2, 5., 1.), None);
    assert_eq!(material_layer_top_at(&geos, m1, 20., 1.), None);
}

#[test]
fn layer_top_regions_without_bounds() {
    let g =
        create_geometry_with_material(&[0., 10., 10., 0.], &[0., 0., 5., 5.], MaterialId(0), false);
    assert_eq!(g.x_min, None);
    assert_eq!(material_layer_top_at(&[g], MaterialId(0), 5., 2.), Some(5.));
}

// ── region-split tests of review-round4 / result-warnings ─────────

const RING40: [Pt; 6] = [
    [0., -10.],
    [0., 10.],
    [10., 10.],
    [30., 0.],
    [40., 0.],
    [40., -10.],
];

#[test]
fn keeps_every_region_wherever_the_slope_lies() {
    for dx in [0., 0.5, 220.] {
        let ring: [Pt; 8] = [
            [-220., -15.],
            [-220., 19.],
            [-210., 19.],
            [-189., 7.],
            [-184.66515835176665, 6.868245269066714],
            [-177.86896225530654, 0.],
            [-164., 0.],
            [-164., -15.],
        ];
        let line: [Pt; 4] = [
            [-220., 7.],
            [-202., 9.],
            [-182.9971442414437, 5.1825478790327],
            [-174., 0.],
        ];
        let px: Vec<f64> = ring.iter().map(|p| p[0] + dx).collect();
        let r = polygonize_regions_detailed(
            &px,
            &ys(&ring),
            &[line.iter().map(|p| [p[0] + dx, p[1]]).collect()],
        )
        .unwrap();
        assert!(!r.failed);
        assert_eq!(r.faces.len(), 2);
    }
}

#[test]
fn splits_at_a_boundary_ending_on_a_sloping_face() {
    for k in 1..50 {
        let t = k as f64 / 50. + 1e-7;
        let end = [10. + 20. * t, 10. - 10. * t - 1e-12];
        let r = polygonize_regions_detailed(&xs(&RING40), &ys(&RING40), &[vec![[0., 2.], end]])
            .unwrap();
        assert!(!r.failed);
        assert_eq!(r.faces.len(), 2);
    }
}

#[test]
fn boundary_end_snapping() {
    let split = |lines: Vec<Vec<Pt>>| {
        polygonize_regions_detailed(&xs(&RING40), &ys(&RING40), &lines).unwrap()
    };
    let r = split(vec![
        vec![[0., -3.], [40., -5.]],
        vec![[20., -4. + 0.02], [20., 5.]],
    ]);
    assert!(r.dangling_boundaries.is_empty());
    assert_eq!(r.faces.len(), 3);
    let r = split(vec![vec![[10., -2.], [20., -6.], [30., -2.], [10.01, -2.]]]);
    assert!(r.dangling_boundaries.is_empty());
    assert_eq!(r.faces.len(), 2);
    let r = split(vec![
        vec![[0., -3.], [40., -5.]],
        vec![[20., -4. + 0.5], [20., 5.]],
    ]);
    assert_eq!(r.dangling_boundaries, vec![1]);
    assert_eq!(r.faces.len(), 2);
    let r = split(vec![vec![[-1., 2.], [41., -3.]]]);
    assert!(r.dangling_boundaries.is_empty());
    assert_eq!(r.faces.len(), 2);
    // a boundary end farther than the tolerance from the edge
    let r = split(vec![vec![[0., 3.], [40. - 0.1, -1.]]]);
    assert_eq!(r.dangling_boundaries, vec![0]);
    let r = split(vec![vec![[5., 5.]], vec![[0., 3.], [40. - 0.1, -1.]]]);
    assert_eq!(r.dangling_boundaries, vec![1]);
    for gap in [1e-12, 1e-3, 0.999e-3 * 40.] {
        // (the line runs through the toe vertex (30, 0): three faces)
        let exact = split(vec![vec![[0., 3.], [40., -1.]]]);
        let r = split(vec![vec![[0., 3.], [40. - gap, -1.]]]);
        assert!(r.dangling_boundaries.is_empty());
        assert_eq!(r.faces.len(), exact.faces.len());
    }
}
