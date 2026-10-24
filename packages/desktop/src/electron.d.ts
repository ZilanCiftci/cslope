/** Ambient types for APIs exposed by the Electron preload script. */

import type {
  AnalysisLimitsState,
  AnalysisResult,
  CustomSearchPlane,
  LineLoadRow,
  PileRow,
  ReinforcementRow,
  MaterialBoundaryRow,
  MaterialRow,
  ModelEntry,
  ModelOrientation,
  ParameterDef,
  PiezometricLineState,
  RegionMaterials,
  ResultViewSettings,
  UdlRow,
} from "./store/types";

interface MaterialAssignmentStatePayload {
  coordinates: [number, number][];
  materialBoundaries: MaterialBoundaryRow[];
  regionMaterials: RegionMaterials;
  materials: MaterialRow[];
}

interface GeometryStatePayload {
  coordinates: [number, number][];
  coordinateExpressions: { x?: string; y?: string }[];
  parameters?: ParameterDef[];
}

interface MaterialsStatePayload {
  materials: MaterialRow[];
  parameters?: ParameterDef[];
}

interface InteriorBoundariesStatePayload {
  coordinates: [number, number][];
  materialBoundaries: MaterialBoundaryRow[];
  selectedMaterialBoundaryId: string | null;
  parameters?: ParameterDef[];
}

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
  reinforcements?: ReinforcementRow[];
  piles?: PileRow[];
  coordinates?: [number, number][];
  orientation?: "ltr" | "rtl";
  parameters?: ParameterDef[];
}

interface PiezoStatePayload {
  piezometricLine: PiezometricLineState;
  coordinates: [number, number][];
  materials: MaterialRow[];
  parameters?: ParameterDef[];
}

interface ResultsPlotStatePayload {
  model: ModelEntry;
  result: AnalysisResult | null;
}

interface ParametersStatePayload {
  parameters: ParameterDef[];
}

interface AnalysisStatePayload {
  coordinates: [number, number][];
  orientation: ModelOrientation;
  analysisLimits: AnalysisLimitsState;
  customSearchPlanes: CustomSearchPlane[];
  customPlanesOnly: boolean;
  options: ModelEntry["options"];
}

interface ViewSettingsStatePayload {
  resultViewSettings: ResultViewSettings;
  coordinates: [number, number][];
  resultViewScale: number;
  resultViewOffset: [number, number];
}

declare global {
  interface Window {
    cslope: {
      // File dialogs
      openFile: () => Promise<string | null>;
      /** Read a dropped project file by its native path (null if it has none). */
      openDroppedFile: (file: File) => Promise<string | null>;
      /** Make the file just read by openFile/openFilePath the save target. */
      confirmFileOpened: () => void;
      /** Native Save / Don't Save / Cancel prompt for unsaved changes. */
      askUnsavedChanges: () => Promise<"save" | "discard" | "cancel">;
      /** The renderer handles close requests (enables the close guard). */
      closeGuardReady: () => void;
      closeGuardReleased: () => void;
      /** Close the main window after the unsaved-changes check passed. */
      confirmClose: () => void;
      onCloseRequested: (listener: (event: unknown) => void) => () => void;
      saveFile: (content: string) => Promise<boolean>;
      saveFileAs: (content: string) => Promise<boolean>;
      // Window controls
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      openMaterialsDialog: () => void;
      openMaterialAssignmentDialog: () => void;
      openGeometryDialog: () => void;
      openInteriorBoundariesDialog: () => void;
      openUdlDialog: () => void;
      openLineLoadsDialog: () => void;
      openReinforcementDialog: () => void;
      openPiezoDialog: () => void;
      openParametersDialog: () => void;
      openResultsPlotDialog: () => void;
      openSearchLimitsDialog: () => void;
      openCustomSearchPlanesDialog: () => void;
      openOptionsDialog: () => void;
      openViewSettingsDialog: () => void;
      onInteriorBoundariesDialogOpenChanged: (
        listener: (event: unknown, open: boolean) => void,
      ) => () => void;
      isMaximized: () => Promise<boolean>;
      onMaximized: (listener: (event: unknown, isMax: unknown) => void) => () => void;
      // App lifecycle
      appReady: () => void;
      // Menu actions
      menuNew: () => void;
      menuAbout: () => void;
      /** Open the online documentation in the default browser. */
      openDocumentation: () => void;
      toggleDevTools: () => void;
      // Materials dialog sync
      requestMaterialsState: () => void;
      sendMaterialsState: (state: MaterialsStatePayload) => void;
      sendMaterialsChanged: (state: MaterialsStatePayload) => void;
      onMaterialsRequestState: (listener: (event: unknown) => void) => () => void;
      onMaterialsState: (
        listener: (event: unknown, state: MaterialsStatePayload) => void,
      ) => () => void;
      onMaterialsChanged: (
        listener: (event: unknown, state: MaterialsStatePayload) => void,
      ) => () => void;
      // Material Assignment dialog sync
      requestMaterialAssignmentState: () => void;
      sendMaterialAssignmentState: (
        state: MaterialAssignmentStatePayload,
      ) => void;
      sendMaterialAssignmentChanged: (
        state: MaterialAssignmentStatePayload,
      ) => void;
      onMaterialAssignmentRequestState: (
        listener: (event: unknown) => void,
      ) => () => void;
      onMaterialAssignmentState: (
        listener: (
          event: unknown,
          state: MaterialAssignmentStatePayload,
        ) => void,
      ) => () => void;
      onMaterialAssignmentChanged: (
        listener: (
          event: unknown,
          state: MaterialAssignmentStatePayload,
        ) => void,
      ) => () => void;
      // Geometry dialog sync
      requestGeometryState: () => void;
      sendGeometryState: (state: GeometryStatePayload) => void;
      sendGeometryChanged: (state: GeometryStatePayload) => void;
      onGeometryRequestState: (listener: (event: unknown) => void) => () => void;
      onGeometryState: (
        listener: (event: unknown, state: GeometryStatePayload) => void,
      ) => () => void;
      onGeometryChanged: (
        listener: (event: unknown, state: GeometryStatePayload) => void,
      ) => () => void;
      // Interior boundaries dialog sync
      requestInteriorBoundariesState: () => void;
      sendInteriorBoundariesState: (
        state: InteriorBoundariesStatePayload,
      ) => void;
      sendInteriorBoundariesChanged: (
        state: InteriorBoundariesStatePayload,
      ) => void;
      onInteriorBoundariesRequestState: (
        listener: (event: unknown) => void,
      ) => () => void;
      onInteriorBoundariesState: (
        listener: (
          event: unknown,
          state: InteriorBoundariesStatePayload,
        ) => void,
      ) => () => void;
      onInteriorBoundariesChanged: (
        listener: (
          event: unknown,
          state: InteriorBoundariesStatePayload,
        ) => void,
      ) => () => void;
      // Loads dialog sync
      requestLoadsState: () => void;
      sendLoadsState: (state: LoadsStatePayload) => void;
      sendLoadsChanged: (state: LoadsStatePayload) => void;
      onLoadsRequestState: (listener: (event: unknown) => void) => () => void;
      onLoadsState: (
        listener: (event: unknown, state: LoadsStatePayload) => void,
      ) => () => void;
      onLoadsChanged: (
        listener: (event: unknown, state: LoadsStatePayload) => void,
      ) => () => void;
      // Piezometric line dialog sync
      requestPiezoState: () => void;
      sendPiezoState: (state: PiezoStatePayload) => void;
      sendPiezoChanged: (state: PiezoStatePayload) => void;
      onPiezoRequestState: (listener: (event: unknown) => void) => () => void;
      onPiezoState: (
        listener: (event: unknown, state: PiezoStatePayload) => void,
      ) => () => void;
      onPiezoChanged: (
        listener: (event: unknown, state: PiezoStatePayload) => void,
      ) => () => void;
      // Parameters dialog sync
      requestParametersState: () => void;
      sendParametersState: (state: ParametersStatePayload) => void;
      sendParametersChanged: (state: ParametersStatePayload) => void;
      onParametersRequestState: (listener: (event: unknown) => void) => () => void;
      onParametersState: (
        listener: (event: unknown, state: ParametersStatePayload) => void,
      ) => () => void;
      onParametersChanged: (
        listener: (event: unknown, state: ParametersStatePayload) => void,
      ) => () => void;
      // Results plot dialog sync
      requestResultsPlotState: () => void;
      sendResultsPlotState: (state: ResultsPlotStatePayload) => void;
      sendResultsPlotChanged: (state: ResultsPlotStatePayload) => void;
      onResultsPlotRequestState: (listener: (event: unknown) => void) => () => void;
      onResultsPlotState: (
        listener: (event: unknown, state: ResultsPlotStatePayload) => void,
      ) => () => void;
      onResultsPlotChanged: (
        listener: (event: unknown, state: ResultsPlotStatePayload) => void,
      ) => () => void;
      // Analysis popups sync
      requestAnalysisState: () => void;
      sendAnalysisState: (state: AnalysisStatePayload) => void;
      sendAnalysisChanged: (state: AnalysisStatePayload) => void;
      onAnalysisRequestState: (listener: (event: unknown) => void) => () => void;
      onAnalysisState: (
        listener: (event: unknown, state: AnalysisStatePayload) => void,
      ) => () => void;
      onAnalysisChanged: (
        listener: (event: unknown, state: AnalysisStatePayload) => void,
      ) => () => void;
      // View settings dialog sync
      requestViewSettingsState: () => void;
      sendViewSettingsState: (state: ViewSettingsStatePayload) => void;
      sendViewSettingsChanged: (state: ViewSettingsStatePayload) => void;
      onViewSettingsRequestState: (listener: (event: unknown) => void) => () => void;
      onViewSettingsState: (
        listener: (event: unknown, state: ViewSettingsStatePayload) => void,
      ) => () => void;
      onViewSettingsChanged: (
        listener: (event: unknown, state: ViewSettingsStatePayload) => void,
      ) => () => void;
    };
  }
}

export {};
