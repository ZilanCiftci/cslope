// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

const fake = vi.hoisted(() => {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const ipcRenderer = {
    send: vi.fn(),
    invoke: vi.fn<(...args: any[]) => Promise<any>>(async () => "result"),
    on: vi.fn((channel: string, fn: (...args: any[]) => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), fn]);
    }),
    off: vi.fn((channel: string, fn: (...args: any[]) => void) => {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((l) => l !== fn),
      );
    }),
  };
  const exposed: Record<string, Record<string, (...args: any[]) => any>> = {};
  const contextBridge = {
    exposeInMainWorld: vi.fn((key: string, api: any) => {
      exposed[key] = api;
    }),
  };
  const emit = (channel: string, ...args: any[]) => {
    for (const fn of listeners.get(channel) ?? []) fn(...args);
  };
  // The native path of a dropped file ("" for a File made by the page).
  const webUtils = {
    getPathForFile: vi.fn((file: any) => (typeof file === "string" ? "/dropped/" + file : (file?.nativePath ?? ""))),
  };
  return { ipcRenderer, contextBridge, webUtils, exposed, listeners, emit };
});

vi.mock("electron", () => ({
  ipcRenderer: fake.ipcRenderer,
  contextBridge: fake.contextBridge,
  webUtils: fake.webUtils,
  default: { ipcRenderer: fake.ipcRenderer, contextBridge: fake.contextBridge, webUtils: fake.webUtils },
}));

// ── Expected API ──────────────────────────────────────────────────

type Kind = "send" | "invoke" | "on";
const EXPECTED: Record<string, [Kind, string]> = {
  openFile: ["invoke", "dialog:openFile"],
  openDroppedFile: ["invoke", "file:openPath"],
  onOpenFileRequested: ["on", "file:openRequested"],
  openRequestedFile: ["invoke", "file:openRequested"],
  confirmFileOpened: ["send", "file:openConfirmed"],
  onFileNameChanged: ["on", "file:nameChanged"],
  askUnsavedChanges: ["invoke", "dialog:unsavedChanges"],
  closeGuardReady: ["send", "app:closeGuardReady"],
  closeGuardReleased: ["send", "app:closeGuardReleased"],
  confirmClose: ["send", "app:closeConfirmed"],
  onCloseRequested: ["on", "app:closeRequested"],
  saveFile: ["invoke", "dialog:saveFile"],
  saveFileAs: ["invoke", "dialog:saveFileAs"],
  saveCopy: ["invoke", "dialog:saveCopy"],
  minimize: ["send", "window:minimize"],
  maximize: ["send", "window:maximize"],
  close: ["send", "window:close"],
  requestSelectionState: ["send", "selection:requestState"],
  sendSelectionChanged: ["send", "selection:changed"],
  onSelectionRequestState: ["on", "selection:requestState"],
  onSelectionChanged: ["on", "selection:changed"],
  isMaximized: ["invoke", "window:isMaximized"],
  onMaximized: ["on", "window:maximized"],
  appReady: ["send", "app:ready"],
  fitDialogHeight: ["send", "window:fitDialogHeight"],
  menuNew: ["send", "menu:new"],
  menuAbout: ["send", "menu:about"],
  openDocumentation: ["send", "help:openDocumentation"],
  toggleDevTools: ["send", "dev:toggle-devtools"],
};

const DIALOG_OPENERS = [
  "Materials",
  "MaterialAssignment",
  "Geometry",
  "InteriorBoundaries",
  "Udl",
  "LineLoads",
  "Reinforcement",
  "Piezo",
  "Parameters",
  "ResultsPlot",
  "SearchLimits",
  "CustomSearchPlanes",
  "Options",
  "Sensitivity",
  "Reliability",
  "PlaceDrawing",
];
for (const name of DIALOG_OPENERS) {
  EXPECTED[`open${name}Dialog`] = ["send", `window:open${name}Dialog`];
}

const SYNC_FAMILIES = [
  "Materials",
  "MaterialAssignment",
  "Geometry",
  "InteriorBoundaries",
  "Loads",
  "Piezo",
  "Parameters",
  "ResultsPlot",
  "Analysis",
];
// Tool windows: the window sends commands, the main window is told when it closes.
for (const name of ["Sensitivity", "Reliability", "Drawing"]) {
  const prefix = name.toLowerCase();
  for (const [key, channel] of [["RequestState", "requestState"], ["State", "stateResponse"], ["Changed", "changed"]]) {
    EXPECTED[`on${name}${key}`] = ["on", `${prefix}:${channel}`];
  }
  EXPECTED[`request${name}State`] = ["send", `${prefix}:requestState`];
  EXPECTED[`send${name}State`] = ["send", `${prefix}:stateResponse`];
  EXPECTED[`send${name}Changed`] = ["send", `${prefix}:changed`];
  EXPECTED[`send${name}Command`] = ["send", `${prefix}:command`];
  EXPECTED[`on${name}Command`] = ["on", `${prefix}:command`];
  EXPECTED[`on${name}Closed`] = ["on", `${prefix}:closed`];
}
// The Place drawing window also gets the drawing files it asks for.
EXPECTED.sendDrawingAsset = ["send", "drawing:asset"];
EXPECTED.onDrawingAsset = ["on", "drawing:asset"];

for (const name of SYNC_FAMILIES) {
  const prefix = name[0].toLowerCase() + name.slice(1);
  EXPECTED[`request${name}State`] = ["send", `${prefix}:requestState`];
  EXPECTED[`send${name}State`] = ["send", `${prefix}:stateResponse`];
  EXPECTED[`send${name}Changed`] = ["send", `${prefix}:changed`];
  EXPECTED[`on${name}RequestState`] = ["on", `${prefix}:requestState`];
  EXPECTED[`on${name}State`] = ["on", `${prefix}:stateResponse`];
  EXPECTED[`on${name}Changed`] = ["on", `${prefix}:changed`];
}

let api: Record<string, (...args: any[]) => any>;
// How often the preload exposed an API when it loaded, counted here: mock
// call history is cleared before each test (clearMocks).
let exposeCalls = 0;

beforeAll(async () => {
  await import("./preload");
  api = fake.exposed.cslope;
  exposeCalls = fake.contextBridge.exposeInMainWorld.mock.calls.length;
});

beforeEach(() => {
  fake.ipcRenderer.send.mockClear();
  fake.ipcRenderer.invoke.mockClear();
  fake.ipcRenderer.on.mockClear();
  fake.ipcRenderer.off.mockClear();
});

describe("preload", () => {
  it("exposes exactly the scoped cslope API, never ipcRenderer itself", () => {
    expect(exposeCalls).toBe(1);
    expect(Object.keys(fake.exposed)).toEqual(["cslope"]);
    expect(Object.keys(api).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const fn of Object.values(api)) expect(typeof fn).toBe("function");
  });

  it.each(
    Object.entries(EXPECTED).filter(([, [kind]]) => kind === "send"),
  )("%s sends on its channel with the given payload", (method, [, channel]) => {
    const payload = { method };
    api[method](payload);
    expect(fake.ipcRenderer.send).toHaveBeenCalledTimes(1);
    const call = fake.ipcRenderer.send.mock.calls[0];
    expect(call[0]).toBe(channel);
    // Payload-carrying methods forward it; the rest send the bare channel.
    if (call.length > 1) expect(call).toEqual([channel, payload]);
    expect(fake.ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  it("forwards the payload of every state and change message", () => {
    for (const name of SYNC_FAMILIES) {
      const prefix = name[0].toLowerCase() + name.slice(1);
      api[`send${name}State`]("s");
      api[`send${name}Changed`]("c");
      expect(fake.ipcRenderer.send).toHaveBeenCalledWith(
        `${prefix}:stateResponse`,
        "s",
      );
      expect(fake.ipcRenderer.send).toHaveBeenCalledWith(
        `${prefix}:changed`,
        "c",
      );
    }
  });

  it.each(
    Object.entries(EXPECTED).filter(([, [kind]]) => kind === "invoke"),
  )("%s invokes its channel and returns the main process answer", async (method, [, channel]) => {
    await expect(api[method]("arg")).resolves.toBe("result");
    const call = fake.ipcRenderer.invoke.mock.calls[0];
    expect(call[0]).toBe(channel);
  });

  it("reads a dropped file by the native path of the File, never one the page names", async () => {
    await expect(api.openDroppedFile({ nativePath: "" })).resolves.toBeNull();
    expect(fake.ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  it("passes the path and content to the file handlers", async () => {
    await api.openDroppedFile({ nativePath: "/tmp/a.json" });
    const data = new Uint8Array([0x50, 0x4b]);
    await api.saveFile(data, "Dam.cslp");
    await api.saveFileAs(data);
    expect(fake.ipcRenderer.invoke.mock.calls).toEqual([
      ["file:openPath", "/tmp/a.json"],
      ["dialog:saveFile", data, "Dam.cslp"],
      ["dialog:saveFileAs", data, undefined],
    ]);
  });

  it.each(
    Object.entries(EXPECTED).filter(([, [kind]]) => kind === "on"),
  )("%s subscribes and its returned function unsubscribes exactly that listener", (method, [, channel]) => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = api[method](first);
    const offSecond = api[method](second);
    expect(typeof offFirst).toBe("function");

    const event = { sender: "main" };
    fake.emit(channel, event, "payload", 2);
    expect(first).toHaveBeenCalledWith(event, "payload", 2);
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
    fake.emit(channel, event, "again");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    offSecond();
    expect(fake.listeners.get(channel)).toEqual([]);
    // The exact wrapper that was registered is the one removed.
    expect(fake.ipcRenderer.off.mock.calls.map((c) => c[1])).toEqual(
      fake.ipcRenderer.on.mock.calls.map((c) => c[1]),
    );
  });
});
