import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalysisResult } from "@cslope/engine";

import { Explorer } from "./Explorer";
import { ProjectInfoDialog } from "./ProjectInfoDialog";
import { useAppStore, type ProjectInfo } from "../../store/app-store";

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

  it("extends the selection with Ctrl and Shift", async () => {
    render(<Explorer />);
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(row("Gamma"));
    await user.keyboard("{/Control}");
    expect(row("Alpha")).toHaveAttribute("aria-selected", "true");
    expect(row("Gamma")).toHaveAttribute("aria-selected", "true");
    expect(row("Beta")).toHaveAttribute("aria-selected", "false");

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
    const input = screen.getByDisplayValue("Beta");
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
    expect(screen.getByRole("menuitem", { name: "Delete Selected (3)" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(row("Beta"));
    await user.keyboard("{Control>}");
    await user.click(row("Gamma"));
    await user.keyboard("{/Control}");
    fireEvent.contextMenu(row("Gamma"));
    await user.click(screen.getByRole("menuitem", { name: "Delete Selected (2)" }));
    expect(names()).toEqual(["Alpha"]);
  });

  it("right-clicking an unselected model selects only it, and an outside click closes the menu", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Gamma"));
    expect(row("Gamma")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("edits model properties and saves them to the model", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Properties" }));
    expect(screen.getByText("Model Properties")).toBeInTheDocument();
    const title = screen.getByText("Title").parentElement!.querySelector("input")!;
    await userEvent.clear(title);
    await userEvent.type(title, "Section B-B");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(screen.queryByText("Model Properties")).toBeNull();
    const beta = store().models.find((m) => m.name === "Beta")!;
    expect(beta.projectInfo).toMatchObject({ title: "Section B-B", revision: "0" });
  });

  it("closes the properties without saving on Cancel", async () => {
    render(<Explorer />);
    fireEvent.contextMenu(row("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Properties" }));
    const before = structuredClone(store().models.find((m) => m.name === "Beta")!.projectInfo);
    const title = screen.getByText("Title").parentElement!.querySelector("input")!;
    await userEvent.type(title, "X");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Model Properties")).toBeNull();
    expect(store().models.find((m) => m.name === "Beta")!.projectInfo).toEqual(before);
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
    expect(row("Gamma").style.borderBottom).toContain("var(--color-vsc-accent)");
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

  const input = (label: string) =>
    screen.getByText(label, { exact: false }).parentElement!.querySelector(
      "input, textarea",
    ) as HTMLInputElement;

  it("saves only the fields that were changed, numbers as numbers", async () => {
    const onSave = vi.fn();
    render(<ProjectInfoDialog initialInfos={[info()]} onSave={onSave} onClose={() => {}} />);
    expect(input("Client")).toHaveValue("ACME");
    await userEvent.type(input("Author"), "ZC");
    await userEvent.clear(input("Canvas Width (m)"));
    await userEvent.type(input("Canvas Width (m)"), "1500");
    await userEvent.type(input("Description / Notes"), "Notes");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(onSave).toHaveBeenCalledWith({
      author: "ZC",
      canvasWidth: 1500,
      description: "Notes",
    });
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
    expect(screen.getByText("Editing 2 models")).toBeInTheDocument();
    expect(screen.getByText("Client (mixed)")).toBeInTheDocument();
    expect(input("Client")).toHaveValue("");
    expect(input("Client")).toHaveAttribute("placeholder", "Mixed values");
    // Shared values are shown.
    expect(input("Project No.")).toHaveValue("P1");
    await userEvent.type(input("Client"), "C");
    expect(screen.queryByText("Client (mixed)")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(onSave).toHaveBeenCalledWith({ client: "C" });
  });

  it("closes from the header button", async () => {
    const onClose = vi.fn();
    render(<ProjectInfoDialog initialInfos={[info()]} onSave={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(onClose).toHaveBeenCalled();
  });
});
