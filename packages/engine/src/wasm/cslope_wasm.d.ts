/* tslint:disable */
/* eslint-disable */

/**
 * `udls`: [x1, x2, magnitude][]; `line_loads`: [x, magnitude][].
 */
export function calculate_all_loads(widths: Float64Array | number[], center_xs: Float64Array | number[], udls: any, line_loads: any): any;

export function calculate_polygon_area(x: Float64Array | number[], y: Float64Array | number[]): number;

export function circle_centre(beta: number, ix: number, iy: number, chord_to_centre: number): Float64Array;

export function circle_radius_from_abcd(c_to_e: number, c: number): number | undefined;

export function clip_polygon_halfplane(px: Float64Array | number[], py: Float64Array | number[], a: number, b: number, c: number): any;

export function clip_polygon_vertical(poly_x: Float64Array | number[], poly_y: Float64Array | number[], x_min: number, x_max: number): any;

export function clipped_sine(x: number, x_start: number, x_end: number): number;

export function constant_interslice(x: number, x_start: number, x_end: number): number;

/**
 * `points`: [x, f][].
 */
export function data_point_specified(x: number, x_start: number, x_end: number, points: any): number;

export function default_analysis_options(): any;

export function default_fem_settings(): any;

export function dist_points(x1: number, y1: number, x2: number, y2: number): number;

/**
 * The crate version and whether this is the testing build, for the
 * facade's sanity check and BUILD-INFO.
 */
export function engine_build(): string;

export function engine_constants(): any;

/**
 * The engine clock's reading (ms), for the facade's check of the clock.
 */
export function engine_now_ms(): number;

/**
 * `lff_array`: [lambda, FS, FS_force][].
 */
export function extrapolate_lambda(lff_array: any): Float64Array;

/**
 * `num_points`: TypeScript's count (a number); below 2 gives one point.
 */
export function generate_circle_coordinates(cx: number, cy: number, radius: number, num_points: number): any;

/**
 * The bounds `createGeometryWithMaterial` caches: [xMin, xMax, yMax], or
 * empty without points.
 */
export function geometry_bounds(px: Float64Array | number[], py: Float64Array | number[]): Float64Array;

export function get_circle_line_intersections(cx: number, cy: number, r: number, px: Float64Array | number[], py: Float64Array | number[]): any;

export function get_circle_y_coordinate_at_x(cx: number, cy: number, radius: number, x: number): number;

export function get_domain_x(coordinates: any): Float64Array;

/**
 * `kind`: an interslice function name or undefined; an unknown name is
 * the half-sine, as TypeScript's `default:` branch.
 */
export function get_interslice_function_value(kind: any, x: number, x_start: number, x_end: number, points: any): number;

export function get_line_between_points(line_x: Float64Array | number[], line_y: Float64Array | number[], x1: number, x2: number): any;

export function get_precision(n: number): number;

export function get_surface_line(px: Float64Array | number[], py: Float64Array | number[]): any;

export function get_y_at_x(poly_x: Float64Array | number[], poly_y: Float64Array | number[], x: number): number;

export function get_y_at_x_many(poly_x: Float64Array | number[], poly_y: Float64Array | number[], x_values: Float64Array | number[]): Float64Array;

export function get_y_at_x_strict(line_x: Float64Array | number[], line_y: Float64Array | number[], x: number): number;

export function halfsine(x: number, x_start: number, x_end: number): number;

/**
 * `hoekBrownOf(model)`: `model` needs only the Hoek–Brown fields.
 */
export function hoek_brown_of(model_js: any): any;

export function hoek_brown_parameters(ucs: number, gsi: number, mi: number, disturbance: number): any;

export function infer_orientation_from_coordinates(coordinates: any): any;

export function instantaneous_at_normal_stress(p: any, sn: number): any;

export function instantaneous_at_sigma3(p: any, s3: number): any;

/**
 * `points`: [x, y][].
 */
export function interpolate_function(points: any, x: number): number;

export function is_combined_depth_model(model_js: any): boolean;

export function is_point_in_polygon(px: number, py: number, poly_x: Float64Array | number[], poly_y: Float64Array | number[]): boolean;

/**
 * `new LineLoad(params)`: the normalised fields (`y` left out when unset).
 */
export function line_load_new(params: any): any;

export function line_segment_intersection(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): Float64Array | undefined;

export function map_analysis_result_to_model_space(result: any, def: any): any;

export function material_colors(): string[];

/**
 * `MATERIAL_MODEL_LABELS` as [kind, label] pairs.
 */
export function material_model_labels(): any;

/**
 * The definition's material model (`materialModelOf`).
 */
export function material_model_of(material: any): any;

/**
 * `new Material(params)`: `{ name, color, model }`, or the constructor's
 * RangeError.
 */
export function material_new(params: any): any;

export function mid_coord(x1: number, y1: number, x2: number, y2: number): Float64Array;

export function mirror_limits(limits: any, x_min: number, x_max: number): any;

export function mirror_point(x: number, y: number, x_min: number, x_max: number): Float64Array;

export function mirror_points(pts: any, x_min: number, x_max: number): any;

export function mirror_x(x: number, x_min: number, x_max: number): number;

export function needs_layer_top(model_js: any): boolean;

export function opposite_direction_definition(def: any): any;

export function polygonize_regions(px: Float64Array | number[], py: Float64Array | number[], lines_js: any): any;

/**
 * `orientation`: "ltr", "rtl" or undefined (inferred).
 */
export function resolve_orientation(orientation: any, coordinates: any): any;

export function resolve_strength(model_js: any, context: any): any;

export function resolve_unit_weight(model_js: any, fallback: number, x: number, y: number): number;

export function split_polygon_by_polyline(px: Float64Array | number[], py: Float64Array | number[], lx: Float64Array | number[], ly: Float64Array | number[]): any;

/**
 * Runs once when the module is instantiated (`initSync` / `init`).
 */
export function start(): void;

export function suction_angle(model_js: any): number;

export function suction_strength(model_js: any, suction: number): number;

export function supports_anisotropy(kind: string): boolean;

export function supports_suction_strength(kind: string): boolean;

export function swedish_partial_factors(basis: any): any;

/**
 * `mirror_range`: [xMin, xMax] or undefined (the definition's own).
 */
export function to_canonical_slope_definition(def: any, mirror_range: any): any;

export function trapezoidal(x: number, x_start: number, x_end: number): number;

/**
 * `new Udl(params)`: the normalised fields.
 */
export function udl_new(params: any): any;

export function validate_material_model(model_js: any): string[];

/**
 * Live waternet handles (for the facade's leak test).
 */
export function waternet_count(): number;

export function waternet_free(handle: number): boolean;

/**
 * Stores a waternet; the facade keeps the handle per waternet object (as
 * TypeScript's WeakMap cache) and frees it with a FinalizationRegistry.
 */
export function waternet_new(waternet: any): number;

export function waternet_pore_pressure_at(handle: number, x: number, z: number): number;

/**
 * The definition's material with its model and without the flat fields
 * (`withMaterialModel`).
 */
export function with_material_model(material: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly calculate_all_loads: (a: number, b: number, c: number, d: number, e: any, f: any) => [number, number, number];
    readonly calculate_polygon_area: (a: number, b: number, c: number, d: number) => number;
    readonly circle_centre: (a: number, b: number, c: number, d: number) => [number, number];
    readonly circle_radius_from_abcd: (a: number, b: number) => [number, number];
    readonly clip_polygon_halfplane: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly clip_polygon_vertical: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly clipped_sine: (a: number, b: number, c: number) => number;
    readonly constant_interslice: (a: number, b: number, c: number) => number;
    readonly data_point_specified: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly default_analysis_options: () => [number, number, number];
    readonly default_fem_settings: () => [number, number, number];
    readonly dist_points: (a: number, b: number, c: number, d: number) => number;
    readonly engine_build: () => [number, number];
    readonly engine_constants: () => [number, number, number];
    readonly engine_now_ms: () => number;
    readonly extrapolate_lambda: (a: any) => [number, number, number, number];
    readonly generate_circle_coordinates: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly geometry_bounds: (a: number, b: number, c: number, d: number) => [number, number];
    readonly get_circle_line_intersections: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly get_circle_y_coordinate_at_x: (a: number, b: number, c: number, d: number) => number;
    readonly get_domain_x: (a: any) => [number, number, number, number];
    readonly get_interslice_function_value: (a: any, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly get_line_between_points: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly get_precision: (a: number) => number;
    readonly get_surface_line: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly get_y_at_x: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly get_y_at_x_many: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly get_y_at_x_strict: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly halfsine: (a: number, b: number, c: number) => number;
    readonly hoek_brown_of: (a: any) => [number, number, number];
    readonly hoek_brown_parameters: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly infer_orientation_from_coordinates: (a: any) => [number, number, number];
    readonly instantaneous_at_normal_stress: (a: any, b: number) => [number, number, number];
    readonly instantaneous_at_sigma3: (a: any, b: number) => [number, number, number];
    readonly interpolate_function: (a: any, b: number) => [number, number, number];
    readonly is_combined_depth_model: (a: any) => [number, number, number];
    readonly is_point_in_polygon: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly line_load_new: (a: any) => [number, number, number];
    readonly line_segment_intersection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly map_analysis_result_to_model_space: (a: any, b: any) => [number, number, number];
    readonly material_colors: () => [number, number];
    readonly material_model_labels: () => [number, number, number];
    readonly material_model_of: (a: any) => [number, number, number];
    readonly material_new: (a: any) => [number, number, number];
    readonly mid_coord: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mirror_limits: (a: any, b: number, c: number) => [number, number, number];
    readonly mirror_point: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mirror_points: (a: any, b: number, c: number) => [number, number, number];
    readonly mirror_x: (a: number, b: number, c: number) => number;
    readonly needs_layer_top: (a: any) => [number, number, number];
    readonly opposite_direction_definition: (a: any) => [number, number, number];
    readonly polygonize_regions: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly resolve_orientation: (a: any, b: any) => [number, number, number];
    readonly resolve_strength: (a: any, b: any) => [number, number, number];
    readonly resolve_unit_weight: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly split_polygon_by_polyline: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly start: () => void;
    readonly suction_angle: (a: any) => [number, number, number];
    readonly suction_strength: (a: any, b: number) => [number, number, number];
    readonly supports_anisotropy: (a: number, b: number) => number;
    readonly supports_suction_strength: (a: number, b: number) => number;
    readonly swedish_partial_factors: (a: any) => [number, number, number];
    readonly to_canonical_slope_definition: (a: any, b: any) => [number, number, number];
    readonly trapezoidal: (a: number, b: number, c: number) => number;
    readonly udl_new: (a: any) => [number, number, number];
    readonly validate_material_model: (a: any) => [number, number, number, number];
    readonly waternet_count: () => number;
    readonly waternet_free: (a: number) => number;
    readonly waternet_new: (a: any) => [number, number, number];
    readonly waternet_pore_pressure_at: (a: number, b: number, c: number) => [number, number, number];
    readonly with_material_model: (a: any) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

/** Forgets the instance (added by build-wasm.ts), so that initSync can instantiate again after a trap. */
export function __wbg_reset(): void;
