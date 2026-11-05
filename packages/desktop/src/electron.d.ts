/** Ambient types for APIs exposed by the Electron preload script. */

import type {
  AnalysisLimitsState,
  AnalysisResult,
  BlockSearchObject,
  CustomSearchPlane,
  LineLoadRow,
  PileRow,
  ReinforcementRow,
  MaterialBoundaryRow,
  MaterialRow,
  ModelEarlierStage,
  ModelEntry,
  ModelOrientation,
  ModelWaternet,
  ParameterDef,
  PiezometricLineState,
  RegionMaterials,
  ResultViewSettings,
  UdlRow,
} from "./store/types";
import type { PaperContent } from "./features/view/extents";
import type { SensitivityCommand, SensitivityWindowState } from "./features/sensitivity/window-sync";
import type { ReliabilityCommand, ReliabilityWindowState } from "./features/reliability/window-sync";

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
  /** The imported earlier stage; null: none. Missing: not sent. */
  earlierStage?: ModelEarlierStage | null;
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
  /** The materials' ids and names (for the excess pore pressure of loads); read-only there. */
  materialNames?: { id: string; name: string }[];
}

interface PiezoStatePayload {
  piezometricLine: PiezometricLineState;
  coordinates: [number, number][];
  materials: MaterialRow[];
  parameters?: ParameterDef[];
  /** The imported waternet; null: none. Missing: not sent. */
  waternet?: ModelWaternet | null;
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
  blockSearchObjects: BlockSearchObject[];
  options: ModelEntry["options"];
  /** From the main window: the water lines (the Options window sets rapid drawdown on them). */
  piezometricLine?: PiezometricLineState;
  /** From the Options window: the water before drawdown; null: none. Missing: not sent. */
  rapidDrawdown?: PiezometricLineState["rapidDrawdown"] | null;
  /**
   * From the custom search planes or Options window: the plane to copy
   * into a reference annotation (the main window adds it). Missing: none.
   */
  referenceFromPlaneId?: string;
}

interface ViewSettingsStatePayload {
  resultViewSettings: ResultViewSettings;
  coordinates: [number, number][];
  resultViewScale: number;
  resultViewOffset: [number, number];
  /** What the model draws (main window to the dialog only). */
  paperContent?: PaperContent;
}

declare global {
  interface Window {
    cslope: {
      // File dialogs
      /** The bytes of a project file chosen in the open dialog (null: none). */
      openFile: () => Promise<Uint8Array | null>;
      /** Read a dropped project file by its native path (null if it has none). */
      openDroppedFile: (file: File) => Promise<Uint8Array | null>;
      /** A project file was given to the app (double-click, command line). */
      onOpenFileRequested: (listener: (event: unknown) => void) => () => void;
      /** The bytes of the project file given to the app (null: none waiting). */
      openRequestedFile: () => Promise<Uint8Array | null>;
      /** Make the file just read by openFile/openFilePath the save target. */
      confirmFileOpened: () => void;
      /** The name of the project file (null: untitled), when it changes. */
      onFileNameChanged: (listener: (event: unknown, name: unknown) => void) => () => void;
      /** Native Save / Don't Save / Cancel prompt for unsaved changes. */
      askUnsavedChanges: () => Promise<"save" | "discard" | "cancel">;
      /** The renderer handles close requests (enables the close guard). */
      closeGuardReady: () => void;
      closeGuardReleased: () => void;
      /** Close the main window after the unsaved-changes check passed. */
      confirmClose: () => void;
      onCloseRequested: (listener: (event: unknown) => void) => () => void;
      /** Save the project (a .cslp archive); `suggestedName` is offered when a dialog asks for a name. */
      saveFile: (content: Uint8Array, suggestedName?: string) => Promise<boolean>;
      saveFileAs: (content: Uint8Array, suggestedName?: string) => Promise<boolean>;
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
      openSensitivityDialog: () => void;
      openReliabilityDialog: () => void;
      openViewSettingsDialog: () => void;
      onInteriorBoundariesDialogOpenChanged: (
        listener: (event: unknown, open: boolean) => void,
      ) => () => void;
      isMaximized: () => Promise<boolean>;
      onMaximized: (listener: (event: unknown, isMax: unknown) => void) => () => void;
      // App lifecycle
      appReady: () => void;
      /** Shrink this dialog window to the given content height (never grows it). */
      fitDialogHeight: (height: number) => void;
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
      requestSensitivityState: () => void;
      sendSensitivityState: (state: SensitivityWindowState) => void;
      sendSensitivityChanged: (state: SensitivityWindowState) => void;
      sendSensitivityCommand: (command: SensitivityCommand) => void;
      onSensitivityRequestState: (listener: (event: unknown) => void) => () => void;
      onSensitivityState: (
        listener: (event: unknown, state: SensitivityWindowState) => void,
      ) => () => void;
      onSensitivityChanged: (
        listener: (event: unknown, state: SensitivityWindowState) => void,
      ) => () => void;
      onSensitivityCommand: (
        listener: (event: unknown, command: SensitivityCommand) => void,
      ) => () => void;
      /** The window closed (sent to the main window). */
      onSensitivityClosed: (listener: (event: unknown) => void) => () => void;
      requestReliabilityState: () => void;
      sendReliabilityState: (state: ReliabilityWindowState) => void;
      sendReliabilityChanged: (state: ReliabilityWindowState) => void;
      sendReliabilityCommand: (command: ReliabilityCommand) => void;
      onReliabilityRequestState: (listener: (event: unknown) => void) => () => void;
      onReliabilityState: (
        listener: (event: unknown, state: ReliabilityWindowState) => void,
      ) => () => void;
      onReliabilityChanged: (
        listener: (event: unknown, state: ReliabilityWindowState) => void,
      ) => () => void;
      onReliabilityCommand: (
        listener: (event: unknown, command: ReliabilityCommand) => void,
      ) => () => void;
      /** The window closed (sent to the main window). */
      onReliabilityClosed: (listener: (event: unknown) => void) => () => void;
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
