import { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { DEV_CSP, PRODUCTION_CSP } from "./csp";

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
// Development only: a packaged app never loads a page named by the environment.
export const VITE_DEV_SERVER_URL = app.isPackaged ? undefined : process.env["VITE_DEV_SERVER_URL"];
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
let reinforcementWin: BrowserWindow | null;
let piezoWin: BrowserWindow | null;
let parametersWin: BrowserWindow | null;
let resultsPlotWin: BrowserWindow | null;
let searchLimitsWin: BrowserWindow | null;
let customSearchPlanesWin: BrowserWindow | null;
let optionsWin: BrowserWindow | null;
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
    // The widest ribbon tab (Results) needs about 1060 px; narrower, its
    // last group (PDF, Export) was cut off.
    minWidth: 1100,
    minHeight: 640,
    title: "cSlope",
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    // Windows: a hidden title bar on a native frame (resize borders and
    // shadow kept). A frameless window (frame: false) is redrawn when it
    // loses or regains focus, e.g. as a dialog window opens or closes, and
    // the whole content jumped by the width of its invisible border.
    frame: process.platform !== "win32" ? false : undefined,
    titleBarStyle: "hidden",
    show: false, // hidden until renderer signals ready
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Ask the renderer before closing so it can offer to save unsaved
  // changes.  Only once the renderer has registered its handler; otherwise
  // (still loading, crashed) close normally.
  closeGuardReady = false;
  closeConfirmed = false;
  currentFilePath = null;
  pendingOpenPath = null;
  // A (re)loading renderer starts with a fresh, unsaved project and has
  // not registered its close handler yet.
  // A crashed renderer leaves a blank window: say so and offer a reload.
  win.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || !win) return;
    closeGuardReady = false; // nobody left to answer the close guard
    void dialog
      .showMessageBox(win, {
        type: "error",
        title: "cSlope",
        message: "cSlope stopped unexpectedly.",
        detail: `The window has to be reloaded (${details.reason}). Changes since the last save may be lost.`,
        buttons: ["Reload", "Close"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) win?.reload();
        else win?.close();
      });
  });
  win.webContents.on("did-start-loading", () => {
    closeGuardReady = false;
    currentFilePath = null;
    pendingOpenPath = null;
    win?.setTitle("cSlope");
  });
  win.on("close", (event) => {
    // Automated media capture quits with SIGTERM and must never block on
    // an unsaved-changes prompt.
    if (process.env.CSLOPE_CAPTURE) return;
    if (closeConfirmed || !closeGuardReady || !win) return;
    if (win.webContents.isDestroyed() || win.webContents.isCrashed()) return;
    event.preventDefault();
    win.webContents.send("app:closeRequested");
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
    title: "Define materials",
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
    title: "Assign materials",
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
    title: "Exterior boundary",
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

  if (interiorBoundariesWin && !interiorBoundariesWin.isDestroyed()) {
    interiorBoundariesWin.show();
    interiorBoundariesWin.focus();
    return;
  }

  interiorBoundariesWin = new BrowserWindow({
    width: 640,
    height: 760,
    minWidth: 520,
    minHeight: 560,
    title: "Interior boundaries",
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
    interiorBoundariesWin = null;
  });

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
    title: "Distributed loads",
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
    title: "Line loads",
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

function createReinforcementWindow() {
  if (!win) return;

  if (reinforcementWin && !reinforcementWin.isDestroyed()) {
    reinforcementWin.show();
    reinforcementWin.focus();
    return;
  }

  reinforcementWin = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 560,
    minHeight: 520,
    title: "Reinforcement",
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

  reinforcementWin.on("closed", () => {
    reinforcementWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    reinforcementWin.loadURL(`${VITE_DEV_SERVER_URL}#reinforcement-dialog`);
  } else {
    reinforcementWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
      hash: "reinforcement-dialog",
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
    title: "Piezometric lines",
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
    title: "Results plot",
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

// Tool windows (Sensitivity, Probabilistic analysis). The main window
// runs their analyses: it gets their commands and sends them the model and
// the results, and is told when one closes so it stops a run.
type ToolWindow = "sensitivity" | "reliability";
const TOOL_WINDOWS: Record<ToolWindow, { title: string; hash: string; width: number; height: number }> = {
  sensitivity: { title: "Sensitivity analysis", hash: "sensitivity-dialog", width: 620, height: 760 },
  reliability: { title: "Probabilistic analysis", hash: "reliability-dialog", width: 620, height: 780 },
};
const toolWins = new Map<ToolWindow, BrowserWindow>();

function createToolWindow(tool: ToolWindow) {
  if (!win) return;

  const open = toolWins.get(tool);
  if (open && !open.isDestroyed()) {
    open.show();
    open.focus();
    return;
  }

  const { title, hash, width, height } = TOOL_WINDOWS[tool];
  const child = new BrowserWindow({
    width,
    height,
    minWidth: 480,
    minHeight: 420,
    title,
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
  toolWins.set(tool, child);

  child.on("closed", () => {
    if (toolWins.get(tool) === child) toolWins.delete(tool);
    if (win && !win.isDestroyed()) win.webContents.send(`${tool}:closed`);
  });

  if (VITE_DEV_SERVER_URL) {
    child.loadURL(`${VITE_DEV_SERVER_URL}#${hash}`);
  } else {
    child.loadFile(path.join(RENDERER_DIST, "index.html"), { hash });
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

// When the renderer tells us it has mounted, show the main window
// and close the splash screen.
ipcMain.on("app:ready", () => {
  showMainWindow();
});

// A dialog window opens at a fixed height. Once laid out, and again when
// its content changes (rows added or removed), it asks to fit its content,
// so short dialogs aren't mostly empty and growing ones grow back. Never
// taller than it opened, never below 240 px, only dialog windows, and no
// longer once the user has resized the window.
const dialogOpenHeight = new WeakMap<BrowserWindow, number>();
const userSizedDialogs = new WeakSet<BrowserWindow>();
/** The content height this handler last gave each dialog. */
const dialogFittedHeight = new WeakMap<BrowserWindow, number>();
ipcMain.on("window:fitDialogHeight", (event, height: unknown) => {
  const child = BrowserWindow.fromWebContents(event.sender);
  if (!child || child === win || typeof height !== "number" || !Number.isFinite(height)) return;
  if (userSizedDialogs.has(child)) return;
  const [width, current] = child.getContentSize();
  // A height other than the one set here means the user resized the window
  // ("will-resize" below is only emitted on Windows and macOS).
  const fitted = dialogFittedHeight.get(child);
  if (fitted !== undefined && Math.abs(current - fitted) > 2) {
    userSizedDialogs.add(child);
    return;
  }
  if (!dialogOpenHeight.has(child)) {
    dialogOpenHeight.set(child, current);
    // Emitted for resizes by the user only (not for setContentSize).
    child.on("will-resize", () => userSizedDialogs.add(child));
  }
  const target = Math.round(Math.min(dialogOpenHeight.get(child)!, Math.max(240, height)));
  if (Math.abs(target - current) < 2) return;
  dialogFittedHeight.set(child, target);
  const frame = child.getSize()[1] - current;
  const [minWidth, minHeight] = child.getMinimumSize();
  if (minHeight > target + frame) child.setMinimumSize(minWidth, target + frame);
  child.setContentSize(width, target);
});

// ── Content Security Policy ──────────────────────────────────

function setupCSP() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // The policies are in csp.ts (the production one is also written into
    // the built index.html as a <meta> fallback by vite.config.ts).
    const csp = VITE_DEV_SERVER_URL ? DEV_CSP : PRODUCTION_CSP;
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
ipcMain.on("dev:toggle-devtools", (event) => {
  // Developer tool only: never in packaged builds, only for the main window.
  if (app.isPackaged || event.sender !== win?.webContents) return;
  win.webContents.toggleDevTools();
});
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
ipcMain.on("window:openReinforcementDialog", () =>
  createReinforcementWindow(),
);
ipcMain.on("window:openPiezoDialog", () => createPiezoWindow());
ipcMain.on("window:openParametersDialog", () => createParametersWindow());
ipcMain.on("window:openResultsPlotDialog", () => createResultsPlotWindow());
ipcMain.on("window:openSearchLimitsDialog", () => createSearchLimitsWindow());
ipcMain.on("window:openCustomSearchPlanesDialog", () =>
  createCustomSearchPlanesWindow(),
);
ipcMain.on("window:openOptionsDialog", () => createOptionsWindow());
ipcMain.on("window:openSensitivityDialog", () => createToolWindow("sensitivity"));
ipcMain.on("window:openReliabilityDialog", () => createToolWindow("reliability"));

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

const loadsWindows = () => [udlWin, lineLoadsWin, reinforcementWin];
const isLoadsWindow = (sender: Electron.WebContents) =>
  loadsWindows().some((w) => w && !w.isDestroyed() && w.webContents === sender);

ipcMain.on("loads:requestState", (event) => {
  if (isLoadsWindow(event.sender)) {
    win?.webContents.send("loads:requestState");
  }
});

ipcMain.on("loads:stateResponse", (event, state) => {
  if (event.sender === win?.webContents) {
    for (const w of loadsWindows()) w?.webContents.send("loads:stateResponse", state);
  }
});

ipcMain.on("loads:changed", (event, state) => {
  const fromDialog = isLoadsWindow(event.sender);
  if (!fromDialog && event.sender !== win?.webContents) return;
  if (fromDialog) win?.webContents.send("loads:changed", state);
  for (const w of loadsWindows()) {
    if (w && !w.isDestroyed() && w.webContents !== event.sender) {
      w.webContents.send("loads:changed", state);
    }
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

// ── Tool windows sync IPC (main window <-> Sensitivity, Probabilistic) ──

for (const tool of Object.keys(TOOL_WINDOWS) as ToolWindow[]) {
  const fromTool = (event: Electron.IpcMainEvent) =>
    event.sender === toolWins.get(tool)?.webContents;
  ipcMain.on(`${tool}:requestState`, (event) => {
    if (fromTool(event)) win?.webContents.send(`${tool}:requestState`);
  });
  ipcMain.on(`${tool}:command`, (event, command) => {
    if (fromTool(event)) win?.webContents.send(`${tool}:command`, command);
  });
  for (const channel of ["stateResponse", "changed"]) {
    ipcMain.on(`${tool}:${channel}`, (event, state) => {
      if (event.sender === win?.webContents) {
        toolWins.get(tool)?.webContents.send(`${tool}:${channel}`, state);
      }
    });
  }
}

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

// ── Canvas selection sync (main window <-> every dialog window) ──────
// The object (and point) selected on the canvas: the windows' tables show
// it as their selected row, and a row picked in a window selects it on the
// canvas. A window that is closed simply gets nothing.

const dialogWindows = () => [
  materialsWin,
  materialAssignmentWin,
  geometryWin,
  interiorBoundariesWin,
  udlWin,
  lineLoadsWin,
  reinforcementWin,
  piezoWin,
  parametersWin,
  resultsPlotWin,
  searchLimitsWin,
  customSearchPlanesWin,
  optionsWin,
];
const isDialogWindow = (sender: Electron.WebContents) =>
  dialogWindows().some((w) => w && !w.isDestroyed() && w.webContents === sender);

ipcMain.on("selection:requestState", (event) => {
  if (isDialogWindow(event.sender)) win?.webContents.send("selection:requestState");
});

ipcMain.on("selection:changed", (event, selection) => {
  if (event.sender === win?.webContents) {
    for (const w of dialogWindows()) {
      if (w && !w.isDestroyed()) w.webContents.send("selection:changed", selection);
    }
    return;
  }
  if (isDialogWindow(event.sender)) win?.webContents.send("selection:changed", selection);
});

// ── Native file dialogs via IPC ──────────────────────────────

let currentFilePath: string | null = null;

// ── Unsaved changes guard ─────────────────────────────────────

let closeGuardReady = false;
let closeConfirmed = false;

ipcMain.on("app:closeGuardReady", (event) => {
  if (event.sender === win?.webContents) closeGuardReady = true;
});

// The renderer's guard is gone (it unmounted, e.g. after a render error):
// nobody would answer a close request, so closing must not wait for one.
ipcMain.on("app:closeGuardReleased", (event) => {
  if (event.sender === win?.webContents) closeGuardReady = false;
});

ipcMain.on("app:closeConfirmed", (event) => {
  if (event.sender !== win?.webContents) return;
  closeConfirmed = true;
  win?.close();
});

ipcMain.handle("dialog:unsavedChanges", async (event) => {
  if (!win || event.sender !== win.webContents) return "cancel";
  const name = currentFilePath
    ? path.basename(currentFilePath, path.extname(currentFilePath))
    : "Untitled";
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    title: "Unsaved changes",
    message: `Do you want to save the changes to ${name}?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ["Save", "Don't save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return response === 0 ? "save" : response === 1 ? "discard" : "cancel";
});
/**
 * Path of a file that was read but not yet loaded by the renderer.  It
 * only becomes the current (save target) path once the renderer confirms
 * the project parsed and loaded; otherwise a failed open would make the
 * next Save overwrite the file that could not be opened.
 */
let pendingOpenPath: string | null = null;

function setCurrentFilePath(filePath: string) {
  currentFilePath = filePath;
  const name = path.basename(filePath, path.extname(filePath));
  win?.setTitle(`${name} — cSlope`);
  sendFileName(name);
}

/**
 * Tell the renderer the name of the project file (null: untitled): its
 * title bar and the window title show it, with a mark for unsaved changes.
 */
function sendFileName(name: string | null) {
  win?.webContents.send("file:nameChanged", name);
}

/**
 * Largest project file accepted (a real project is a few hundred kB). The
 * renderer's file pickers have the same limit (src/features/project/file-limits.ts).
 */
const MAX_PROJECT_BYTES = 50 * 1024 * 1024;

/**
 * The project file: a .cslp archive. Projects saved before it are JSON
 * files named .json or .cslope; they are opened (the renderer tells the
 * formats apart by content) but never written.
 */
const PROJECT_EXT = ".cslp";
const OPENABLE_EXTS = [PROJECT_EXT, ".json", ".cslope"];
/** One or more project extensions at the end of a name (".cslope.cslp"). */
const PROJECT_EXTS_AT_END = /(\.(cslp|cslope|json))+$/i;

/** Whether a path names a file the app opens as a project. */
function isOpenablePath(filePath: string): boolean {
  return OPENABLE_EXTS.includes(path.extname(filePath).toLowerCase());
}

/**
 * The path a project is saved to: the name with .cslp as its only
 * extension. A typed .json or .cslope, or .cslp twice (a save dialog may
 * append the filter's extension to a typed one), is replaced, so
 * "x.cslope.cslp", "x.cslp.cslp" and "x.json" all give "x.cslp". Other
 * dots stay part of the name.
 */
export function cslpPath(filePath: string): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath).trim().replace(PROJECT_EXTS_AT_END, "").trim();
  return path.join(dir, `${base || "cslope-project"}${PROJECT_EXT}`);
}

/** The file name to offer for a new project, from the name the renderer suggests. */
function suggestedFileName(suggested: unknown): string {
  const raw = typeof suggested === "string" ? suggested : "";
  // A name only, never a path, in characters every file system takes.
  // (The reserved characters go first: on Windows path.basename reads "a:"
  // as a drive and would drop it.)
  const name = path
    .basename(raw.replace(/[\\/:*?"<>|]+|\p{Cc}+/gu, "_"))
    .slice(0, 200);
  return path.basename(cslpPath(name || "cslope-project"));
}

/** A project file's bytes (a size check first: never a huge file read by mistake). */
function readProjectFile(filePath: string): Uint8Array {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("Not a file.");
  if (stat.size > MAX_PROJECT_BYTES) {
    throw new Error("The file is too large to be a cSlope project.");
  }
  return new Uint8Array(fs.readFileSync(filePath));
}

ipcMain.handle("file:openPath", async (event, filePath: string) => {
  // File access only for the main window (not dialogs or a page that a
  // dropped file might have navigated to).
  if (!win || event.sender !== win.webContents) return null;
  if (typeof filePath !== "string" || !isOpenablePath(filePath)) return null;
  const resolved = path.resolve(filePath);
  // A new open attempt replaces any earlier one that was not confirmed.
  pendingOpenPath = null;
  try {
    const contents = readProjectFile(resolved);
    pendingOpenPath = resolved;
    return contents;
  } catch {
    return null;
  }
});

ipcMain.handle("dialog:openFile", async (event) => {
  if (!win || event.sender !== win.webContents) return null;
  // A cancelled or failed open must not leave an earlier path to confirm.
  pendingOpenPath = null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Open cSlope project",
    filters: [
      { name: "cSlope project", extensions: ["cslp", "json", "cslope"] },
      { name: "All files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return null;
  let contents: Uint8Array;
  try {
    contents = readProjectFile(filePaths[0]);
  } catch (err) {
    dialog.showErrorBox(
      "Could not open file",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  pendingOpenPath = filePaths[0];
  return contents;
});

ipcMain.on("file:openConfirmed", (event) => {
  if (event.sender !== win?.webContents || !pendingOpenPath) return;
  setCurrentFilePath(pendingOpenPath);
  pendingOpenPath = null;
});

// ── Project files given to the app ───────────────────────────
// A double-clicked .cslp file (Windows, Linux: on the command line;
// macOS: the open-file event), also when cSlope is already running (a
// second launch hands its command line to this instance and quits). The
// path waits here until the page asks for it (it may still be loading),
// and is read like a dropped file.

/** A project file given to the app, not yet asked for by the page. */
let requestedOpenPath: string | null = null;

/** The project file named on a command line (relative paths from `cwd`), if any (the last one). */
export function projectPathFromArgs(argv: readonly string[], cwd = process.cwd()): string | null {
  let found: string | null = null;
  // argv[0] is the executable; flags (Chromium's too) start with "-".
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith("-") || !isOpenablePath(arg)) continue;
    const resolved = path.resolve(cwd, arg);
    try {
      if (fs.statSync(resolved).isFile()) found = resolved;
    } catch {
      // Not a file.
    }
  }
  return found;
}

/** Open `filePath` in the main window (once its page asks for it). */
function requestOpen(filePath: string) {
  requestedOpenPath = filePath;
  if (win && !win.isDestroyed()) {
    win.webContents.send("file:openRequested");
  } else if (app.isReady()) {
    // macOS: no window left; the new page asks for the file once loaded.
    createWindow();
  }
}

ipcMain.handle("file:openRequested", async (event) => {
  if (!win || event.sender !== win.webContents || !requestedOpenPath) return null;
  const filePath = requestedOpenPath;
  requestedOpenPath = null;
  pendingOpenPath = null;
  try {
    const contents = readProjectFile(filePath);
    pendingOpenPath = filePath;
    return contents;
  } catch (err) {
    dialog.showErrorBox(
      "Could not open file",
      `${filePath}\n${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
});

/**
 * Write the project atomically: to a temporary file next to the target,
 * flushed to disk, then renamed over it. Writing in place truncates the
 * existing file first, so a crash, power loss or full disk mid-write
 * would destroy the user's only copy.
 */
async function saveToPath(filePath: string, content: Uint8Array) {
  let target = filePath;
  try {
    target = fs.realpathSync(filePath); // keep symlinks pointing at the file
  } catch {
    // New file.
  }
  // Keep the file's protection: a read-only project stays unsaveable (as
  // with an in-place write) and the copy gets the original mode.
  let mode: number | undefined;
  try {
    const stat = fs.statSync(target);
    fs.accessSync(target, fs.constants.W_OK);
    mode = stat.mode & 0o7777;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // An unguessable name, created exclusively: a file or link planted
  // under a predictable name in a shared folder is never written through.
  const tmp = `${target}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    const fd = fs.openSync(tmp, "wx", mode);
    try {
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    try {
      fs.renameSync(tmp, target);
    } catch (err) {
      // Windows: the target can be held open (antivirus, sync clients)
      // so it cannot be replaced; fall back to writing it in place.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EXDEV") throw err;
      fs.writeFileSync(target, content);
      fs.unlinkSync(tmp);
    }
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Nothing to clean up.
    }
    throw err;
  }
  setCurrentFilePath(filePath);
  return true;
}

/** The project archive from the renderer (never anything but bytes). */
const isProjectData = (content: unknown): content is Uint8Array => content instanceof Uint8Array;

ipcMain.handle("dialog:saveFile", async (event, content: unknown, suggestedName?: unknown) => {
  if (!win || event.sender !== win.webContents || !isProjectData(content)) return false;
  // A .cslp file: save to it directly (no dialog).
  if (currentFilePath && path.extname(currentFilePath).toLowerCase() === PROJECT_EXT) {
    return saveToPath(currentFilePath, content);
  }
  // No file yet, or a project opened from a .json/.cslope file of an
  // earlier version: Save As, offering <name>.cslp next to it (the old
  // file is never replaced by a file of another format).
  return saveAs(content, suggestedName);
});

ipcMain.handle("dialog:saveFileAs", async (event, content: unknown, suggestedName?: unknown) => {
  if (event.sender !== win?.webContents || !isProjectData(content)) return false;
  return saveAs(content, suggestedName);
});

async function saveAs(content: Uint8Array, suggestedName?: unknown): Promise<boolean> {
  if (!win) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save cSlope project",
    defaultPath: currentFilePath ? cslpPath(currentFilePath) : suggestedFileName(suggestedName),
    filters: [{ name: "cSlope project", extensions: ["cslp"] }],
  });
  if (canceled || !filePath) return false;
  const target = cslpPath(filePath);
  // The dialog asked about replacing the name typed; the name saved to
  // differs (x.json typed, x.cslp saved), so ask about that one.
  if (target !== filePath && fs.existsSync(target)) {
    const { response } = await dialog.showMessageBox(win, {
      type: "warning",
      title: "Save cSlope project",
      message: `${path.basename(target)} already exists. Do you want to replace it?`,
      buttons: ["Replace", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return false;
  }
  return saveToPath(target, content);
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

ipcMain.on("menu:new", (event) => {
  if (event.sender !== win?.webContents) return;
  currentFilePath = null;
  pendingOpenPath = null;
  win?.setTitle("cSlope");
  sendFileName(null);
});

ipcMain.on("menu:about", () => {
  const version = app.getVersion();
  const options = {
    type: "info" as const,
    title: "About cSlope",
    message: `cSlope v${version}`,
    detail:
      "Slope stability analysis\nOpen-source geotechnical engineering software.\nhttps://cslope.com\n\n" +
      "DWG import uses acadrust (MPL-2.0, https://github.com/hakanaktt/acadrust). " +
      "Third-party licenses: THIRD-PARTY-NOTICES.txt in the app's resources folder.",
  };
  // Modal to the main window so it cannot open behind it.
  if (win) dialog.showMessageBox(win, options);
  else dialog.showMessageBox(options);
});

// Help › Documentation, and the "?" buttons of the dialog windows: the
// website's documentation in the default browser. The renderer can only
// name a page and a heading under /docs (lower-case words and hyphens);
// the site is fixed here.
const DOCS_PAGE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?(?:#[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
ipcMain.on("help:openDocumentation", (event, page: unknown) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  const fromApp = !!win && (event.sender === win.webContents || sender?.getParentWindow() === win);
  if (!fromApp) return;
  const path = typeof page === "string" && DOCS_PAGE.test(page) ? `/${page}` : "";
  void shell.openExternal(`https://cslope.com/docs${path}`);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// Dialog windows keep their own title; the page <title> ("cSlope") would
// otherwise replace "Define Materials", "Piezometric Lines", ...
// No window may navigate away from the app or open new windows: a file
// dropped on a dialog window would otherwise replace it (and a dropped
// .html page would get the preload API).
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    // Reloading the app's own page (dev Reload button, Vite full reload)
    // is fine; anything else is not.
    const strip = (u: string) => u.split("#")[0];
    if (strip(url) !== strip(contents.getURL())) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});

app.on("browser-window-created", (_event, created) => {
  created.on("page-title-updated", (event) => {
    if (created !== win) event.preventDefault();
  });
});

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

// One cSlope at a time: a second launch (a .cslp file double-clicked
// while cSlope runs) hands its command line to this instance and quits.
// Not for automated capture, which may run instances side by side.
const isPrimaryInstance = process.env.CSLOPE_CAPTURE ? true : app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  requestedOpenPath = projectPathFromArgs(process.argv);
  app.on("second-instance", (_event, argv: string[], workingDirectory: string) => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    const filePath = projectPathFromArgs(argv, workingDirectory || undefined);
    if (filePath) requestOpen(filePath);
  });
  // macOS: a file opened with cSlope (also before the app is ready).
  app.on("open-file", (event, filePath: string) => {
    event.preventDefault();
    if (isOpenablePath(filePath)) requestOpen(path.resolve(filePath));
  });
}

app.whenReady().then(() => {
  if (!isPrimaryInstance) return;
  setupCSP();
  // The app needs no camera, microphone, location or notifications.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
