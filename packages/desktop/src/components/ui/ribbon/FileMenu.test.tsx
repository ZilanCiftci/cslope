import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock("../../../utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/download")>()),
  downloadFile: mocks.downloadFile,
}));

import { FileMenu } from "./FileMenu";
import { markProjectClean, useAppStore } from "../../../store/app-store";

const store = () => useAppStore.getState();

const dxf = (pairs: (string | number)[][]) =>
  pairs.map(([c, v]) => `${c}\n${v}`).join("\n") + "\n";
const OUTLINE_DXF = dxf([
  [0, "SECTION"], [2, "ENTITIES"],
  [0, "LWPOLYLINE"], [8, "outline"], [90, 4], [70, 1],
  [10, 0], [20, 0], [10, 0], [20, 10], [10, 30], [20, 10], [10, 30], [20, 0],
  [0, "ENDSEC"], [0, "EOF"],
]);

/** Captures file inputs that the menu clicks (pickers it creates). */
function capturePickers() {
  const pickers: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    pickers.push(this);
  });
  return pickers;
}

function choose(input: HTMLInputElement, name: string, content: string) {
  const file = new File([content], name);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
}

function renderMenu(name?: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return render(
    <FileMenu activeModelName={name} isOpen onActivate={() => {}} panelHost={host} />,
  );
}

beforeEach(() => {
  store().newProject();
  markProjectClean(store());
  mocks.downloadFile.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("FileMenu in a browser", () => {
  it("downloads the project named after the model on Save", async () => {
    renderMenu("Slope A");
    await userEvent.click(screen.getByTitle("Save (Ctrl+S)"));
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1);
    const [name, json, type] = mocks.downloadFile.mock.calls[0];
    expect(name).toBe("Slope A.json");
    expect(type).toBe("application/json");
    expect(JSON.parse(json as string)).toHaveProperty("models");
  });

  it("asks for a name on Save As and keeps it for later saves", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("my project");
    renderMenu();
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledTimes(1));
    expect(prompt).toHaveBeenCalledWith("Save project as", "cslope-project");
    expect(mocks.downloadFile.mock.calls[0][0]).toBe("my project.json");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledTimes(2));
    expect(mocks.downloadFile.mock.calls[1][0]).toBe("my project.json");
  });

  it("does nothing when Save As is cancelled", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    renderMenu();
    await userEvent.click(screen.getByTitle("Save As (Ctrl+Shift+S)"));
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("opens a project file chosen in the file picker", async () => {
    const pickers = capturePickers();
    const { container } = renderMenu();
    await userEvent.click(screen.getByTitle("Open (Ctrl+O)"));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(pickers).toContain(input);
    // A saved copy of a project with an extra model.
    store().addModel("Second");
    store().saveCurrentModel();
    const { buildProjectJson } = await import("../../../features/project/actions");
    const json = buildProjectJson(store());
    store().newProject();
    choose(input, "p.json", json);
    fireEvent.change(input);
    await waitFor(() => expect(store().models.map((m) => m.name)).toContain("Second"));
  });

  it("imports a DXF outline as a new model and reports it", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const pickers = capturePickers();
    renderMenu();
    await userEvent.click(screen.getByTitle("Import DXF"));
    const picker = pickers.at(-1)!;
    expect(picker.accept).toBe(".dxf");
    choose(picker, "Section 1.dxf", OUTLINE_DXF);
    picker.onchange?.(new Event("change"));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    const active = store().models.find((m) => m.id === store().activeModelId)!;
    expect(active.name).toBe("Section 1");
    expect(store().coordinates).toHaveLength(4);
  });

  it("reports a DXF that cannot be imported", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const pickers = capturePickers();
    renderMenu();
    await userEvent.click(screen.getByTitle("Import DXF"));
    const picker = pickers.at(-1)!;
    choose(picker, "empty.dxf", dxf([[0, "SECTION"], [2, "ENTITIES"], [0, "ENDSEC"], [0, "EOF"]]));
    picker.onchange?.(new Event("change"));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls[0][0])).toMatch(/^DXF import failed: /);
    expect(store().models).toHaveLength(1);
  });

  it("starts a new project", async () => {
    store().addMaterial();
    markProjectClean(store());
    renderMenu();
    await userEvent.click(screen.getByTitle("New (Ctrl+N)"));
    await waitFor(() => expect(store().materials).toHaveLength(1));
    // No Exit button outside the desktop app.
    expect(screen.queryByTitle("Exit")).toBeNull();
  });
});
