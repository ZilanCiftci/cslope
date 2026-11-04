import type {
  AnalysisOptions,
  AnalysisResult,
  MaterialModel,
  PileForceDirection,
  PileForceLocation,
  SlopeDefinition,
} from "@cslope/engine";

// Export analysis types so UI components can consume them from a single module
export type { AnalysisResult } from "@cslope/engine";

export type AppMode = "edit" | "result";
export type ThemeMode = "dark" | "light";
export type RunState = "idle" | "running" | "done" | "error";
export type AnalysisRunState = RunState;
export type SurfaceDisplayMode = "critical" | "all" | "filter";
export type ModelOrientation = "ltr" | "rtl";

/**
 * Pore pressure from head lines and reference lines (from .stix files), in
 * the model's own coordinates. Replaces the piezometric lines' pore
 * pressure for all materials (they still give the phreatic level).
 */
export type ModelWaternet = NonNullable<SlopeDefinition["waternet"]>;

/**
 * An earlier construction stage (from .stix files), an engine definition in
 * the model's own coordinates: its effective stresses give the yield stress
 * of SHANSEP materials with `yieldFromEarlierStage`. Not edited in the app.
 */
export type ModelEarlierStage = NonNullable<SlopeDefinition["earlierStage"]>;

/** Part of a load carried as excess pore pressure in one material (0–1). */
export interface UdlExcessPorePressure {
  materialId: string;
  ratio: number;
}

export interface ParameterDef {
  id: string;
  name: string;
  expression: string;
}

export interface CoordinateExpression {
  x?: string;
  y?: string;
}

export type MaterialExpressions = Partial<Record<string, string>>;

export interface MaterialRow {
  id: string;
  name: string;
  color: string;
  depthRange?: [number, number];
  /** Full material model definition — source of truth for strength. */
  model: MaterialModel;
  /** Expression strings for numeric material model fields. */
  modelExpressions?: MaterialExpressions;
}

export interface MaterialBoundaryRow {
  id: string;
  coordinates: [number, number][];
  coordinateExpressions?: CoordinateExpression[];
}

export interface RegionAssignment {
  point: [number, number];
  materialId: string;
}

export type RegionMaterials = RegionAssignment[];

export interface AnalysisLimitsState {
  enabled: boolean;
  entryLeftX: number;
  entryRightX: number;
  exitLeftX: number;
  exitRightX: number;
}

export interface CustomSearchPlane {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  /**
   * Non-circular surface: polyline through the soil (cx, cy, radius are
   * then unused). Fitted to the ground by the engine.
   */
  points?: [number, number][];
}

/**
 * A block search object: one point (a fixed point), two (a line) or three
 * or more (a window). Each block surface passes through one point of every
 * object.
 */
export interface BlockSearchObject {
  id: string;
  points: [number, number][];
}

export interface UdlExpressions {
  magnitude?: string;
  x1?: string;
  x2?: string;
}

export interface LineLoadExpressions {
  magnitude?: string;
  x?: string;
}

export interface UdlRow {
  id: string;
  magnitude: number;
  x1: number;
  x2: number;
  /** Acting normal to the ground (water against a slope); not set: vertical. */
  direction?: "vertical" | "normal";
  /**
   * Part of the load carried as excess pore pressure in these materials
   * (from .stix files). Entries of deleted materials are ignored.
   */
  excessPorePressure?: UdlExcessPorePressure[];
  expressions?: UdlExpressions;
}

export interface LineLoadRow {
  id: string;
  magnitude: number;
  x: number;
  /**
   * Inclination from the downward vertical (°), positive when the load
   * points towards +x: 0 vertical, ±90 horizontal. Not set: vertical.
   */
  angle?: number;
  /**
   * Elevation of the load point (m), for a load on a wall face; only used
   * with a non-zero angle. Not set: the ground at x.
   */
  y?: number;
  expressions?: LineLoadExpressions;
}

export type ReinforcementType = "anchor" | "tieback" | "nail" | "geosynthetic";

/**
 * Reinforcement element (stag, jordspik, geonät): a straight line from end 1
 * (the head, at the face) to end 2 (the embedded end). Capacities are per
 * element (kN), or per metre for spacing 1.
 */
export interface ReinforcementRow {
  id: string;
  label?: string;
  type: ReinforcementType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Tensile capacity (kN per element). */
  tensileCapacity: number;
  /** Out-of-plane spacing (m). */
  spacing: number;
  /**
   * Pullout along the element: none (fully anchored ends), constant bond
   * (kN/m), interface friction from the overburden (geosynthetics), or the
   * tensile capacity developing linearly over a length from each end.
   */
  pullout: "none" | "bond" | "interface" | "development";
  /** Bond strength (kN per m of element). */
  bondStrength: number;
  /** Bonded length at end 2 (m); 0 = the whole element (nails). */
  bondedLength: number;
  /** Lock-off load of the free length (kN per element), for the finite element analysis; not set: 0. */
  prestress?: number;
  /** Interface adhesion (kPa) and friction angle (°), both faces. */
  adhesion: number;
  interfaceFriction: number;
  /** Development lengths from end 1 and end 2 (m); 0 = that end fully anchored. */
  developmentLength1?: number;
  developmentLength2?: number;
  /** Plate / facing connection capacity at end 1 (kN per element). */
  end1Capacity: number;
  /** Anchorage capacity at end 2 (kN per element). */
  end2Capacity: number;
  direction: "axial" | "tangent" | "bisector";
  application: "active" | "passive";
}

export type PileType = "pile" | "sheet-pile";

/**
 * Pile row or sheet pile wall resisting in shear where the slip surface
 * crosses it: a given force per pile, or (vertical piles) the Ito & Matsui
 * force of the soil between the piles, limited by the capacities.
 */
export interface PileRow {
  id: string;
  label?: string;
  type: PileType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** "force": the given shear force; "ito-matsui": from the soil. */
  mode: "force" | "ito-matsui";
  /** Shear force per pile (kN), or per metre of wall with spacing 1. */
  force: number;
  /** Pile diameter / width (m). */
  diameter: number;
  /** Centre-to-centre spacing (m); 1 for a wall. */
  spacing: number;
  /** Shear capacity per pile (kN); 0 = no limit. */
  shearCapacity: number;
  /** Bending capacity per pile (kNm); 0 = no limit. */
  momentCapacity: number;
  /** Bending stiffness EI per pile (kNm²) for the finite element analysis; not set: a concrete circle of the diameter. */
  bendingStiffness?: number;
  /** Tilt of the force above horizontal (°), for direction "angle". */
  angle: number;
  /**
   * Direction of the force: along the slip surface ("tangent", the usual
   * default and that of a new pile row), perpendicular to the pile, or
   * tilted by `angle`. Absent (older files): by `angle`.
   */
  direction?: PileForceDirection;
  application: "active" | "passive";
  /**
   * Where an Ito & Matsui force acts: at the resultant of the soil
   * pressure (absent: the default) or at the slip surface.
   */
  location?: PileForceLocation;
}

export interface PiezoLine {
  id: string;
  name: string;
  color: string;
  coordinates: [number, number][];
  coordinateExpressions?: CoordinateExpression[];
}

export interface PiezometricLineState {
  enabled: boolean;
  lines: PiezoLine[];
  activeLineId: string | null;
  materialAssignment: Record<string, string>;
  /**
   * Where a line lies above the ground, the water stands on the surface as
   * free water (load on the slope) instead of being clipped to the ground.
   * Missing means true; files from before version 3 are loaded with false.
   */
  freeWater?: boolean;
  /**
   * Line giving the free water and the pore pressure of materials without
   * a line of their own (see mainPiezoLine). Missing: the first line.
   */
  mainLineId?: string;
  /**
   * Rapid drawdown (three-stage, Duncan, Wright & Wong 1990): the water
   * table before drawdown, for all materials; the lines above are the
   * water after it. Materials with a drawdown (R) envelope do not drain.
   * Missing: no drawdown analysis.
   */
  rapidDrawdown?: { waterBefore: [number, number][] };
}

export type PaperSize = "A4" | "A3" | "A2" | "A1" | "A0";

export interface ProjectInfo {
  title: string;
  subtitle: string;
  client: string;
  projectNumber: string;
  revision: string;
  author: string;
  checker: string;
  date: string;
  description: string;
  canvasWidth: number;
  canvasHeight: number;
}

export interface PaperFrameSettings {
  paperSize: PaperSize;
  landscape: boolean;
  showFrame: boolean;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface ViewLock {
  bottomLeft: [number, number];
  topRight: [number, number];
}

export type MaterialTableColumnKey =
  | "model"
  | "unitWeight"
  | "frictionAngle"
  | "cohesion"
  | "piezometricLine"
  | "depthRef"
  | "cDatum"
  | "cRate";

export type PlotAxisMode = "slice" | "x";

export type PlotMetricKey =
  | "shearStrength"
  | "cohesion"
  | "baseCohesion"
  | "cohesionStrength"
  | "frictionAngle"
  | "porePressure"
  | "pwp"
  | "sliceWeight"
  | "resistingForce"
  | "pullingForce";

export type AnchorPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface Annotation {
  id: string;
  type: "text" | "material-table" | "color-bar" | "plot";
  x: number;
  y: number;
  anchor?: AnchorPosition;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  tableColumns?: MaterialTableColumnKey[];
  plotAxisX?: PlotAxisMode;
  plotAxisY?: PlotMetricKey;
}

export interface ResultViewSettings {
  surfaceDisplay: SurfaceDisplayMode;
  fosFilterMax: number;
  showSlices: boolean;
  showFosLabel: boolean;
  showCentreMarker: boolean;
  showGrid: boolean;
  showSoilColor?: boolean;
  /** Shade the plastic zone of a finite element result (default: shown). */
  showFemPlasticZone?: boolean;
  /** Draw the final mesh of a finite element result (default: hidden). */
  showFemMesh?: boolean;
  /**
   * Draw the custom search planes' surfaces in the result, dashed, each
   * with its own factor of safety (default: hidden).
   */
  showCustomSurfaces?: boolean;
  /** Grid / major-tick spacing in world units. undefined or 0 = auto. */
  gridSpacing?: number;
  /** Grid line spacing in world units. undefined or 0 = the tick spacing. */
  gridLineSpacing?: number;
  /** Number of minor tick subdivisions between major ticks. 0 = none. */
  minorTicks?: number;
  annotations: Annotation[];
  paperFrame: PaperFrameSettings;
  viewLock?: ViewLock;
  /**
   * PDF export: append the analysis summary (calculation basis) pages after
   * the drawing. Absent: included.
   */
  pdfSummaryPages?: boolean;
  /**
   * PDF export: a title line (model name, factor of safety, method) in the
   * top margin above the drawing frame. Absent: off; the drawing's own text
   * annotations (#Title, #Subtitle) carry the title.
   */
  pdfTitleLine?: boolean;
}

export interface ModelEntry {
  id: string;
  name: string;
  orientation?: ModelOrientation;
  projectInfo?: ProjectInfo;
  coordinates: [number, number][];
  coordinateExpressions?: CoordinateExpression[];
  parameters?: ParameterDef[];
  materials: MaterialRow[];
  materialBoundaries: MaterialBoundaryRow[];
  regionMaterials: RegionMaterials;
  piezometricLine: PiezometricLineState;
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  reinforcements?: ReinforcementRow[];
  piles?: PileRow[];
  customSearchPlanes: CustomSearchPlane[];
  customPlanesOnly: boolean;
  /** Absent in files saved before the block search. */
  blockSearchObjects?: BlockSearchObject[];
  /** Pore pressure from head and reference lines; absent: none. */
  waternet?: ModelWaternet;
  /** An earlier construction stage; absent: none. */
  earlierStage?: ModelEarlierStage;
  /**
   * What the import from another program's file noted (what did not carry
   * over), shown in the model's properties; absent: not imported.
   */
  importNotes?: string[];
  options: AnalysisOptions;
  analysisLimits: AnalysisLimitsState;
  editViewOffset?: [number, number];
  editViewScale?: number;
  resultViewOffset?: [number, number];
  resultViewScale?: number;
  viewOffset?: [number, number];
  viewScale?: number;
  resultViewSettings?: ResultViewSettings;
  runState?: RunState;
  progress?: number;
  result?: AnalysisResult | null;
  errorMessage?: string | null;
  mode?: AppMode;
}

export interface LayoutSlice {
  theme: ThemeMode;
  mode: AppMode;
  explorerOpen: boolean;
  sidebarOpen: boolean;
  explorerLocation: "left" | "right";
  propertiesLocation: "left" | "right";
  activeSection: string | null;
  snapToGrid: boolean;
  gridSnapSize: number;
  setExplorerLocation: (loc: "left" | "right") => void;
  setPropertiesLocation: (loc: "left" | "right") => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setMode: (mode: AppMode) => void;
  toggleExplorer: () => void;
  toggleSidebar: () => void;
  setActiveSection: (section: string | null) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setGridSnapSize: (size: number) => void;
}

export interface ModelsSlice {
  activeModelId: string;
  models: ModelEntry[];
  setProjectInfo: (info: Partial<ProjectInfo>) => void;
  updateModelProjectInfo: (id: string, info: ProjectInfo) => void;
  addModel: (name?: string) => void;
  duplicateModel: (id: string) => void;
  deleteModel: (id: string) => void;
  renameModel: (id: string, name: string) => void;
  reorderModels: (
    draggedId: string,
    targetId: string,
    position?: "before" | "after",
  ) => void;
  switchModel: (id: string) => void;
  saveCurrentModel: () => void;
  loadProject: (data: { models: ModelEntry[]; activeModelId?: string }) => void;
  newProject: () => void;
  /** Help → Benchmarks: every verification problem. */
  loadBenchmarks: () => void;
  /** The bundled example models (tutorials and the website's images). */
  loadExamples: () => void;
  loadLovoModels: () => Promise<void>;
  /** Set after loadProject / loadBenchmarks so the canvas auto-fits. */
  _pendingFitToScreen: boolean;
  clearPendingFitToScreen: () => void;
}

export interface GeometrySlice {
  orientation: ModelOrientation;
  projectInfo: ProjectInfo;
  coordinates: [number, number][];
  coordinateExpressions: CoordinateExpression[];
  materials: MaterialRow[];
  materialBoundaries: MaterialBoundaryRow[];
  regionMaterials: RegionMaterials;
  piezometricLine: PiezometricLineState;
  /** The active model's waternet (imported; not edited in the app). */
  waternet: ModelWaternet | undefined;
  /** The active model's earlier stage (imported; not edited in the app). */
  earlierStage: ModelEarlierStage | undefined;
  selectedPointIndex: number | null;
  selectedMaterialBoundaryId: string | null;
  interiorBoundariesDialogOpen: boolean;
  assigningMaterialId: string | null;
  selectedRegionKey: string | null;
  setOrientation: (orientation: ModelOrientation) => void;
  setSelectedPoint: (index: number | null) => void;
  setSelectedMaterialBoundary: (boundaryId: string | null) => void;
  setInteriorBoundariesDialogOpen: (open: boolean) => void;
  setAssigningMaterial: (materialId: string | null) => void;
  setSelectedRegionKey: (key: string | null) => void;
  setCoordinates: (coords: [number, number][]) => void;
  setCoordinate: (index: number, coord: [number, number]) => void;
  setCoordinateExpression: (
    index: number,
    axis: "x" | "y",
    expr: string | undefined,
  ) => void;
  addCoordinate: (coord: [number, number]) => void;
  insertCoordinateAt: (index: number, coord: [number, number]) => void;
  removeCoordinate: (index: number) => void;
  setMaterials: (mats: MaterialRow[]) => void;
  setMaterialBoundaries: (boundaries: MaterialBoundaryRow[]) => void;
  setRegionMaterials: (assignments: RegionMaterials) => void;
  updateMaterial: (id: string, patch: Partial<MaterialRow>) => void;
  addMaterial: () => void;
  removeMaterial: (id: string) => void;
  addMaterialBoundary: (coordinates: [number, number][]) => void;
  updateMaterialBoundary: (
    id: string,
    patch: Partial<MaterialBoundaryRow>,
  ) => void;
  removeMaterialBoundary: (id: string) => void;
  addBoundaryPoint: (boundaryId: string, coord: [number, number]) => void;
  insertBoundaryPointAt: (
    boundaryId: string,
    index: number,
    coord: [number, number],
  ) => void;
  updateBoundaryPoint: (
    boundaryId: string,
    index: number,
    coord: [number, number],
  ) => void;
  removeBoundaryPoint: (boundaryId: string, index: number) => void;
  setRegionMaterial: (point: [number, number], materialId: string) => void;
  setPiezometricLine: (pl: Partial<PiezometricLineState>) => void;
  addPiezoLine: (coords?: [number, number][]) => void;
  removePiezoLine: (lineId: string) => void;
  renamePiezoLine: (lineId: string, name: string) => void;
  setActivePiezoLine: (lineId: string | null) => void;
  setPiezoCoordinate: (index: number, coord: [number, number]) => void;
  addPiezoPoint: (coord: [number, number]) => void;
  insertPiezoPointAt: (index: number, coord: [number, number]) => void;
  removePiezoPoint: (index: number) => void;
  setPiezoMaterialAssignment: (materialId: string, piezoLineId: string) => void;
  setPiezoFreeWater: (enabled: boolean) => void;
  setPiezoMainLine: (lineId: string) => void;
  /** Rapid drawdown: the water before it, or undefined for none. */
  setPiezoRapidDrawdown: (rapidDrawdown: PiezometricLineState["rapidDrawdown"]) => void;
  enablePiezoWithDefault: () => void;
  /** Drop the imported waternet: the piezometric lines give the pore pressure again. */
  removeWaternet: () => void;
  /**
   * Drop the imported earlier stage, and the yield stress from it of every
   * material (also above the water line).
   */
  removeEarlierStage: () => void;
}

export interface LoadsSlice {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  addUdl: () => void;
  updateUdl: (id: string, patch: Partial<UdlRow>) => void;
  removeUdl: (id: string) => void;
  addLineLoad: () => void;
  updateLineLoad: (id: string, patch: Partial<LineLoadRow>) => void;
  removeLineLoad: (id: string) => void;
  reinforcements: ReinforcementRow[];
  addReinforcement: (type?: ReinforcementType) => void;
  updateReinforcement: (id: string, patch: Partial<ReinforcementRow>) => void;
  removeReinforcement: (id: string) => void;
  piles: PileRow[];
  addPile: (type?: PileType) => void;
  updatePile: (id: string, patch: Partial<PileRow>) => void;
  removePile: (id: string) => void;
}

export interface ParametersSlice {
  parameters: ParameterDef[];
  addParameter: () => void;
  updateParameter: (id: string, patch: Partial<ParameterDef>) => void;
  removeParameter: (id: string) => void;
  setParameters: (params: ParameterDef[]) => void;
}

/** Progress of a Run All batch, or its outcome once it has ended. */
export interface RunAllStatus {
  /** Models in the batch. */
  total: number;
  /** Models finished (analysed, failed or dropped). */
  finished: number;
  /** Of them, those whose analysis failed. */
  failed: number;
  /** The batch's progress, 0 to 1: the mean of the models'. */
  progress: number;
  /** False once the batch has ended (its summary). */
  running: boolean;
}

export interface AnalysisSlice {
  analysisLimits: AnalysisLimitsState;
  customSearchPlanes: CustomSearchPlane[];
  customPlanesOnly: boolean;
  blockSearchObjects: BlockSearchObject[];
  options: AnalysisOptions;
  runState: RunState;
  progress: number;
  /**
   * The limit equilibrium result while the run goes on with the finite
   * element analysis (`runState` "running"), else the run's result.
   */
  result: AnalysisResult | null;
  errorMessage: string | null;
  /** The Run All batch for the status bar: while it runs, then its summary. */
  runAll: RunAllStatus | null;
  /** What the single run is doing (the finite element analysis's stage and trials); null otherwise. */
  runStage: string | null;
  /** When the single run started (ms since the epoch), for its elapsed time; null when none runs. */
  runStartedAt: number | null;
  invalidateAnalysis: () => void;
  setAnalysisLimits: (limits: Partial<AnalysisLimitsState>) => void;
  addCustomSearchPlane: (kind?: "circle" | "polyline") => void;
  updateCustomSearchPlane: (
    id: string,
    patch: Partial<CustomSearchPlane>,
  ) => void;
  removeCustomSearchPlane: (id: string) => void;
  /** Move one vertex of a non-circular surface (a canvas drag). */
  updateCustomPlanePoint: (
    id: string,
    pointIndex: number,
    point: [number, number],
  ) => void;
  /** Insert a vertex before `pointIndex` of a non-circular surface. */
  insertCustomPlanePointAt: (
    id: string,
    pointIndex: number,
    point: [number, number],
  ) => void;
  /** Remove a vertex of a non-circular surface; it keeps at least two. */
  removeCustomPlanePoint: (id: string, pointIndex: number) => void;
  /** The custom search plane picked on the canvas (not persisted). */
  selectedCustomPlaneId: string | null;
  setSelectedCustomPlane: (id: string | null) => void;
  setCustomPlanesOnly: (value: boolean) => void;
  addBlockSearchObject: () => void;
  updateBlockSearchObject: (id: string, points: [number, number][]) => void;
  removeBlockSearchObject: (id: string) => void;
  setOptions: (opts: Partial<AnalysisOptions>) => void;
  runAnalysis: () => void;
  cancelAnalysis: () => void;
  runAllAnalyses: () => Promise<void>;
  resetAllAnalyses: () => void;
  reset: () => void;
}

export interface ViewportSlice {
  editViewOffset: [number, number];
  editViewScale: number;
  resultViewOffset: [number, number];
  resultViewScale: number;
  setEditViewOffset: (offset: [number, number]) => void;
  setEditViewScale: (scale: number) => void;
  setResultViewOffset: (offset: [number, number]) => void;
  setResultViewScale: (scale: number) => void;
}

export interface ResultViewSlice {
  resultViewSettings: ResultViewSettings;
  selectedAnnotationIds: string[];
  selectedResultObject: "paper-frame" | null;
  setResultViewSettings: (patch: Partial<ResultViewSettings>) => void;
  addAnnotation: (type: Annotation["type"]) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  setSelectedAnnotations: (ids: string[]) => void;
  toggleAnnotationSelection: (id: string, additive: boolean) => void;
  setSelectedResultObject: (target: "paper-frame" | null) => void;
  alignAnnotations: (
    align: "left" | "right" | "top" | "bottom" | "center-h" | "center-v",
  ) => void;
}

export interface CanvasToolbarState {
  zoomBoxActive: boolean;
  panActive: boolean;
  zoomPercent: number;
  onFitToScreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetZoomPercent: (percent: number) => void;
  onToggleZoomBox: () => void;
  onTogglePan: () => void;
}

export interface CanvasToolbarSlice {
  canvasToolbar: CanvasToolbarState | null;
  setCanvasToolbar: (toolbar: CanvasToolbarState | null) => void;
  cursorWorld: [number, number] | null;
  setCursorWorld: (pos: [number, number] | null) => void;
}

export type AppState = LayoutSlice &
  ModelsSlice &
  GeometrySlice &
  ParametersSlice &
  LoadsSlice &
  AnalysisSlice &
  ViewportSlice &
  ResultViewSlice &
  CanvasToolbarSlice;
