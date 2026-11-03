/* @ts-self-types="./cslope_wasm.d.ts" */

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
 * @param {number} c_to_e
 * @param {number} c
 * @returns {number | undefined}
 */
export function circle_radius_from_abcd(c_to_e, c) {
    const ret = wasm.circle_radius_from_abcd(c_to_e, c);
    return ret[0] === 0 ? undefined : ret[1];
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
 * @param {number} n
 * @returns {number}
 */
export function get_precision(n) {
    const ret = wasm.get_precision(n);
    return ret >>> 0;
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
        __wbg_call_40b008ba32f73991: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
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
        __wbg_iterator_e4c5e8f68ada7b58: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_186163212ffe79c3: function(arg0) {
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
        __wbg_next_178c1651c11432b3: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_af5ac6a08bb0a717: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
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
