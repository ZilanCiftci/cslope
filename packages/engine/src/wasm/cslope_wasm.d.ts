/* tslint:disable */
/* eslint-disable */

/**
 * `adaptiveBounds(slope, options)`; `on_level` is `options.onLevel`.
 */
export function adaptive_bounds(slope: any, options: any, size_field: number | null | undefined, on_level: any): any;

export function add_single_circular_plane(handle: number, cx: number, cy: number, radius: number): void;

export function add_single_entry_exit_plane(handle: number, lc_x: number, rc_x: number, num_circles: number): void;

export function analyse_bishop(handle: number, slices: any, fs?: number | null): any;

export function analyse_janbu(handle: number, slices: any, fs?: number | null): any;

export function analyse_morgenstern_price(handle: number, slices: any): any;

export function analyse_ordinary(handle: number, slices: any): number | undefined;

/**
 * `analyseReliability(def, options, variables, ro)`; `on_progress` is
 * `ro.onProgress`.
 */
export function analyse_reliability(def: any, options: any, variables: any, ro: any, on_progress?: Function | null): any;

/**
 * `analyseSlope(slope)`: the minimum FOS (the results set on the slope).
 */
export function analyse_slope(handle: number): number | undefined;

/**
 * `analyseSlopeSteps(slope)`: generates the search planes first, as the
 * TypeScript generator does before its first yield.
 */
export function analyse_steps_new(handle: number): number;

/**
 * `analysisResult(slope, minFOS, options, start)`: `elapsed_ms` is the
 * time since `start`.
 */
export function analysis_result(handle: number, min_fos: number | null | undefined, options: any, elapsed_ms: number): any;

export function analysis_warnings(handle: number, effective_normals: any): any;

/**
 * `analyzeFem(slope, options)`; `size_field` is the handle of
 * `options.sizeField`, `on_trial` its `onTrial`.
 */
export function analyze_fem(slope: any, options: any, size_field: number | null | undefined, on_trial: any): any;

export function apply_rapid_drawdown_to(handle: number, slices: any, plane: any): any;

export function apply_reinforcement(handle: number, slices: any, cx: number, cy: number): any;

export function best_distinct_planes(planes: any, count: number, span: number): any;

export function block_search_steps_new(handle: number): number;

export function block_search_with(handle: number, bridge: Function): any;

export function boundary_corner_in_mass(handle: number, x0: number, x1: number, base_y: Function): boolean;

export function build_envelope(handle: number, r: any): any;

export function build_pile_profile(handle: number, p: any): any;

export function build_slope(def: any): number;

/**
 * `udls`: [x1, x2, magnitude][]; `line_loads`: [x, magnitude][].
 */
export function calculate_all_loads(widths: Float64Array | number[], center_xs: Float64Array | number[], udls: any, line_loads: any): any;

export function calculate_polygon_area(x: Float64Array | number[], y: Float64Array | number[]): number;

export function circle_below_bare_base(floor: any, cx: number, cy: number, radius: number, x0: number, x1: number, tol: number): boolean;

export function circle_centre(beta: number, ix: number, iy: number, chord_to_centre: number): Float64Array;

export function circle_leaves_model(handle: number, cx: number, cy: number, radius: number, x0: number, x1: number): boolean;

export function circle_radius_from_abcd(c_to_e: number, c: number): number | undefined;

export function circle_to_polyline(cx: number, cy: number, radius: number, lc: any, rc: any, vertices: number): any;

export function clip_polygon_halfplane(px: Float64Array | number[], py: Float64Array | number[], a: number, b: number, c: number): any;

export function clip_polygon_vertical(poly_x: Float64Array | number[], poly_y: Float64Array | number[], x_min: number, x_max: number): any;

export function clipped_sine(x: number, x_start: number, x_end: number): number;

export function composite_floor(boundary: any, geometries: any, materials: any, follow_base: boolean): any;

export function constant_interslice(x: number, x_start: number, x_end: number): number;

export function dangling_boundary_message(n: number): string;

/**
 * `points`: [x, f][].
 */
export function data_point_specified(x: number, x_start: number, x_end: number, points: any): number;

export function default_analysis_options(): any;

export function default_axis_point(points: any): Float64Array;

export function default_fem_settings(): any;

export function display_points(plane: any): any;

export function dist_points(x1: number, y1: number, x2: number, y2: number): number;

export function drawdown_strength(sfc: number, tfc: number, c: number, phi_deg: number, c_r: number, phi_r_deg: number): number;

export function effective_vertical_stress(handle: number, x: number, y: number): number;

export function effective_vertical_stress_with_loads(handle: number, x: number, y: number): number;

/**
 * The crate version and whether this is the testing build, for the
 * facade's sanity check and BUILD-INFO.
 */
export function engine_build(): string;

export function engine_constants(): any;

export function entry_inclination(plane: any): number;

export function envelope_at(env: any, s: number): number;

/**
 * `evaluatePlanes(slope, planes)`: the planes as evaluated (the facade
 * writes them back onto the caller's objects).
 */
export function evaluate_planes(handle: number, planes: any): any;

/**
 * `lff_array`: [lambda, FS, FS_force][].
 */
export function extrapolate_lambda(lff_array: any): Float64Array;

/**
 * The engine's values of the FE modules' data constants, which the facade
 * keeps as TypeScript (its test compares them).
 */
export function fem_constants(): any;

export function find_angle_crack_x(x_entry: number, x_exit: number, base_y: Function, angle: number): number | undefined;

export function find_crack_x(surf: any, x_entry: number, x_exit: number, base_y: Function, depth_at: Function): number | undefined;

export function fit_polyline_to_ground(handle: number, input: any): any;

export function floor_dip_tolerance(model_height: number): number;

export function floor_y_at(floor: any, x: number, side: any): number;

export function frictional_surface_slide(handle: number, sliding_only: boolean): any;

/**
 * `num_points`: TypeScript's count (a number); below 2 gives one point.
 */
export function generate_circle_coordinates(cx: number, cy: number, radius: number, num_points: number): any;

export function generate_planes(handle: number, lc: any, rc: any, num_circles: number): any;

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

export function get_morgenstern_price_solver(): string;

export function get_precision(n: number): number;

export function get_slices(handle: number, entry_x: number, x1: number, cx: number, cy: number, radius: number, points: any): any;

export function get_surface_line(px: Float64Array | number[], py: Float64Array | number[]): any;

export function get_y_at_x(poly_x: Float64Array | number[], poly_y: Float64Array | number[], x: number): number;

export function get_y_at_x_many(poly_x: Float64Array | number[], poly_y: Float64Array | number[], x_values: Float64Array | number[]): Float64Array;

export function get_y_at_x_strict(line_x: Float64Array | number[], line_y: Float64Array | number[], x: number): number;

export function halfsine(x: number, x_start: number, x_end: number): number;

export function head_factor(line: any, wy_left: number, wy_right: number, x_left: number, x_right: number, vertical_head: boolean): number;

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

export function is_admissible_polyline(handle: number, points: any, concavity_tol_deg: number): boolean;

export function is_combined_depth_model(model_js: any): boolean;

export function is_plane_within_external_boundary(handle: number, plane: any, as_circle: boolean): boolean;

export function is_point_in_polygon(px: number, py: number, poly_x: Float64Array | number[], poly_y: Float64Array | number[]): boolean;

export function ito_matsui_coefficients(D1: number, D: number, phi_deg: number): Float64Array;

export function janbu_correction_factor(slices: any): number;

/**
 * `new LineLoad(params)`: the normalised fields (`y` left out when unset).
 */
export function line_load_new(params: any): any;

export function line_segment_intersection(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): Float64Array | undefined;

export function lognormal_beta(f: number, cov: number): number;

/**
 * `lowerBound(slope, options)`.
 */
export function lower_bound(slope: any, options: any, size_field?: number | null): any;

export function map_analysis_result_to_model_space(result: any, def: any): any;

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

export function monte_carlo_sample(handle: number, values: Float64Array | number[]): number | undefined;

export function monte_carlo_sampler_free(handle: number): boolean;

export function monte_carlo_sampler_new(def: any, options: any, variables: any): number;

export function needs_layer_top(model_js: any): boolean;

export function normal_cdf(x: number): number;

export function opposite_direction_definition(def: any): any;

export function optimise_non_circular_steps_new(handle: number, evaluated: any, options: any): number;

export function optimise_non_circular_with(handle: number, evaluated: any, bridge: Function, options: any): any;

export function optimise_polylines_steps_new(handle: number, seeds: any, options: any): number;

export function optimise_polylines_with(handle: number, seeds: any, bridge: Function, options: any): any;

/**
 * `pileForce(slope, p, x, y, profile?)`: `profile` undefined builds it,
 * null is none.
 */
export function pile_force(handle: number, p: any, x: number, y: number, profile: any): any;

export function pile_force_direction(p: any, tx: number, ty: number): Float64Array;

export function plane_key(plane: any): string;

export function polygonize_regions(px: Float64Array | number[], py: Float64Array | number[], lines_js: any): any;

export function polyline_crossings_x(points: any, px: Float64Array | number[], py: Float64Array | number[], closed: boolean): Float64Array;

export function polyline_y_at(points: any, x: number): number;

/**
 * The public defaults of Python and the command line (D-23).
 */
export function public_default_options(): any;

export function pullout_beyond(env: any, s: number): number;

export function rankine_crack_depth(handle: number, x: number): number;

export function ray_to_ground(ground: any, x0: number, y0: number, dx: number, dy: number): any;

export function reliability_steps_free(handle: number): boolean;

export function reliability_steps_new(def: any, options: any, variables: any, ro: any): number;

/**
 * Resumes a reliability analysis: `factors` are the samples' factors
 * after a samples step. Returns `{ kind: "analyse", slope }` (a slope
 * handle to analyse, given back on the next resume), `{ kind: "samples",
 * values, def, count }` or `{ kind: "done", result }`, with the progress
 * reached since the last step.
 */
export function reliability_steps_resume(handle: number, factors: any): any;

/**
 * F of one set of values of the samples step out (the step's sampler).
 */
export function reliability_steps_sample(handle: number, values: Float64Array | number[]): number | undefined;

export function reliability_surface_to_model_space(surface: any, def: any): any;

/**
 * `orientation`: "ltr", "rtl" or undefined (inferred).
 */
export function resolve_orientation(orientation: any, coordinates: any): any;

export function resolve_strength(model_js: any, context: any): any;

export function resolve_unit_weight(model_js: any, fallback: number, x: number, y: number): number;

export function restore_critical_slices(handle: number): void;

/**
 * `runAnalysis(def, options, { onProgress })`: `on_progress` gets the
 * surfaces evaluated so far in the direction analysed.
 */
export function run_analysis(def: any, options: any, on_progress?: Function | null): any;

/**
 * `runFemSummary(definition, settings, onTrial, onStage)`.
 */
export function run_fem_summary(definition: any, settings: any, on_trial: any, on_stage: any): any;

/**
 * `runFemSummaryWithBounds(definition, settings, onTrial, onStage)`
 * (Clarabel is linked in: the facade's `solvers` loader is not called).
 */
export function run_fem_summary_with_bounds(definition: any, settings: any, on_trial: any, on_stage: any): any;

/**
 * The version of the schemas (the engine's version).
 */
export function schema_version(): string;

export function select_entry_exit(handle: number, cx: number, cy: number, radius: number): any;

export function set_entry_exit_planes(handle: number): void;

export function set_morgenstern_price_solver(solver: string): void;

export function sgi3d_factor_of_safety(handle: number, options: any): any;

/**
 * `shallowCohesionlessMessage(slices, fos, relief)`: the slices' materials
 * are indices into `materials`.
 */
export function shallow_cohesionless_message(slices: any, materials: any, fos: number, relief: number): string | undefined;

export function shallow_depth_limit(local_relief: number): number;

/**
 * The element size at (x, y) of a size field.
 */
export function size_field_at(handle: number, x: number, y: number): number;

/**
 * Live size field handles (for the facade's leak test).
 */
export function size_field_count(): number;

export function size_field_free(handle: number): boolean;

/**
 * Its smallest value, when known (undefined otherwise).
 */
export function size_field_min(handle: number): number | undefined;

export function slice_driving_moment(s: any): number;

export function slice_vertical_load(s: any): number;

export function slope_add_fixed_slices(handle: number, x: Float64Array | number[]): void;

export function slope_add_individual_planes(handle: number, planes: any): void;

export function slope_add_material(handle: number, m: any): void;

export function slope_assign_material(handle: number, coord: any, m: any): void;

export function slope_assign_material_water_table(handle: number, m: any, id: any): void;

/**
 * A copy of a child slope ("earlierStage", "drawdownBefore") under a new
 * handle, or `undefined`.
 */
export function slope_child(handle: number, which: string): number | undefined;

/**
 * Live slope handles (for the facade's leak test).
 */
export function slope_count(): number;

export function slope_free(handle: number): boolean;

/**
 * A property of the slope by its TypeScript getter name.
 */
export function slope_get(handle: number, name: string): any;

export function slope_get_circle_external_intersection(handle: number, cx: number, cy: number, radius: number): any;

export function slope_get_external_y_intersection(handle: number, x: number): number;

export function slope_get_max_fos(handle: number): number;

export function slope_get_min_fos(handle: number): number;

export function slope_get_min_fos_circle(handle: number): any;

export function slope_get_min_fos_end_points(handle: number): any;

export function slope_get_water_y_intersection(handle: number, x: number): number;

export function slope_is_inside_external_boundary(handle: number, x: number, y: number): boolean;

/**
 * The table index of a material (inserted if new).
 */
export function slope_material_index(handle: number, m: any): number;

/**
 * `materialsChanged()` after models were changed in place: the facade
 * passes the current models of the materials JavaScript knows.
 */
export function slope_materials_changed(handle: number, materials: any): void;

export function slope_new(): number;

/**
 * The slices of plane `index` of the slope's `list` ("search" or
 * "individualPlanes"): its own, or, if the analysis dropped them, the
 * plane evaluated again (the same surface gives the same slices).
 */
export function slope_plane_slices(handle: number, list: string, index: number): any;

export function slope_remove_analysis_limits(handle: number): void;

export function slope_remove_individual_planes(handle: number): void;

export function slope_remove_line_loads(handle: number): void;

export function slope_remove_udls(handle: number): void;

export function slope_remove_water_table(handle: number): void;

export function slope_set_analysis_limits(handle: number, limits: any): void;

export function slope_set_block_search_objects(handle: number, objects: any): void;

export function slope_set_custom_planes_only(handle: number, value: boolean): void;

/**
 * `setDrawdownBefore`: a copy of `child` (or none).
 */
export function slope_set_drawdown_before(handle: number, child?: number | null): void;

/**
 * `setEarlierStage`: a copy of `child` (or none).
 */
export function slope_set_earlier_stage(handle: number, child?: number | null): void;

export function slope_set_external_boundary(handle: number, coordinates: any): void;

export function slope_set_line_loads(handle: number, loads: any): void;

export function slope_set_material_boundaries(handle: number, lines: any): void;

export function slope_set_material_boundary(handle: number, coordinates: any): boolean;

/**
 * Gives table entry `index` the key of the JavaScript object made for it.
 */
export function slope_set_material_key(handle: number, index: number, key: number): void;

export function slope_set_mirrored(handle: number, value: boolean): void;

export function slope_set_piles(handle: number, p: any): void;

export function slope_set_reinforcements(handle: number, r: any): void;

export function slope_set_search_planes(handle: number, planes: any): void;

export function slope_set_search_results(handle: number, planes: any): void;

export function slope_set_udls(handle: number, udls: any): void;

export function slope_set_water_table(handle: number, options: any): void;

export function slope_set_water_table_by_id(handle: number, id: string, coordinates: any, follow_boundary: boolean): void;

export function slope_set_waternet(handle: number, wn: any): void;

/**
 * Changes with every mutable access to the slope (the facade's cache key).
 */
export function slope_stamp(handle: number): number;

export function slope_to_model_x(handle: number, x: number): number;

export function slope_update_analysis_options(handle: number, opts: any): void;

export function slope_water_line_for_material(handle: number, m: any): any;

export function solve_slice_normal(w: number, x_left: number, e_left: number, eff_c: number, tan_phi: number, cos_a: number, sin_a: number, shear_factor: number, fos: number): Float64Array;

export function solved_effective_normals(handle: number, slices: any, fos: number, lff_array: any): any;

export function split_polygon_by_polyline(px: Float64Array | number[], py: Float64Array | number[], lx: Float64Array | number[], ly: Float64Array | number[]): any;

/**
 * Runs once when the module is instantiated (`initSync` / `init`).
 */
export function start(): void;

export function steep_entry_message(handle: number, planes: any): string | undefined;

export function steep_entry_tension_message(handle: number, plane: any, n: number): string | undefined;

export function steps_free(handle: number): boolean;

/**
 * Resumes the steps: `evaluated` is the last batch as the driver
 * evaluated it (undefined on the first call). Returns `{ done: false,
 * batch }` or `{ done: true, fos }` (analyseSlopeSteps, the results set on
 * the slope) / `{ done: true, planes }`.
 */
export function steps_resume(handle: number, evaluated: any): any;

export function suction_angle(model_js: any): number;

export function suction_strength(model_js: any, suction: number): number;

/**
 * `summarizeResult`: what F is, the method, the critical surface and the
 * warnings of a result run with `options` (merged with the defaults it ran
 * with).
 */
export function summarize_result(result: any, options: any, engine_build: string): any;

export function supports_anisotropy(kind: string): boolean;

export function supports_suction_strength(kind: string): boolean;

export function surface_slide_message(s: any, f: number): string;

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

/**
 * `upperBound(slope, options)`.
 */
export function upper_bound(slope: any, options: any, size_field?: number | null): any;

/**
 * `validate`: the issues of an analysis document or of a definition and
 * its options (`options` undefined or null: none given).
 */
export function validate_definition(doc_or_definition: any, options: any): any;

export function validate_material_model(model_js: any): string[];

export function vertical_stress(handle: number, x: number, y: number, effective: boolean): number;

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
    readonly adaptive_bounds: (a: any, b: any, c: number, d: any) => [number, number, number];
    readonly add_single_circular_plane: (a: number, b: number, c: number, d: number) => [number, number];
    readonly add_single_entry_exit_plane: (a: number, b: number, c: number, d: number) => [number, number];
    readonly analyse_bishop: (a: number, b: any, c: number, d: number) => [number, number, number];
    readonly analyse_janbu: (a: number, b: any, c: number, d: number) => [number, number, number];
    readonly analyse_morgenstern_price: (a: number, b: any) => [number, number, number];
    readonly analyse_ordinary: (a: number, b: any) => [number, number, number, number];
    readonly analyse_reliability: (a: any, b: any, c: any, d: any, e: number) => [number, number, number];
    readonly analyse_slope: (a: number) => [number, number, number, number];
    readonly analyse_steps_new: (a: number) => [number, number, number];
    readonly analysis_result: (a: number, b: number, c: number, d: any, e: number) => [number, number, number];
    readonly analysis_warnings: (a: number, b: any) => [number, number, number];
    readonly analyze_fem: (a: any, b: any, c: number, d: any) => [number, number, number];
    readonly apply_rapid_drawdown_to: (a: number, b: any, c: any) => [number, number, number];
    readonly apply_reinforcement: (a: number, b: any, c: number, d: number) => [number, number, number];
    readonly best_distinct_planes: (a: any, b: number, c: number) => [number, number, number];
    readonly block_search_steps_new: (a: number) => [number, number, number];
    readonly block_search_with: (a: number, b: any) => [number, number, number];
    readonly boundary_corner_in_mass: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly build_envelope: (a: number, b: any) => [number, number, number];
    readonly build_pile_profile: (a: number, b: any) => [number, number, number];
    readonly build_slope: (a: any) => [number, number, number];
    readonly calculate_all_loads: (a: number, b: number, c: number, d: number, e: any, f: any) => [number, number, number];
    readonly calculate_polygon_area: (a: number, b: number, c: number, d: number) => number;
    readonly circle_below_bare_base: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly circle_centre: (a: number, b: number, c: number, d: number) => [number, number];
    readonly circle_leaves_model: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly circle_radius_from_abcd: (a: number, b: number) => [number, number];
    readonly circle_to_polyline: (a: number, b: number, c: number, d: any, e: any, f: number) => [number, number, number];
    readonly clip_polygon_halfplane: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly clip_polygon_vertical: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly clipped_sine: (a: number, b: number, c: number) => number;
    readonly composite_floor: (a: any, b: any, c: any, d: number) => [number, number, number];
    readonly constant_interslice: (a: number, b: number, c: number) => number;
    readonly dangling_boundary_message: (a: number) => [number, number];
    readonly data_point_specified: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly default_analysis_options: () => [number, number, number];
    readonly default_axis_point: (a: any) => [number, number, number, number];
    readonly default_fem_settings: () => [number, number, number];
    readonly display_points: (a: any) => [number, number, number];
    readonly dist_points: (a: number, b: number, c: number, d: number) => number;
    readonly drawdown_strength: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly effective_vertical_stress: (a: number, b: number, c: number) => [number, number, number];
    readonly effective_vertical_stress_with_loads: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_build: () => [number, number];
    readonly engine_constants: () => [number, number, number];
    readonly entry_inclination: (a: any) => [number, number, number];
    readonly envelope_at: (a: any, b: number) => [number, number, number];
    readonly evaluate_planes: (a: number, b: any) => [number, number, number];
    readonly extrapolate_lambda: (a: any) => [number, number, number, number];
    readonly fem_constants: () => [number, number, number];
    readonly find_angle_crack_x: (a: number, b: number, c: any, d: number) => [number, number, number, number];
    readonly find_crack_x: (a: any, b: number, c: number, d: any, e: any) => [number, number, number, number];
    readonly fit_polyline_to_ground: (a: number, b: any) => [number, number, number];
    readonly floor_dip_tolerance: (a: number) => number;
    readonly floor_y_at: (a: any, b: number, c: any) => [number, number, number];
    readonly frictional_surface_slide: (a: number, b: number) => [number, number, number];
    readonly generate_circle_coordinates: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly generate_planes: (a: number, b: any, c: any, d: number) => [number, number, number];
    readonly geometry_bounds: (a: number, b: number, c: number, d: number) => [number, number];
    readonly get_circle_line_intersections: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly get_circle_y_coordinate_at_x: (a: number, b: number, c: number, d: number) => number;
    readonly get_domain_x: (a: any) => [number, number, number, number];
    readonly get_interslice_function_value: (a: any, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly get_line_between_points: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly get_morgenstern_price_solver: () => [number, number];
    readonly get_precision: (a: number) => number;
    readonly get_slices: (a: number, b: number, c: number, d: number, e: number, f: number, g: any) => [number, number, number];
    readonly get_surface_line: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly get_y_at_x: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly get_y_at_x_many: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly get_y_at_x_strict: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly halfsine: (a: number, b: number, c: number) => number;
    readonly head_factor: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly hoek_brown_of: (a: any) => [number, number, number];
    readonly hoek_brown_parameters: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly infer_orientation_from_coordinates: (a: any) => [number, number, number];
    readonly instantaneous_at_normal_stress: (a: any, b: number) => [number, number, number];
    readonly instantaneous_at_sigma3: (a: any, b: number) => [number, number, number];
    readonly interpolate_function: (a: any, b: number) => [number, number, number];
    readonly is_admissible_polyline: (a: number, b: any, c: number) => [number, number, number];
    readonly is_combined_depth_model: (a: any) => [number, number, number];
    readonly is_plane_within_external_boundary: (a: number, b: any, c: number) => [number, number, number];
    readonly is_point_in_polygon: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly ito_matsui_coefficients: (a: number, b: number, c: number) => [number, number];
    readonly janbu_correction_factor: (a: any) => [number, number, number];
    readonly line_load_new: (a: any) => [number, number, number];
    readonly line_segment_intersection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly lognormal_beta: (a: number, b: number) => number;
    readonly lower_bound: (a: any, b: any, c: number) => [number, number, number];
    readonly map_analysis_result_to_model_space: (a: any, b: any) => [number, number, number];
    readonly material_model_labels: () => [number, number, number];
    readonly material_model_of: (a: any) => [number, number, number];
    readonly material_new: (a: any) => [number, number, number];
    readonly mid_coord: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mirror_limits: (a: any, b: number, c: number) => [number, number, number];
    readonly mirror_point: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mirror_points: (a: any, b: number, c: number) => [number, number, number];
    readonly mirror_x: (a: number, b: number, c: number) => number;
    readonly monte_carlo_sample: (a: number, b: number, c: number) => [number, number, number, number];
    readonly monte_carlo_sampler_free: (a: number) => number;
    readonly monte_carlo_sampler_new: (a: any, b: any, c: any) => [number, number, number];
    readonly needs_layer_top: (a: any) => [number, number, number];
    readonly normal_cdf: (a: number) => number;
    readonly opposite_direction_definition: (a: any) => [number, number, number];
    readonly optimise_non_circular_steps_new: (a: number, b: any, c: any) => [number, number, number];
    readonly optimise_non_circular_with: (a: number, b: any, c: any, d: any) => [number, number, number];
    readonly optimise_polylines_steps_new: (a: number, b: any, c: any) => [number, number, number];
    readonly optimise_polylines_with: (a: number, b: any, c: any, d: any) => [number, number, number];
    readonly pile_force: (a: number, b: any, c: number, d: number, e: any) => [number, number, number];
    readonly pile_force_direction: (a: any, b: number, c: number) => [number, number, number, number];
    readonly plane_key: (a: any) => [number, number, number, number];
    readonly polygonize_regions: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly polyline_crossings_x: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly polyline_y_at: (a: any, b: number) => [number, number, number];
    readonly public_default_options: () => [number, number, number];
    readonly pullout_beyond: (a: any, b: number) => [number, number, number];
    readonly rankine_crack_depth: (a: number, b: number) => [number, number, number];
    readonly ray_to_ground: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly reliability_steps_free: (a: number) => number;
    readonly reliability_steps_new: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly reliability_steps_resume: (a: number, b: any) => [number, number, number];
    readonly reliability_steps_sample: (a: number, b: number, c: number) => [number, number, number, number];
    readonly reliability_surface_to_model_space: (a: any, b: any) => [number, number, number];
    readonly resolve_orientation: (a: any, b: any) => [number, number, number];
    readonly resolve_strength: (a: any, b: any) => [number, number, number];
    readonly resolve_unit_weight: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly restore_critical_slices: (a: number) => [number, number];
    readonly run_analysis: (a: any, b: any, c: number) => [number, number, number];
    readonly run_fem_summary: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly run_fem_summary_with_bounds: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly schema_version: () => [number, number];
    readonly select_entry_exit: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly set_entry_exit_planes: (a: number) => [number, number];
    readonly set_morgenstern_price_solver: (a: number, b: number) => void;
    readonly sgi3d_factor_of_safety: (a: number, b: any) => [number, number, number];
    readonly shallow_cohesionless_message: (a: any, b: any, c: number, d: number) => [number, number, number, number];
    readonly shallow_depth_limit: (a: number) => number;
    readonly size_field_at: (a: number, b: number, c: number) => [number, number, number];
    readonly size_field_count: () => number;
    readonly size_field_free: (a: number) => number;
    readonly size_field_min: (a: number) => [number, number, number, number];
    readonly slice_driving_moment: (a: any) => [number, number, number];
    readonly slice_vertical_load: (a: any) => [number, number, number];
    readonly slope_add_fixed_slices: (a: number, b: number, c: number) => [number, number];
    readonly slope_add_individual_planes: (a: number, b: any) => [number, number];
    readonly slope_add_material: (a: number, b: any) => [number, number];
    readonly slope_assign_material: (a: number, b: any, c: any) => [number, number];
    readonly slope_assign_material_water_table: (a: number, b: any, c: any) => [number, number];
    readonly slope_child: (a: number, b: number, c: number) => [number, number, number];
    readonly slope_count: () => number;
    readonly slope_free: (a: number) => number;
    readonly slope_get: (a: number, b: number, c: number) => [number, number, number];
    readonly slope_get_circle_external_intersection: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly slope_get_external_y_intersection: (a: number, b: number) => [number, number, number];
    readonly slope_get_max_fos: (a: number) => [number, number, number];
    readonly slope_get_min_fos: (a: number) => [number, number, number];
    readonly slope_get_min_fos_circle: (a: number) => [number, number, number];
    readonly slope_get_min_fos_end_points: (a: number) => [number, number, number];
    readonly slope_get_water_y_intersection: (a: number, b: number) => [number, number, number];
    readonly slope_is_inside_external_boundary: (a: number, b: number, c: number) => [number, number, number];
    readonly slope_material_index: (a: number, b: any) => [number, number, number];
    readonly slope_materials_changed: (a: number, b: any) => [number, number];
    readonly slope_new: () => [number, number, number];
    readonly slope_plane_slices: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly slope_remove_analysis_limits: (a: number) => [number, number];
    readonly slope_remove_individual_planes: (a: number) => [number, number];
    readonly slope_remove_line_loads: (a: number) => [number, number];
    readonly slope_remove_udls: (a: number) => [number, number];
    readonly slope_remove_water_table: (a: number) => [number, number];
    readonly slope_set_analysis_limits: (a: number, b: any) => [number, number];
    readonly slope_set_block_search_objects: (a: number, b: any) => [number, number];
    readonly slope_set_custom_planes_only: (a: number, b: number) => [number, number];
    readonly slope_set_drawdown_before: (a: number, b: number) => [number, number];
    readonly slope_set_earlier_stage: (a: number, b: number) => [number, number];
    readonly slope_set_external_boundary: (a: number, b: any) => [number, number];
    readonly slope_set_line_loads: (a: number, b: any) => [number, number];
    readonly slope_set_material_boundaries: (a: number, b: any) => [number, number];
    readonly slope_set_material_boundary: (a: number, b: any) => [number, number, number];
    readonly slope_set_material_key: (a: number, b: number, c: number) => [number, number];
    readonly slope_set_mirrored: (a: number, b: number) => [number, number];
    readonly slope_set_piles: (a: number, b: any) => [number, number];
    readonly slope_set_reinforcements: (a: number, b: any) => [number, number];
    readonly slope_set_search_planes: (a: number, b: any) => [number, number];
    readonly slope_set_search_results: (a: number, b: any) => [number, number];
    readonly slope_set_udls: (a: number, b: any) => [number, number];
    readonly slope_set_water_table: (a: number, b: any) => [number, number];
    readonly slope_set_water_table_by_id: (a: number, b: number, c: number, d: any, e: number) => [number, number];
    readonly slope_set_waternet: (a: number, b: any) => [number, number];
    readonly slope_stamp: (a: number) => [number, number, number];
    readonly slope_to_model_x: (a: number, b: number) => [number, number, number];
    readonly slope_update_analysis_options: (a: number, b: any) => [number, number];
    readonly slope_water_line_for_material: (a: number, b: any) => [number, number, number];
    readonly solve_slice_normal: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly solved_effective_normals: (a: number, b: any, c: number, d: any) => [number, number, number];
    readonly split_polygon_by_polyline: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly start: () => void;
    readonly steep_entry_message: (a: number, b: any) => [number, number, number, number];
    readonly steep_entry_tension_message: (a: number, b: any, c: number) => [number, number, number, number];
    readonly steps_free: (a: number) => number;
    readonly steps_resume: (a: number, b: any) => [number, number, number];
    readonly suction_angle: (a: any) => [number, number, number];
    readonly suction_strength: (a: any, b: number) => [number, number, number];
    readonly summarize_result: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly supports_anisotropy: (a: number, b: number) => number;
    readonly supports_suction_strength: (a: number, b: number) => number;
    readonly surface_slide_message: (a: any, b: number) => [number, number, number, number];
    readonly swedish_partial_factors: (a: any) => [number, number, number];
    readonly to_canonical_slope_definition: (a: any, b: any) => [number, number, number];
    readonly trapezoidal: (a: number, b: number, c: number) => number;
    readonly udl_new: (a: any) => [number, number, number];
    readonly upper_bound: (a: any, b: any, c: number) => [number, number, number];
    readonly validate_definition: (a: any, b: any) => [number, number, number];
    readonly validate_material_model: (a: any) => [number, number, number, number];
    readonly vertical_stress: (a: number, b: number, c: number, d: number) => [number, number, number];
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
