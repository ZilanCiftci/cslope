/** Ambient types for APIs exposed by the Electron preload script. */

interface Window {
  ipcRenderer: {
    on(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ): void;
    off(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ): void;
    send(channel: string, ...args: unknown[]): void;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };
  cslope: {
    openFile: () => Promise<string | null>;
    openFilePath: (filePath: string) => Promise<string | null>;
    saveFile: (content: string) => Promise<boolean>;
    saveFileAs: (content: string) => Promise<boolean>;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
  };
}
