/** Ambient types for APIs exposed by the Electron preload script. */

import type { MaterialRow } from "./store/types";

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
    };
  }
}

export {};
