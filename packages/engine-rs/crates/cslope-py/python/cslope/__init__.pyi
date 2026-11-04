# Type stubs of the cslope package (handwritten). The TypedDicts describe the
# main input and output shapes: the JSON shapes of the engine, camelCase keys.
# They list the common fields; the engine reads more (see the TypeScript
# types in packages/engine/src/types of the cSlope repository) and ignores
# unknown keys.

from __future__ import annotations

import array
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple, Union

# (typing_extensions is always available to type checkers in a stub)
from typing_extensions import NotRequired, TypedDict

Point = Tuple[float, float]
ArrayKind = Literal["array", "numpy", "list"]
NumberArray = Union["array.array[float]", List[float], Any]
IndexArray = Union["array.array[int]", List[int], Any]

__version__: str
ENGINE_BUILD: str

# ── materials ────────────────────────────────────────────────────────────

class MohrCoulombModel(TypedDict):
    kind: Literal["mohr-coulomb"]
    unitWeight: float
    cohesion: float
    frictionAngle: float
    unitWeightSat: NotRequired[float]
    ru: NotRequired[float]
    phiB: NotRequired[float]
    maxSuction: NotRequired[float]
    cohesionRefDepth: NotRequired[float]
    cohesionRateOfChange: NotRequired[float]

class UndrainedModel(TypedDict):
    kind: Literal["undrained"]
    unitWeight: float
    undrainedShearStrength: float
    unitWeightSat: NotRequired[float]
    anisotropy: NotRequired[List[Point]]

class HoekBrownModel(TypedDict):
    kind: Literal["hoek-brown"]
    unitWeight: float
    ucs: float
    gsi: float
    mi: float
    disturbance: NotRequired[float]

class ImpenetrableModel(TypedDict):
    kind: Literal["impenetrable"]
    unitWeight: NotRequired[float]

# The other kinds ("high-strength", "spatial-mohr-coulomb",
# "anisotropic-function", "s-f-depth", "s-f-datum", "lime-cement-columns",
# "shansep", "shear-normal") are accepted as plain dicts.
MaterialModel = Union[MohrCoulombModel, UndrainedModel, HoekBrownModel, ImpenetrableModel, Dict[str, Any]]

class SlopeMaterialDefinition(TypedDict):
    name: str
    model: MaterialModel
    color: NotRequired[str]

# ── the slope definition ────────────────────────────────────────────────

class WaterTable(TypedDict):
    mode: Literal["height", "depth", "custom"]
    value: Union[float, List[Point]]
    followBoundary: NotRequired[bool]

class Udl(TypedDict):
    magnitude: float
    x1: float
    x2: float
    direction: NotRequired[Literal["vertical", "normal"]]

class LineLoad(TypedDict):
    magnitude: float
    x: float
    angle: NotRequired[float]
    y: NotRequired[float]

class MaterialBoundary(TypedDict):
    coordinates: List[Point]
    materialName: str

class RegionAssignment(TypedDict):
    point: Point
    materialName: str

class AnalysisLimits(TypedDict):
    entryLeftX: float
    entryRightX: float
    exitLeftX: float
    exitRightX: float

class CustomSearchPlane(TypedDict):
    cx: float
    cy: float
    radius: float

class CustomSurface(TypedDict):
    points: List[Point]
    axis: NotRequired[Point]

class SlopeDefinition(TypedDict):
    """A slope model: the outline, materials, water, loads and search limits."""

    coordinates: List[Point]
    materials: List[SlopeMaterialDefinition]
    orientation: NotRequired[Literal["ltr", "rtl"]]
    waterTable: NotRequired[WaterTable]
    udls: NotRequired[List[Udl]]
    lineLoads: NotRequired[List[LineLoad]]
    materialBoundaries: NotRequired[List[MaterialBoundary]]
    regionAssignments: NotRequired[List[RegionAssignment]]
    topRegionMaterialName: NotRequired[str]
    analysisLimits: NotRequired[AnalysisLimits]
    customSearchPlanes: NotRequired[List[CustomSearchPlane]]
    customSurfaces: NotRequired[List[CustomSurface]]
    customPlanesOnly: NotRequired[bool]
    reinforcements: NotRequired[List[Dict[str, Any]]]
    piles: NotRequired[List[Dict[str, Any]]]
    waterTables: NotRequired[List[Dict[str, Any]]]
    waternet: NotRequired[Dict[str, Any]]
    rapidDrawdown: NotRequired[Dict[str, Any]]
    earlierStage: NotRequired[Dict[str, Any]]
    blockSearchObjects: NotRequired[List[Dict[str, Any]]]

# ── analysis options and results ────────────────────────────────────────

AnalysisMethod = Literal["Bishop", "Janbu", "Morgenstern-Price"]

class Sgi3dSettings(TypedDict):
    enabled: bool
    length: float
    overstrongF2D: Optional[float]
    excludeMaterials: List[str]
    cellSize: NotRequired[float]

class AnalysisOptions(TypedDict, total=False):
    """Analysis options; every field is optional (the engine's defaults)."""

    method: AnalysisMethod
    slices: int
    iterations: int
    refinedIterations: int
    minFailureDist: float
    tolerance: float
    maxIterations: int
    janbuCorrection: bool
    intersliceFunction: Literal["constant", "half-sine", "clipped-sine", "trapezoidal", "data-point-specified"]
    intersliceDataPoints: List[Point]
    porePressureHead: Literal["phreatic-correction", "vertical"]
    tensionCrackDepth: float
    tensionCrackWater: float
    tensionCrackAuto: bool
    tensionCrackAngle: float
    compositeSurfaces: bool
    compositeBase: bool
    seismicHorizontal: float
    seismicVertical: float
    partialFactors: Optional[Dict[str, Any]]
    bothDirections: bool
    nonCircularOptimization: bool
    searchMethod: Literal["circular", "block"]
    blockActiveAngle: Optional[Tuple[float, float]]
    blockPassiveAngle: Optional[Tuple[float, float]]
    minSlipDepth: float
    minSlipArea: Optional[float]
    sgi3d: Sgi3dSettings

class Material(TypedDict):
    name: str
    color: str
    model: MaterialModel

class ReinforcementForce(TypedDict):
    index: int
    x: float
    force: float
    fx: float
    fy: float

class SlipSurfaceResult(TypedDict):
    cx: float
    cy: float
    radius: float
    fos: float
    entryPoint: Point
    exitPoint: Point
    converged: NotRequired[bool]
    closestPair: NotRequired[bool]
    lffArray: NotRequired[List[Tuple[float, float, float, float]]]
    equilibriumGap: NotRequired[float]
    points: NotRequired[List[Point]]
    composite: NotRequired[bool]
    reinforcementForces: NotRequired[List[ReinforcementForce]]
    crack: NotRequired[Dict[str, float]]

class SliceData(TypedDict):
    x: float
    xLeft: float
    xRight: float
    width: float
    yTop: float
    yBottom: float
    height: float
    area: float
    alpha: float
    baseLength: float
    weight: float
    surfaceLoad: NotRequired[float]
    cohesion: float
    frictionAngle: float
    normalForce: float
    porePressure: float
    baseMaterial: Material

class AnalysisWarning(TypedDict):
    code: str
    message: str
    count: NotRequired[int]
    boundaryIndex: NotRequired[int]

class AnalysisResult(TypedDict):
    """The result of ``analyse``, in the model's coordinates."""

    minFOS: float
    maxFOS: float
    criticalSurface: Optional[SlipSurfaceResult]
    allSurfaces: List[SlipSurfaceResult]
    criticalSlices: List[SliceData]
    method: AnalysisMethod
    elapsedMs: float
    criticalLffArray: NotRequired[List[Tuple[float, float, float, float]]]
    criticalPushingMoment: NotRequired[float]
    criticalResistingMoment: NotRequired[float]
    criticalSlipVolume: NotRequired[float]
    nonConvergedSurfaces: NotRequired[int]
    splitFailureCount: NotRequired[int]
    warnings: NotRequired[List[AnalysisWarning]]
    discardedBySize: NotRequired[int]
    slidingDirection: NotRequired[Literal["ltr", "rtl"]]
    otherDirectionMinFOS: NotRequired[Optional[float]]
    sgi3d: NotRequired[Dict[str, Any]]
    sgi3dError: NotRequired[str]

# ── finite elements ─────────────────────────────────────────────────────

FlowRule = Literal["davis-b", "associated", "non-associated"]

class FemAnalysisSettings(TypedDict):
    """Settings of the finite element analysis as the app holds them."""

    enabled: bool
    flowRule: FlowRule
    youngsModulus: float
    poissonsRatio: float
    dilationAngle: float
    elementSize: Optional[float]
    tensionCutoff: bool
    refinementLevels: int
    porePressure: NotRequired[Literal["water-table", "seepage"]]
    nonAssociatedSolver: NotRequired[Literal["viscoplastic", "newton"]]
    convergence: NotRequired[Literal["increment", "equilibrium"]]
    limitAnalysis: NotRequired[bool]
    initialStress: NotRequired[Literal["gravity", "k0"]]
    k0: NotRequired[Optional[float]]
    originalGroundLevel: NotRequired[Optional[float]]
    materialStages: NotRequired[Dict[str, int]]

class FemLevelSummary(TypedDict):
    elements: int
    fos: float

class FemBounds(TypedDict):
    lower: Optional[float]
    upper: Optional[float]
    elements: int
    refinements: NotRequired[int]
    elapsedMs: float
    warnings: List[str]
    davis: NotRequired[Dict[str, Optional[float]]]

class FemResultSummary(TypedDict):
    """The result of ``fem_summary``, in the model's coordinates."""

    factorOfSafety: float
    failedF: float
    flowRule: FlowRule
    levels: List[FemLevelSummary]
    warnings: List[str]
    elapsedMs: float
    x: NumberArray
    y: NumberArray
    triangles: IndexArray
    plasticShear: NumberArray
    shearIncrement: NotRequired[NumberArray]
    displacement: NumberArray
    curve: NotRequired[List[Dict[str, float]]]
    piles: NotRequired[List[Dict[str, float]]]
    bounds: NotRequired[FemBounds]

class FemAnalysisOptions(TypedDict, total=False):
    """Options of ``Slope.fem`` (strength reduction); all optional."""

    elementSize: float
    flowRule: FlowRule
    fTolerance: float
    tensionCutoff: bool
    materialParameters: Dict[str, Dict[str, float]]
    adaptive: Dict[str, Any]
    porePressure: Literal["water-table", "seepage"]

class FemMeshView(TypedDict):
    x: NumberArray
    y: NumberArray
    triangles: IndexArray
    elementMaterial: IndexArray
    materialNames: List[str]

class FemAnalysisResult(TypedDict):
    factorOfSafety: float
    failedF: float
    displacementJumpF: Optional[float]
    trials: List[Dict[str, Any]]
    iterations: int
    warnings: List[str]
    mesh: FemMeshView
    displacement: NumberArray
    plasticShearStrain: NumberArray
    shearStrainIncrement: NumberArray
    levels: List[Dict[str, Any]]
    piles: List[Dict[str, Any]]
    elapsedMs: float

# ── reliability ─────────────────────────────────────────────────────────

class RandomVariable(TypedDict):
    """A material parameter taken as random: ``material`` is the index in
    the definition's materials, ``field`` the model field (e.g.
    ``"frictionAngle"``), ``sd`` its standard deviation."""

    material: int
    field: str
    sd: float
    distribution: NotRequired[Literal["normal", "lognormal"]]
    min: NotRequired[float]
    max: NotRequired[float]

class Correlation(TypedDict):
    a: int
    b: int
    rho: float

class ReliabilityOptions(TypedDict):
    method: Literal["taylor", "monte-carlo"]
    search: NotRequired[bool]
    samples: NotRequired[int]
    seed: NotRequired[int]
    correlations: NotRequired[List[Correlation]]

class ReliabilityResult(TypedDict):
    method: Literal["taylor", "monte-carlo"]
    fos: float
    meanFOS: float
    sdFOS: float
    cov: float
    betaLognormal: float
    pfLognormal: float
    betaNormal: float
    pf: NotRequired[float]
    samples: NotRequired[List[float]]
    terms: NotRequired[List[Dict[str, Any]]]
    surface: Dict[str, Any]
    failed: int

# ── progress ────────────────────────────────────────────────────────────

class ProgressEvent(TypedDict):
    """``kind`` is "search" (``done``, ``totalHint``, ``phase``),
    "reliability" (``progress``, 0-1), "femTrial" (``trial``), "bounds"
    (``level``) or "femStage" (``stage``: ``{"stage": "mesh" |
    "strengthReduction" | "upperBound" | "lowerBound", "mesh", "meshes",
    "davis"}``)."""

    kind: Literal["search", "reliability", "femTrial", "bounds", "femStage"]
    done: NotRequired[int]
    totalHint: NotRequired[int]
    phase: NotRequired[Literal["first", "refined", "local", "block", "optimise"]]
    progress: NotRequired[float]
    trial: NotRequired[Dict[str, Any]]
    level: NotRequired[Dict[str, Any]]
    stage: NotRequired[Dict[str, Any]]

ProgressCallback = Callable[[ProgressEvent], Optional[bool]]

class SearchSurface(TypedDict):
    cx: float
    cy: float
    radius: float
    fos: Optional[float]
    entryPoint: Point
    exitPoint: Point
    converged: Optional[bool]
    closestPair: NotRequired[bool]
    equilibriumGap: NotRequired[float]
    points: NotRequired[List[Point]]
    composite: NotRequired[bool]
    belowMinSize: NotRequired[bool]

# ── API ─────────────────────────────────────────────────────────────────

class EngineError(RuntimeError): ...
class AnalysisCancelled(EngineError): ...

class CancelToken:
    def __init__(self) -> None: ...
    def cancel(self) -> None: ...
    @property
    def cancelled(self) -> bool: ...

def analyse(
    definition: SlopeDefinition,
    options: Optional[AnalysisOptions] = None,
    *,
    both_directions: bool = False,
    progress: Optional[ProgressCallback] = None,
    threads: Optional[int] = None,
    cancel: Optional[CancelToken] = None,
) -> AnalysisResult: ...
def fem_summary(
    definition: SlopeDefinition,
    settings: FemAnalysisSettings,
    *,
    bounds: bool = False,
    progress: Optional[ProgressCallback] = None,
    cancel: Optional[CancelToken] = None,
    arrays: ArrayKind = "array",
) -> FemResultSummary: ...
def reliability(
    definition: SlopeDefinition,
    options: Optional[AnalysisOptions],
    variables: List[RandomVariable],
    reliability: ReliabilityOptions,
    *,
    progress: Optional[ProgressCallback] = None,
    threads: Optional[int] = None,
    cancel: Optional[CancelToken] = None,
) -> ReliabilityResult: ...
def to_canonical(definition: SlopeDefinition) -> SlopeDefinition: ...
def validate_material_model(model: MaterialModel) -> List[str]: ...

class Slope:
    def __init__(self, definition: SlopeDefinition) -> None: ...
    def update_analysis_options(self, options: AnalysisOptions) -> None: ...
    @property
    def analysis_options(self) -> AnalysisOptions: ...
    @property
    def orientation(self) -> Literal["ltr", "rtl"]: ...
    @property
    def definition(self) -> SlopeDefinition: ...
    def analyse(
        self,
        *,
        progress: Optional[ProgressCallback] = None,
        threads: Optional[int] = None,
        cancel: Optional[CancelToken] = None,
    ) -> Optional[float]: ...
    @property
    def min_fos(self) -> Optional[float]: ...
    @property
    def search(self) -> List[SearchSurface]: ...
    def result(self) -> AnalysisResult: ...
    def fem(
        self,
        options: Optional[FemAnalysisOptions] = None,
        *,
        progress: Optional[ProgressCallback] = None,
        cancel: Optional[CancelToken] = None,
        arrays: ArrayKind = "array",
    ) -> FemAnalysisResult: ...
