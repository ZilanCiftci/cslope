import type {
  AnalysisLimitsState,
  PiezometricLineState,
  ProjectInfo,
  ResultViewSettings,
  PaperSize,
} from "./types";

export const PAPER_DIMENSIONS: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
  A0: { w: 1189, h: 841 },
};

export const PLOT_MARGINS = {
  L: 0.08,
  B: 0.08,
  T: 0.05,
  R: 0.05,
};

export const DEFAULT_PROJECT_INFO: ProjectInfo = {
  title: "New Slope Analysis",
  subtitle: "",
  client: "",
  projectNumber: "",
  revision: "0",
  author: "",
  checker: "",
  date: new Date().toISOString().split("T")[0],
  description: "",
  canvasWidth: 1000,
  canvasHeight: 1000,
};

export const DEFAULT_COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [5, 10],
  [15, 5],
  [20, 5],
  [20, 0],
];

export const DEFAULT_MATERIAL = {
  id: "mat-1",
  name: "Clay",
  unitWeight: 20,
  frictionAngle: 35,
  cohesion: 2,
  color: "#d4a373",
};

export const PIEZO_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

export const DEFAULT_PIEZO_LINE: PiezometricLineState = {
  enabled: false,
  lines: [],
  activeLineId: null,
  materialAssignment: {},
};

export const DEFAULT_ANALYSIS_LIMITS: AnalysisLimitsState = {
  enabled: false,
  entryLeftX: 0,
  entryRightX: 20,
  exitLeftX: 0,
  exitRightX: 20,
};

export const DEFAULT_RESULT_VIEW_SETTINGS: ResultViewSettings = {
  surfaceDisplay: "critical",
  fosFilterMax: 1.5,
  showSlices: true,
  showFosLabel: true,
  showCentreMarker: true,
  showGrid: false,
  annotations: [],
  paperFrame: { paperSize: "A3", showFrame: true },
};

export const MATERIAL_COLORS = [
  "#d4a373",
  "#a8c686",
  "#b5838d",
  "#6d6875",
  "#e5989b",
  "#ffb4a2",
];
