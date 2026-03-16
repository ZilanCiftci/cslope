import type {
  AnalysisOptions,
  AnalysisResult,
  MaterialModel,
} from "@cslope/engine";

// Export analysis types so UI components can consume them from a single module
export type { AnalysisResult } from "@cslope/engine";

export type AppMode = "edit" | "result";
export type ThemeMode = "dark" | "light";
export type RunState = "idle" | "running" | "done" | "error";
export type AnalysisRunState = RunState;
export type SurfaceDisplayMode = "critical" | "all" | "filter";
export type ModelOrientation = "ltr" | "rtl";

export interface MaterialRow {
  id: string;
  name: string;
  color: string;
  depthRange?: [number, number];
  /** Full material model definition — source of truth for strength. */
  model: MaterialModel;
}

export interface MaterialBoundaryRow {
  id: string;
  coordinates: [number, number][];
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
}

export interface UdlRow {
  id: string;
  magnitude: number;
  x1: number;
  x2: number;
}

export interface LineLoadRow {
  id: string;
  magnitude: number;
  x: number;
}

export interface PiezoLine {
  id: string;
  name: string;
  color: string;
  coordinates: [number, number][];
}

export interface PiezometricLineState {
  enabled: boolean;
  lines: PiezoLine[];
  activeLineId: string | null;
  materialAssignment: Record<string, string>;
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
}

export interface ViewLock {
  enabled: boolean;
  bottomLeft: [number, number];
  topRight: [number, number];
}

export interface Annotation {
  id: string;
  type:
    | "text"
    | "input-params"
    | "output-params"
    | "material-table"
    | "color-bar";
  x: number;
  y: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export interface ResultViewSettings {
  surfaceDisplay: SurfaceDisplayMode;
  fosFilterMax: number;
  showSlices: boolean;
  showFosLabel: boolean;
  showCentreMarker: boolean;
  showGrid: boolean;
  showSoilColor?: boolean;
  annotations: Annotation[];
  paperFrame: PaperFrameSettings;
  viewLock?: ViewLock;
}

export interface ModelEntry {
  id: string;
  name: string;
  orientation?: ModelOrientation;
  projectInfo?: ProjectInfo;
  coordinates: [number, number][];
  materials: MaterialRow[];
  materialBoundaries: MaterialBoundaryRow[];
  regionMaterials: RegionMaterials;
  piezometricLine: PiezometricLineState;
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  customSearchPlanes: CustomSearchPlane[];
  customPlanesOnly: boolean;
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
  switchModel: (id: string) => void;
  saveCurrentModel: () => void;
  loadProject: (data: { models: ModelEntry[]; activeModelId?: string }) => void;
  newProject: () => void;
  loadBenchmarks: () => void;
  loadLovoModels: () => void;
  /** Set after loadProject / loadBenchmarks so the canvas auto-fits. */
  _pendingFitToScreen: boolean;
  clearPendingFitToScreen: () => void;
}

export interface GeometrySlice {
  orientation: ModelOrientation;
  projectInfo: ProjectInfo;
  coordinates: [number, number][];
  materials: MaterialRow[];
  materialBoundaries: MaterialBoundaryRow[];
  regionMaterials: RegionMaterials;
  piezometricLine: PiezometricLineState;
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
  enablePiezoWithDefault: () => void;
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
}

export interface AnalysisSlice {
  analysisLimits: AnalysisLimitsState;
  customSearchPlanes: CustomSearchPlane[];
  customPlanesOnly: boolean;
  options: AnalysisOptions;
  runState: RunState;
  progress: number;
  result: AnalysisResult | null;
  errorMessage: string | null;
  invalidateAnalysis: () => void;
  setAnalysisLimits: (limits: Partial<AnalysisLimitsState>) => void;
  addCustomSearchPlane: () => void;
  updateCustomSearchPlane: (
    id: string,
    patch: Partial<CustomSearchPlane>,
  ) => void;
  removeCustomSearchPlane: (id: string) => void;
  setCustomPlanesOnly: (value: boolean) => void;
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
  setResultViewSettings: (patch: Partial<ResultViewSettings>) => void;
  addAnnotation: (type: Annotation["type"]) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  setSelectedAnnotations: (ids: string[]) => void;
  toggleAnnotationSelection: (id: string, additive: boolean) => void;
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
  LoadsSlice &
  AnalysisSlice &
  ViewportSlice &
  ResultViewSlice &
  CanvasToolbarSlice;
