/** Ambient types for APIs exposed by the Electron preload script. */

import type {
  LineLoadRow,
  MaterialBoundaryRow,
  MaterialRow,
  PiezometricLineState,
  RegionMaterials,
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
}

interface InteriorBoundariesStatePayload {
  coordinates: [number, number][];
  materialBoundaries: MaterialBoundaryRow[];
  selectedMaterialBoundaryId: string | null;
}

interface LoadsStatePayload {
  udls: UdlRow[];
  lineLoads: LineLoadRow[];
}

interface PiezoStatePayload {
  piezometricLine: PiezometricLineState;
  coordinates: [number, number][];
  materials: MaterialRow[];
}

declare global {
  interface Window {
    cslope: {
      // File dialogs
      openFile: () => Promise<string | null>;
      openFilePath: (filePath: string) => Promise<string | null>;
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
      openPiezoDialog: () => void;
      onInteriorBoundariesDialogOpenChanged: (
        listener: (event: unknown, open: boolean) => void,
      ) => void;
      offInteriorBoundariesDialogOpenChanged: (
        listener: (event: unknown, open: boolean) => void,
      ) => void;
      isMaximized: () => Promise<boolean>;
      onMaximized: (listener: (event: unknown, isMax: unknown) => void) => void;
      offMaximized: (
        listener: (event: unknown, isMax: unknown) => void,
      ) => void;
      // App lifecycle
      appReady: () => void;
      // Menu actions
      menuNew: () => void;
      menuAbout: () => void;
      toggleDevTools: () => void;
      // Materials dialog sync
      requestMaterialsState: () => void;
      sendMaterialsState: (materials: MaterialRow[]) => void;
      sendMaterialsChanged: (materials: MaterialRow[]) => void;
      onMaterialsRequestState: (listener: (event: unknown) => void) => void;
      offMaterialsRequestState: (listener: (event: unknown) => void) => void;
      onMaterialsState: (
        listener: (event: unknown, materials: MaterialRow[]) => void,
      ) => void;
      offMaterialsState: (
        listener: (event: unknown, materials: MaterialRow[]) => void,
      ) => void;
      onMaterialsChanged: (
        listener: (event: unknown, materials: MaterialRow[]) => void,
      ) => void;
      offMaterialsChanged: (
        listener: (event: unknown, materials: MaterialRow[]) => void,
      ) => void;
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
      ) => void;
      offMaterialAssignmentRequestState: (
        listener: (event: unknown) => void,
      ) => void;
      onMaterialAssignmentState: (
        listener: (
          event: unknown,
          state: MaterialAssignmentStatePayload,
        ) => void,
      ) => void;
      offMaterialAssignmentState: (
        listener: (
          event: unknown,
          state: MaterialAssignmentStatePayload,
        ) => void,
      ) => void;
      onMaterialAssignmentChanged: (
        listener: (
          event: unknown,
          state: MaterialAssignmentStatePayload,
        ) => void,
      ) => void;
      offMaterialAssignmentChanged: (
        listener: (
          event: unknown,
          state: MaterialAssignmentStatePayload,
        ) => void,
      ) => void;
      // Geometry dialog sync
      requestGeometryState: () => void;
      sendGeometryState: (state: GeometryStatePayload) => void;
      sendGeometryChanged: (state: GeometryStatePayload) => void;
      onGeometryRequestState: (listener: (event: unknown) => void) => void;
      offGeometryRequestState: (listener: (event: unknown) => void) => void;
      onGeometryState: (
        listener: (event: unknown, state: GeometryStatePayload) => void,
      ) => void;
      offGeometryState: (
        listener: (event: unknown, state: GeometryStatePayload) => void,
      ) => void;
      onGeometryChanged: (
        listener: (event: unknown, state: GeometryStatePayload) => void,
      ) => void;
      offGeometryChanged: (
        listener: (event: unknown, state: GeometryStatePayload) => void,
      ) => void;
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
      ) => void;
      offInteriorBoundariesRequestState: (
        listener: (event: unknown) => void,
      ) => void;
      onInteriorBoundariesState: (
        listener: (
          event: unknown,
          state: InteriorBoundariesStatePayload,
        ) => void,
      ) => void;
      offInteriorBoundariesState: (
        listener: (
          event: unknown,
          state: InteriorBoundariesStatePayload,
        ) => void,
      ) => void;
      onInteriorBoundariesChanged: (
        listener: (
          event: unknown,
          state: InteriorBoundariesStatePayload,
        ) => void,
      ) => void;
      offInteriorBoundariesChanged: (
        listener: (
          event: unknown,
          state: InteriorBoundariesStatePayload,
        ) => void,
      ) => void;
      // Loads dialog sync
      requestLoadsState: () => void;
      sendLoadsState: (state: LoadsStatePayload) => void;
      sendLoadsChanged: (state: LoadsStatePayload) => void;
      onLoadsRequestState: (listener: (event: unknown) => void) => void;
      offLoadsRequestState: (listener: (event: unknown) => void) => void;
      onLoadsState: (
        listener: (event: unknown, state: LoadsStatePayload) => void,
      ) => void;
      offLoadsState: (
        listener: (event: unknown, state: LoadsStatePayload) => void,
      ) => void;
      onLoadsChanged: (
        listener: (event: unknown, state: LoadsStatePayload) => void,
      ) => void;
      offLoadsChanged: (
        listener: (event: unknown, state: LoadsStatePayload) => void,
      ) => void;
      // Piezometric line dialog sync
      requestPiezoState: () => void;
      sendPiezoState: (state: PiezoStatePayload) => void;
      sendPiezoChanged: (state: PiezoStatePayload) => void;
      onPiezoRequestState: (listener: (event: unknown) => void) => void;
      offPiezoRequestState: (listener: (event: unknown) => void) => void;
      onPiezoState: (
        listener: (event: unknown, state: PiezoStatePayload) => void,
      ) => void;
      offPiezoState: (
        listener: (event: unknown, state: PiezoStatePayload) => void,
      ) => void;
      onPiezoChanged: (
        listener: (event: unknown, state: PiezoStatePayload) => void,
      ) => void;
      offPiezoChanged: (
        listener: (event: unknown, state: PiezoStatePayload) => void,
      ) => void;
    };
  }
}

export {};
