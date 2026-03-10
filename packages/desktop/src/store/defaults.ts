import type {
  AnalysisLimitsState,
  MaterialRow,
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

export const createDefaultProjectInfo = (): ProjectInfo => ({
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
});

export const DEFAULT_PROJECT_INFO: ProjectInfo = createDefaultProjectInfo();

export const DEFAULT_COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [12.5, 7.5],
  [15, 7.5],
  [17.5, 10],
  [25, 10],
  [25, 0],
];

export const DEFAULT_MATERIAL: MaterialRow = {
  id: "mat-1",
  name: "Clay",
  color: "#d4a373",
  model: {
    kind: "mohr-coulomb",
    unitWeight: 18,
    frictionAngle: 0,
    cohesion: 12,
  },
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
  enabled: true,
  entryLeftX: 4,
  entryRightX: 8,
  exitLeftX: 12.5,
  exitRightX: 15,
};

export const DEFAULT_RESULT_VIEW_SETTINGS: ResultViewSettings = {
  surfaceDisplay: "critical",
  fosFilterMax: 1.5,
  showSlices: true,
  showFosLabel: true,
  showCentreMarker: true,
  showGrid: true,
  showSoilColor: true,
  annotations: [
    {
      id: "anno-8d2aabaf-31cb-43b5-b9a5-980aa7354464",
      type: "text",
      x: 0.11,
      y: 0.08,
      text: "#Title",
      fontSize: 24,
    },
    {
      id: "anno-89ddb1d9-0f29-4483-849a-bf5c09ea5076",
      type: "text",
      x: 0.11,
      y: 0.13,
      text: "#Subtitle",
      fontSize: 14,
    },
  ],
  paperFrame: { paperSize: "A4", landscape: true, showFrame: true },
  viewLock: {
    enabled: true,
    bottomLeft: [-1, -1],
    topRight: [26, 18.09090909090909],
  },
};

export const MATERIAL_COLORS = [
  "#d4a373",
  "#a8c686",
  "#b5838d",
  "#6d6875",
  "#e5989b",
  "#ffb4a2",
];
