/** Ambient types for APIs exposed by the Electron preload script. */

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
    isMaximized: () => Promise<boolean>;
    onMaximized: (listener: (event: unknown, isMax: unknown) => void) => void;
    offMaximized: (listener: (event: unknown, isMax: unknown) => void) => void;
    // App lifecycle
    appReady: () => void;
    // Menu actions
    menuNew: () => void;
    menuAbout: () => void;
    toggleDevTools: () => void;
  };
}
