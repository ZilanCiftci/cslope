// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Electron fakes ────────────────────────────────────────────────
// main.ts registers everything at import time, so each test re-imports
// it against fresh fakes and drives it through the recorded handlers.

const fake = vi.hoisted(() => {
  type Listener = (...args: any[]) => any;

  class Emitter {
    listeners = new Map<string, Listener[]>();
    on(name: string, fn: Listener) {
      const list = this.listeners.get(name) ?? [];
      list.push(fn);
      this.listeners.set(name, list);
      return this;
    }
    once(name: string, fn: Listener) {
      const wrapped: Listener = (...args) => {
        this.off(name, wrapped);
        return fn(...args);
      };
      return this.on(name, wrapped);
    }
    off(name: string, fn: Listener) {
      const list = this.listeners.get(name) ?? [];
      this.listeners.set(
        name,
        list.filter((l) => l !== fn),
      );
      return this;
    }
    emit(name: string, ...args: any[]) {
      for (const fn of [...(this.listeners.get(name) ?? [])]) fn(...args);
    }
    count(name: string) {
      return this.listeners.get(name)?.length ?? 0;
    }
  }

  class FakeWebContents extends Emitter {
    url = "";
    destroyed = false;
    crashed = false;
    send = vi.fn();
    toggleDevTools = vi.fn();
    windowOpenHandler: (() => unknown) | null = null;
    isDestroyed = () => this.destroyed;
    isCrashed = () => this.crashed;
    getURL = () => this.url;
    setWindowOpenHandler(fn: () => unknown) {
      this.windowOpenHandler = fn;
    }
  }

  class FakeBrowserWindow extends Emitter {
    static instances: FakeBrowserWindow[] = [];
    static getAllWindows = () =>
      FakeBrowserWindow.instances.filter((w) => !w.destroyed);
    static fromWebContents = (wc: unknown) =>
      FakeBrowserWindow.instances.find((w) => w.webContents === wc) ?? null;
    options: any;
    webContents = new FakeWebContents();
    destroyed = false;
    maximized = false;
    title = "";
    show = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn();
    loadFile = vi.fn();
    reload = vi.fn();
    minimize = vi.fn();
    maximize = vi.fn(() => {
      this.maximized = true;
    });
    unmaximize = vi.fn(() => {
      this.maximized = false;
    });
    isMaximized = () => this.maximized;
    /** Content size and a 30 px frame, as the window options give them. */
    contentHeight = 0;
    minHeight = 0;
    getContentSize = () => [this.options?.width ?? 0, this.contentHeight];
    getSize = () => [this.options?.width ?? 0, this.contentHeight + 30];
    setContentSize = vi.fn((_w: number, h: number) => {
      this.contentHeight = h;
    });
    getMinimumSize = () => [this.options?.minWidth ?? 0, this.minHeight];
    setMinimumSize = vi.fn((_w: number, h: number) => {
      this.minHeight = h;
    });
    isDestroyed = () => this.destroyed;
    setTitle = vi.fn((t: string) => {
      this.title = t;
    });
    /** Mirrors Electron: "close" can be prevented, otherwise "closed". */
    close = vi.fn(() => {
      if (this.destroyed) return;
      let prevented = false;
      this.emit("close", {
        preventDefault: () => {
          prevented = true;
        },
      });
      if (prevented) return;
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.emit("closed");
    });
    constructor(options: any) {
      super();
      this.options = options;
      this.contentHeight = options?.height ?? 0;
      this.minHeight = options?.minHeight ?? 0;
      FakeBrowserWindow.instances.push(this);
      state.appListeners.get("browser-window-created")?.forEach((fn) =>
        fn({}, this),
      );
      state.appListeners.get("web-contents-created")?.forEach((fn) =>
        fn({}, this.webContents),
      );
    }
  }

  const state = {
    on: new Map<string, Listener>(),
    handle: new Map<string, Listener>(),
    appListeners: new Map<string, Listener[]>(),
  };

  const ipcMain = {
    on: vi.fn((channel: string, fn: Listener) => {
      state.on.set(channel, fn);
    }),
    handle: vi.fn((channel: string, fn: Listener) => {
      state.handle.set(channel, fn);
    }),
  };

  const app = {
    isPackaged: false,
    on: vi.fn((name: string, fn: Listener) => {
      const list = state.appListeners.get(name) ?? [];
      list.push(fn);
      state.appListeners.set(name, list);
    }),
    whenReady: vi.fn(() => Promise.resolve()),
    getVersion: vi.fn(() => "1.2.3"),
    quit: vi.fn(),
  };

  const dialog = {
    showMessageBox: vi.fn<(...args: any[]) => Promise<any>>(async () => ({ response: 0 })),
    showOpenDialog: vi.fn<(...args: any[]) => Promise<any>>(async () => ({
      canceled: true,
      filePaths: [] as string[],
    })),
    showSaveDialog: vi.fn<(...args: any[]) => Promise<any>>(async () => ({
      canceled: true,
      filePath: undefined as string | undefined,
    })),
    showErrorBox: vi.fn(),
  };

  const session = {
    defaultSession: {
      webRequest: { onHeadersReceived: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    },
  };
  const Menu = { setApplicationMenu: vi.fn() };
  const shell = { openExternal: vi.fn(async () => {}) };
  // Preload side, for the channel contract test.
  const ipcRenderer = {
    send: vi.fn(),
    invoke: vi.fn<(...args: any[]) => Promise<any>>(async () => null),
    on: vi.fn(),
    off: vi.fn(),
  };
  const exposed: Record<string, Record<string, (...a: any[]) => any>> = {};
  const contextBridge = {
    exposeInMainWorld: vi.fn((key: string, api: any) => {
      exposed[key] = api;
    }),
  };

  function reset() {
    state.on.clear();
    state.handle.clear();
    state.appListeners.clear();
    FakeBrowserWindow.instances = [];
    app.isPackaged = false;
    for (const group of [ipcMain, app, dialog, Menu, shell]) {
      for (const fn of Object.values(group)) {
        if (typeof fn === "function" && "mockClear" in fn) {
          (fn as any).mockClear();
        }
      }
    }
    session.defaultSession.webRequest.onHeadersReceived.mockClear();
    dialog.showMessageBox.mockImplementation(async () => ({ response: 0 }));
    dialog.showOpenDialog.mockImplementation(async () => ({
      canceled: true,
      filePaths: [],
    }));
    dialog.showSaveDialog.mockImplementation(async () => ({
      canceled: true,
      filePath: undefined,
    }));
  }

  return {
    state,
    reset,
    FakeBrowserWindow,
    FakeWebContents,
    ipcMain,
    app,
    dialog,
    session,
    Menu,
    shell,
    ipcRenderer,
    contextBridge,
    exposed,
  };
});

vi.mock("electron", () => {
  const mod = {
    app: fake.app,
    BrowserWindow: fake.FakeBrowserWindow,
    Menu: fake.Menu,
    dialog: fake.dialog,
    ipcMain: fake.ipcMain,
    session: fake.session,
    shell: fake.shell,
    ipcRenderer: fake.ipcRenderer,
    contextBridge: fake.contextBridge,
    // Every File has a native path here (a dropped file).
    webUtils: { getPathForFile: () => "/dropped/project.json" },
  };
  return { ...mod, default: mod };
});

type Win = InstanceType<typeof fake.FakeBrowserWindow>;
type Contents = InstanceType<typeof fake.FakeWebContents>;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function loadMain(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  fake.reset();
  delete process.env.VITE_DEV_SERVER_URL;
  delete process.env.CSLOPE_CAPTURE;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import("./main");
  await flush();
  return mod;
}

/** The main window (the one with the preload and no parent). */
function mainWin(): Win {
  const w = fake.FakeBrowserWindow.instances.find(
    (b) => b.options.title === "cSlope",
  );
  if (!w) throw new Error("main window not created");
  return w;
}

function send(channel: string, sender: Contents, ...args: unknown[]) {
  const fn = fake.state.on.get(channel);
  if (!fn) throw new Error(`no ipcMain.on for ${channel}`);
  return fn({ sender }, ...args);
}

function invoke(channel: string, sender: Contents, ...args: unknown[]) {
  const fn = fake.state.handle.get(channel);
  if (!fn) throw new Error(`no ipcMain.handle for ${channel}`);
  return fn({ sender }, ...args);
}

const stranger = () => new fake.FakeWebContents();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.VITE_DEV_SERVER_URL;
  delete process.env.CSLOPE_CAPTURE;
});

// ── Startup ───────────────────────────────────────────────────────

describe("startup", () => {
  it("shows a splash, then the hidden main window once the renderer is ready", async () => {
    await loadMain();
    const [splash, win] = fake.FakeBrowserWindow.instances;
    expect(splash.options.frame).toBe(false);
    expect(splash.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/splash\.html$/),
    );
    expect(win.options.show).toBe(false);
    expect(win.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(win.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/dist[\\/]index\.html$/),
    );
    expect(fake.Menu.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(win.show).not.toHaveBeenCalled();

    send("app:ready", win.webContents);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalled();
    expect(splash.destroyed).toBe(true);

    // The 10 s fallback was cancelled: nothing more happens.
    vi.advanceTimersByTime(20000);
    expect(win.show).toHaveBeenCalledTimes(1);
  });

  it("loads the dev server URL in development", async () => {
    await loadMain({ VITE_DEV_SERVER_URL: "http://localhost:5173/" });
    const win = mainWin();
    expect(win.loadURL).toHaveBeenCalledWith("http://localhost:5173/");
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it("falls back to showing the window after did-finish-load, did-fail-load or 10 s", async () => {
    await loadMain();
    let win = mainWin();
    win.webContents.emit("did-finish-load");
    expect(win.show).toHaveBeenCalledTimes(1);

    await loadMain();
    win = mainWin();
    win.webContents.emit("did-fail-load");
    expect(win.show).toHaveBeenCalledTimes(1);

    await loadMain();
    win = mainWin();
    vi.advanceTimersByTime(9999);
    expect(win.show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(fake.FakeBrowserWindow.instances[0].destroyed).toBe(true);
  });

  it("does not re-show after did-finish-load once the splash is gone", async () => {
    await loadMain();
    const win = mainWin();
    send("app:ready", win.webContents);
    win.webContents.emit("did-finish-load");
    expect(win.show).toHaveBeenCalledTimes(1);
  });

  it("skips the splash and shows at once in capture mode", async () => {
    await loadMain({ CSLOPE_CAPTURE: "1" });
    expect(fake.FakeBrowserWindow.instances).toHaveLength(1);
    expect(mainWin().show).toHaveBeenCalled();
  });

  it("sets a strict content security policy in production", async () => {
    await loadMain();
    const [handler] =
      fake.session.defaultSession.webRequest.onHeadersReceived.mock.calls[0];
    const callback = vi.fn();
    handler({ responseHeaders: { "X-Other": ["1"] } }, callback);
    const headers = callback.mock.calls[0][0].responseHeaders;
    expect(headers["X-Other"]).toEqual(["1"]);
    const csp = headers["Content-Security-Policy"][0] as string;
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows the Vite HMR socket and eval only in development", async () => {
    await loadMain({ VITE_DEV_SERVER_URL: "http://localhost:5173/" });
    const [handler] =
      fake.session.defaultSession.webRequest.onHeadersReceived.mock.calls[0];
    const callback = vi.fn();
    handler({ responseHeaders: {} }, callback);
    const csp = callback.mock.calls[0][0].responseHeaders[
      "Content-Security-Policy"
    ][0] as string;
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws://localhost:*");
  });

  it("recreates the main window on activate when none is left", async () => {
    await loadMain();
    for (const w of fake.FakeBrowserWindow.instances) w.destroyed = true;
    fake.state.appListeners.get("activate")![0]();
    expect(
      fake.FakeBrowserWindow.instances.filter(
        (w) => w.options.title === "cSlope",
      ),
    ).toHaveLength(2);

    // With a window still open nothing is created.
    const before = fake.FakeBrowserWindow.instances.length;
    fake.state.appListeners.get("activate")![0]();
    expect(fake.FakeBrowserWindow.instances).toHaveLength(before);
  });

  it("quits when all windows are closed except on macOS", async () => {
    await loadMain();
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      Object.defineProperty(process, "platform", { value: "darwin" });
      fake.state.appListeners.get("window-all-closed")![0]();
      expect(fake.app.quit).not.toHaveBeenCalled();
      Object.defineProperty(process, "platform", { value: "win32" });
      fake.state.appListeners.get("window-all-closed")![0]();
      expect(fake.app.quit).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });
});

// ── Window controls ───────────────────────────────────────────────

describe("window controls", () => {
  it("minimizes, toggles maximize and reports the state", async () => {
    await loadMain();
    const win = mainWin();
    send("window:minimize", win.webContents);
    expect(win.minimize).toHaveBeenCalled();

    expect(await invoke("window:isMaximized", win.webContents)).toBe(false);
    send("window:maximize", win.webContents);
    expect(win.maximize).toHaveBeenCalled();
    expect(await invoke("window:isMaximized", win.webContents)).toBe(true);
    send("window:maximize", win.webContents);
    expect(win.unmaximize).toHaveBeenCalled();
    expect(await invoke("window:isMaximized", win.webContents)).toBe(false);
  });

  it("forwards maximize state changes to the renderer", async () => {
    await loadMain();
    const win = mainWin();
    win.emit("maximize");
    win.emit("unmaximize");
    expect(win.webContents.send).toHaveBeenNthCalledWith(
      1,
      "window:maximized",
      true,
    );
    expect(win.webContents.send).toHaveBeenNthCalledWith(
      2,
      "window:maximized",
      false,
    );
  });

  it("closes the main window on window:close", async () => {
    await loadMain();
    const win = mainWin();
    send("window:close", win.webContents);
    expect(win.destroyed).toBe(true);
  });

  it("toggles devtools only for the main window of an unpackaged app", async () => {
    await loadMain();
    const win = mainWin();
    send("dev:toggle-devtools", stranger());
    expect(win.webContents.toggleDevTools).not.toHaveBeenCalled();
    send("dev:toggle-devtools", win.webContents);
    expect(win.webContents.toggleDevTools).toHaveBeenCalledTimes(1);
    fake.app.isPackaged = true;
    send("dev:toggle-devtools", win.webContents);
    expect(win.webContents.toggleDevTools).toHaveBeenCalledTimes(1);
  });

  it("shows the About box unparented once the main window is gone", async () => {
    await loadMain();
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      Object.defineProperty(process, "platform", { value: "linux" });
      fake.state.appListeners.get("window-all-closed")![0]();
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
    send("menu:about", stranger());
    expect(fake.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ title: "About cSlope" }),
    );
    expect(fake.dialog.showMessageBox.mock.calls[0]).toHaveLength(1);
  });

  it("opens the documentation in the browser, for the main window only", async () => {
    await loadMain();
    send("help:openDocumentation", stranger());
    expect(fake.shell.openExternal).not.toHaveBeenCalled();
    send("help:openDocumentation", mainWin().webContents);
    expect(fake.shell.openExternal).toHaveBeenCalledWith("https://cslope.com/docs");
  });

  it("shows the About box modal to the main window", async () => {
    await loadMain();
    const win = mainWin();
    send("menu:about", win.webContents);
    expect(fake.dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({ message: "cSlope v1.2.3" }),
    );
  });
});

// ── Dialog windows ────────────────────────────────────────────────

const DIALOGS: [channel: string, title: string, hash: string][] = [
  ["window:openMaterialsDialog", "Define Materials", "materials-dialog"],
  [
    "window:openMaterialAssignmentDialog",
    "Assign Materials",
    "material-assignment-dialog",
  ],
  ["window:openGeometryDialog", "Exterior Boundary", "geometry-dialog"],
  [
    "window:openInteriorBoundariesDialog",
    "Interior Boundaries",
    "interior-boundaries-dialog",
  ],
  ["window:openUdlDialog", "UDL", "udl-dialog"],
  ["window:openLineLoadsDialog", "Line Loads", "line-loads-dialog"],
  ["window:openReinforcementDialog", "Reinforcement", "reinforcement-dialog"],
  ["window:openPiezoDialog", "Piezometric Lines", "piezo-dialog"],
  ["window:openParametersDialog", "Parameters", "parameters-dialog"],
  ["window:openResultsPlotDialog", "Results Plot", "results-plot-dialog"],
  ["window:openSearchLimitsDialog", "Search limits", "search-limits-dialog"],
  [
    "window:openCustomSearchPlanesDialog",
    "Custom search planes",
    "custom-search-planes-dialog",
  ],
  ["window:openOptionsDialog", "Options", "options-dialog"],
  ["window:openViewSettingsDialog", "View Settings", "view-settings-dialog"],
];

function openDialog(channel: string): Win {
  const before = fake.FakeBrowserWindow.instances.length;
  send(channel, mainWin().webContents);
  const created = fake.FakeBrowserWindow.instances.slice(before);
  if (created.length !== 1) throw new Error(`${channel} created no window`);
  return created[0];
}

describe("dialog windows", () => {
  it.each(DIALOGS)(
    "%s opens one sandboxed child window, then refocuses it",
    async (channel, title, hash) => {
      await loadMain();
      const win = mainWin();
      const dlg = openDialog(channel);
      expect(dlg.options.title).toBe(title);
      expect(dlg.options.parent).toBe(win);
      expect(dlg.options.webPreferences).toMatchObject({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      });
      expect(dlg.loadFile).toHaveBeenCalledWith(
        expect.stringMatching(/index\.html$/),
        { hash },
      );

      const count = fake.FakeBrowserWindow.instances.length;
      send(channel, win.webContents);
      expect(fake.FakeBrowserWindow.instances).toHaveLength(count);
      expect(dlg.show).toHaveBeenCalled();
      expect(dlg.focus).toHaveBeenCalled();

      // Once closed, a new window is created.
      dlg.close();
      send(channel, win.webContents);
      expect(fake.FakeBrowserWindow.instances).toHaveLength(count + 1);
    },
  );

  it.each(DIALOGS)(
    "%s loads the dev server URL with its hash in development",
    async (channel, _title, hash) => {
      await loadMain({ VITE_DEV_SERVER_URL: "http://localhost:5173/" });
      const dlg = openDialog(channel);
      expect(dlg.loadURL).toHaveBeenCalledWith(
        `http://localhost:5173/#${hash}`,
      );
    },
  );

  it.each(DIALOGS)(
    "%s does nothing without a main window",
    async (channel) => {
      await loadMain();
      const win = mainWin();
      fake.state.appListeners.get("window-all-closed")![0]();
      const platform = process.platform;
      if (platform === "darwin") return; // win is kept on macOS
      const before = fake.FakeBrowserWindow.instances.length;
      send(channel, win.webContents);
      expect(fake.FakeBrowserWindow.instances).toHaveLength(before);
    },
  );

  it("tells the main window when the interior boundaries dialog opens and closes", async () => {
    await loadMain();
    const win = mainWin();
    const dlg = openDialog("window:openInteriorBoundariesDialog");
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      "interiorBoundaries:dialogOpenChanged",
      true,
    );
    win.webContents.send.mockClear();
    send("window:openInteriorBoundariesDialog", win.webContents);
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      "interiorBoundaries:dialogOpenChanged",
      true,
    );
    dlg.close();
    expect(win.webContents.send).toHaveBeenLastCalledWith(
      "interiorBoundaries:dialogOpenChanged",
      false,
    );
  });

  it("keeps the dialog titles but lets the main window take the page title", async () => {
    await loadMain();
    const win = mainWin();
    const dlg = openDialog("window:openPiezoDialog");
    const mainEvent = { preventDefault: vi.fn() };
    const dlgEvent = { preventDefault: vi.fn() };
    win.emit("page-title-updated", mainEvent);
    dlg.emit("page-title-updated", dlgEvent);
    expect(mainEvent.preventDefault).not.toHaveBeenCalled();
    expect(dlgEvent.preventDefault).toHaveBeenCalled();
  });
});

// ── Dialog state routing ──────────────────────────────────────────

/** Channels with one dialog window that syncs both ways. */
const PAIRS: [prefix: string, openChannel: string][] = [
  ["materials", "window:openMaterialsDialog"],
  ["materialAssignment", "window:openMaterialAssignmentDialog"],
  ["geometry", "window:openGeometryDialog"],
  ["interiorBoundaries", "window:openInteriorBoundariesDialog"],
  ["piezo", "window:openPiezoDialog"],
  ["parameters", "window:openParametersDialog"],
  ["viewSettings", "window:openViewSettingsDialog"],
];

describe("dialog window height", () => {
  it("fits a dialog to its content, within its opening height", async () => {
    await loadMain();
    const dlg = openDialog("window:openOptionsDialog");
    const open = dlg.contentHeight;
    send("window:fitDialogHeight", dlg.webContents, 300);
    expect(dlg.contentHeight).toBe(300);
    expect(dlg.minHeight).toBeLessThanOrEqual(330);
    // Content grows again (rows added): back up, but not past the opening height.
    send("window:fitDialogHeight", dlg.webContents, 5000);
    expect(dlg.contentHeight).toBe(open);
    // Never below 240 px.
    send("window:fitDialogHeight", dlg.webContents, 10);
    expect(dlg.contentHeight).toBe(240);
  });

  it("ignores the main window, other senders and non-numbers", async () => {
    await loadMain();
    const win = mainWin();
    const before = win.contentHeight;
    send("window:fitDialogHeight", win.webContents, 300);
    send("window:fitDialogHeight", stranger(), 300);
    expect(win.contentHeight).toBe(before);
    const dlg = openDialog("window:openOptionsDialog");
    const open = dlg.contentHeight;
    for (const bad of [Number.NaN, Infinity, "300", null]) {
      send("window:fitDialogHeight", dlg.webContents, bad);
    }
    expect(dlg.contentHeight).toBe(open);
  });

  it("stops fitting once the user has resized the window", async () => {
    await loadMain();
    const dlg = openDialog("window:openOptionsDialog");
    send("window:fitDialogHeight", dlg.webContents, 300);
    dlg.emit("will-resize", {});
    send("window:fitDialogHeight", dlg.webContents, 500);
    expect(dlg.contentHeight).toBe(300);
  });
});

describe("dialog state routing", () => {
  it.each(PAIRS)(
    "%s: routes requests, responses and changes between the main window and its dialog only",
    async (prefix, openChannel) => {
      await loadMain();
      const win = mainWin();
      const dlg = openDialog(openChannel);
      win.webContents.send.mockClear();
      const other = stranger();

      // Only the dialog may request the state.
      send(`${prefix}:requestState`, other);
      send(`${prefix}:requestState`, win.webContents);
      expect(win.webContents.send).not.toHaveBeenCalled();
      send(`${prefix}:requestState`, dlg.webContents);
      expect(win.webContents.send).toHaveBeenCalledWith(
        `${prefix}:requestState`,
      );

      // Only the main window may answer.
      send(`${prefix}:stateResponse`, other, { a: 1 });
      send(`${prefix}:stateResponse`, dlg.webContents, { a: 1 });
      expect(dlg.webContents.send).not.toHaveBeenCalled();
      send(`${prefix}:stateResponse`, win.webContents, { a: 2 });
      expect(dlg.webContents.send).toHaveBeenCalledWith(
        `${prefix}:stateResponse`,
        { a: 2 },
      );

      // Changes flow to the other side, never back to the sender.
      win.webContents.send.mockClear();
      dlg.webContents.send.mockClear();
      send(`${prefix}:changed`, dlg.webContents, "from-dialog");
      expect(win.webContents.send).toHaveBeenCalledWith(
        `${prefix}:changed`,
        "from-dialog",
      );
      expect(dlg.webContents.send).not.toHaveBeenCalled();
      send(`${prefix}:changed`, win.webContents, "from-main");
      expect(dlg.webContents.send).toHaveBeenCalledWith(
        `${prefix}:changed`,
        "from-main",
      );
      expect(win.webContents.send).toHaveBeenCalledTimes(1);

      // Strangers are ignored.
      win.webContents.send.mockClear();
      dlg.webContents.send.mockClear();
      send(`${prefix}:changed`, other, "x");
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(dlg.webContents.send).not.toHaveBeenCalled();
    },
  );

  it.each(PAIRS)(
    "%s: main window changes with no dialog open go nowhere",
    async (prefix) => {
      await loadMain();
      const win = mainWin();
      expect(() =>
        send(`${prefix}:changed`, win.webContents, 1),
      ).not.toThrow();
      expect(() =>
        send(`${prefix}:stateResponse`, win.webContents, 1),
      ).not.toThrow();
    },
  );

  it("results plot: the dialog requests, the main window answers and pushes changes", async () => {
    await loadMain();
    const win = mainWin();
    const dlg = openDialog("window:openResultsPlotDialog");
    win.webContents.send.mockClear();
    send("resultsPlot:requestState", win.webContents);
    expect(win.webContents.send).not.toHaveBeenCalled();
    send("resultsPlot:requestState", dlg.webContents);
    expect(win.webContents.send).toHaveBeenCalledWith(
      "resultsPlot:requestState",
    );
    send("resultsPlot:stateResponse", dlg.webContents, 1);
    expect(dlg.webContents.send).not.toHaveBeenCalled();
    send("resultsPlot:stateResponse", win.webContents, 2);
    expect(dlg.webContents.send).toHaveBeenCalledWith(
      "resultsPlot:stateResponse",
      2,
    );
    // The plot window is read-only: its "changes" are not forwarded.
    win.webContents.send.mockClear();
    send("resultsPlot:changed", dlg.webContents, 3);
    expect(win.webContents.send).not.toHaveBeenCalled();
    send("resultsPlot:changed", win.webContents, 4);
    expect(dlg.webContents.send).toHaveBeenLastCalledWith(
      "resultsPlot:changed",
      4,
    );
  });

  it("loads: UDL, line load and reinforcement windows share one channel", async () => {
    await loadMain();
    const win = mainWin();
    const udl = openDialog("window:openUdlDialog");
    const line = openDialog("window:openLineLoadsDialog");
    const reinf = openDialog("window:openReinforcementDialog");
    win.webContents.send.mockClear();

    send("loads:requestState", stranger());
    send("loads:requestState", win.webContents);
    expect(win.webContents.send).not.toHaveBeenCalled();
    for (const d of [udl, line, reinf]) send("loads:requestState", d.webContents);
    expect(win.webContents.send).toHaveBeenCalledTimes(3);

    send("loads:stateResponse", udl.webContents, "bad");
    expect(line.webContents.send).not.toHaveBeenCalled();
    send("loads:stateResponse", win.webContents, "s");
    for (const d of [udl, line, reinf]) {
      expect(d.webContents.send).toHaveBeenCalledWith("loads:stateResponse", "s");
    }

    for (const d of [win, udl, line, reinf]) d.webContents.send.mockClear();
    send("loads:changed", line.webContents, "c1");
    expect(win.webContents.send).toHaveBeenCalledWith("loads:changed", "c1");
    expect(udl.webContents.send).toHaveBeenCalledWith("loads:changed", "c1");
    expect(reinf.webContents.send).toHaveBeenCalledWith("loads:changed", "c1");
    expect(line.webContents.send).not.toHaveBeenCalled();

    for (const d of [win, udl, line, reinf]) d.webContents.send.mockClear();
    send("loads:changed", win.webContents, "c2");
    expect(win.webContents.send).not.toHaveBeenCalled();
    for (const d of [udl, line, reinf]) {
      expect(d.webContents.send).toHaveBeenCalledWith("loads:changed", "c2");
    }

    for (const d of [win, udl, line, reinf]) d.webContents.send.mockClear();
    send("loads:changed", stranger(), "c3");
    for (const d of [win, udl, line, reinf]) {
      expect(d.webContents.send).not.toHaveBeenCalled();
    }
  });

  it("loads: a closed loads window is no longer accepted or notified", async () => {
    await loadMain();
    const win = mainWin();
    const udl = openDialog("window:openUdlDialog");
    const line = openDialog("window:openLineLoadsDialog");
    const udlContents = udl.webContents;
    udl.close();
    win.webContents.send.mockClear();
    send("loads:requestState", udlContents);
    expect(win.webContents.send).not.toHaveBeenCalled();
    send("loads:changed", win.webContents, "x");
    expect(line.webContents.send).toHaveBeenCalledWith("loads:changed", "x");
    expect(udlContents.send).not.toHaveBeenCalledWith("loads:changed", "x");
  });

  it("analysis: search limits, custom planes and options windows share one channel", async () => {
    await loadMain();
    const win = mainWin();
    const limits = openDialog("window:openSearchLimitsDialog");
    const planes = openDialog("window:openCustomSearchPlanesDialog");
    const options = openDialog("window:openOptionsDialog");
    win.webContents.send.mockClear();

    send("analysis:requestState", stranger());
    send("analysis:requestState", win.webContents);
    expect(win.webContents.send).not.toHaveBeenCalled();
    for (const d of [limits, planes, options]) {
      send("analysis:requestState", d.webContents);
    }
    expect(win.webContents.send).toHaveBeenCalledTimes(3);

    send("analysis:stateResponse", planes.webContents, "bad");
    expect(limits.webContents.send).not.toHaveBeenCalled();
    send("analysis:stateResponse", win.webContents, "s");
    for (const d of [limits, planes, options]) {
      expect(d.webContents.send).toHaveBeenCalledWith(
        "analysis:stateResponse",
        "s",
      );
    }

    for (const sender of [limits, planes, options]) {
      for (const d of [win, limits, planes, options]) {
        d.webContents.send.mockClear();
      }
      send("analysis:changed", sender.webContents, "c");
      expect(win.webContents.send).toHaveBeenCalledWith("analysis:changed", "c");
      for (const d of [limits, planes, options]) {
        if (d === sender) expect(d.webContents.send).not.toHaveBeenCalled();
        else {
          expect(d.webContents.send).toHaveBeenCalledWith(
            "analysis:changed",
            "c",
          );
        }
      }
    }

    for (const d of [win, limits, planes, options]) d.webContents.send.mockClear();
    send("analysis:changed", win.webContents, "m");
    expect(win.webContents.send).not.toHaveBeenCalled();
    for (const d of [limits, planes, options]) {
      expect(d.webContents.send).toHaveBeenCalledWith("analysis:changed", "m");
    }

    for (const d of [win, limits, planes, options]) d.webContents.send.mockClear();
    send("analysis:changed", stranger(), "x");
    for (const d of [win, limits, planes, options]) {
      expect(d.webContents.send).not.toHaveBeenCalled();
    }
  });
});

// ── Navigation guards ─────────────────────────────────────────────

describe("navigation guards", () => {
  it("blocks navigation away from the app page but allows reloads and hash changes", async () => {
    await loadMain();
    const contents = mainWin().webContents;
    contents.url = "file:///app/dist/index.html#materials-dialog";
    const [navigate] = contents.listeners.get("will-navigate")!;

    const blocked = { preventDefault: vi.fn() };
    navigate(blocked, "file:///home/user/evil.html");
    expect(blocked.preventDefault).toHaveBeenCalled();

    const remote = { preventDefault: vi.fn() };
    navigate(remote, "https://example.com/");
    expect(remote.preventDefault).toHaveBeenCalled();

    const reload = { preventDefault: vi.fn() };
    navigate(reload, "file:///app/dist/index.html");
    expect(reload.preventDefault).not.toHaveBeenCalled();

    const hash = { preventDefault: vi.fn() };
    navigate(hash, "file:///app/dist/index.html#other");
    expect(hash.preventDefault).not.toHaveBeenCalled();
  });

  it("denies every new window", async () => {
    await loadMain();
    const win = mainWin();
    const dlg = openDialog("window:openOptionsDialog");
    for (const c of [win.webContents, dlg.webContents]) {
      expect(c.windowOpenHandler?.()).toEqual({ action: "deny" });
    }
  });
});

// ── Close guard and reloads ───────────────────────────────────────

describe("close guard", () => {
  it("closes at once while the renderer has not registered its guard", async () => {
    await loadMain();
    const win = mainWin();
    win.close();
    expect(win.destroyed).toBe(true);
    expect(win.webContents.send).not.toHaveBeenCalledWith(
      "app:closeRequested",
    );
  });

  it("asks the renderer first, then closes once it confirms", async () => {
    await loadMain();
    const win = mainWin();
    send("app:closeGuardReady", win.webContents);
    win.close();
    expect(win.destroyed).toBe(false);
    expect(win.webContents.send).toHaveBeenCalledWith("app:closeRequested");

    // A dialog cannot confirm on the main window's behalf.
    const dlg = openDialog("window:openOptionsDialog");
    send("app:closeConfirmed", dlg.webContents);
    expect(win.destroyed).toBe(false);

    send("app:closeConfirmed", win.webContents);
    expect(win.destroyed).toBe(true);
  });

  it("ignores guard registration from other windows", async () => {
    await loadMain();
    const win = mainWin();
    send("app:closeGuardReady", stranger());
    win.close();
    expect(win.destroyed).toBe(true);
  });

  it("does not block a crashed or destroyed renderer", async () => {
    await loadMain();
    let win = mainWin();
    send("app:closeGuardReady", win.webContents);
    win.webContents.crashed = true;
    win.close();
    expect(win.destroyed).toBe(true);

    await loadMain();
    win = mainWin();
    send("app:closeGuardReady", win.webContents);
    win.webContents.destroyed = true;
    win.close();
    expect(win.destroyed).toBe(true);
  });

  it("never blocks automated capture", async () => {
    await loadMain({ CSLOPE_CAPTURE: "1" });
    const win = mainWin();
    send("app:closeGuardReady", win.webContents);
    win.close();
    expect(win.destroyed).toBe(true);
  });

  it("drops the guard, file path and title when the page reloads", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cslope-main-"));
    try {
      await loadMain();
      const win = mainWin();
      send("app:closeGuardReady", win.webContents);
      const file = path.join(dir, "Slope.json");
      fs.writeFileSync(file, "{}");
      await invoke("file:openPath", win.webContents, file);
      send("file:openConfirmed", win.webContents);
      expect(win.title).toBe("Slope — cSlope");

      win.webContents.emit("did-start-loading");
      expect(win.title).toBe("cSlope");
      // A pending open from before the reload is forgotten too.
      send("file:openConfirmed", win.webContents);
      expect(win.title).toBe("cSlope");
      // Save now asks for a path instead of overwriting the old file.
      await invoke("dialog:saveFile", win.webContents, "{}");
      expect(fake.dialog.showSaveDialog).toHaveBeenCalled();
      win.close();
      expect(win.destroyed).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("offers a reload after a renderer crash", async () => {
    await loadMain();
    const win = mainWin();
    send("app:closeGuardReady", win.webContents);
    fake.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    await flush();
    expect(fake.dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        type: "error",
        detail: expect.stringContaining("crashed"),
      }),
    );
    expect(win.reload).toHaveBeenCalled();
    // The crashed renderer can no longer answer the close guard.
    win.close();
    expect(win.destroyed).toBe(true);
  });

  it("closes after a renderer crash when the user picks Close", async () => {
    await loadMain();
    const win = mainWin();
    fake.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    win.webContents.emit("render-process-gone", {}, { reason: "oom" });
    await flush();
    expect(win.reload).not.toHaveBeenCalled();
    expect(win.destroyed).toBe(true);
  });

  it("ignores a clean renderer exit", async () => {
    await loadMain();
    const win = mainWin();
    win.webContents.emit("render-process-gone", {}, { reason: "clean-exit" });
    await flush();
    expect(fake.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it.each([
    [0, "save"],
    [1, "discard"],
    [2, "cancel"],
  ])("maps unsaved-changes button %i to %s", async (response, answer) => {
    await loadMain();
    const win = mainWin();
    fake.dialog.showMessageBox.mockResolvedValueOnce({ response });
    expect(await invoke("dialog:unsavedChanges", win.webContents)).toBe(answer);
    expect(fake.dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        message: "Do you want to save the changes to Untitled?",
        cancelId: 2,
      }),
    );
  });

  it("names the current file in the unsaved-changes prompt and refuses strangers", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cslope-main-"));
    try {
      await loadMain();
      const win = mainWin();
      expect(await invoke("dialog:unsavedChanges", stranger())).toBe("cancel");
      expect(fake.dialog.showMessageBox).not.toHaveBeenCalled();
      const file = path.join(dir, "Dam.cslope");
      fs.writeFileSync(file, "{}");
      await invoke("file:openPath", win.webContents, file);
      send("file:openConfirmed", win.webContents);
      await invoke("dialog:unsavedChanges", win.webContents);
      expect(fake.dialog.showMessageBox).toHaveBeenCalledWith(
        win,
        expect.objectContaining({
          message: "Do you want to save the changes to Dam?",
        }),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Opening files ─────────────────────────────────────────────────

describe("opening files", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cslope-open-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a dropped project and makes it the save target only once confirmed", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "Slope.JSON");
    fs.writeFileSync(file, '{"v":1}');
    expect(await invoke("file:openPath", win.webContents, file)).toBe(
      '{"v":1}',
    );
    expect(win.title).toBe("");

    // Not yet confirmed: Save asks for a path.
    await invoke("dialog:saveFile", win.webContents, "x");
    expect(fake.dialog.showSaveDialog).toHaveBeenCalledTimes(1);

    send("file:openConfirmed", win.webContents);
    expect(win.title).toBe("Slope — cSlope");
    await invoke("dialog:saveFile", win.webContents, "saved");
    expect(fake.dialog.showSaveDialog).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(file, "utf-8")).toBe("saved");
  });

  it("accepts .cslope files", async () => {
    await loadMain();
    const file = path.join(dir, "a.cslope");
    fs.writeFileSync(file, "c");
    expect(await invoke("file:openPath", mainWin().webContents, file)).toBe(
      "c",
    );
  });

  it("refuses other senders, other extensions, directories, missing and oversized files", async () => {
    await loadMain();
    const win = mainWin();
    const good = path.join(dir, "ok.json");
    fs.writeFileSync(good, "{}");
    expect(await invoke("file:openPath", stranger(), good)).toBeNull();

    const html = path.join(dir, "page.html");
    fs.writeFileSync(html, "<html>");
    expect(await invoke("file:openPath", win.webContents, html)).toBeNull();

    const folder = path.join(dir, "folder.json");
    fs.mkdirSync(folder);
    expect(await invoke("file:openPath", win.webContents, folder)).toBeNull();

    expect(
      await invoke("file:openPath", win.webContents, path.join(dir, "no.json")),
    ).toBeNull();

    const big = path.join(dir, "big.json");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 50 * 1024 * 1024 + 1);
    expect(await invoke("file:openPath", win.webContents, big)).toBeNull();

    // Exactly at the cap is still accepted.
    fs.truncateSync(big, 50 * 1024 * 1024);
    const atCap = await invoke("file:openPath", win.webContents, big);
    expect(typeof atCap).toBe("string");
  });

  it("returns null when the file cannot be read and keeps the previous target", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "locked.json");
    fs.writeFileSync(file, "{}");
    vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("locked"), { code: "EACCES" });
    });
    expect(await invoke("file:openPath", win.webContents, file)).toBeNull();
    send("file:openConfirmed", win.webContents);
    expect(win.title).toBe("");
  });

  it("ignores openConfirmed from other windows or without a pending open", async () => {
    await loadMain();
    const win = mainWin();
    send("file:openConfirmed", win.webContents);
    expect(win.setTitle).not.toHaveBeenCalled();
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, "{}");
    await invoke("file:openPath", win.webContents, file);
    send("file:openConfirmed", stranger());
    expect(win.setTitle).not.toHaveBeenCalled();
  });

  it("an unconfirmed open does not survive a cancelled open or File > New", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "Old.json");
    fs.writeFileSync(file, "{}");
    // Read but never confirmed (e.g. the project failed to parse)...
    await invoke("file:openPath", win.webContents, file);
    // ...then the user cancels the next open dialog:
    fake.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke("dialog:openFile", win.webContents)).toBeNull();
    send("file:openConfirmed", win.webContents);
    expect(win.setTitle).not.toHaveBeenCalled();
    // File > New clears it too.
    await invoke("file:openPath", win.webContents, file);
    send("menu:new", win.webContents);
    vi.mocked(win.setTitle).mockClear();
    send("file:openConfirmed", win.webContents);
    expect(win.setTitle).not.toHaveBeenCalled();
  });

  it("opens through the native dialog", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "Bank.json");
    fs.writeFileSync(file, "bank");
    fake.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [file],
    });
    expect(await invoke("dialog:openFile", win.webContents)).toBe("bank");
    expect(fake.dialog.showOpenDialog).toHaveBeenCalledWith(
      win,
      expect.objectContaining({ properties: ["openFile"] }),
    );
    send("file:openConfirmed", win.webContents);
    expect(win.title).toBe("Bank — cSlope");
  });

  it("returns null when the open dialog is cancelled or used by another window", async () => {
    await loadMain();
    const win = mainWin();
    expect(await invoke("dialog:openFile", stranger())).toBeNull();
    expect(fake.dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(await invoke("dialog:openFile", win.webContents)).toBeNull();
    fake.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [],
    });
    expect(await invoke("dialog:openFile", win.webContents)).toBeNull();
  });

  it("reports unreadable and oversized files from the open dialog", async () => {
    await loadMain();
    const win = mainWin();
    fake.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [path.join(dir, "gone.json")],
    });
    expect(await invoke("dialog:openFile", win.webContents)).toBeNull();
    expect(fake.dialog.showErrorBox).toHaveBeenCalledWith(
      "Could not open file",
      expect.stringContaining("ENOENT"),
    );

    const big = path.join(dir, "big.json");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 50 * 1024 * 1024 + 1);
    fake.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [big],
    });
    expect(await invoke("dialog:openFile", win.webContents)).toBeNull();
    expect(fake.dialog.showErrorBox).toHaveBeenLastCalledWith(
      "Could not open file",
      "The file is too large to be a cSlope project.",
    );
    // Nothing became the save target.
    send("file:openConfirmed", win.webContents);
    expect(win.title).toBe("");
  });

  it("stringifies non-Error failures from the open dialog", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "x.json");
    fs.writeFileSync(file, "{}");
    fake.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [file],
    });
    vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw "boom";
    });
    expect(await invoke("dialog:openFile", win.webContents)).toBeNull();
    expect(fake.dialog.showErrorBox).toHaveBeenCalledWith(
      "Could not open file",
      "boom",
    );
  });

  it("File > New forgets the save target", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, "{}");
    await invoke("file:openPath", win.webContents, file);
    send("file:openConfirmed", win.webContents);
    send("menu:new", stranger());
    expect(win.title).toBe("a — cSlope");
    send("menu:new", win.webContents);
    expect(win.title).toBe("cSlope");
    await invoke("dialog:saveFile", win.webContents, "new");
    expect(fake.dialog.showSaveDialog).toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf-8")).toBe("{}");
  });
});

// ── Saving ────────────────────────────────────────────────────────

describe("saving", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cslope-save-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const leftovers = () => fs.readdirSync(dir).filter((f) => f.includes(".tmp-"));

  async function saveAsTo(file: string, content: string) {
    fake.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: file,
    });
    return invoke("dialog:saveFileAs", mainWin().webContents, content);
  }

  it("Save As writes a new file, sets the title and becomes the save target", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "New Slope.json");
    expect(await saveAsTo(file, "one")).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("one");
    expect(win.title).toBe("New Slope — cSlope");
    expect(fake.dialog.showSaveDialog).toHaveBeenCalledWith(
      win,
      expect.objectContaining({ defaultPath: "cslope-project.json" }),
    );
    expect(leftovers()).toEqual([]);

    expect(await invoke("dialog:saveFile", win.webContents, "two")).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("two");
    expect(fake.dialog.showSaveDialog).toHaveBeenCalledTimes(1);

    // Save As again proposes the current path.
    await invoke("dialog:saveFileAs", win.webContents, "three");
    expect(fake.dialog.showSaveDialog).toHaveBeenLastCalledWith(
      win,
      expect.objectContaining({ defaultPath: file }),
    );
  });

  it("Save without a path falls through to Save As; cancelling saves nothing", async () => {
    await loadMain();
    const win = mainWin();
    expect(await invoke("dialog:saveFile", win.webContents, "x")).toBe(false);
    fake.dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: "",
    });
    expect(await invoke("dialog:saveFile", win.webContents, "x")).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("refuses saves from other windows", async () => {
    await loadMain();
    expect(await invoke("dialog:saveFile", stranger(), "x")).toBe(false);
    expect(await invoke("dialog:saveFileAs", stranger(), "x")).toBe(false);
    expect(fake.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  it("writes through a temporary file that is flushed before the rename", async () => {
    await loadMain();
    const file = path.join(dir, "p.json");
    fs.writeFileSync(file, "old");
    const order: string[] = [];
    const open = vi.spyOn(fs, "openSync");
    vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      order.push("fsync");
    });
    const rename = vi.spyOn(fs, "renameSync");
    rename.mockImplementation((from, to) => {
      order.push("rename");
      // The target is untouched until the rename.
      expect(fs.readFileSync(file, "utf-8")).toBe("old");
      expect(fs.readFileSync(from as string, "utf-8")).toBe("new");
      vi.mocked(fs.renameSync).mockRestore();
      fs.renameSync(from, to);
    });
    expect(await saveAsTo(file, "new")).toBe(true);
    expect(order).toEqual(["fsync", "rename"]);
    // An unguessable temporary name, created exclusively.
    expect(open.mock.calls[0][0]).toMatch(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.tmp-[0-9a-f]{16}$`));
    expect(open.mock.calls[0][1]).toBe("wx");
    expect(fs.readFileSync(file, "utf-8")).toBe("new");
    expect(leftovers()).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps the file's permissions",
    async () => {
      await loadMain();
      const file = path.join(dir, "p.json");
      fs.writeFileSync(file, "old");
      fs.chmodSync(file, 0o640);
      expect(await saveAsTo(file, "new")).toBe(true);
      expect(fs.statSync(file).mode & 0o777).toBe(0o640);
      expect(fs.readFileSync(file, "utf-8")).toBe("new");
    },
  );

  it("refuses to replace a read-only file and leaves it untouched", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "ro.json");
    fs.writeFileSync(file, "keep");
    // Root can write anything, so simulate the permission check.
    vi.spyOn(fs, "accessSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    });
    await expect(saveAsTo(file, "lost")).rejects.toThrow("EACCES");
    expect(fs.readFileSync(file, "utf-8")).toBe("keep");
    expect(leftovers()).toEqual([]);
    expect(win.title).toBe("");
  });

  it.skipIf(process.platform === "win32")(
    "saves through a symlink without replacing the link",
    async () => {
      await loadMain();
      const real = path.join(dir, "real.json");
      const link = path.join(dir, "link.json");
      fs.writeFileSync(real, "old");
      fs.symlinkSync(real, link);
      expect(await saveAsTo(link, "new")).toBe(true);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(real, "utf-8")).toBe("new");
      expect(mainWin().title).toBe("link — cSlope");
    },
  );

  it.each(["EPERM", "EBUSY", "EXDEV"])(
    "falls back to an in-place write when the rename fails with %s",
    async (code) => {
      await loadMain();
      const file = path.join(dir, "held.json");
      fs.writeFileSync(file, "old");
      vi.spyOn(fs, "renameSync").mockImplementation(() => {
        throw Object.assign(new Error(code), { code });
      });
      expect(await saveAsTo(file, "new")).toBe(true);
      expect(fs.readFileSync(file, "utf-8")).toBe("new");
      expect(leftovers()).toEqual([]);
    },
  );

  it("fails on other rename errors, keeping the original and removing the temp file", async () => {
    await loadMain();
    const win = mainWin();
    const file = path.join(dir, "p.json");
    fs.writeFileSync(file, "old");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });
    await expect(saveAsTo(file, "new")).rejects.toThrow("EACCES");
    expect(fs.readFileSync(file, "utf-8")).toBe("old");
    expect(leftovers()).toEqual([]);
    expect(win.title).toBe("");
  });

  it("keeps the original when writing the temporary file fails (disk full)", async () => {
    await loadMain();
    const file = path.join(dir, "p.json");
    fs.writeFileSync(file, "old");
    const real = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((target, ...rest) => {
      if (typeof target === "number") {
        throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
      }
      return real(target, ...(rest as [string]));
    });
    await expect(saveAsTo(file, "new")).rejects.toThrow("ENOSPC");
    expect(fs.readFileSync(file, "utf-8")).toBe("old");
    expect(leftovers()).toEqual([]);
  });

  it("propagates unexpected stat errors without writing", async () => {
    await loadMain();
    const file = path.join(dir, "p.json");
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    });
    await expect(saveAsTo(file, "new")).rejects.toThrow("EIO");
    expect(fs.existsSync(file)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it("still reports the original error when the temp file cannot be removed", async () => {
    await loadMain();
    const file = path.join(dir, "p.json");
    vi.spyOn(fs, "openSync").mockImplementation(() => {
      throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
    });
    const unlink = vi.spyOn(fs, "unlinkSync");
    await expect(saveAsTo(file, "new")).rejects.toThrow("EMFILE");
    expect(unlink).toHaveBeenCalledWith(expect.stringMatching(/\.tmp-[0-9a-f]{16}$/));
  });
});

// ── Preload / main channel contract ───────────────────────────────

describe("preload channel contract", () => {
  it("every channel the preload sends or invokes has a main-process handler, and vice versa", async () => {
    await loadMain();
    await import("./preload");
    const api = fake.exposed.cslope;
    fake.ipcRenderer.send.mockClear();
    fake.ipcRenderer.invoke.mockClear();
    for (const [name, fn] of Object.entries(api)) {
      if (/^on[A-Z]/.test(name)) continue; // subscriptions
      await fn("arg");
    }
    const sent = new Set(fake.ipcRenderer.send.mock.calls.map((c) => c[0]));
    const invoked = new Set(
      fake.ipcRenderer.invoke.mock.calls.map((c) => c[0] as string),
    );
    expect([...sent].filter((c) => !fake.state.on.has(c))).toEqual([]);
    expect([...invoked].filter((c) => !fake.state.handle.has(c))).toEqual([]);
    expect([...fake.state.on.keys()].filter((c) => !sent.has(c))).toEqual([]);
    expect(
      [...fake.state.handle.keys()].filter((c) => !invoked.has(c)),
    ).toEqual([]);
  });
});
