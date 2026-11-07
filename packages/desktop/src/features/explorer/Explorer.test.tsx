import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalysisResult } from "@cslope/engine";

import { Explorer } from "./Explorer";
import { ProjectInfoDialog } from "./ProjectInfoDialog";
import { useAppStore, type ProjectInfo } from "../../store/app-store";
import { serializeProject } from "../../store/persistence";
import { APP_DEFAULT_ANALYSIS_OPTIONS } from "../../store/defaults";
import { readProject, writeProjectArchive } from "../project/cslp";
import { readZip, writeZip } from "../../utils/zip";

const store = () => useAppStore.getState();
const names = () => store().models.map((m) => m.name);
const row = (name: string) => screen.getByRole("treeitem", { name });

/** jsdom drag events carry no coordinates: set clientY explicitly. */
function dragOverAt(el: HTMLElement, clientY: number) {
  const ev = createEvent.dragOver(el);
  Object.defineProperty(ev, "clientY", { value: clientY });
  fireEvent(el, ev);
}

function setupModels() {
  store().newProject();
  const first = store().activeModelId;
  act(() => {
    store().renameModel(first, "Alpha");
    store().addModel("Beta");
    store().addModel("Gamma");
    store().switchModel(first);
  });
}

beforeEach(() => {
  setupModels();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Explorer — list and selection", () => {
  it("lists the models with the active one selected", () => {
    render(<Explorer />);
    expect(screen.getAllByRole("treeitem").map((r) => r.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(row("Alpha")).toHaveAttribute("aria-selected", "true");
    expect(row("Beta")).toHaveAttribute("aria-selected", "false");
    // A tree, with the active model as its stop on the Tab key.
    expect(within(screen.getByRole("tree", { name: "Models" })).getAllByRole("treeitem")).toHaveLength(3);
    expect(row("Alpha")).toHaveAttribute("tabindex", "0");
    expect(row("Beta")).toHaveAttribute("tabindex", "-1");
  });

  it("moves the selection to a model made active elsewhere (e.g. an import)", async () => {
    render(<Explorer />);
    await userEvent.click(row("Beta"));
    act(() => store().switchModel(store().models[2].id));
    expect(row("Gamma")).toHaveAttribute("aria-selected", "true");
    expect(row("Beta")).toHaveAttribute("aria-selected", "false");
  });

  it("collapses and expands the list", async () => {
    render(<Explorer />);
    const toggle = screen.getByRole("button", { name: "Toggle models list" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByRole("treeitem")).toEqual([]);
    await userEvent.click(toggle);
    expect(screen.getAllByRole("treeitem")).toHaveLength(3);
  });

  it("renders nothing when the explorer is closed", () => {
    act(() => useAppStore.setState({ explorerOpen: false }));
    const { container } = render(<Explorer />);
    expect(container).toBeEmptyDOMElement();
    act(() => useAppStore.setState({ explorerOpen: true }));
  });

  it("switches the active model on click", async () => {
    render(<Explorer />);
    await userEvent.click(row("Beta"));
    expect(names()[store().models.findIndex((m) => m.id === store().activeModelId)]).toBe("Beta");
    expect(row("Beta")).toHaveAttribute("aria-selected", "true");
    expect(row("Alpha")).toHaveAttribute("aria-selected", "false");
  });

  it("opens the result view when the chosen model has a result", async () => {
    const beta = store().models[1].id;
    act(() => {
      store().switchModel(beta);
      useAppStore.setState({ result: { minFOS: 1.3 } as AnalysisResult, runState: "done" });
      store().saveCurrentModel();
      store().switchModel(store().models[0].id);
      store().setMode("edit");
    });
    render(<Explorer />);
    await userEvent.click(row("Beta"));
    expect(store().mode).toBe("result");
  });

  it("shows the run state as a dot: analysed, failed, not analysed (the active one from the flat state)", () => {
    const [, beta, gamma] = store().models.map((m) => m.id);
    act(() =>
      useAppStore.setState((s) => ({
        result: { minFOS: 1.3 } as AnalysisResult,
        runState: "done",
        models: s.models.map((m) =>
          m.id === beta ? { ...m, runState: "error" } : m.id === gamma ? { ...m, result: { minFOS: 1.1 } as AnalysisResult, runState: "done" } : m,
        ),
      })),
    );
    render(<Explorer />);
    const state = (name: string) => row(name).querySelector("[role=img]")!.getAttribute("aria-label");
    expect(state("Alpha")).toBe("Analyzed");
    expect(state("Beta")).toBe("Analysis failed");
    expect(state("Gamma")).toBe("Analyzed");
    act(() => useAppStore.setState({ result: null, runState: "idle" }));
    expect(state("Alpha")).toBe("Not analyzed");
  });

  it("marks the models whose analysis runs, the active one by its single run", () => {
    const [alpha, beta, gamma] = store().models.map((m) => m.id);
    render(<Explorer />);
    const running = () =>
      ["Alpha", "Beta", "Gamma"].filter((name) => row(name).querySelector("[data-testid=model-running]"));
    expect(running()).toEqual([]);
    // Run All: Alpha (active) and Beta started, Gamma waiting.
    act(() =>
      useAppStore.setState((s) => ({
        runState: "running",
        runAll: { total: 3, finished: 0, failed: 0, progress: 0.1, running: true },
        models: s.models.map((m) => (m.id === gamma ? m : { ...m, runState: "running" })),
      })),
    );
    expect(running()).toEqual(["Alpha", "Beta"]);
    act(() =>
      useAppStore.setState((s) => ({
        models: s.models.map((m) => (m.id === alpha ? { ...m, runState: "idle" } : m)),
      })),
    );
    // (the active model's flat state is "running" for the whole batch)
    expect(running()).toEqual(["Beta"]);
    // A single run of the active model.
    act(() =>
      useAppStore.setState((s) => ({
        runState: "running",
        runAll: null,
        models: s.models.map((m) => (m.id === beta ? { ...m, runState: "done" } : m)),
      })),
    );
    expect(running()).toEqual(["Alpha"]);
    expect(within(row("Alpha")).getByRole("img", { name: "Analyzing" })).toBeInTheDocument();
  });

  it("shows a selected drawing, not its model, as the selection; a click on the model selects it again", async () => {
    const user = userEvent.setup();
    act(() => {
      store().addBackground({
        id: "d1",
        assetId: "none",
        name: "Section A-A",
        page: 1,
        crop: { x0: 0, y0: 0, x1: 10, y1: 10 },
        calibration: { mode: "points", points: [] },
        transform: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 },
        opacity: 1,
        visible: true,
        order: 0,
      });
    });
    render(<Explorer />);
    await user.keyboard("{Control>}");
    await user.click(row("Beta"));
    await user.keyboard("{/Control}");
    await user.click(row("Alpha"));
    await user.keyboard("{Control>}");
    await user.click(row("Gamma"));
    await user.keyboard("{/Control}");
    act(() => store().switchModel(store().models[0].id));
    act(() => store().selectCanvasObject({ type: "background", id: "d1" }));
    expect(row("Section A-A")).toHaveAttribute("aria-selected", "true");
    // The active model stays the current one (semibold), but is not selected; nor the others.
    expect(row("Alpha")).toHaveAttribute("aria-current", "true");
    for (const n of ["Alpha", "Beta", "Gamma"]) expect(row(n)).toHaveAttribute("aria-selected", "false");

    await user.click(row("Alpha"));
    expect(store().canvasSelection).toBeNull();
    expect(row("Alpha")).toHaveAttribute("aria-selected", "true");
    expect(row("Gamma")).toHaveAttribute("aria-selected", "false");
  });

  it("extends the selection with Ctrl and Shift", async () => {
    render(<Explorer />);
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(row("Gamma"));
    await user.keyboard("{/Control}");
    expect(row("Alpha")).toHaveAttribute("aria-selected", "true");
    expect(row("Gamma")).toHaveAttribute("aria-selected", "true");
    expect(row("Beta")).toHaveAttribute("aria-selected", "false");
    // Every selected row in the same light blue (not the hover grey); the
    // active model (Gamma, the last clicked) is the current one.
    expect(row("Alpha").style.background).toBe("var(--color-vsc-selected-bg)");
    expect(row("Gamma").style.background).toBe("var(--color-vsc-selected-bg)");
    expect(row("Gamma")).toHaveAttribute("aria-current", "true");
    expect(row("Alpha")).not.toHaveAttribute("aria-current");

    await user.click(row("Alpha"));
    await user.keyboard("{Shift>}");
    await user.click(row("Gamma"));
    await user.keyboard("{/Shift}");
    for (const n of ["Alpha", "Beta", "Gamma"]) {
      expect(row(n)).toHaveAttribute("aria-selected", "true");
    }
  });
});

describe("Explorer — rename", () => {
  it("renames with a double click and Enter", async () => {
    render(<Explorer />);
    await userEvent.dblClick(row("Beta"));
    const input = screen.getByRole("textbox", { name: "Model name" });
    expect(input).toHaveValue("Beta");
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, "  Slope 2  {Enter}");
    expect(names()).toEqual(["Alpha", "Slope 2", "Gamma"]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("cancels with Escape and ignores an empty name", async () => {
    render(<Explorer />);
    await userEvent.dblClick(row("Beta"));
    await userEvent.type(screen.getByDisplayValue("Beta"), "x{Escape}");
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);

    await userEvent.dblClick(row("Beta"));
    const input = screen.getByDisplayValue("Beta");
    await userEvent.clear(input);
    fireEvent.blur(input);
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("renames from the context menu", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Gamma"), { clientX: 30, clientY: 40 });
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("30px");
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.queryByRole("menu")).toBeNull();
    const input = screen.getByDisplayValue("Gamma");
    await userEvent.clear(input);
    await userEvent.type(input, "G{Enter}");
    expect(names()).toEqual(["Alpha", "Beta", "G"]);
  });
});

describe("Explorer — context menu", () => {
  it("duplicates a model", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(store().models).toHaveLength(4);
    expect(names().filter((n) => n.startsWith("Beta"))).toHaveLength(2);
  });

  it("deletes a model after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Explorer />);
    fireEvent.contextMenu(row("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith('Delete model "Beta"? This cannot be undone.');
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);

    confirm.mockReturnValue(true);
    fireEvent.contextMenu(row("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(names()).toEqual(["Alpha", "Gamma"]);
  });

  it("deletes several selected models at once, but never all of them", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Explorer />);
    const user = userEvent.setup();
    await user.keyboard("{Shift>}");
    await user.click(row("Gamma"));
    await user.keyboard("{/Shift}");
    // All three selected: deleting them all is not offered.
    fireEvent.contextMenu(row("Beta"));
    expect(screen.getByRole("menuitem", { name: "Delete selected (3)" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(row("Beta"));
    await user.keyboard("{Control>}");
    await user.click(row("Gamma"));
    await user.keyboard("{/Control}");
    fireEvent.contextMenu(row("Gamma"));
    await user.click(screen.getByRole("menuitem", { name: "Delete selected (2)" }));
    expect(names()).toEqual(["Alpha"]);
  });

  it("right-clicking an unselected model selects only it, and an outside click closes the menu", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Gamma"));
    expect(row("Gamma")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("menuitem", { name: "Delete" })).not.toHaveAttribute("aria-disabled");
    // Text only, like every menu; Delete set apart by a separator.
    const menu = screen.getByRole("menu");
    expect(menu.querySelector("svg")).toBeNull();
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("edits model properties and saves them to the model", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Model properties" }));
    expect(screen.getByText("Model properties")).toBeInTheDocument();
    const title = screen.getByText("Title").parentElement!.querySelector("input")!;
    await userEvent.clear(title);
    await userEvent.type(title, "Section B-B");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.queryByText("Model properties")).toBeNull();
    const beta = store().models.find((m) => m.name === "Beta")!;
    expect(beta.projectInfo).toMatchObject({ title: "Section B-B", revision: "0" });
  });

  it("closes the properties without saving on Cancel", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Model properties" }));
    const before = structuredClone(store().models.find((m) => m.name === "Beta")!.projectInfo);
    const title = screen.getByText("Title").parentElement!.querySelector("input")!;
    await userEvent.type(title, "X");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Model properties")).toBeNull();
    expect(store().models.find((m) => m.name === "Beta")!.projectInfo).toEqual(before);
  });

  it("closes the properties without saving on Escape", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Model properties" }));
    const before = structuredClone(store().models.find((m) => m.name === "Beta")!.projectInfo);
    const title = screen.getByText("Title").parentElement!.querySelector("input")!;
    await userEvent.type(title, "X");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Model properties")).toBeNull();
    expect(store().models.find((m) => m.name === "Beta")!.projectInfo).toEqual(before);
  });

  it("shows the full model name as a tooltip", () => {
    render(<Explorer />);
    expect(screen.getByText("Beta")).toHaveAttribute("title", "Beta");
  });
});

describe("Explorer — drag and drop", () => {
  it("moves a model before or after the drop target", () => {
    render(<Explorer />);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0, height: 20, left: 0, width: 100, bottom: 20, right: 100, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.dragStart(row("Alpha"));
    dragOverAt(row("Gamma"), 15);
    // The drop line under the target row.
    expect(within(row("Gamma")).getByTestId("model-drop-indicator").style.bottom).toBe("-1px");
    fireEvent.drop(row("Gamma"));
    expect(names()).toEqual(["Beta", "Gamma", "Alpha"]);

    fireEvent.dragStart(row("Alpha"));
    dragOverAt(row("Beta"), 2);
    fireEvent.drop(row("Beta"));
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("ignores drops on the dragged model itself", () => {
    render(<Explorer />);
    fireEvent.dragStart(row("Beta"));
    fireEvent.dragOver(row("Beta"));
    fireEvent.drop(row("Beta"));
    fireEvent.dragEnd(row("Beta"));
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(row("Beta").style.opacity).toBe("1");
  });
});

describe("Explorer — results out of date", () => {
  /** A saved project whose models have results; `edit` changes model.json of the second model after the run. */
  async function savedAndEdited(edit: (model: Record<string, unknown>) => void): Promise<Uint8Array> {
    const result = { minFOS: 1.3, maxFOS: 2, criticalSurface: null, allSurfaces: [], criticalSlices: [], method: "Bishop", elapsedMs: 1 };
    const file = serializeProject(store());
    // (complete options, as the app holds them after opening a file: the
    // starter model's are sparse, and opening fills them)
    const models = file.models.map((m) => ({
      ...m,
      options: { ...APP_DEFAULT_ANALYSIS_OPTIONS, ...m.options },
      runState: "done" as const,
      progress: 1,
      result: result as unknown as AnalysisResult,
      errorMessage: null,
    }));
    const bytes = await writeProjectArchive({ ...file, models });
    const id = models[1].id;
    const entries = [...(await readZip(bytes))].map(([name, data]) => {
      if (name !== `models/${id}/model.json`) return { name, data };
      const model = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
      edit(model);
      return { name, data: JSON.stringify(model) };
    });
    return writeZip(entries);
  }

  const dot = (name: string) => within(row(name)).getByRole("img");

  it("marks a result whose model was edited in the file after the run, and keeps it viewable", async () => {
    act(() => store().saveCurrentModel());
    const bytes = await savedAndEdited((model) => {
      // the first material's undrained strength, edited by hand
      const materials = model.materials as { model: Record<string, unknown> }[];
      materials[0].model = { kind: "undrained", unitWeight: 18, undrainedShearStrength: 45 };
    });
    const read = await readProject(bytes);
    act(() => store().loadProject(read.file));
    render(<Explorer />);
    expect(dot("Alpha")).toHaveAccessibleName("Analyzed");
    expect(dot("Beta")).toHaveAccessibleName("Result out of date");
    expect(dot("Beta")).toHaveAttribute("title", expect.stringContaining("Run the analysis again"));
    expect(dot("Gamma")).toHaveAccessibleName("Analyzed");
    // the result is still there, also once the model is the active one
    act(() => store().switchModel(store().models[1].id));
    expect(store().result?.minFOS).toBe(1.3);
    expect(dot("Beta")).toHaveAccessibleName("Result out of date");
  });

  it("does not mark a result whose model changed only outside its input (its name)", async () => {
    act(() => store().saveCurrentModel());
    const bytes = await savedAndEdited((model) => {
      model.name = "Beta renamed";
    });
    const read = await readProject(bytes);
    act(() => store().loadProject(read.file));
    render(<Explorer />);
    expect(dot("Beta renamed")).toHaveAccessibleName("Analyzed");
  });
});

describe("ProjectInfoDialog", () => {
  const info = (patch: Partial<ProjectInfo> = {}): ProjectInfo => ({
    title: "T",
    subtitle: "",
    client: "ACME",
    projectNumber: "P1",
    revision: "A",
    author: "",
    checker: "",
    date: "2026-01-01",
    description: "",
    canvasWidth: 1000,
    canvasHeight: 800,
    ...patch,
  });

  const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  it("saves only the fields that were changed", async () => {
    const onSave = vi.fn();
    render(<ProjectInfoDialog initialInfos={[info()]} onSave={onSave} onClose={() => {}} />);
    expect(input("Client")).toHaveValue("ACME");
    await userEvent.type(input("Author"), "ZC");
    await userEvent.type(input("Description"), "Notes");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({
      author: "ZC",
      description: "Notes",
    });
  });

  it("has no canvas width or height fields (D-21: the app never reads them)", () => {
    render(<ProjectInfoDialog initialInfos={[info()]} onSave={() => {}} onClose={() => {}} />);
    expect(screen.queryByLabelText(/canvas width/i)).toBeNull();
    expect(screen.queryByLabelText(/canvas height/i)).toBeNull();
  });

  it("shows mixed values when editing several models", async () => {
    const onSave = vi.fn();
    render(
      <ProjectInfoDialog
        initialInfos={[info({ client: "A" }), info({ client: "B" })]}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Model properties" })).toHaveAccessibleDescription(/^Editing 2 models/);
    expect(input("Client")).toHaveValue("");
    expect(input("Client")).toHaveAttribute("placeholder", "Mixed values");
    // Shared values are shown.
    expect(input("Project no.")).toHaveValue("P1");
    await userEvent.type(input("Client"), "C");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ client: "C" });
  });

  it("shows the notes of an imported model read-only", () => {
    const { unmount } = render(<ProjectInfoDialog initialInfos={[info()]} onSave={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId("import-notes")).toBeNull();
    unmount();
    render(
      <ProjectInfoDialog
        initialInfos={[info()]}
        onSave={() => {}}
        onClose={() => {}}
        importNotes={["Imported from Dike.stix.", 'Material "Clay": no unit weight in the file; 20 kN/m³ used.']}
      />,
    );
    const notes = screen.getByRole("region", { name: "Import notes" });
    expect(notes).toHaveTextContent("Imported from Dike.stix.");
    expect(notes).toHaveTextContent('Material "Clay": no unit weight');
  });

  it("closes from the header button", async () => {
    const onClose = vi.fn();
    render(<ProjectInfoDialog initialInfos={[info()]} onSave={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
