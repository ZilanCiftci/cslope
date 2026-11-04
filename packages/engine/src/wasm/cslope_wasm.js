/* @ts-self-types="./cslope_wasm.d.ts" */

/**
 * `adaptiveBounds(slope, options)`; `on_level` is `options.onLevel`.
 * @param {any} slope
 * @param {any} options
 * @param {number | null | undefined} size_field
 * @param {any} on_level
 * @returns {any}
 */
export function adaptive_bounds(slope, options, size_field, on_level) {
    const ret = wasm.adaptive_bounds(slope, options, isLikeNone(size_field) ? Number.MAX_SAFE_INTEGER : (size_field) >>> 0, on_level);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 */
export function add_single_circular_plane(handle, cx, cy, radius) {
    const ret = wasm.add_single_circular_plane(handle, cx, cy, radius);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {number} lc_x
 * @param {number} rc_x
 * @param {number} num_circles
 */
export function add_single_entry_exit_plane(handle, lc_x, rc_x, num_circles) {
    const ret = wasm.add_single_entry_exit_plane(handle, lc_x, rc_x, num_circles);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} slices
 * @param {number | null} [fs]
 * @returns {any}
 */
export function analyse_bishop(handle, slices, fs) {
    const ret = wasm.analyse_bishop(handle, slices, !isLikeNone(fs), isLikeNone(fs) ? 0 : fs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} slices
 * @param {number | null} [fs]
 * @returns {any}
 */
export function analyse_janbu(handle, slices, fs) {
    const ret = wasm.analyse_janbu(handle, slices, !isLikeNone(fs), isLikeNone(fs) ? 0 : fs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} slices
 * @returns {any}
 */
export function analyse_morgenstern_price(handle, slices) {
    const ret = wasm.analyse_morgenstern_price(handle, slices);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} slices
 * @returns {number | undefined}
 */
export function analyse_ordinary(handle, slices) {
    const ret = wasm.analyse_ordinary(handle, slices);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * `analyseReliability(def, options, variables, ro)`; `on_progress` is
 * `ro.onProgress`.
 * @param {any} def
 * @param {any} options
 * @param {any} variables
 * @param {any} ro
 * @param {Function | null} [on_progress]
 * @returns {any}
 */
export function analyse_reliability(def, options, variables, ro, on_progress) {
    const ret = wasm.analyse_reliability(def, options, variables, ro, isLikeNone(on_progress) ? 0 : addToExternrefTable0(on_progress));
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `analyseSlope(slope)`: the minimum FOS (the results set on the slope).
 * @param {number} handle
 * @returns {number | undefined}
 */
export function analyse_slope(handle) {
    const ret = wasm.analyse_slope(handle);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * `analyseSlopeSteps(slope)`: generates the search planes first, as the
 * TypeScript generator does before its first yield.
 * @param {number} handle
 * @returns {number}
 */
export function analyse_steps_new(handle) {
    const ret = wasm.analyse_steps_new(handle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * `analysisResult(slope, minFOS, options, start)`: `elapsed_ms` is the
 * time since `start`.
 * @param {number} handle
 * @param {number | null | undefined} min_fos
 * @param {any} options
 * @param {number} elapsed_ms
 * @returns {any}
 */
export function analysis_result(handle, min_fos, options, elapsed_ms) {
    const ret = wasm.analysis_result(handle, !isLikeNone(min_fos), isLikeNone(min_fos) ? 0 : min_fos, options, elapsed_ms);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} effective_normals
 * @returns {any}
 */
export function analysis_warnings(handle, effective_normals) {
    const ret = wasm.analysis_warnings(handle, effective_normals);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `analyzeFem(slope, options)`; `size_field` is the handle of
 * `options.sizeField`, `on_trial` its `onTrial`.
 * @param {any} slope
 * @param {any} options
 * @param {number | null | undefined} size_field
 * @param {any} on_trial
 * @returns {any}
 */
export function analyze_fem(slope, options, size_field, on_trial) {
    const ret = wasm.analyze_fem(slope, options, isLikeNone(size_field) ? Number.MAX_SAFE_INTEGER : (size_field) >>> 0, on_trial);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} slices
 * @param {any} plane
 * @returns {any}
 */
export function apply_rapid_drawdown_to(handle, slices, plane) {
    const ret = wasm.apply_rapid_drawdown_to(handle, slices, plane);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} slices
 * @param {number} cx
 * @param {number} cy
 * @returns {any}
 */
export function apply_reinforcement(handle, slices, cx, cy) {
    const ret = wasm.apply_reinforcement(handle, slices, cx, cy);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} planes
 * @param {number} count
 * @param {number} span
 * @returns {any}
 */
export function best_distinct_planes(planes, count, span) {
    const ret = wasm.best_distinct_planes(planes, count, span);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @returns {number}
 */
export function block_search_steps_new(handle) {
    const ret = wasm.block_search_steps_new(handle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} handle
 * @param {Function} bridge
 * @returns {any}
 */
export function block_search_with(handle, bridge) {
    const ret = wasm.block_search_with(handle, bridge);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {number} x0
 * @param {number} x1
 * @param {Function} base_y
 * @returns {boolean}
 */
export function boundary_corner_in_mass(handle, x0, x1, base_y) {
    const ret = wasm.boundary_corner_in_mass(handle, x0, x1, base_y);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {number} handle
 * @param {any} r
 * @returns {any}
 */
export function build_envelope(handle, r) {
    const ret = wasm.build_envelope(handle, r);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} p
 * @returns {any}
 */
export function build_pile_profile(handle, p) {
    const ret = wasm.build_pile_profile(handle, p);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} def
 * @returns {number}
 */
export function build_slope(def) {
    const ret = wasm.build_slope(def);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * `udls`: [x1, x2, magnitude][]; `line_loads`: [x, magnitude][].
 * @param {Float64Array | number[]} widths
 * @param {Float64Array | number[]} center_xs
 * @param {any} udls
 * @param {any} line_loads
 * @returns {any}
 */
export function calculate_all_loads(widths, center_xs, udls, line_loads) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(widths, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(center_xs, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.calculate_all_loads(ptr0, len0, ptr1, len1, udls, line_loads);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Float64Array | number[]} x
 * @param {Float64Array | number[]} y
 * @returns {number}
 */
export function calculate_polygon_area(x, y) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(x, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(y, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.calculate_polygon_area(ptr0, len0, ptr1, len1);
    return ret;
}

/**
 * @param {any} floor
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} x0
 * @param {number} x1
 * @param {number} tol
 * @returns {boolean}
 */
export function circle_below_bare_base(floor, cx, cy, radius, x0, x1, tol) {
    const ret = wasm.circle_below_bare_base(floor, cx, cy, radius, x0, x1, tol);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {number} beta
 * @param {number} ix
 * @param {number} iy
 * @param {number} chord_to_centre
 * @returns {Float64Array}
 */
export function circle_centre(beta, ix, iy, chord_to_centre) {
    const ret = wasm.circle_centre(beta, ix, iy, chord_to_centre);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @param {number} handle
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} x0
 * @param {number} x1
 * @returns {boolean}
 */
export function circle_leaves_model(handle, cx, cy, radius, x0, x1) {
    const ret = wasm.circle_leaves_model(handle, cx, cy, radius, x0, x1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {number} c_to_e
 * @param {number} c
 * @returns {number | undefined}
 */
export function circle_radius_from_abcd(c_to_e, c) {
    const ret = wasm.circle_radius_from_abcd(c_to_e, c);
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {any} lc
 * @param {any} rc
 * @param {number} vertices
 * @returns {any}
 */
export function circle_to_polyline(cx, cy, radius, lc, rc, vertices) {
    const ret = wasm.circle_to_polyline(cx, cy, radius, lc, rc, vertices);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Float64Array | number[]} px
 * @param {Float64Array | number[]} py
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @returns {any}
 */
export function clip_polygon_halfplane(px, py, a, b, c) {
    const val3 = +a;
    const val4 = +b;
    const val5 = +c;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(px, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(py, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.clip_polygon_halfplane(ptr0, len0, ptr1, len1, val3, val4, val5);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Float64Array | number[]} poly_x
 * @param {Float64Array | number[]} poly_y
 * @param {number} x_min
 * @param {number} x_max
 * @returns {any}
 */
export function clip_polygon_vertical(poly_x, poly_y, x_min, x_max) {
    const val3 = +x_min;
    const val4 = +x_max;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(poly_x, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(poly_y, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.clip_polygon_vertical(ptr0, len0, ptr1, len1, val3, val4);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x
 * @param {number} x_start
 * @param {number} x_end
 * @returns {number}
 */
export function clipped_sine(x, x_start, x_end) {
    const ret = wasm.clipped_sine(x, x_start, x_end);
    return ret;
}

/**
 * @param {any} boundary
 * @param {any} geometries
 * @param {any} materials
 * @param {boolean} follow_base
 * @returns {any}
 */
export function composite_floor(boundary, geometries, materials, follow_base) {
    const ret = wasm.composite_floor(boundary, geometries, materials, follow_base);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x
 * @param {number} x_start
 * @param {number} x_end
 * @returns {number}
 */
export function constant_interslice(x, x_start, x_end) {
    const ret = wasm.constant_interslice(x, x_start, x_end);
    return ret;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function dangling_boundary_message(n) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.dangling_boundary_message(n);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * `points`: [x, f][].
 * @param {number} x
 * @param {number} x_start
 * @param {number} x_end
 * @param {any} points
 * @returns {number}
 */
export function data_point_specified(x, x_start, x_end, points) {
    const ret = wasm.data_point_specified(x, x_start, x_end, points);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @returns {any}
 */
export function default_analysis_options() {
    const ret = wasm.default_analysis_options();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} points
 * @returns {Float64Array}
 */
export function default_axis_point(points) {
    const ret = wasm.default_axis_point(points);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @returns {any}
 */
export function default_fem_settings() {
    const ret = wasm.default_fem_settings();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} plane
 * @returns {any}
 */
export function display_points(plane) {
    const ret = wasm.display_points(plane);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
export function dist_points(x1, y1, x2, y2) {
    const ret = wasm.dist_points(x1, y1, x2, y2);
    return ret;
}

/**
 * @param {number} sfc
 * @param {number} tfc
 * @param {number} c
 * @param {number} phi_deg
 * @param {number} c_r
 * @param {number} phi_r_deg
 * @returns {number}
 */
export function drawdown_strength(sfc, tfc, c, phi_deg, c_r, phi_r_deg) {
    const ret = wasm.drawdown_strength(sfc, tfc, c, phi_deg, c_r, phi_r_deg);
    return ret;
}

/**
 * @param {number} handle
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function effective_vertical_stress(handle, x, y) {
    const ret = wasm.effective_vertical_stress(handle, x, y);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function effective_vertical_stress_with_loads(handle, x, y) {
    const ret = wasm.effective_vertical_stress_with_loads(handle, x, y);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * The crate version and whether this is the testing build, for the
 * facade's sanity check and BUILD-INFO.
 * @returns {string}
 */
export function engine_build() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.engine_build();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @returns {any}
 */
export function engine_constants() {
    const ret = wasm.engine_constants();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * The engine clock's reading (ms), for the facade's check of the clock.
 * @returns {number}
 */
export function engine_now_ms() {
    const ret = wasm.engine_now_ms();
    return ret;
}

/**
 * @param {any} plane
 * @returns {number}
 */
export function entry_inclination(plane) {
    const ret = wasm.entry_inclination(plane);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {any} env
 * @param {number} s
 * @returns {number}
 */
export function envelope_at(env, s) {
    const ret = wasm.envelope_at(env, s);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * `evaluatePlanes(slope, planes)`: the planes as evaluated (the facade
 * writes them back onto the caller's objects).
 * @param {number} handle
 * @param {any} planes
 * @returns {any}
 */
export function evaluate_planes(handle, planes) {
    const ret = wasm.evaluate_planes(handle, planes);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `lff_array`: [lambda, FS, FS_force][].
 * @param {any} lff_array
 * @returns {Float64Array}
 */
export function extrapolate_lambda(lff_array) {
    const ret = wasm.extrapolate_lambda(lff_array);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * The engine's values of the FE modules' data constants, which the facade
 * keeps as TypeScript (its test compares them).
 * @returns {any}
 */
export function fem_constants() {
    const ret = wasm.fem_constants();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x_entry
 * @param {number} x_exit
 * @param {Function} base_y
 * @param {number} angle
 * @returns {number | undefined}
 */
export function find_angle_crack_x(x_entry, x_exit, base_y, angle) {
    const ret = wasm.find_angle_crack_x(x_entry, x_exit, base_y, angle);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * @param {any} surf
 * @param {number} x_entry
 * @param {number} x_exit
 * @param {Function} base_y
 * @param {Function} depth_at
 * @returns {number | undefined}
 */
export function find_crack_x(surf, x_entry, x_exit, base_y, depth_at) {
    const ret = wasm.find_crack_x(surf, x_entry, x_exit, base_y, depth_at);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * @param {number} handle
 * @param {any} input
 * @returns {any}
 */
export function fit_polyline_to_ground(handle, input) {
    const ret = wasm.fit_polyline_to_ground(handle, input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} model_height
 * @returns {number}
 */
export function floor_dip_tolerance(model_height) {
    const ret = wasm.floor_dip_tolerance(model_height);
    return ret;
}

/**
 * @param {any} floor
 * @param {number} x
 * @param {any} side
 * @returns {number}
 */
export function floor_y_at(floor, x, side) {
    const ret = wasm.floor_y_at(floor, x, side);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @param {boolean} sliding_only
 * @returns {any}
 */
export function frictional_surface_slide(handle, sliding_only) {
    const ret = wasm.frictional_surface_slide(handle, sliding_only);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `num_points`: TypeScript's count (a number); below 2 gives one point.
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} num_points
 * @returns {any}
 */
export function generate_circle_coordinates(cx, cy, radius, num_points) {
    const ret = wasm.generate_circle_coordinates(cx, cy, radius, num_points);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} lc
 * @param {any} rc
 * @param {number} num_circles
 * @returns {any}
 */
export function generate_planes(handle, lc, rc, num_circles) {
    const ret = wasm.generate_planes(handle, lc, rc, num_circles);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * The bounds `createGeometryWithMaterial` caches: [xMin, xMax, yMax], or
 * empty without points.
 * @param {Float64Array | number[]} px
 * @param {Float64Array | number[]} py
 * @returns {Float64Array}
 */
export function geometry_bounds(px, py) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(px, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(py, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.geometry_bounds(ptr0, len0, ptr1, len1);
    var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v3;
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {Float64Array | number[]} px
 * @param {Float64Array | number[]} py
 * @returns {any}
 */
export function get_circle_line_intersections(cx, cy, r, px, py) {
    const val3 = +cx;
    const val4 = +cy;
    const val5 = +r;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(px, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(py, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.get_circle_line_intersections(val3, val4, val5, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} x
 * @returns {number}
 */
export function get_circle_y_coordinate_at_x(cx, cy, radius, x) {
    const ret = wasm.get_circle_y_coordinate_at_x(cx, cy, radius, x);
    return ret;
}

/**
 * @param {any} coordinates
 * @returns {Float64Array}
 */
export function get_domain_x(coordinates) {
    const ret = wasm.get_domain_x(coordinates);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * `kind`: an interslice function name or undefined; an unknown name is
 * the half-sine, as TypeScript's `default:` branch.
 * @param {any} kind
 * @param {number} x
 * @param {number} x_start
 * @param {number} x_end
 * @param {any} points
 * @returns {number}
 */
export function get_interslice_function_value(kind, x, x_start, x_end, points) {
    const ret = wasm.get_interslice_function_value(kind, x, x_start, x_end, points);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {Float64Array | number[]} line_x
 * @param {Float64Array | number[]} line_y
 * @param {number} x1
 * @param {number} x2
 * @returns {any}
 */
export function get_line_between_points(line_x, line_y, x1, x2) {
    const val3 = +x1;
    const val4 = +x2;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(line_x, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(line_y, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.get_line_between_points(ptr0, len0, ptr1, len1, val3, val4);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @returns {string}
 */
export function get_morgenstern_price_solver() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.get_morgenstern_price_solver();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {number} n
 * @returns {number}
 */
export function get_precision(n) {
    const ret = wasm.get_precision(n);
    return ret >>> 0;
}

/**
 * @param {number} handle
 * @param {number} entry_x
 * @param {number} x1
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {any} points
 * @returns {any}
 */
export function get_slices(handle, entry_x, x1, cx, cy, radius, points) {
    const ret = wasm.get_slices(handle, entry_x, x1, cx, cy, radius, points);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Float64Array | number[]} px
 * @param {Float64Array | number[]} py
 * @returns {any}
 */
export function get_surface_line(px, py) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(px, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(py, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.get_surface_line(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Float64Array | number[]} poly_x
 * @param {Float64Array | number[]} poly_y
 * @param {number} x
 * @returns {number}
 */
export function get_y_at_x(poly_x, poly_y, x) {
    const val3 = +x;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(poly_x, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(poly_y, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.get_y_at_x(ptr0, len0, ptr1, len1, val3);
    return ret;
}

/**
 * @param {Float64Array | number[]} poly_x
 * @param {Float64Array | number[]} poly_y
 * @param {Float64Array | number[]} x_values
 * @returns {Float64Array}
 */
export function get_y_at_x_many(poly_x, poly_y, x_values) {
    let ptr0, len0, ptr1, len1, ptr2, len2;
    try {
        ptr0 = passArrayF64ToWasm0(poly_x, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(poly_y, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passArrayF64ToWasm0(x_values, wasm.__wbindgen_malloc);
        len2 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 8, 8); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.get_y_at_x_many(ptr0, len0, ptr1, len1, ptr2, len2);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * @param {Float64Array | number[]} line_x
 * @param {Float64Array | number[]} line_y
 * @param {number} x
 * @returns {number}
 */
export function get_y_at_x_strict(line_x, line_y, x) {
    const val3 = +x;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(line_x, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(line_y, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.get_y_at_x_strict(ptr0, len0, ptr1, len1, val3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} x
 * @param {number} x_start
 * @param {number} x_end
 * @returns {number}
 */
export function halfsine(x, x_start, x_end) {
    const ret = wasm.halfsine(x, x_start, x_end);
    return ret;
}

/**
 * @param {any} line
 * @param {number} wy_left
 * @param {number} wy_right
 * @param {number} x_left
 * @param {number} x_right
 * @param {boolean} vertical_head
 * @returns {number}
 */
export function head_factor(line, wy_left, wy_right, x_left, x_right, vertical_head) {
    const ret = wasm.head_factor(line, wy_left, wy_right, x_left, x_right, vertical_head);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * `hoekBrownOf(model)`: `model` needs only the Hoek–Brown fields.
 * @param {any} model_js
 * @returns {any}
 */
export function hoek_brown_of(model_js) {
    const ret = wasm.hoek_brown_of(model_js);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} ucs
 * @param {number} gsi
 * @param {number} mi
 * @param {number} disturbance
 * @returns {any}
 */
export function hoek_brown_parameters(ucs, gsi, mi, disturbance) {
    const ret = wasm.hoek_brown_parameters(ucs, gsi, mi, disturbance);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} coordinates
 * @returns {any}
 */
export function infer_orientation_from_coordinates(coordinates) {
    const ret = wasm.infer_orientation_from_coordinates(coordinates);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} p
 * @param {number} sn
 * @returns {any}
 */
export function instantaneous_at_normal_stress(p, sn) {
    const ret = wasm.instantaneous_at_normal_stress(p, sn);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} p
 * @param {number} s3
 * @returns {any}
 */
export function instantaneous_at_sigma3(p, s3) {
    const ret = wasm.instantaneous_at_sigma3(p, s3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `points`: [x, y][].
 * @param {any} points
 * @param {number} x
 * @returns {number}
 */
export function interpolate_function(points, x) {
    const ret = wasm.interpolate_function(points, x);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @param {any} points
 * @param {number} concavity_tol_deg
 * @returns {boolean}
 */
export function is_admissible_polyline(handle, points, concavity_tol_deg) {
    const ret = wasm.is_admissible_polyline(handle, points, concavity_tol_deg);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {any} model_js
 * @returns {boolean}
 */
export function is_combined_depth_model(model_js) {
    const ret = wasm.is_combined_depth_model(model_js);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {number} handle
 * @param {any} plane
 * @param {boolean} as_circle
 * @returns {boolean}
 */
export function is_plane_within_external_boundary(handle, plane, as_circle) {
    const ret = wasm.is_plane_within_external_boundary(handle, plane, as_circle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {number} px
 * @param {number} py
 * @param {Float64Array | number[]} poly_x
 * @param {Float64Array | number[]} poly_y
 * @returns {boolean}
 */
export function is_point_in_polygon(px, py, poly_x, poly_y) {
    const val3 = +px;
    const val4 = +py;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(poly_x, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(poly_y, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.is_point_in_polygon(val3, val4, ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * @param {number} D1
 * @param {number} D
 * @param {number} phi_deg
 * @returns {Float64Array}
 */
export function ito_matsui_coefficients(D1, D, phi_deg) {
    const ret = wasm.ito_matsui_coefficients(D1, D, phi_deg);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @param {any} slices
 * @returns {number}
 */
export function janbu_correction_factor(slices) {
    const ret = wasm.janbu_correction_factor(slices);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * `new LineLoad(params)`: the normalised fields (`y` left out when unset).
 * @param {any} params
 * @returns {any}
 */
export function line_load_new(params) {
    const ret = wasm.line_load_new(params);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} x3
 * @param {number} y3
 * @param {number} x4
 * @param {number} y4
 * @returns {Float64Array | undefined}
 */
export function line_segment_intersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    const ret = wasm.line_segment_intersection(x1, y1, x2, y2, x3, y3, x4, y4);
    let v1;
    if (ret[0] !== 0) {
        v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    }
    return v1;
}

/**
 * @param {number} f
 * @param {number} cov
 * @returns {number}
 */
export function lognormal_beta(f, cov) {
    const ret = wasm.lognormal_beta(f, cov);
    return ret;
}

/**
 * `lowerBound(slope, options)`.
 * @param {any} slope
 * @param {any} options
 * @param {number | null} [size_field]
 * @returns {any}
 */
export function lower_bound(slope, options, size_field) {
    const ret = wasm.lower_bound(slope, options, isLikeNone(size_field) ? Number.MAX_SAFE_INTEGER : (size_field) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} result
 * @param {any} def
 * @returns {any}
 */
export function map_analysis_result_to_model_space(result, def) {
    const ret = wasm.map_analysis_result_to_model_space(result, def);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @returns {string[]}
 */
export function material_colors() {
    const ret = wasm.material_colors();
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * `MATERIAL_MODEL_LABELS` as [kind, label] pairs.
 * @returns {any}
 */
export function material_model_labels() {
    const ret = wasm.material_model_labels();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * The definition's material model (`materialModelOf`).
 * @param {any} material
 * @returns {any}
 */
export function material_model_of(material) {
    const ret = wasm.material_model_of(material);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `new Material(params)`: `{ name, color, model }`, or the constructor's
 * RangeError.
 * @param {any} params
 * @returns {any}
 */
export function material_new(params) {
    const ret = wasm.material_new(params);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {Float64Array}
 */
export function mid_coord(x1, y1, x2, y2) {
    const ret = wasm.mid_coord(x1, y1, x2, y2);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @param {any} limits
 * @param {number} x_min
 * @param {number} x_max
 * @returns {any}
 */
export function mirror_limits(limits, x_min, x_max) {
    const ret = wasm.mirror_limits(limits, x_min, x_max);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} x_min
 * @param {number} x_max
 * @returns {Float64Array}
 */
export function mirror_point(x, y, x_min, x_max) {
    const ret = wasm.mirror_point(x, y, x_min, x_max);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @param {any} pts
 * @param {number} x_min
 * @param {number} x_max
 * @returns {any}
 */
export function mirror_points(pts, x_min, x_max) {
    const ret = wasm.mirror_points(pts, x_min, x_max);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x
 * @param {number} x_min
 * @param {number} x_max
 * @returns {number}
 */
export function mirror_x(x, x_min, x_max) {
    const ret = wasm.mirror_x(x, x_min, x_max);
    return ret;
}

/**
 * @param {number} handle
 * @param {Float64Array | number[]} values
 * @returns {number | undefined}
 */
export function monte_carlo_sample(handle, values) {
    const val2 = +handle;
    const ptr0 = passArrayF64ToWasm0(values, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.monte_carlo_sample(val2, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * @param {number} handle
 * @returns {boolean}
 */
export function monte_carlo_sampler_free(handle) {
    const ret = wasm.monte_carlo_sampler_free(handle);
    return ret !== 0;
}

/**
 * @param {any} def
 * @param {any} options
 * @param {any} variables
 * @returns {number}
 */
export function monte_carlo_sampler_new(def, options, variables) {
    const ret = wasm.monte_carlo_sampler_new(def, options, variables);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {any} model_js
 * @returns {boolean}
 */
export function needs_layer_top(model_js) {
    const ret = wasm.needs_layer_top(model_js);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {number} x
 * @returns {number}
 */
export function normal_cdf(x) {
    const ret = wasm.normal_cdf(x);
    return ret;
}

/**
 * @param {any} def
 * @returns {any}
 */
export function opposite_direction_definition(def) {
    const ret = wasm.opposite_direction_definition(def);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} evaluated
 * @param {any} options
 * @returns {number}
 */
export function optimise_non_circular_steps_new(handle, evaluated, options) {
    const ret = wasm.optimise_non_circular_steps_new(handle, evaluated, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} handle
 * @param {any} evaluated
 * @param {Function} bridge
 * @param {any} options
 * @returns {any}
 */
export function optimise_non_circular_with(handle, evaluated, bridge, options) {
    const ret = wasm.optimise_non_circular_with(handle, evaluated, bridge, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {any} seeds
 * @param {any} options
 * @returns {number}
 */
export function optimise_polylines_steps_new(handle, seeds, options) {
    const ret = wasm.optimise_polylines_steps_new(handle, seeds, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} handle
 * @param {any} seeds
 * @param {Function} bridge
 * @param {any} options
 * @returns {any}
 */
export function optimise_polylines_with(handle, seeds, bridge, options) {
    const ret = wasm.optimise_polylines_with(handle, seeds, bridge, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `pileForce(slope, p, x, y, profile?)`: `profile` undefined builds it,
 * null is none.
 * @param {number} handle
 * @param {any} p
 * @param {number} x
 * @param {number} y
 * @param {any} profile
 * @returns {any}
 */
export function pile_force(handle, p, x, y, profile) {
    const ret = wasm.pile_force(handle, p, x, y, profile);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} p
 * @param {number} tx
 * @param {number} ty
 * @returns {Float64Array}
 */
export function pile_force_direction(p, tx, ty) {
    const ret = wasm.pile_force_direction(p, tx, ty);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @param {any} plane
 * @returns {string}
 */
export function plane_key(plane) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.plane_key(plane);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {Float64Array | number[]} px
 * @param {Float64Array | number[]} py
 * @param {any} lines_js
 * @returns {any}
 */
export function polygonize_regions(px, py, lines_js) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(px, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(py, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.polygonize_regions(ptr0, len0, ptr1, len1, lines_js);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} points
 * @param {Float64Array | number[]} px
 * @param {Float64Array | number[]} py
 * @param {boolean} closed
 * @returns {Float64Array}
 */
export function polyline_crossings_x(points, px, py, closed) {
    const val3 = +closed;
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArrayF64ToWasm0(px, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(py, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.polyline_crossings_x(points, ptr0, len0, ptr1, len1, val3);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * @param {any} points
 * @param {number} x
 * @returns {number}
 */
export function polyline_y_at(points, x) {
    const ret = wasm.polyline_y_at(points, x);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {any} env
 * @param {number} s
 * @returns {number}
 */
export function pullout_beyond(env, s) {
    const ret = wasm.pullout_beyond(env, s);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @param {number} x
 * @returns {number}
 */
export function rankine_crack_depth(handle, x) {
    const ret = wasm.rankine_crack_depth(handle, x);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {any} ground
 * @param {number} x0
 * @param {number} y0
 * @param {number} dx
 * @param {number} dy
 * @returns {any}
 */
export function ray_to_ground(ground, x0, y0, dx, dy) {
    const ret = wasm.ray_to_ground(ground, x0, y0, dx, dy);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @returns {boolean}
 */
export function reliability_steps_free(handle) {
    const ret = wasm.reliability_steps_free(handle);
    return ret !== 0;
}

/**
 * @param {any} def
 * @param {any} options
 * @param {any} variables
 * @param {any} ro
 * @returns {number}
 */
export function reliability_steps_new(def, options, variables, ro) {
    const ret = wasm.reliability_steps_new(def, options, variables, ro);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * Resumes a reliability analysis: `factors` are the samples' factors
 * after a samples step. Returns `{ kind: "analyse", slope }` (a slope
 * handle to analyse, given back on the next resume), `{ kind: "samples",
 * values, def, count }` or `{ kind: "done", result }`, with the progress
 * reached since the last step.
 * @param {number} handle
 * @param {any} factors
 * @returns {any}
 */
export function reliability_steps_resume(handle, factors) {
    const ret = wasm.reliability_steps_resume(handle, factors);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * F of one set of values of the samples step out (the step's sampler).
 * @param {number} handle
 * @param {Float64Array | number[]} values
 * @returns {number | undefined}
 */
export function reliability_steps_sample(handle, values) {
    const val2 = +handle;
    const ptr0 = passArrayF64ToWasm0(values, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.reliability_steps_sample(val2, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * @param {any} surface
 * @param {any} def
 * @returns {any}
 */
export function reliability_surface_to_model_space(surface, def) {
    const ret = wasm.reliability_surface_to_model_space(surface, def);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `orientation`: "ltr", "rtl" or undefined (inferred).
 * @param {any} orientation
 * @param {any} coordinates
 * @returns {any}
 */
export function resolve_orientation(orientation, coordinates) {
    const ret = wasm.resolve_orientation(orientation, coordinates);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} model_js
 * @param {any} context
 * @returns {any}
 */
export function resolve_strength(model_js, context) {
    const ret = wasm.resolve_strength(model_js, context);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} model_js
 * @param {number} fallback
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function resolve_unit_weight(model_js, fallback, x, y) {
    const ret = wasm.resolve_unit_weight(model_js, fallback, x, y);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 */
export function restore_critical_slices(handle) {
    const ret = wasm.restore_critical_slices(handle);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * `runAnalysis(def, options, { onProgress })`: `on_progress` gets the
 * surfaces evaluated so far in the direction analysed.
 * @param {any} def
 * @param {any} options
 * @param {Function | null} [on_progress]
 * @returns {any}
 */
export function run_analysis(def, options, on_progress) {
    const ret = wasm.run_analysis(def, options, isLikeNone(on_progress) ? 0 : addToExternrefTable0(on_progress));
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `runFemSummary(definition, settings, onTrial, onStage)`.
 * @param {any} definition
 * @param {any} settings
 * @param {any} on_trial
 * @param {any} on_stage
 * @returns {any}
 */
export function run_fem_summary(definition, settings, on_trial, on_stage) {
    const ret = wasm.run_fem_summary(definition, settings, on_trial, on_stage);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `runFemSummaryWithBounds(definition, settings, onTrial, onStage)`
 * (Clarabel is linked in: the facade's `solvers` loader is not called).
 * @param {any} definition
 * @param {any} settings
 * @param {any} on_trial
 * @param {any} on_stage
 * @returns {any}
 */
export function run_fem_summary_with_bounds(definition, settings, on_trial, on_stage) {
    const ret = wasm.run_fem_summary_with_bounds(definition, settings, on_trial, on_stage);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @returns {any}
 */
export function select_entry_exit(handle, cx, cy, radius) {
    const ret = wasm.select_entry_exit(handle, cx, cy, radius);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 */
export function set_entry_exit_planes(handle) {
    const ret = wasm.set_entry_exit_planes(handle);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {string} solver
 */
export function set_morgenstern_price_solver(solver) {
    const ptr0 = passStringToWasm0(solver, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.set_morgenstern_price_solver(ptr0, len0);
}

/**
 * @param {number} handle
 * @param {any} options
 * @returns {any}
 */
export function sgi3d_factor_of_safety(handle, options) {
    const ret = wasm.sgi3d_factor_of_safety(handle, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `shallowCohesionlessMessage(slices, fos, relief)`: the slices' materials
 * are indices into `materials`.
 * @param {any} slices
 * @param {any} materials
 * @param {number} fos
 * @param {number} relief
 * @returns {string | undefined}
 */
export function shallow_cohesionless_message(slices, materials, fos, relief) {
    const ret = wasm.shallow_cohesionless_message(slices, materials, fos, relief);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * @param {number} local_relief
 * @returns {number}
 */
export function shallow_depth_limit(local_relief) {
    const ret = wasm.shallow_depth_limit(local_relief);
    return ret;
}

/**
 * The element size at (x, y) of a size field.
 * @param {number} handle
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function size_field_at(handle, x, y) {
    const ret = wasm.size_field_at(handle, x, y);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * A constant size field (`() => value`, with `min` when given): the
 * one closure the facade can turn into data.
 * @param {number} value
 * @param {number | null} [min]
 * @returns {number}
 */
export function size_field_constant(value, min) {
    const ret = wasm.size_field_constant(value, !isLikeNone(min), isLikeNone(min) ? 0 : min);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * Live size field handles (for the facade's leak test).
 * @returns {number}
 */
export function size_field_count() {
    const ret = wasm.size_field_count();
    return ret >>> 0;
}

/**
 * @param {number} handle
 * @returns {boolean}
 */
export function size_field_free(handle) {
    const ret = wasm.size_field_free(handle);
    return ret !== 0;
}

/**
 * Its smallest value, when known (undefined otherwise).
 * @param {number} handle
 * @returns {number | undefined}
 */
export function size_field_min(handle) {
    const ret = wasm.size_field_min(handle);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * @param {any} s
 * @returns {number}
 */
export function slice_driving_moment(s) {
    const ret = wasm.slice_driving_moment(s);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {any} s
 * @returns {number}
 */
export function slice_vertical_load(s) {
    const ret = wasm.slice_vertical_load(s);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @param {Float64Array | number[]} x
 */
export function slope_add_fixed_slices(handle, x) {
    const val2 = +handle;
    const ptr0 = passArrayF64ToWasm0(x, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.slope_add_fixed_slices(val2, ptr0, len0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} planes
 */
export function slope_add_individual_planes(handle, planes) {
    const ret = wasm.slope_add_individual_planes(handle, planes);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} m
 */
export function slope_add_material(handle, m) {
    const ret = wasm.slope_add_material(handle, m);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} coord
 * @param {any} m
 */
export function slope_assign_material(handle, coord, m) {
    const ret = wasm.slope_assign_material(handle, coord, m);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} m
 * @param {any} id
 */
export function slope_assign_material_water_table(handle, m, id) {
    const ret = wasm.slope_assign_material_water_table(handle, m, id);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * A copy of a child slope ("earlierStage", "drawdownBefore") under a new
 * handle, or `undefined`.
 * @param {number} handle
 * @param {string} which
 * @returns {number | undefined}
 */
export function slope_child(handle, which) {
    const val2 = +handle;
    const ptr0 = passStringToWasm0(which, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.slope_child(val2, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] === Number.MAX_SAFE_INTEGER ? undefined : ret[0];
}

/**
 * A copy of the slope under a new handle.
 * @param {number} handle
 * @returns {number}
 */
export function slope_clone(handle) {
    const ret = wasm.slope_clone(handle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * Live slope handles (for the facade's leak test).
 * @returns {number}
 */
export function slope_count() {
    const ret = wasm.slope_count();
    return ret >>> 0;
}

/**
 * @param {number} handle
 * @returns {boolean}
 */
export function slope_free(handle) {
    const ret = wasm.slope_free(handle);
    return ret !== 0;
}

/**
 * A property of the slope by its TypeScript getter name.
 * @param {number} handle
 * @param {string} name
 * @returns {any}
 */
export function slope_get(handle, name) {
    const val2 = +handle;
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.slope_get(val2, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @returns {any}
 */
export function slope_get_circle_external_intersection(handle, cx, cy, radius) {
    const ret = wasm.slope_get_circle_external_intersection(handle, cx, cy, radius);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {number} x
 * @returns {number}
 */
export function slope_get_external_y_intersection(handle, x) {
    const ret = wasm.slope_get_external_y_intersection(handle, x);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @returns {number}
 */
export function slope_get_max_fos(handle) {
    const ret = wasm.slope_get_max_fos(handle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @returns {number}
 */
export function slope_get_min_fos(handle) {
    const ret = wasm.slope_get_min_fos(handle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @returns {any}
 */
export function slope_get_min_fos_circle(handle) {
    const ret = wasm.slope_get_min_fos_circle(handle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @returns {any}
 */
export function slope_get_min_fos_end_points(handle) {
    const ret = wasm.slope_get_min_fos_end_points(handle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 * @param {number} x
 * @returns {number}
 */
export function slope_get_water_y_intersection(handle, x) {
    const ret = wasm.slope_get_water_y_intersection(handle, x);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function slope_is_inside_external_boundary(handle, x, y) {
    const ret = wasm.slope_is_inside_external_boundary(handle, x, y);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * The table index of a material (inserted if new).
 * @param {number} handle
 * @param {any} m
 * @returns {number}
 */
export function slope_material_index(handle, m) {
    const ret = wasm.slope_material_index(handle, m);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * `materialsChanged()` after models were changed in place: the facade
 * passes the current models of the materials JavaScript knows.
 * @param {number} handle
 * @param {any} materials
 */
export function slope_materials_changed(handle, materials) {
    const ret = wasm.slope_materials_changed(handle, materials);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @returns {number}
 */
export function slope_new() {
    const ret = wasm.slope_new();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * The slices of plane `index` of the slope's `list` ("search" or
 * "individualPlanes"): its own, or, if the analysis dropped them, the
 * plane evaluated again (the same surface gives the same slices).
 * @param {number} handle
 * @param {string} list
 * @param {number} index
 * @returns {any}
 */
export function slope_plane_slices(handle, list, index) {
    const val2 = +handle;
    const val3 = +index;
    const ptr0 = passStringToWasm0(list, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.slope_plane_slices(val2, ptr0, len0, val3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} handle
 */
export function slope_remove_analysis_limits(handle) {
    const ret = wasm.slope_remove_analysis_limits(handle);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 */
export function slope_remove_individual_planes(handle) {
    const ret = wasm.slope_remove_individual_planes(handle);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 */
export function slope_remove_line_loads(handle) {
    const ret = wasm.slope_remove_line_loads(handle);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 */
export function slope_remove_udls(handle) {
    const ret = wasm.slope_remove_udls(handle);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 */
export function slope_remove_water_table(handle) {
    const ret = wasm.slope_remove_water_table(handle);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} limits
 */
export function slope_set_analysis_limits(handle, limits) {
    const ret = wasm.slope_set_analysis_limits(handle, limits);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} objects
 */
export function slope_set_block_search_objects(handle, objects) {
    const ret = wasm.slope_set_block_search_objects(handle, objects);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {boolean} value
 */
export function slope_set_custom_planes_only(handle, value) {
    const ret = wasm.slope_set_custom_planes_only(handle, value);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * `setDrawdownBefore`: a copy of `child` (or none).
 * @param {number} handle
 * @param {number | null} [child]
 */
export function slope_set_drawdown_before(handle, child) {
    const ret = wasm.slope_set_drawdown_before(handle, isLikeNone(child) ? Number.MAX_SAFE_INTEGER : (child) >>> 0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * `setEarlierStage`: a copy of `child` (or none).
 * @param {number} handle
 * @param {number | null} [child]
 */
export function slope_set_earlier_stage(handle, child) {
    const ret = wasm.slope_set_earlier_stage(handle, isLikeNone(child) ? Number.MAX_SAFE_INTEGER : (child) >>> 0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} coordinates
 */
export function slope_set_external_boundary(handle, coordinates) {
    const ret = wasm.slope_set_external_boundary(handle, coordinates);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} loads
 */
export function slope_set_line_loads(handle, loads) {
    const ret = wasm.slope_set_line_loads(handle, loads);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} lines
 */
export function slope_set_material_boundaries(handle, lines) {
    const ret = wasm.slope_set_material_boundaries(handle, lines);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} coordinates
 * @returns {boolean}
 */
export function slope_set_material_boundary(handle, coordinates) {
    const ret = wasm.slope_set_material_boundary(handle, coordinates);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * Gives table entry `index` the key of the JavaScript object made for it.
 * @param {number} handle
 * @param {number} index
 * @param {number} key
 */
export function slope_set_material_key(handle, index, key) {
    const ret = wasm.slope_set_material_key(handle, index, key);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {boolean} value
 */
export function slope_set_mirrored(handle, value) {
    const ret = wasm.slope_set_mirrored(handle, value);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} p
 */
export function slope_set_piles(handle, p) {
    const ret = wasm.slope_set_piles(handle, p);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} r
 */
export function slope_set_reinforcements(handle, r) {
    const ret = wasm.slope_set_reinforcements(handle, r);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} planes
 */
export function slope_set_search_planes(handle, planes) {
    const ret = wasm.slope_set_search_planes(handle, planes);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} planes
 */
export function slope_set_search_results(handle, planes) {
    const ret = wasm.slope_set_search_results(handle, planes);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} udls
 */
export function slope_set_udls(handle, udls) {
    const ret = wasm.slope_set_udls(handle, udls);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} options
 */
export function slope_set_water_table(handle, options) {
    const ret = wasm.slope_set_water_table(handle, options);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {string} id
 * @param {any} coordinates
 * @param {boolean} follow_boundary
 */
export function slope_set_water_table_by_id(handle, id, coordinates, follow_boundary) {
    const val2 = +handle;
    const val3 = +follow_boundary;
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.slope_set_water_table_by_id(val2, ptr0, len0, coordinates, val3);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} wn
 */
export function slope_set_waternet(handle, wn) {
    const ret = wasm.slope_set_waternet(handle, wn);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * Changes with every mutable access to the slope (the facade's cache key).
 * @param {number} handle
 * @returns {number}
 */
export function slope_stamp(handle) {
    const ret = wasm.slope_stamp(handle);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @param {number} x
 * @returns {number}
 */
export function slope_to_model_x(handle, x) {
    const ret = wasm.slope_to_model_x(handle, x);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {number} handle
 * @param {any} opts
 */
export function slope_update_analysis_options(handle, opts) {
    const ret = wasm.slope_update_analysis_options(handle, opts);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * @param {number} handle
 * @param {any} m
 * @returns {any}
 */
export function slope_water_line_for_material(handle, m) {
    const ret = wasm.slope_water_line_for_material(handle, m);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} w
 * @param {number} x_left
 * @param {number} e_left
 * @param {number} eff_c
 * @param {number} tan_phi
 * @param {number} cos_a
 * @param {number} sin_a
 * @param {number} shear_factor
 * @param {number} fos
 * @returns {Float64Array}
 */
export function solve_slice_normal(w, x_left, e_left, eff_c, tan_phi, cos_a, sin_a, shear_factor, fos) {
    const ret = wasm.solve_slice_normal(w, x_left, e_left, eff_c, tan_phi, cos_a, sin_a, shear_factor, fos);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @param {number} handle
 * @param {any} slices
 * @param {number} fos
 * @param {any} lff_array
 * @returns {any}
 */
export function solved_effective_normals(handle, slices, fos, lff_array) {
    const ret = wasm.solved_effective_normals(handle, slices, fos, lff_array);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Float64Array | number[]} px
 * @param {Float64Array | number[]} py
 * @param {Float64Array | number[]} lx
 * @param {Float64Array | number[]} ly
 * @returns {any}
 */
export function split_polygon_by_polyline(px, py, lx, ly) {
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3;
    try {
        ptr0 = passArrayF64ToWasm0(px, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passArrayF64ToWasm0(py, wasm.__wbindgen_malloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passArrayF64ToWasm0(lx, wasm.__wbindgen_malloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = passArrayF64ToWasm0(ly, wasm.__wbindgen_malloc);
        len3 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 8, 8); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 8, 8); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 8, 8); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 8, 8); }
        throw e;
    }
    const ret = wasm.split_polygon_by_polyline(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Runs once when the module is instantiated (`initSync` / `init`).
 */
export function start() {
    wasm.start();
}

/**
 * @param {number} handle
 * @param {any} planes
 * @returns {string | undefined}
 */
export function steep_entry_message(handle, planes) {
    const ret = wasm.steep_entry_message(handle, planes);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * @param {number} handle
 * @param {any} plane
 * @param {number} n
 * @returns {string | undefined}
 */
export function steep_entry_tension_message(handle, plane, n) {
    const ret = wasm.steep_entry_tension_message(handle, plane, n);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * @param {number} handle
 * @returns {boolean}
 */
export function steps_free(handle) {
    const ret = wasm.steps_free(handle);
    return ret !== 0;
}

/**
 * Resumes the steps: `evaluated` is the last batch as the driver
 * evaluated it (undefined on the first call). Returns `{ done: false,
 * batch }` or `{ done: true, fos }` (analyseSlopeSteps, the results set on
 * the slope) / `{ done: true, planes }`.
 * @param {number} handle
 * @param {any} evaluated
 * @returns {any}
 */
export function steps_resume(handle, evaluated) {
    const ret = wasm.steps_resume(handle, evaluated);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} model_js
 * @returns {number}
 */
export function suction_angle(model_js) {
    const ret = wasm.suction_angle(model_js);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {any} model_js
 * @param {number} suction
 * @returns {number}
 */
export function suction_strength(model_js, suction) {
    const ret = wasm.suction_strength(model_js, suction);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
export function supports_anisotropy(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.supports_anisotropy(ptr0, len0);
    return ret !== 0;
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
export function supports_suction_strength(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.supports_suction_strength(ptr0, len0);
    return ret !== 0;
}

/**
 * @param {any} s
 * @param {number} f
 * @returns {string}
 */
export function surface_slide_message(s, f) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.surface_slide_message(s, f);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {any} basis
 * @returns {any}
 */
export function swedish_partial_factors(basis) {
    const ret = wasm.swedish_partial_factors(basis);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `mirror_range`: [xMin, xMax] or undefined (the definition's own).
 * @param {any} def
 * @param {any} mirror_range
 * @returns {any}
 */
export function to_canonical_slope_definition(def, mirror_range) {
    const ret = wasm.to_canonical_slope_definition(def, mirror_range);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {number} x
 * @param {number} x_start
 * @param {number} x_end
 * @returns {number}
 */
export function trapezoidal(x, x_start, x_end) {
    const ret = wasm.trapezoidal(x, x_start, x_end);
    return ret;
}

/**
 * `new Udl(params)`: the normalised fields.
 * @param {any} params
 * @returns {any}
 */
export function udl_new(params) {
    const ret = wasm.udl_new(params);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * `upperBound(slope, options)`.
 * @param {any} slope
 * @param {any} options
 * @param {number | null} [size_field]
 * @returns {any}
 */
export function upper_bound(slope, options, size_field) {
    const ret = wasm.upper_bound(slope, options, isLikeNone(size_field) ? Number.MAX_SAFE_INTEGER : (size_field) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {any} model_js
 * @returns {string[]}
 */
export function validate_material_model(model_js) {
    const ret = wasm.validate_material_model(model_js);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * @param {number} handle
 * @param {number} x
 * @param {number} y
 * @param {boolean} effective
 * @returns {number}
 */
export function vertical_stress(handle, x, y, effective) {
    const ret = wasm.vertical_stress(handle, x, y, effective);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * Live waternet handles (for the facade's leak test).
 * @returns {number}
 */
export function waternet_count() {
    const ret = wasm.waternet_count();
    return ret >>> 0;
}

/**
 * @param {number} handle
 * @returns {boolean}
 */
export function waternet_free(handle) {
    const ret = wasm.waternet_free(handle);
    return ret !== 0;
}

/**
 * Stores a waternet; the facade keeps the handle per waternet object (as
 * TypeScript's WeakMap cache) and frees it with a FinalizationRegistry.
 * @param {any} waternet
 * @returns {number}
 */
export function waternet_new(waternet) {
    const ret = wasm.waternet_new(waternet);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} handle
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function waternet_pore_pressure_at(handle, x, z) {
    const ret = wasm.waternet_pore_pressure_at(handle, x, z);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * The definition's material with its model and without the flat fields
 * (`withMaterialModel`).
 * @param {any} material
 * @returns {any}
 */
export function with_material_model(material) {
    const ret = wasm.with_material_model(material);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_ff192a72a0dcdf6d: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_11da4b52cd0aedef: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64((arg0 >>> 0) + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_4f1baf9a00be3c74: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_f249a2a76caa9a55: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_3f58a9d3b3a7eed2: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_bigint_5fa10641e039d3ef: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_c22311b1cc228e3a: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_8b968c3ab8e96595: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_fc456fee5d3317de: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_38d7bfbe4cc84039: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_b2f214e2e4b30e36: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_934b640d0889af78: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64((arg0 >>> 0) + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_7ce8eee7fd327545: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_apply_bfe2b07b146427e2: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.apply(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_40b008ba32f73991: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_done_57e08d0be6e30c02: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_7bb1459bd9b5c2b9: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_error_4766cfd6a4c1d634: function(arg0, arg1) {
            console.error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getPrototypeOf_684ea783c7170e41: function(arg0) {
            const ret = Object.getPrototypeOf(arg0);
            return ret;
        },
        __wbg_get_2080c49015e35254: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_635eea311fa1a291: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_d7176cfb76d71114: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_unchecked_e6325ad374eff861: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_with_ref_key_fc601247060b7204: function(arg0, arg1) {
            const ret = arg0[arg1];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_12cdaa4161423e6b: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Float64Array_4acace5b49aaf791: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Float64Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Map_0b4fc8b62e73f163: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Map;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_d7aeb0dcb3108fea: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_bcf1376d0d732d08: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_1a35ba4d31e71d38: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_isView_7c4f5a7c257b3a84: function(arg0) {
            const ret = ArrayBuffer.isView(arg0);
            return ret;
        },
        __wbg_is_2248ff2b575d60c7: function(arg0, arg1) {
            const ret = Object.is(arg0, arg1);
            return ret;
        },
        __wbg_iterator_e4c5e8f68ada7b58: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_5a8bb8abe1e54e15: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_b03a0fabb109b1e9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_13de428334042d26: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_37eb45aaf5eeb820: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_4416a2fe2fac9c65: function(arg0, arg1) {
            const ret = new TypeError(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_7075786089b89c5e: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_787b9fb330d55d78: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_8a1847cd91d0d7fb: function(arg0, arg1) {
            const ret = new RangeError(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_cd4348290afae586: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_aaf85a9746711968: function(arg0, arg1) {
            const ret = new Float64Array(getArrayF64FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_e0c60a796e12bb7c: function(arg0, arg1) {
            const ret = new Int32Array(getArrayI32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_next_178c1651c11432b3: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_af5ac6a08bb0a717: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_now_cace042f68c814d8: function(arg0) {
            const ret = arg0.now();
            return ret;
        },
        __wbg_performance_9e331c7bce8c98d3: function(arg0) {
            const ret = arg0.performance;
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_prototypesetcall_a366c038a3918afa: function(arg0, arg1, arg2) {
            Float64Array.prototype.set.call(getArrayF64FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_c9f4893fc209f768: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_2793479888329cb6: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_8282f7e0d2d01336: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_d2d33b52458e984a: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_e4b9a833d288759a: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_slice_85ae26e3542949c1: function(arg0, arg1, arg2) {
            const ret = arg0.slice(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_value_e0f328965e184931: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./cslope_wasm_bg.js": import0,
    };
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function debugString(val) {
    switch (typeof val) {
        // primitive types
        case 'number':
        case 'boolean':
        case 'undefined':
        return `${val}`;
        case 'string':
        return JSON.stringify(val);
        case 'bigint':
        return `${val}n`;
        case 'symbol':
        return val.description !== undefined
            ? `Symbol(${val.description})`
            : 'Symbol';
        case 'function':
        return typeof val.name === 'string' && val.name !== ''
            ? `Function(${val.name})`
            : 'Function';
        case 'object': {
            if (val === null) {
                return 'null';
            }
            // objects
            if (Array.isArray(val)) {
                return '[' + Array.from(val, debugString).join(', ') + ']';
            }
            // errors
            if (val instanceof Error) {
                return `${val.name}: ${val.message}\n${val.stack}`;
            }

            const toStringOutput = toString.call(val);
            // Test for built-in
            const className = /\[object ([^\]]+)\]/.exec(toStringOutput)?.[1];

            // Failed to match the standard '[object ClassName]'
            if (className === undefined) {
                return toStringOutput;
            }
            if (className === 'Object') {
                // we're a user defined class or Object
                // JSON.stringify avoids problems with cycles, and is generally much
                // easier than looping through ownProperties of `val`.
                try {
                    return 'Object(' + JSON.stringify(val) + ')';
                } catch (_) {
                    return 'Object';
                }
            }
            // TODO we could test for more things here, like `Set`s and `Map`s.
            return className;
        }
        // Per MDN: 'This list of values is exhaustive.'
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#description
    }
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }


    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

// Added by packages/engine-rs/tools/build-wasm.ts: forget the instance, so that
// initSync can instantiate the module again after a trap.
export function __wbg_reset() {
    wasm = undefined;
    wasmInstance = undefined;
    wasmModule = undefined;
    __wbg_init_promise = undefined;
}
