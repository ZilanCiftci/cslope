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
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

// ── Native file dialogs via IPC ──────────────────────────────

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
  return fs.readFileSync(filePaths[0], "utf-8");
});

ipcMain.handle("dialog:saveFile", async (_event, content: string) => {
  if (!win) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save cSlope Project",
    filters: [
      { name: "cSlope Projects", extensions: ["json", "cslope"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
});

// ── Application menu ─────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Project…",
          accelerator: "CmdOrCtrl+O",
          click: () => win?.webContents.send("menu:open"),
        },
        {
          label: "Save Project…",
          accelerator: "CmdOrCtrl+S",
          click: () => win?.webContents.send("menu:save"),
        },
        { type: "separator" },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" as const },
    { role: "viewMenu" as const },
    { role: "windowMenu" as const },
    {
      label: "Help",
      submenu: [
        {
          label: "About cSlope",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "About cSlope",
              message: "cSlope — Slope Stability Analysis",
              detail:
                "Open-source geotechnical engineering software.\nhttps://cslope.com",
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
