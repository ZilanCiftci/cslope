import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "cSlope",
    icon: path.join(process.env.VITE_PUBLIC, "mountain.svg"),
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Notify renderer when maximized state changes
  win.on("maximize", () => win?.webContents.send("window:maximized", true));
  win.on("unmaximize", () => win?.webContents.send("window:maximized", false));

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
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

// ── Native file dialogs via IPC ──────────────────────────────

let currentFilePath: string | null = null;

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
  buildMenu();
  createWindow();
});
