//! Port of `packages/engine/src/fem`.
pub mod adapt;
pub mod analysis;
pub mod anderson;
pub mod bars;
pub mod bfgs;
pub mod bound_adapt;
pub mod conic;
pub mod elements;
pub mod initial_stress;
pub mod limit_common;
pub mod lower_bound;
pub mod mesh;
pub mod model;
pub mod newton;
pub mod piles;
pub mod seepage;
pub mod sparse;
pub mod srm;
pub mod summary;
pub mod transfer;
pub mod upper_bound;

// The exports of packages/engine/src/fem/index.ts (its loadHighs and
// loadClarabel load WebAssembly solvers: Clarabel is linked in here, and
// HiGHS is not ported; PORTING.md, Decisions).
pub use crate::types::FlowRule;
pub use adapt::{dissipation_indicator, dorfler_mark, refined_size_field, zz_indicator};
pub use analysis::{
    analyze_fem, FemAnalysisOptions, FemAnalysisResult, FemLevel, FemMeshView, FemSearch, FemStep,
    FemTrialBatch,
};
pub use bound_adapt::{
    adaptive_bounds, bound_gap_indicator, AdaptiveBoundsLevel, AdaptiveBoundsOptions,
    AdaptiveBoundsResult, BoundGap,
};
pub use lower_bound::{lower_bound, lower_bound_problem, LowerBoundOptions, LowerBoundResult};
pub use mesh::{mesh_domain, point_in_polygon, MeshInput, TriMesh};
pub use model::{
    build_fe_model, gauss_strains, solve_elastic, FeMaterialParameters, FeModel, FeModelOptions,
};
pub use newton::{newton_at_f, return_map};
pub use sparse::{nested_dissection, SparseCholesky};
pub use srm::{davis_b, solve_at_f, strength_reduction, SrmOptions, SrmResult, SrmTrial};
pub use summary::{run_fem_summary, run_fem_summary_with_bounds};
pub use upper_bound::{upper_bound, upper_bound_problem, UpperBoundOptions, UpperBoundResult};
