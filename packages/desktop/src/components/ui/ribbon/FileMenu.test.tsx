import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** The text of the import/export summary dialog, once it shows. */
async function summaryText(): Promise<string> {
  const text = await screen.findByTestId("summary-text");
  return text.textContent ?? "";
}

/** Close the summary dialog. */
async function closeSummary() {
  const dialog = screen.getByRole("dialog");
  // The ✕ in the header and the Close button in the footer.
  await userEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[1]);
  expect(screen.queryByRole("dialog")).toBeNull();
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
    const pickers = capturePickers();
    renderMenu();
    await userEvent.click(screen.getByTitle("Import"));
    await userEvent.click(screen.getByTitle("Import a DXF file"));
    const picker = pickers.at(-1)!;
    expect(picker.accept).toBe(".dxf");
    choose(picker, "Section 1.dxf", OUTLINE_DXF);
    picker.onchange?.(new Event("change"));
    expect(await summaryText()).toMatch(/^Imported "Section 1": outline with 4 points/);
    const active = store().models.find((m) => m.id === store().activeModelId)!;
    expect(active.name).toBe("Section 1");
    expect(store().coordinates).toHaveLength(4);
  });

  it("reports a DXF that cannot be imported", async () => {
    const pickers = capturePickers();
    renderMenu();
    await userEvent.click(screen.getByTitle("Import"));
    await userEvent.click(screen.getByTitle("Import a DXF file"));
    const picker = pickers.at(-1)!;
    choose(picker, "empty.dxf", dxf([[0, "SECTION"], [2, "ENTITIES"], [0, "ENDSEC"], [0, "EOF"]]));
    picker.onchange?.(new Event("change"));
    expect(await summaryText()).not.toMatch(/failed/);
    expect(screen.getByText("Import of empty.dxf failed")).toBeInTheDocument();
    expect(store().models).toHaveLength(1);
  });

  it("imports a .gsz file from Import › .gsz file and exports the model as one", async () => {
    const { modelToGsz } = await import("../../../features/project/gsz/gsz-write");
    store().saveCurrentModel();
    const model = store().models.find((m) => m.id === store().activeModelId)!;
    const { bytes } = modelToGsz({ ...model, name: "Exported" });
    const pickers = capturePickers();
    renderMenu();
    await userEvent.click(screen.getByTitle("Import"));
    await userEvent.click(screen.getByTitle("Import a .gsz project file"));
    const picker = pickers.at(-1)!;
    expect(picker.accept).toBe(".gsz");
    Object.defineProperty(picker, "files", { value: [new File([bytes as BlobPart], "Section B.gsz")], configurable: true });
    picker.onchange?.(new Event("change"));
    const imported = await summaryText();
    expect(imported).toMatch(/^Imported 1 model from Section B\.gsz/);
    expect(imported).toContain("The import cannot be undone");
    await closeSummary();
    const importedModel = store().models.find((m) => m.id === store().activeModelId)!;
    expect(importedModel.name).toBe("Section B");
    // The notes stay with the model.
    expect(importedModel.importNotes?.[0]).toBe("Imported from Section B.gsz.");

    URL.createObjectURL ??= () => "blob:x";
    URL.revokeObjectURL ??= () => {};
    await userEvent.click(screen.getByTitle("Export"));
    await userEvent.click(screen.getByTitle("Export the active model as a .gsz project file"));
    expect(await summaryText()).toMatch(/^Prepared "Section B" as Section B\.gsz for download/);
  });

  it("imports a .stix file from Import › .stix file and exports the model as one", async () => {
    const { modelToStix } = await import("../../../features/project/stix/stix-write");
    store().saveCurrentModel();
    const model = store().models.find((m) => m.id === store().activeModelId)!;
    const { bytes } = modelToStix({ ...model, name: "Exported" });
    const pickers = capturePickers();
    renderMenu();
    await userEvent.click(screen.getByTitle("Import"));
    await userEvent.click(screen.getByTitle("Import a .stix project file"));
    const picker = pickers.at(-1)!;
    expect(picker.accept).toBe(".stix");
    Object.defineProperty(picker, "files", { value: [new File([bytes as BlobPart], "Dike.stix")], configurable: true });
    picker.onchange?.(new Event("change"));
    const imported = await summaryText();
    expect(imported).toMatch(/^Imported 1 model from Dike\.stix/);
    // The method the model got (Bishop for a circle).
    expect(imported).toMatch(/; method (Bishop|Morgenstern-Price|Janbu)\./);
    expect(imported).toContain("The import cannot be undone");
    await closeSummary();
    expect(store().models.find((m) => m.id === store().activeModelId)!.name).toBe("Calculation 1 (Dike)");

    URL.createObjectURL ??= () => "blob:x";
    URL.revokeObjectURL ??= () => {};
    await userEvent.click(screen.getByTitle("Export"));
    await userEvent.click(screen.getByTitle("Export the active model as a .stix project file"));
    expect(await summaryText()).toMatch(/^Prepared "Calculation 1 \(Dike\)" as /);
  });

  it("imports a .slim file from Import › .sli/.slim/.slmd file and exports the model as one", async () => {
    const { modelToSlim } = await import("../../../features/project/sli/sli-write");
    store().saveCurrentModel();
    const model = store().models.find((m) => m.id === store().activeModelId)!;
    const { bytes } = modelToSlim({ ...model, name: "Exported" }, "Exported");
    const pickers = capturePickers();
    renderMenu();
    await userEvent.click(screen.getByTitle("Import"));
    await userEvent.click(screen.getByTitle("Import a .sli, .slim or .slmd model file"));
    const picker = pickers.at(-1)!;
    expect(picker.accept).toBe(".sli,.slim,.slmd");
    Object.defineProperty(picker, "files", { value: [new File([bytes as BlobPart], "Cut.slim")], configurable: true });
    picker.onchange?.(new Event("change"));
    const imported = await summaryText();
    expect(imported).toMatch(/^Imported 1 model from Cut\.slim/);
    expect(imported).toContain("The import cannot be undone");
    await closeSummary();

    URL.createObjectURL ??= () => "blob:x";
    URL.revokeObjectURL ??= () => {};
    await userEvent.click(screen.getByTitle("Export"));
    await userEvent.click(screen.getByTitle("Export the active model as a .slim model file"));
    expect(await summaryText()).toMatch(/^Prepared ".*" as .*\.slim/);
  });

  it("shows the summary in a dialog that copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    URL.createObjectURL ??= () => "blob:x";
    URL.revokeObjectURL ??= () => {};
    renderMenu();
    await userEvent.click(screen.getByTitle("Export"));
    await userEvent.click(screen.getByTitle("Export the active model as a .gsz project file"));
    const text = await summaryText();
    expect(screen.getByRole("dialog", { name: "Export as .gsz" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(text);
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
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
