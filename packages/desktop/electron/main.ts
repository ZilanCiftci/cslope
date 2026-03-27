import { app, BrowserWindow, Menu, dialog, ipcMain, session } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;
let splash: BrowserWindow | null;
let materialsWin: BrowserWindow | null;
let materialAssignmentWin: BrowserWindow | null;
let geometryWin: BrowserWindow | null;
let interiorBoundariesWin: BrowserWindow | null;
let udlWin: BrowserWindow | null;
let lineLoadsWin: BrowserWindow | null;
let piezoWin: BrowserWindow | null;
let parametersWin: BrowserWindow | null;
let resultsPlotWin: BrowserWindow | null;
let searchLimitsWin: BrowserWindow | null;
let customSearchPlanesWin: BrowserWindow | null;
let optionsWin: BrowserWindow | null;
let viewSettingsWin: BrowserWindow | null;
let splashTimeout: ReturnType<typeof setTimeout> | null = null;

function showMainWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
  if (splashTimeout) {
    clearTimeout(splashTimeout);
    splashTimeout = null;
  }
  if (splash && !splash.isDestroyed()) {
    splash.close();
    splash = null;
  }
}

function createSplash() {
  splash = new BrowserWindow({
    width: 360,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  // In dev the file lives in public/; in prod it's copied to dist/
  const splashPath = path.join(process.env.VITE_PUBLIC, "splash.html");
  splash.loadFile(splashPath);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "cSlope",
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    frame: false,
    titleBarStyle: "hidden",
    show: false, // hidden until renderer signals ready
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Notify renderer when maximized state changes
  win.on("maximize", () => win?.webContents.send("window:maximized", true));
  win.on("unmaximize", () => win?.webContents.send("window:maximized", false));

  // Fallback: if renderer loads but never emits `app:ready`, still show window.
  win.webContents.once("did-finish-load", () => {
    if (splash && !splash.isDestroyed()) {
      showMainWindow();
    }
  });

  // If load fails (e.g. dev server hiccup), avoid permanent splash deadlock.
  win.webContents.once("did-fail-load", () => {
    showMainWindow();
  });

  // Absolute fallback for unexpected startup issues.
  splashTimeout = setTimeout(() => {
    showMainWindow();
  }, 10000);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

function createMaterialsWindow() {
  if (!win) return;

  if (materialsWin && !materialsWin.isDestroyed()) {
    materialsWin.show();
    materialsWin.focus();
    return;
  }

  materialsWin = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 640,
    minHeight: 560,
    title: "Define Materials",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  materialsWin.on("closed", () => {
    materialsWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    materialsWin.loadURL(`${VITE_DEV_SERVER_URL}#materials-dialog`);
  } else {
    materialsWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "materials-dialog",
    });
  }
}

function createMaterialAssignmentWindow() {
  if (!win) return;

  if (materialAssignmentWin && !materialAssignmentWin.isDestroyed()) {
    materialAssignmentWin.show();
    materialAssignmentWin.focus();
    return;
  }

  materialAssignmentWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: "Assign Materials",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  materialAssignmentWin.on("closed", () => {
    materialAssignmentWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    materialAssignmentWin.loadURL(
      `${VITE_DEV_SERVER_URL}#material-assignment-dialog`,
    );
  } else {
    materialAssignmentWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "material-assignment-dialog",
    });
  }
}

function createGeometryWindow() {
  if (!win) return;

  if (geometryWin && !geometryWin.isDestroyed()) {
    geometryWin.show();
    geometryWin.focus();
    return;
  }

  geometryWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: "Exterior Boundary",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  geometryWin.on("closed", () => {
    geometryWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    geometryWin.loadURL(`${VITE_DEV_SERVER_URL}#geometry-dialog`);
  } else {
    geometryWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "geometry-dialog",
    });
  }
}

function createInteriorBoundariesWindow() {
  if (!win) return;

  const broadcastOpenState = (open: boolean) => {
    win?.webContents.send("interiorBoundaries:dialogOpenChanged", open);
  };

  if (interiorBoundariesWin && !interiorBoundariesWin.isDestroyed()) {
    interiorBoundariesWin.show();
    interiorBoundariesWin.focus();
    broadcastOpenState(true);
    return;
  }

  interiorBoundariesWin = new BrowserWindow({
    width: 640,
    height: 760,
    minWidth: 520,
    minHeight: 560,
    title: "Interior Boundaries",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  interiorBoundariesWin.on("closed", () => {
    broadcastOpenState(false);
    interiorBoundariesWin = null;
  });

  broadcastOpenState(true);

  if (VITE_DEV_SERVER_URL) {
    interiorBoundariesWin.loadURL(
      `${VITE_DEV_SERVER_URL}#interior-boundaries-dialog`,
    );
  } else {
    interiorBoundariesWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "interior-boundaries-dialog",
    });
  }
}

function createUdlWindow() {
  if (!win) return;

  if (udlWin && !udlWin.isDestroyed()) {
    udlWin.show();
    udlWin.focus();
    return;
  }

  udlWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: "UDL",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  udlWin.on("closed", () => {
    udlWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    udlWin.loadURL(`${VITE_DEV_SERVER_URL}#udl-dialog`);
  } else {
    udlWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "udl-dialog",
    });
  }
}

function createLineLoadsWindow() {
  if (!win) return;

  if (lineLoadsWin && !lineLoadsWin.isDestroyed()) {
    lineLoadsWin.show();
    lineLoadsWin.focus();
    return;
  }

  lineLoadsWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: "Line Loads",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  lineLoadsWin.on("closed", () => {
    lineLoadsWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    lineLoadsWin.loadURL(`${VITE_DEV_SERVER_URL}#line-loads-dialog`);
  } else {
    lineLoadsWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "line-loads-dialog",
    });
  }
}

function createPiezoWindow() {
  if (!win) return;

  if (piezoWin && !piezoWin.isDestroyed()) {
    piezoWin.show();
    piezoWin.focus();
    return;
  }

  piezoWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: "Piezometric Lines",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  piezoWin.on("closed", () => {
    piezoWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    piezoWin.loadURL(`${VITE_DEV_SERVER_URL}#piezo-dialog`);
  } else {
    piezoWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "piezo-dialog",
    });
  }
}

function createParametersWindow() {
  if (!win) return;

  if (parametersWin && !parametersWin.isDestroyed()) {
    parametersWin.show();
    parametersWin.focus();
    return;
  }

  parametersWin = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 640,
    minHeight: 560,
    title: "Parameters",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  parametersWin.on("closed", () => {
    parametersWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    parametersWin.loadURL(`${VITE_DEV_SERVER_URL}#parameters-dialog`);
  } else {
    parametersWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "parameters-dialog",
    });
  }
}

function createResultsPlotWindow() {
  if (!win) return;

  if (resultsPlotWin && !resultsPlotWin.isDestroyed()) {
    resultsPlotWin.show();
    resultsPlotWin.focus();
    return;
  }

  resultsPlotWin = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: "Results Plot",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  resultsPlotWin.on("closed", () => {
    resultsPlotWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    resultsPlotWin.loadURL(`${VITE_DEV_SERVER_URL}#results-plot-dialog`);
  } else {
    resultsPlotWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "results-plot-dialog",
    });
  }
}

function createSearchLimitsWindow() {
  if (!win) return;

  if (searchLimitsWin && !searchLimitsWin.isDestroyed()) {
    searchLimitsWin.show();
    searchLimitsWin.focus();
    return;
  }

  searchLimitsWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: "Search limits",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  searchLimitsWin.on("closed", () => {
    searchLimitsWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    searchLimitsWin.loadURL(`${VITE_DEV_SERVER_URL}#search-limits-dialog`);
  } else {
    searchLimitsWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "search-limits-dialog",
    });
  }
}

function createCustomSearchPlanesWindow() {
  if (!win) return;

  if (customSearchPlanesWin && !customSearchPlanesWin.isDestroyed()) {
    customSearchPlanesWin.show();
    customSearchPlanesWin.focus();
    return;
  }

  customSearchPlanesWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 520,
    title: "Custom search planes",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  customSearchPlanesWin.on("closed", () => {
    customSearchPlanesWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    customSearchPlanesWin.loadURL(
      `${VITE_DEV_SERVER_URL}#custom-search-planes-dialog`,
    );
  } else {
    customSearchPlanesWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "custom-search-planes-dialog",
    });
  }
}

function createOptionsWindow() {
  if (!win) return;

  if (optionsWin && !optionsWin.isDestroyed()) {
    optionsWin.show();
    optionsWin.focus();
    return;
  }

  optionsWin = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 460,
    minHeight: 560,
    title: "Options",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  optionsWin.on("closed", () => {
    optionsWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    optionsWin.loadURL(`${VITE_DEV_SERVER_URL}#options-dialog`);
  } else {
    optionsWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "options-dialog",
    });
  }
}

function createViewSettingsWindow() {
  if (!win) return;

  if (viewSettingsWin && !viewSettingsWin.isDestroyed()) {
    viewSettingsWin.show();
    viewSettingsWin.focus();
    return;
  }

  viewSettingsWin = new BrowserWindow({
    width: 420,
    height: 620,
    minWidth: 360,
    minHeight: 480,
    title: "View Settings",
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  viewSettingsWin.on("closed", () => {
    viewSettingsWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    viewSettingsWin.loadURL(`${VITE_DEV_SERVER_URL}#view-settings-dialog`);
  } else {
    viewSettingsWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "view-settings-dialog",
    });
  }
}

// When the renderer tells us it has mounted, show the main window
// and close the splash screen.
ipcMain.on("app:ready", () => {
  showMainWindow();
});

// ── Content Security Policy ──────────────────────────────────

function setupCSP() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = VITE_DEV_SERVER_URL
      ? // Dev: allow Vite HMR websocket & eval for fast-refresh
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*; worker-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:;"
      : // Production: strict policy
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; img-src 'self' data: blob:; font-src 'self' data:;";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

// ── Window control IPC ───────────────────────────────────────

ipcMain.on("window:minimize", () => win?.minimize());
ipcMain.on("window:maximize", () => {
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});
ipcMain.on("window:close", () => win?.close());
ipcMain.handle("window:isMaximized", () => win?.isMaximized() ?? false);
ipcMain.on("dev:toggle-devtools", () => win?.webContents.toggleDevTools());
ipcMain.on("window:openMaterialsDialog", () => createMaterialsWindow());
ipcMain.on("window:openMaterialAssignmentDialog", () =>
  createMaterialAssignmentWindow(),
);
ipcMain.on("window:openGeometryDialog", () => createGeometryWindow());
ipcMain.on("window:openInteriorBoundariesDialog", () =>
  createInteriorBoundariesWindow(),
);
ipcMain.on("window:openUdlDialog", () => createUdlWindow());
ipcMain.on("window:openLineLoadsDialog", () => createLineLoadsWindow());
ipcMain.on("window:openPiezoDialog", () => createPiezoWindow());
ipcMain.on("window:openParametersDialog", () => createParametersWindow());
ipcMain.on("window:openResultsPlotDialog", () => createResultsPlotWindow());
ipcMain.on("window:openSearchLimitsDialog", () => createSearchLimitsWindow());
ipcMain.on("window:openCustomSearchPlanesDialog", () =>
  createCustomSearchPlanesWindow(),
);
ipcMain.on("window:openOptionsDialog", () => createOptionsWindow());
ipcMain.on("window:openViewSettingsDialog", () => createViewSettingsWindow());

// ── Materials window sync IPC (main window <-> materials window) ─────

ipcMain.on("materials:requestState", (event) => {
  if (event.sender === materialsWin?.webContents) {
    win?.webContents.send("materials:requestState");
  }
});

ipcMain.on("materials:stateResponse", (event, materials) => {
  if (event.sender === win?.webContents) {
    materialsWin?.webContents.send("materials:stateResponse", materials);
  }
});

ipcMain.on("materials:changed", (event, materials) => {
  if (event.sender === materialsWin?.webContents) {
    win?.webContents.send("materials:changed", materials);
    return;
  }
  if (event.sender === win?.webContents) {
    materialsWin?.webContents.send("materials:changed", materials);
  }
});

// ── Material assignment window sync IPC (main window <-> assign window) ──

ipcMain.on("materialAssignment:requestState", (event) => {
  if (event.sender === materialAssignmentWin?.webContents) {
    win?.webContents.send("materialAssignment:requestState");
  }
});

ipcMain.on("materialAssignment:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    materialAssignmentWin?.webContents.send(
      "materialAssignment:stateResponse",
      state,
    );
  }
});

ipcMain.on("materialAssignment:changed", (event, state) => {
  if (event.sender === materialAssignmentWin?.webContents) {
    win?.webContents.send("materialAssignment:changed", state);
    return;
  }
  if (event.sender === win?.webContents) {
    materialAssignmentWin?.webContents.send(
      "materialAssignment:changed",
      state,
    );
  }
});

// ── Geometry window sync IPC (main window <-> geometry window) ───────

ipcMain.on("geometry:requestState", (event) => {
  if (event.sender === geometryWin?.webContents) {
    win?.webContents.send("geometry:requestState");
  }
});

ipcMain.on("geometry:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    geometryWin?.webContents.send("geometry:stateResponse", state);
  }
});

ipcMain.on("geometry:changed", (event, state) => {
  if (event.sender === geometryWin?.webContents) {
    win?.webContents.send("geometry:changed", state);
    return;
  }
  if (event.sender === win?.webContents) {
    geometryWin?.webContents.send("geometry:changed", state);
  }
});

// ── Interior boundaries window sync IPC (main window <-> boundaries window) ──

ipcMain.on("interiorBoundaries:requestState", (event) => {
  if (event.sender === interiorBoundariesWin?.webContents) {
    win?.webContents.send("interiorBoundaries:requestState");
  }
});

ipcMain.on("interiorBoundaries:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    interiorBoundariesWin?.webContents.send(
      "interiorBoundaries:stateResponse",
      state,
    );
  }
});

ipcMain.on("interiorBoundaries:changed", (event, state) => {
  if (event.sender === interiorBoundariesWin?.webContents) {
    win?.webContents.send("interiorBoundaries:changed", state);
    return;
  }
  if (event.sender === win?.webContents) {
    interiorBoundariesWin?.webContents.send(
      "interiorBoundaries:changed",
      state,
    );
  }
});

// ── Loads window sync IPC (main window <-> loads windows) ───────────────

ipcMain.on("loads:requestState", (event) => {
  if (
    event.sender === udlWin?.webContents ||
    event.sender === lineLoadsWin?.webContents
  ) {
    win?.webContents.send("loads:requestState");
  }
});

ipcMain.on("loads:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    udlWin?.webContents.send("loads:stateResponse", state);
    lineLoadsWin?.webContents.send("loads:stateResponse", state);
  }
});

ipcMain.on("loads:changed", (event, state) => {
  if (
    event.sender === udlWin?.webContents ||
    event.sender === lineLoadsWin?.webContents
  ) {
    win?.webContents.send("loads:changed", state);
    if (event.sender !== udlWin?.webContents) {
      udlWin?.webContents.send("loads:changed", state);
    }
    if (event.sender !== lineLoadsWin?.webContents) {
      lineLoadsWin?.webContents.send("loads:changed", state);
    }
    return;
  }

  if (event.sender === win?.webContents) {
    udlWin?.webContents.send("loads:changed", state);
    lineLoadsWin?.webContents.send("loads:changed", state);
  }
});

// ── Piezometric line window sync IPC (main window <-> piezo window) ──────

ipcMain.on("piezo:requestState", (event) => {
  if (event.sender === piezoWin?.webContents) {
    win?.webContents.send("piezo:requestState");
  }
});

ipcMain.on("piezo:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    piezoWin?.webContents.send("piezo:stateResponse", state);
  }
});

ipcMain.on("piezo:changed", (event, state) => {
  if (event.sender === piezoWin?.webContents) {
    win?.webContents.send("piezo:changed", state);
    return;
  }
  if (event.sender === win?.webContents) {
    piezoWin?.webContents.send("piezo:changed", state);
  }
});

// ── Parameters window sync IPC (main window <-> parameters window) ───────

ipcMain.on("parameters:requestState", (event) => {
  if (event.sender === parametersWin?.webContents) {
    win?.webContents.send("parameters:requestState");
  }
});

ipcMain.on("parameters:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    parametersWin?.webContents.send("parameters:stateResponse", state);
  }
});

ipcMain.on("parameters:changed", (event, state) => {
  if (event.sender === parametersWin?.webContents) {
    win?.webContents.send("parameters:changed", state);
    return;
  }
  if (event.sender === win?.webContents) {
    parametersWin?.webContents.send("parameters:changed", state);
  }
});

// ── Results plot window sync IPC (main window <-> results window) ───────

ipcMain.on("resultsPlot:requestState", (event) => {
  if (event.sender === resultsPlotWin?.webContents) {
    win?.webContents.send("resultsPlot:requestState");
  }
});

ipcMain.on("resultsPlot:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    resultsPlotWin?.webContents.send("resultsPlot:stateResponse", state);
  }
});

ipcMain.on("resultsPlot:changed", (event, state) => {
  if (event.sender === win?.webContents) {
    resultsPlotWin?.webContents.send("resultsPlot:changed", state);
  }
});

// ── Analysis windows sync IPC (main window <-> analysis windows) ─────────

ipcMain.on("analysis:requestState", (event) => {
  if (
    event.sender === searchLimitsWin?.webContents ||
    event.sender === customSearchPlanesWin?.webContents ||
    event.sender === optionsWin?.webContents
  ) {
    win?.webContents.send("analysis:requestState");
  }
});

ipcMain.on("analysis:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    searchLimitsWin?.webContents.send("analysis:stateResponse", state);
    customSearchPlanesWin?.webContents.send("analysis:stateResponse", state);
    optionsWin?.webContents.send("analysis:stateResponse", state);
  }
});

ipcMain.on("analysis:changed", (event, state) => {
  if (
    event.sender === searchLimitsWin?.webContents ||
    event.sender === customSearchPlanesWin?.webContents ||
    event.sender === optionsWin?.webContents
  ) {
    win?.webContents.send("analysis:changed", state);
    if (event.sender !== searchLimitsWin?.webContents) {
      searchLimitsWin?.webContents.send("analysis:changed", state);
    }
    if (event.sender !== customSearchPlanesWin?.webContents) {
      customSearchPlanesWin?.webContents.send("analysis:changed", state);
    }
    if (event.sender !== optionsWin?.webContents) {
      optionsWin?.webContents.send("analysis:changed", state);
    }
    return;
  }

  if (event.sender === win?.webContents) {
    searchLimitsWin?.webContents.send("analysis:changed", state);
    customSearchPlanesWin?.webContents.send("analysis:changed", state);
    optionsWin?.webContents.send("analysis:changed", state);
  }
});

// ── View settings window sync IPC (main window <-> view settings window) ──

ipcMain.on("viewSettings:requestState", (event) => {
  if (event.sender === viewSettingsWin?.webContents) {
    win?.webContents.send("viewSettings:requestState");
  }
});

ipcMain.on("viewSettings:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    viewSettingsWin?.webContents.send("viewSettings:stateResponse", state);
  }
});

ipcMain.on("viewSettings:changed", (event, state) => {
  if (event.sender === viewSettingsWin?.webContents) {
    win?.webContents.send("viewSettings:changed", state);
    return;
  }
  if (event.sender === win?.webContents) {
    viewSettingsWin?.webContents.send("viewSettings:changed", state);
  }
});

// ── Native file dialogs via IPC ──────────────────────────────

let currentFilePath: string | null = null;

ipcMain.handle("file:openPath", async (_event, filePath: string) => {
  if (!win) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".json" && ext !== ".cslope") return null;
  const resolved = path.resolve(filePath);
  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  try {
    const contents = fs.readFileSync(resolved, "utf-8");
    currentFilePath = resolved;
    const name = path.basename(filePath, path.extname(filePath));
    win.setTitle(`${name} — cSlope`);
    return contents;
  } catch {
    return null;
  }
});

ipcMain.handle("dialog:openFile", async () => {
  if (!win) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Open cSlope Project",
    filters: [
      { name: "cSlope Projects", extensions: ["json", "cslope"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return null;
  currentFilePath = filePaths[0];
  const name = path.basename(currentFilePath, path.extname(currentFilePath));
  win.setTitle(`${name} — cSlope`);
  return fs.readFileSync(currentFilePath, "utf-8");
});

async function saveToPath(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, "utf-8");
  currentFilePath = filePath;
  const name = path.basename(filePath, path.extname(filePath));
  win?.setTitle(`${name} — cSlope`);
  return true;
}

ipcMain.handle("dialog:saveFile", async (_event, content: string) => {
  if (!win) return false;
  // If we already have a path, save directly (no dialog)
  if (currentFilePath) {
    return saveToPath(currentFilePath, content);
  }
  // Otherwise fall through to Save As
  return saveAs(content);
});

ipcMain.handle("dialog:saveFileAs", async (_event, content: string) => {
  return saveAs(content);
});

async function saveAs(content: string): Promise<boolean> {
  if (!win) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save cSlope Project",
    defaultPath: currentFilePath ?? "cslope-project.json",
    filters: [
      { name: "cSlope Projects", extensions: ["json", "cslope"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (canceled || !filePath) return false;
  return saveToPath(filePath, content);
}

// ── Application menu (hidden — custom title bar in renderer) ─

function buildMenu() {
  // Remove the native menu bar; the renderer has its own.
  Menu.setApplicationMenu(null);
}

// ── Keyboard-shortcut IPC from renderer ──────────────────────
// The renderer sends these when the user triggers a shortcut or
// clicks a custom menu item. We handle them here so the main
// process can coordinate file-path state and window title.

ipcMain.on("menu:new", () => {
  currentFilePath = null;
  win?.setTitle("cSlope");
});

ipcMain.on("menu:about", () => {
  const version = app.getVersion();
  dialog.showMessageBox({
    type: "info",
    title: "About cSlope",
    message: `cSlope v${version}`,
    detail:
      "Slope Stability Analysis\nOpen-source geotechnical engineering software.\nhttps://cslope.com",
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  setupCSP();
  buildMenu();
  if (!process.env.CSLOPE_CAPTURE) {
    createSplash();
  }
  createWindow();
  if (process.env.CSLOPE_CAPTURE) {
    // In capture mode show the main window immediately (no splash to wait for)
    showMainWindow();
  }
});
