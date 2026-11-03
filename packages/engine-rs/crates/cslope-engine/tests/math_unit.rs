//! Ported unit tests of packages/engine/src/math: circle.test.ts,
//! polygon.test.ts, interpolation.test.ts, helpers.test.ts,
//! loads-helpers.test.ts (and the spline case of types/shansep.test.ts).

use cslope_engine::error::ErrorKind;
use cslope_engine::math::*;
use cslope_engine::types::IntersliceFunctionType as K;

/// vitest `toBeCloseTo(b, digits)`: |a − b| < 10^−digits / 2.
#[track_caller]
fn close_to(a: f64, b: f64, digits: i32) {
    assert!(
        (a - b).abs() < cslope_engine::js::math::pow(10.0, -digits as f64) / 2.0,
        "{a} is not close to {b} ({digits} digits)"
    );
}

// ── circle.test.ts ──

#[test]
fn circle_y_at_x() {
    close_to(get_circle_y_coordinate_at_x(5.0, 10.0, 5.0, 5.0), 5.0, 10);
    close_to(
        get_circle_y_coordinate_at_x(5.0, 10.0, 5.0, 3.0),
        5.41742430504416,
        8,
    );
    // x just outside the radius: cy, not NaN (regression for 2.3)
    let r = get_circle_y_coordinate_at_x(5.0, 10.0, 5.0, 5.0 + 5.0 + 1e-14);
    assert!(!r.is_nan());
    close_to(r, 10.0, 8);
}

#[test]
fn circle_line_intersections() {
    let mut ints = get_circle_line_intersections(5.0, 5.0, 3.0, &[0.0, 10.0], &[5.0, 5.0]);
    assert_eq!(ints.len(), 2);
    ints.sort_by(|a, b| a[0].total_cmp(&b[0]));
    close_to(ints[0][0], 2.0, 8);
    close_to(ints[0][1], 5.0, 8);
    close_to(ints[1][0], 8.0, 8);
    close_to(ints[1][1], 5.0, 8);
    assert!(get_circle_line_intersections(5.0, 5.0, 3.0, &[0.0, 10.0], &[20.0, 20.0]).is_empty());
}

#[test]
fn circle_radius_and_centre() {
    close_to(circle_radius_from_abcd(4.0, 16.0).unwrap(), 4.0, 10);
    assert_eq!(circle_radius_from_abcd(0.0, 16.0), None);
    assert_eq!(circle_radius_from_abcd(1e-15, 16.0), None);
    assert_eq!(circle_radius_from_abcd(-1e-15, 16.0), None);
    let [x, y] = circle_centre(0.0, [5.0, 5.0], 10.0);
    close_to(x, 5.0, 10);
    close_to(y, 15.0, 10);
}

#[test]
fn circle_coordinates() {
    let (x, y) = generate_circle_coordinates(0.0, 0.0, 10.0, 50);
    assert_eq!((x.len(), y.len()), (50, 50));
    let (_, y) = generate_circle_coordinates(0.0, 0.0, 10.0, 90);
    assert!(y.iter().all(|&yi| yi <= 0.001));
    // a single point gives the lowest point (helpers.test.ts)
    assert_eq!(
        generate_circle_coordinates(2.0, 5.0, 3.0, 1),
        (vec![2.0], vec![2.0])
    );
    let (x, y) = generate_circle_coordinates(0.0, 0.0, 1.0, 5);
    assert_eq!(x.len(), 5);
    for i in 0..5 {
        close_to(cslope_engine::js::math::hypot(&[x[i], y[i]]), 1.0, 2);
    }
}

// ── polygon.test.ts ──

#[test]
fn polygon_area() {
    assert_eq!(calculate_polygon_area(&[0.0, 1.0], &[0.0, 1.0]), 0.0);
    assert_eq!(calculate_polygon_area(&[], &[]), 0.0);
    close_to(
        calculate_polygon_area(&[0.0, 1.0, 1.0, 0.0], &[0.0, 0.0, 1.0, 1.0]),
        1.0,
        10,
    );
    close_to(
        calculate_polygon_area(&[0.0, 4.0, 2.0], &[0.0, 0.0, 3.0]),
        6.0,
        10,
    );
    let cw = calculate_polygon_area(&[0.0, 1.0, 1.0, 0.0], &[0.0, 0.0, 1.0, 1.0]);
    let ccw = calculate_polygon_area(&[0.0, 0.0, 1.0, 1.0], &[0.0, 1.0, 1.0, 0.0]);
    close_to(cw, ccw, 10);
}

#[test]
fn point_in_polygon() {
    let (sx, sy) = ([0.0, 1.0, 1.0, 0.0], [0.0, 0.0, 1.0, 1.0]);
    assert!(is_point_in_polygon(0.5, 0.5, &sx, &sy));
    assert!(!is_point_in_polygon(2.0, 0.5, &sx, &sy));
    assert!(is_point_in_polygon(0.001, 0.5, &sx, &sy));
}

#[test]
fn polygon_clipping() {
    let (rx, ry) =
        clip_polygon_halfplane(&[0.0, 4.0, 4.0, 0.0], &[0.0, 0.0, 3.0, 3.0], 1.0, 0.0, -1.0);
    assert!(rx.len() >= 3);
    close_to(calculate_polygon_area(&rx, &ry), 9.0, 6);
    let (rx, _) = clip_polygon_halfplane(
        &[0.0, 1.0, 1.0, 0.0],
        &[0.0, 0.0, 1.0, 1.0],
        1.0,
        0.0,
        -10.0,
    );
    assert!(rx.is_empty());
    let (rx, ry) = clip_polygon_vertical(&[0.0, 4.0, 4.0, 0.0], &[0.0, 0.0, 3.0, 3.0], 1.0, 3.0);
    assert!(rx.len() >= 3);
    close_to(calculate_polygon_area(&rx, &ry), 6.0, 6);
    let (rx, _) = clip_polygon_vertical(&[0.0, 1.0, 1.0, 0.0], &[0.0, 0.0, 1.0, 1.0], 5.0, 10.0);
    assert!(rx.is_empty());
}

// ── interpolation.test.ts ──

const PX: [f64; 3] = [0.0, 5.0, 10.0];
const PY: [f64; 3] = [0.0, 10.0, 5.0];

#[test]
fn y_at_x() {
    close_to(get_y_at_x(&PX, &PY, 2.5), 5.0, 10);
    close_to(get_y_at_x(&PX, &PY, 7.5), 7.5, 10);
    assert!(get_y_at_x(&PX, &PY, -1.0).is_nan());
    assert!(get_y_at_x(&PX, &PY, 11.0).is_nan());
    close_to(get_y_at_x(&PX, &PY, 0.0), 0.0, 10);
    close_to(get_y_at_x(&PX, &PY, 5.0), 10.0, 10);
    close_to(get_y_at_x(&PX, &PY, 10.0), 5.0, 10);
    let r = get_y_at_x_many(&PX, &PY, &[0.0, 2.5, 5.0, 7.5, 10.0]);
    for (a, b) in r.iter().zip([0.0, 5.0, 10.0, 7.5, 5.0]) {
        close_to(*a, b, 10);
    }
}

#[test]
fn y_at_x_strict() {
    close_to(get_y_at_x_strict((&PX, &PY), 2.5).unwrap(), 5.0, 10);
    assert_eq!(
        get_y_at_x_strict((&PX, &PY), -5.0).unwrap_err().kind,
        ErrorKind::Range
    );
    assert_eq!(
        get_y_at_x_strict((&PX, &PY), 15.0).unwrap_err().kind,
        ErrorKind::Range
    );
    // helpers.test.ts: vertical segment, out of range, NaN
    assert_eq!(
        get_y_at_x_strict((&[0.0, 5.0, 5.0, 10.0], &[0.0, 0.0, 4.0, 4.0]), 5.0).unwrap(),
        0.0
    );
    assert_eq!(
        get_y_at_x_strict((&[5.0, 5.0], &[0.0, 4.0]), 5.0).unwrap(),
        2.0
    );
    let e = get_y_at_x_strict((&[0.0, 10.0], &[0.0, 1.0]), 11.0).unwrap_err();
    assert_eq!(
        e.message,
        "x (11) is outside the limits of the line (0 to 10)."
    );
    let e = get_y_at_x_strict((&[0.0, 10.0], &[0.0, 1.0]), f64::NAN).unwrap_err();
    assert_eq!(e.message, "Could not interpolate y-value for x=NaN");
}

#[test]
fn line_between_points() {
    let line = ([0.0, 2.0, 5.0, 8.0, 10.0], [0.0, 4.0, 10.0, 6.0, 5.0]);
    let (x_out, _) = get_line_between_points((&line.0, &line.1), 1.0, 6.0).unwrap();
    assert_eq!(x_out[0], 1.0);
    assert_eq!(*x_out.last().unwrap(), 6.0);
    assert!(x_out.contains(&2.0) && x_out.contains(&5.0));
    let e = get_line_between_points((&line.0, &line.1), -1.0, 5.0).unwrap_err();
    assert_eq!(e.kind, ErrorKind::Range);
    // helpers.test.ts: without vertices between the ends
    assert_eq!(
        get_line_between_points((&[0.0, 10.0], &[0.0, 10.0]), 2.0, 3.0).unwrap(),
        (vec![2.0, 3.0], vec![2.0, 3.0])
    );
    let e = get_line_between_points((&[0.0, 10.0], &[0.0, 10.0]), -1.0, 3.0).unwrap_err();
    assert!(e.message.contains("outside the limits"));
}

// ── helpers.test.ts ──

const KINDS: [K; 5] = [
    K::Constant,
    K::HalfSine,
    K::ClippedSine,
    K::Trapezoidal,
    K::DataPointSpecified,
];

#[test]
fn interslice_functions_zero_outside_and_in_unit_range() {
    let pts = [[0.0, 0.2], [0.5, 1.0], [1.0, 0.2]];
    for kind in KINDS {
        for x in [-5.0, 10.0, 10.0 - 1e-15, 30.0, 31.0] {
            assert_eq!(
                get_interslice_function_value(Some(kind), x, 10.0, 30.0, &pts),
                0.0,
                "{kind:?} at {x}"
            );
        }
        for k in 1..40 {
            let v =
                get_interslice_function_value(Some(kind), 10.0 + k as f64 * 0.5, 10.0, 30.0, &pts);
            assert!((0.0..=1.0).contains(&v));
        }
    }
}

#[test]
fn interslice_functions_symmetric() {
    let pts = [[0.0, 0.1], [0.3, 0.8], [0.5, 1.0], [0.7, 0.8], [1.0, 0.1]];
    for kind in KINDS {
        for t in [0.05, 0.13, 0.2, 0.37, 0.5] {
            let a = get_interslice_function_value(Some(kind), 2.0 + 8.0 * t, 2.0, 10.0, &pts);
            let b =
                get_interslice_function_value(Some(kind), 2.0 + 8.0 * (1.0 - t), 2.0, 10.0, &pts);
            close_to(a, b, 12);
        }
    }
}

#[test]
fn interslice_shapes() {
    assert_eq!(constant_interslice(5.0, 0.0, 10.0), 1.0);
    close_to(halfsine(5.0, 0.0, 10.0), 1.0, 12);
    close_to(
        halfsine(2.5, 0.0, 10.0),
        std::f64::consts::FRAC_1_SQRT_2,
        12,
    );
    assert_eq!(clipped_sine(0.1, 0.0, 10.0), 0.35);
    close_to(clipped_sine(5.0, 0.0, 10.0), 1.0, 12);
    close_to(trapezoidal(1.0, 0.0, 10.0), 0.5, 12);
    assert_eq!(trapezoidal(2.0, 0.0, 10.0), 1.0);
    assert_eq!(trapezoidal(8.0, 0.0, 10.0), 1.0);
    close_to(trapezoidal(9.0, 0.0, 10.0), 0.5, 12);
    for kind in KINDS {
        assert_eq!(
            get_interslice_function_value(Some(kind), 5.0, 5.0, 5.0, &[]),
            0.0
        );
        assert_eq!(
            get_interslice_function_value(Some(kind), 5.0, 10.0, 0.0, &[]),
            0.0
        );
    }
    // a missing kind is the half-sine (an unknown string does not
    // deserialize into IntersliceFunctionType)
    close_to(
        get_interslice_function_value(None, 2.5, 0.0, 10.0, &[]),
        std::f64::consts::FRAC_1_SQRT_2,
        12,
    );
}

#[test]
fn data_point_specified_function() {
    let pts = [[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]];
    close_to(data_point_specified(25.0, 0.0, 100.0, &pts), 0.5, 12);
    close_to(data_point_specified(50.0, 0.0, 100.0, &pts), 1.0, 12);
    close_to(data_point_specified(90.0, 0.0, 100.0, &pts), 0.2, 12);
    let pts = [[0.8, 0.4], [0.2, 0.6]];
    close_to(data_point_specified(10.0, 0.0, 100.0, &pts), 0.6, 12);
    close_to(data_point_specified(95.0, 0.0, 100.0, &pts), 0.4, 12);
    close_to(data_point_specified(50.0, 0.0, 100.0, &pts), 0.5, 12);
    close_to(
        data_point_specified(30.0, 0.0, 100.0, &[[-1.0, -2.0], [2.0, 1.0]]),
        0.3,
        12,
    );
    let r = std::f64::consts::FRAC_1_SQRT_2;
    close_to(
        data_point_specified(25.0, 0.0, 100.0, &[[f64::NAN, 1.0], [0.5, f64::INFINITY]]),
        r,
        12,
    );
    close_to(data_point_specified(25.0, 0.0, 100.0, &[]), r, 12);
    close_to(
        data_point_specified(50.0, 0.0, 100.0, &[[f64::NAN, 1.0], [0.5, 0.3]]),
        0.3,
        12,
    );
    let step = [[0.0, 0.2], [0.5, 0.2], [0.5, 0.9], [1.0, 0.9]];
    close_to(data_point_specified(49.0, 0.0, 100.0, &step), 0.2, 12);
    close_to(data_point_specified(51.0, 0.0, 100.0, &step), 0.9, 12);
    for x in [1.0, 50.0, 99.0] {
        close_to(data_point_specified(x, 0.0, 100.0, &[[0.4, 0.7]]), 0.7, 12);
    }
    // loads-helpers.test.ts
    close_to(
        data_point_specified(5.0, 0.0, 10.0, &[[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]]),
        1.0,
        10,
    );
    close_to(
        data_point_specified(2.5, 0.0, 10.0, &[[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]]),
        0.5,
        10,
    );
}

#[test]
fn lambda_extrapolation() {
    let e = extrapolate_lambda(&[[0.0, 1.0, 1.2]]).unwrap_err();
    assert!(e.message.contains("at least two"));
    let [lambda, fs] = extrapolate_lambda(&[[0.0, 1.5, 1.3], [0.2, 1.52, 1.4]]).unwrap();
    close_to(lambda, 0.5, 12);
    close_to(fs, 1.55, 12);
    let [lambda, _] =
        extrapolate_lambda(&[[-1.0, 9.0, 1.0], [0.0, 1.5, 1.3], [0.2, 1.52, 1.4]]).unwrap();
    close_to(lambda, 0.5, 12);
    let r = extrapolate_lambda(&[[0.0, 1.5, 1.25], [0.2, 1.6, 1.35], [0.4, 3.0, 1.0]]).unwrap();
    assert!(r == [0.0, 1.5] || r == [0.2, 1.6], "{r:?}");
    assert_eq!(
        extrapolate_lambda(&[[0.0, 1.5, 1.3], [0.1, 1.5, 1.3001]]).unwrap()[0],
        5.0
    );
    assert_eq!(
        extrapolate_lambda(&[[0.0, 1.5, 1.7], [0.1, 1.5, 1.7001]]).unwrap()[0],
        -5.0
    );
    // loads-helpers.test.ts
    let [lambda, fs] =
        extrapolate_lambda(&[[0.2, 1.387, 1.289], [0.4, 1.386, 1.336], [0.6, 1.39, 1.363]])
            .unwrap();
    close_to(lambda, 0.8347826086956522, 6);
    close_to(fs, 1.394695652173913, 6);
}

#[test]
fn small_helpers() {
    assert_eq!(get_precision(5.0), 0);
    assert_eq!(get_precision(1.25), 2);
    assert_eq!(get_precision(0.1), 1);
    assert_eq!(get_precision(1.2000004), 1);
    assert_eq!(get_precision(42.0), 0);
    assert_eq!(get_precision(1.23), 2);
    assert_eq!(mid_coord([0.0, 0.0], [4.0, -2.0]), [2.0, -1.0]);
    assert_eq!(mid_coord([0.0, 0.0], [10.0, 6.0]), [5.0, 3.0]);
    assert_eq!(dist_points([1.0, 1.0], [4.0, 5.0]), 5.0);
    close_to(dist_points([0.0, 0.0], [3.0, 4.0]), 5.0, 10);
    assert_eq!(dist_points([5.0, 5.0], [5.0, 5.0]), 0.0);
    assert_eq!(MATERIAL_COLORS.len(), 10);
    assert!(MATERIAL_COLORS.iter().all(|c| c.starts_with('#')));
}

// ── loads-helpers.test.ts ──

#[test]
fn all_loads() {
    let (u, l) = calculate_all_loads(
        &[2.0, 2.0, 2.0],
        &[1.0, 3.0, 5.0],
        &[[0.5, 4.5, 10.0]],
        &[[3.0, 50.0]],
    );
    for (a, b) in u.iter().zip([15.0, 20.0, 5.0]) {
        close_to(*a, b, 8);
    }
    for (a, b) in l.iter().zip([0.0, 50.0, 0.0]) {
        close_to(*a, b, 8);
    }
    assert_eq!(
        calculate_all_loads(&[2.0], &[1.0], &[], &[]),
        (vec![0.0], vec![0.0])
    );
    close_to(
        calculate_all_loads(&[10.0], &[5.0], &[[3.0, 7.0, 10.0]], &[]).0[0],
        40.0,
        8,
    );
    close_to(
        calculate_all_loads(&[10.0], &[5.0], &[[7.0, 3.0, 10.0]], &[]).0[0],
        40.0,
        8,
    );
}

#[test]
#[allow(clippy::approx_constant)] // the literal of the TypeScript test
fn interslice_values_of_loads_helpers_test() {
    close_to(halfsine(5.0, 0.0, 10.0), 1.0, 10);
    close_to(halfsine(2.5, 0.0, 10.0), 0.7071067811865476, 10);
    for x in [-1.0, 11.0, 0.0, 10.0] {
        assert_eq!(halfsine(x, 0.0, 10.0), 0.0);
    }
    assert_eq!(constant_interslice(5.0, 0.0, 10.0), 1.0);
    assert_eq!(constant_interslice(0.0, 0.0, 10.0), 0.0);
    assert_eq!(constant_interslice(10.0, 0.0, 10.0), 0.0);
    assert!(clipped_sine(1.0, 0.0, 10.0) > 0.34);
    close_to(trapezoidal(5.0, 0.0, 10.0), 1.0, 10);
    assert_eq!(
        get_interslice_function_value(Some(K::Constant), 5.0, 0.0, 10.0, &[]),
        1.0
    );
    close_to(
        get_interslice_function_value(Some(K::HalfSine), 5.0, 0.0, 10.0, &[]),
        1.0,
        10,
    );
}

// ── spline (types/shansep.test.ts) ──

#[test]
fn natural_and_clamped_splines() {
    let line = cubic_spline(&[[0.0, 1.0], [1.0, 3.0], [3.0, 7.0]], [None, None]);
    close_to(eval_spline(&line, 2.0).value, 5.0, 12);
    close_to(eval_spline(&line, 5.0).value, 11.0, 12);
    let sq = cubic_spline(
        &[[0.0, 0.0], [1.0, 1.0], [2.0, 4.0], [3.0, 9.0]],
        [Some(0.0), Some(6.0)],
    );
    close_to(eval_spline(&sq, 1.5).value, 2.25, 12);
    close_to(eval_spline(&sq, 2.5).slope, 5.0, 12);
}
