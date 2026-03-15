import { ipcRenderer, contextBridge } from "electron";

// --------- Expose scoped API to the Renderer process ---------
contextBridge.exposeInMainWorld("cslope", {
  // File dialogs
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  openFilePath: (filePath: string) =>
    ipcRenderer.invoke("file:openPath", filePath),
  saveFile: (content: string) => ipcRenderer.invoke("dialog:saveFile", content),
  saveFileAs: (content: string) =>
    ipcRenderer.invoke("dialog:saveFileAs", content),
  // Window controls
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  openMaterialsDialog: () => ipcRenderer.send("window:openMaterialsDialog"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onMaximized: (listener: (event: unknown, isMax: unknown) => void) =>
    ipcRenderer.on("window:maximized", listener),
  offMaximized: (listener: (event: unknown, isMax: unknown) => void) =>
    ipcRenderer.off("window:maximized", listener),
  // App lifecycle
  appReady: () => ipcRenderer.send("app:ready"),
  // Menu actions
  menuNew: () => ipcRenderer.send("menu:new"),
  menuAbout: () => ipcRenderer.send("menu:about"),
  toggleDevTools: () => ipcRenderer.send("dev:toggle-devtools"),
  // Materials dialog sync
  requestMaterialsState: () => ipcRenderer.send("materials:requestState"),
  sendMaterialsState: (materials: unknown) =>
    ipcRenderer.send("materials:stateResponse", materials),
  sendMaterialsChanged: (materials: unknown) =>
    ipcRenderer.send("materials:changed", materials),
  onMaterialsRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.on("materials:requestState", listener),
  offMaterialsRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.off("materials:requestState", listener),
  onMaterialsState: (listener: (event: unknown, materials: unknown) => void) =>
    ipcRenderer.on("materials:stateResponse", listener),
  offMaterialsState: (listener: (event: unknown, materials: unknown) => void) =>
    ipcRenderer.off("materials:stateResponse", listener),
  onMaterialsChanged: (
    listener: (event: unknown, materials: unknown) => void,
  ) => ipcRenderer.on("materials:changed", listener),
  offMaterialsChanged: (
    listener: (event: unknown, materials: unknown) => void,
  ) => ipcRenderer.off("materials:changed", listener),
});
