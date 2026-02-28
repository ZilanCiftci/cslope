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
  createSplash();
  createWindow();
});
