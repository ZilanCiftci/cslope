/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string;
    /** /dist/ or /public/ */
    VITE_PUBLIC: string;
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import("electron").IpcRenderer;
  cslope: {
    openFile: () => Promise<Uint8Array | null>;
    saveFile: (content: Uint8Array, suggestedName?: string) => Promise<boolean>;
    saveFileAs: (content: Uint8Array, suggestedName?: string) => Promise<boolean>;
    saveCopy: (content: Uint8Array, suffix: string) => Promise<string | null>;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
  };
}
