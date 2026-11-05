import { ipcRenderer, contextBridge, webUtils } from "electron";
import type { IpcRendererEvent } from "electron";

/**
 * Subscribe to an IPC channel and return a function that unsubscribes.
 *
 * A function passed through contextBridge arrives as a new proxy on every
 * call, so a separate `off(listener)` can never match the proxy that was
 * registered and listeners would pile up.  The returned closure captures
 * the exact wrapper that was registered.
 */
function subscribe(
  channel: string,
  listener: (event: unknown, ...args: never[]) => void,
): () => void {
  const wrapped = (event: IpcRendererEvent, ...args: unknown[]) =>
    (listener as (event: unknown, ...args: unknown[]) => void)(
      event,
      ...args,
    );
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.off(channel, wrapped);
  };
}

// --------- Expose scoped API to the Renderer process ---------
contextBridge.exposeInMainWorld("cslope", {
  // File dialogs
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  // A dropped file, by its native path. The path is looked up here, from
  // the File the user dropped (File.path is gone since Electron 32): the
  // page cannot name a file to read.
  openDroppedFile: (file: File) => {
    const filePath = webUtils.getPathForFile(file);
    return filePath ? ipcRenderer.invoke("file:openPath", filePath) : Promise.resolve(null);
  },
  // A project file given to the app (double-click, command line, a second
  // launch): the main process tells the page, which then asks for it.
  onOpenFileRequested: (listener: (event: unknown) => void) =>
    subscribe("file:openRequested", listener),
  openRequestedFile: () => ipcRenderer.invoke("file:openRequested"),
  confirmFileOpened: () => ipcRenderer.send("file:openConfirmed"),
  onFileNameChanged: (listener: (event: unknown, name: unknown) => void) =>
    subscribe("file:nameChanged", listener),
  // Unsaved changes
  askUnsavedChanges: () => ipcRenderer.invoke("dialog:unsavedChanges"),
  closeGuardReady: () => ipcRenderer.send("app:closeGuardReady"),
  closeGuardReleased: () => ipcRenderer.send("app:closeGuardReleased"),
  confirmClose: () => ipcRenderer.send("app:closeConfirmed"),
  onCloseRequested: (listener: (event: unknown) => void) =>
    subscribe("app:closeRequested", listener),
  // The project as a .cslp archive and the file name to offer for it.
  saveFile: (content: Uint8Array, suggestedName?: string) =>
    ipcRenderer.invoke("dialog:saveFile", content, suggestedName),
  saveFileAs: (content: Uint8Array, suggestedName?: string) =>
    ipcRenderer.invoke("dialog:saveFileAs", content, suggestedName),
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
  openReinforcementDialog: () =>
    ipcRenderer.send("window:openReinforcementDialog"),
  openPiezoDialog: () => ipcRenderer.send("window:openPiezoDialog"),
  openParametersDialog: () => ipcRenderer.send("window:openParametersDialog"),
  openResultsPlotDialog: () => ipcRenderer.send("window:openResultsPlotDialog"),
  openSearchLimitsDialog: () =>
    ipcRenderer.send("window:openSearchLimitsDialog"),
  openCustomSearchPlanesDialog: () =>
    ipcRenderer.send("window:openCustomSearchPlanesDialog"),
  openOptionsDialog: () => ipcRenderer.send("window:openOptionsDialog"),
  openSensitivityDialog: () =>
    ipcRenderer.send("window:openSensitivityDialog"),
  openReliabilityDialog: () =>
    ipcRenderer.send("window:openReliabilityDialog"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onMaximized: (listener: (event: unknown, isMax: unknown) => void) =>
    subscribe("window:maximized", listener),
  // App lifecycle
  appReady: () => ipcRenderer.send("app:ready"),
  fitDialogHeight: (height: number) => ipcRenderer.send("window:fitDialogHeight", height),
  // Menu actions
  menuNew: () => ipcRenderer.send("menu:new"),
  menuAbout: () => ipcRenderer.send("menu:about"),
  // The documentation, or one of its pages at a heading ("analysis#method").
  openDocumentation: (page?: string) => ipcRenderer.send("help:openDocumentation", page),
  toggleDevTools: () => ipcRenderer.send("dev:toggle-devtools"),
  // Canvas selection sync (the main window and every dialog window)
  requestSelectionState: () => ipcRenderer.send("selection:requestState"),
  sendSelectionChanged: (selection: unknown) =>
    ipcRenderer.send("selection:changed", selection),
  onSelectionRequestState: (listener: (event: unknown) => void) =>
    subscribe("selection:requestState", listener),
  onSelectionChanged: (
    listener: (event: unknown, selection: unknown) => void,
  ) => subscribe("selection:changed", listener),
  // Materials dialog sync
  requestMaterialsState: () => ipcRenderer.send("materials:requestState"),
  sendMaterialsState: (materials: unknown) =>
    ipcRenderer.send("materials:stateResponse", materials),
  sendMaterialsChanged: (materials: unknown) =>
    ipcRenderer.send("materials:changed", materials),
  onMaterialsRequestState: (listener: (event: unknown) => void) =>
    subscribe("materials:requestState", listener),
  onMaterialsState: (listener: (event: unknown, materials: unknown) => void) =>
    subscribe("materials:stateResponse", listener),
  onMaterialsChanged: (
    listener: (event: unknown, materials: unknown) => void,
  ) => subscribe("materials:changed", listener),
  // Material Assignment dialog sync
  requestMaterialAssignmentState: () =>
    ipcRenderer.send("materialAssignment:requestState"),
  sendMaterialAssignmentState: (state: unknown) =>
    ipcRenderer.send("materialAssignment:stateResponse", state),
  sendMaterialAssignmentChanged: (state: unknown) =>
    ipcRenderer.send("materialAssignment:changed", state),
  onMaterialAssignmentRequestState: (listener: (event: unknown) => void) =>
    subscribe("materialAssignment:requestState", listener),
  onMaterialAssignmentState: (
    listener: (event: unknown, state: unknown) => void,
  ) => subscribe("materialAssignment:stateResponse", listener),
  onMaterialAssignmentChanged: (
    listener: (event: unknown, state: unknown) => void,
  ) => subscribe("materialAssignment:changed", listener),
  // Geometry dialog sync
  requestGeometryState: () => ipcRenderer.send("geometry:requestState"),
  sendGeometryState: (state: unknown) =>
    ipcRenderer.send("geometry:stateResponse", state),
  sendGeometryChanged: (state: unknown) =>
    ipcRenderer.send("geometry:changed", state),
  onGeometryRequestState: (listener: (event: unknown) => void) =>
    subscribe("geometry:requestState", listener),
  onGeometryState: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("geometry:stateResponse", listener),
  onGeometryChanged: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("geometry:changed", listener),
  // Interior boundaries dialog sync
  requestInteriorBoundariesState: () =>
    ipcRenderer.send("interiorBoundaries:requestState"),
  sendInteriorBoundariesState: (state: unknown) =>
    ipcRenderer.send("interiorBoundaries:stateResponse", state),
  sendInteriorBoundariesChanged: (state: unknown) =>
    ipcRenderer.send("interiorBoundaries:changed", state),
  onInteriorBoundariesRequestState: (listener: (event: unknown) => void) =>
    subscribe("interiorBoundaries:requestState", listener),
  onInteriorBoundariesState: (
    listener: (event: unknown, state: unknown) => void,
  ) => subscribe("interiorBoundaries:stateResponse", listener),
  onInteriorBoundariesChanged: (
    listener: (event: unknown, state: unknown) => void,
  ) => subscribe("interiorBoundaries:changed", listener),
  // Loads dialog sync
  requestLoadsState: () => ipcRenderer.send("loads:requestState"),
  sendLoadsState: (state: unknown) =>
    ipcRenderer.send("loads:stateResponse", state),
  sendLoadsChanged: (state: unknown) =>
    ipcRenderer.send("loads:changed", state),
  onLoadsRequestState: (listener: (event: unknown) => void) =>
    subscribe("loads:requestState", listener),
  onLoadsState: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("loads:stateResponse", listener),
  onLoadsChanged: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("loads:changed", listener),
  // Piezometric line dialog sync
  requestPiezoState: () => ipcRenderer.send("piezo:requestState"),
  sendPiezoState: (state: unknown) =>
    ipcRenderer.send("piezo:stateResponse", state),
  sendPiezoChanged: (state: unknown) =>
    ipcRenderer.send("piezo:changed", state),
  onPiezoRequestState: (listener: (event: unknown) => void) =>
    subscribe("piezo:requestState", listener),
  onPiezoState: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("piezo:stateResponse", listener),
  onPiezoChanged: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("piezo:changed", listener),
  // Parameters dialog sync
  requestParametersState: () => ipcRenderer.send("parameters:requestState"),
  sendParametersState: (state: unknown) =>
    ipcRenderer.send("parameters:stateResponse", state),
  sendParametersChanged: (state: unknown) =>
    ipcRenderer.send("parameters:changed", state),
  onParametersRequestState: (listener: (event: unknown) => void) =>
    subscribe("parameters:requestState", listener),
  onParametersState: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("parameters:stateResponse", listener),
  onParametersChanged: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("parameters:changed", listener),
  // Results plot dialog sync
  requestResultsPlotState: () => ipcRenderer.send("resultsPlot:requestState"),
  sendResultsPlotState: (state: unknown) =>
    ipcRenderer.send("resultsPlot:stateResponse", state),
  sendResultsPlotChanged: (state: unknown) =>
    ipcRenderer.send("resultsPlot:changed", state),
  onResultsPlotRequestState: (listener: (event: unknown) => void) =>
    subscribe("resultsPlot:requestState", listener),
  onResultsPlotState: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("resultsPlot:stateResponse", listener),
  onResultsPlotChanged: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("resultsPlot:changed", listener),
  // Sensitivity window sync (the main window runs the analyses)
  requestSensitivityState: () => ipcRenderer.send("sensitivity:requestState"),
  sendSensitivityState: (state: unknown) =>
    ipcRenderer.send("sensitivity:stateResponse", state),
  sendSensitivityChanged: (state: unknown) =>
    ipcRenderer.send("sensitivity:changed", state),
  sendSensitivityCommand: (command: unknown) =>
    ipcRenderer.send("sensitivity:command", command),
  onSensitivityRequestState: (listener: (event: unknown) => void) =>
    subscribe("sensitivity:requestState", listener),
  onSensitivityState: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("sensitivity:stateResponse", listener),
  onSensitivityChanged: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("sensitivity:changed", listener),
  onSensitivityCommand: (listener: (event: unknown, command: unknown) => void) =>
    subscribe("sensitivity:command", listener),
  onSensitivityClosed: (listener: (event: unknown) => void) =>
    subscribe("sensitivity:closed", listener),
  // Reliability window sync (the main window runs the analyses)
  requestReliabilityState: () => ipcRenderer.send("reliability:requestState"),
  sendReliabilityState: (state: unknown) =>
    ipcRenderer.send("reliability:stateResponse", state),
  sendReliabilityChanged: (state: unknown) =>
    ipcRenderer.send("reliability:changed", state),
  sendReliabilityCommand: (command: unknown) =>
    ipcRenderer.send("reliability:command", command),
  onReliabilityRequestState: (listener: (event: unknown) => void) =>
    subscribe("reliability:requestState", listener),
  onReliabilityState: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("reliability:stateResponse", listener),
  onReliabilityChanged: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("reliability:changed", listener),
  onReliabilityCommand: (listener: (event: unknown, command: unknown) => void) =>
    subscribe("reliability:command", listener),
  onReliabilityClosed: (listener: (event: unknown) => void) =>
    subscribe("reliability:closed", listener),
  // Analysis popups sync
  requestAnalysisState: () => ipcRenderer.send("analysis:requestState"),
  sendAnalysisState: (state: unknown) =>
    ipcRenderer.send("analysis:stateResponse", state),
  sendAnalysisChanged: (state: unknown) =>
    ipcRenderer.send("analysis:changed", state),
  onAnalysisRequestState: (listener: (event: unknown) => void) =>
    subscribe("analysis:requestState", listener),
  onAnalysisState: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("analysis:stateResponse", listener),
  onAnalysisChanged: (listener: (event: unknown, state: unknown) => void) =>
    subscribe("analysis:changed", listener),
});
