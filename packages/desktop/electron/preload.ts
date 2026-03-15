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
  openMaterialAssignmentDialog: () =>
    ipcRenderer.send("window:openMaterialAssignmentDialog"),
  openGeometryDialog: () => ipcRenderer.send("window:openGeometryDialog"),
  openInteriorBoundariesDialog: () =>
    ipcRenderer.send("window:openInteriorBoundariesDialog"),
  openUdlDialog: () => ipcRenderer.send("window:openUdlDialog"),
  openLineLoadsDialog: () => ipcRenderer.send("window:openLineLoadsDialog"),
  openPiezoDialog: () => ipcRenderer.send("window:openPiezoDialog"),
  onInteriorBoundariesDialogOpenChanged: (
    listener: (event: unknown, open: unknown) => void,
  ) => ipcRenderer.on("interiorBoundaries:dialogOpenChanged", listener),
  offInteriorBoundariesDialogOpenChanged: (
    listener: (event: unknown, open: unknown) => void,
  ) => ipcRenderer.off("interiorBoundaries:dialogOpenChanged", listener),
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
  // Material Assignment dialog sync
  requestMaterialAssignmentState: () =>
    ipcRenderer.send("materialAssignment:requestState"),
  sendMaterialAssignmentState: (state: unknown) =>
    ipcRenderer.send("materialAssignment:stateResponse", state),
  sendMaterialAssignmentChanged: (state: unknown) =>
    ipcRenderer.send("materialAssignment:changed", state),
  onMaterialAssignmentRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.on("materialAssignment:requestState", listener),
  offMaterialAssignmentRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.off("materialAssignment:requestState", listener),
  onMaterialAssignmentState: (
    listener: (event: unknown, state: unknown) => void,
  ) => ipcRenderer.on("materialAssignment:stateResponse", listener),
  offMaterialAssignmentState: (
    listener: (event: unknown, state: unknown) => void,
  ) => ipcRenderer.off("materialAssignment:stateResponse", listener),
  onMaterialAssignmentChanged: (
    listener: (event: unknown, state: unknown) => void,
  ) => ipcRenderer.on("materialAssignment:changed", listener),
  offMaterialAssignmentChanged: (
    listener: (event: unknown, state: unknown) => void,
  ) => ipcRenderer.off("materialAssignment:changed", listener),
  // Geometry dialog sync
  requestGeometryState: () => ipcRenderer.send("geometry:requestState"),
  sendGeometryState: (state: unknown) =>
    ipcRenderer.send("geometry:stateResponse", state),
  sendGeometryChanged: (state: unknown) =>
    ipcRenderer.send("geometry:changed", state),
  onGeometryRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.on("geometry:requestState", listener),
  offGeometryRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.off("geometry:requestState", listener),
  onGeometryState: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.on("geometry:stateResponse", listener),
  offGeometryState: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.off("geometry:stateResponse", listener),
  onGeometryChanged: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.on("geometry:changed", listener),
  offGeometryChanged: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.off("geometry:changed", listener),
  // Interior boundaries dialog sync
  requestInteriorBoundariesState: () =>
    ipcRenderer.send("interiorBoundaries:requestState"),
  sendInteriorBoundariesState: (state: unknown) =>
    ipcRenderer.send("interiorBoundaries:stateResponse", state),
  sendInteriorBoundariesChanged: (state: unknown) =>
    ipcRenderer.send("interiorBoundaries:changed", state),
  onInteriorBoundariesRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.on("interiorBoundaries:requestState", listener),
  offInteriorBoundariesRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.off("interiorBoundaries:requestState", listener),
  onInteriorBoundariesState: (
    listener: (event: unknown, state: unknown) => void,
  ) => ipcRenderer.on("interiorBoundaries:stateResponse", listener),
  offInteriorBoundariesState: (
    listener: (event: unknown, state: unknown) => void,
  ) => ipcRenderer.off("interiorBoundaries:stateResponse", listener),
  onInteriorBoundariesChanged: (
    listener: (event: unknown, state: unknown) => void,
  ) => ipcRenderer.on("interiorBoundaries:changed", listener),
  offInteriorBoundariesChanged: (
    listener: (event: unknown, state: unknown) => void,
  ) => ipcRenderer.off("interiorBoundaries:changed", listener),
  // Loads dialog sync
  requestLoadsState: () => ipcRenderer.send("loads:requestState"),
  sendLoadsState: (state: unknown) =>
    ipcRenderer.send("loads:stateResponse", state),
  sendLoadsChanged: (state: unknown) =>
    ipcRenderer.send("loads:changed", state),
  onLoadsRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.on("loads:requestState", listener),
  offLoadsRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.off("loads:requestState", listener),
  onLoadsState: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.on("loads:stateResponse", listener),
  offLoadsState: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.off("loads:stateResponse", listener),
  onLoadsChanged: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.on("loads:changed", listener),
  offLoadsChanged: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.off("loads:changed", listener),
  // Piezometric line dialog sync
  requestPiezoState: () => ipcRenderer.send("piezo:requestState"),
  sendPiezoState: (state: unknown) =>
    ipcRenderer.send("piezo:stateResponse", state),
  sendPiezoChanged: (state: unknown) =>
    ipcRenderer.send("piezo:changed", state),
  onPiezoRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.on("piezo:requestState", listener),
  offPiezoRequestState: (listener: (event: unknown) => void) =>
    ipcRenderer.off("piezo:requestState", listener),
  onPiezoState: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.on("piezo:stateResponse", listener),
  offPiezoState: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.off("piezo:stateResponse", listener),
  onPiezoChanged: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.on("piezo:changed", listener),
  offPiezoChanged: (listener: (event: unknown, state: unknown) => void) =>
    ipcRenderer.off("piezo:changed", listener),
});
