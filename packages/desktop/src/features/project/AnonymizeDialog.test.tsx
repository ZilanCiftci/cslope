/**
 * File › Save as anonymized… in a browser: the ribbon button opens the
 * dialog, its summary and warning, the copy is downloaded as
 * <name>-anonymized.cslp, a confirmation follows, and the open project
 * (its models, unsaved state, undo history) is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock("../../utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/download")>()),
  downloadFile: mocks.downloadFile,
}));

import { FileMenu } from "../../components/ui/ribbon/FileMenu";
import { isProjectDirty, markProjectClean, useAppStore } from "../../store/app-store";
import { readProjectBytes } from "./cslp";
import { openZip } from "../../utils/zip";

/** The text of every entry of an archive. */
async function archiveText(bytes: Uint8Array): Promise<string> {
  const zip = openZip(bytes);
  let text = "";
  for (const e of zip.entries()) text += new TextDecoder().decode(await zip.read(e.name));
  return text;
}

const store = () => useAppStore.getState();

function renderMenu() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return render(<FileMenu activeModelName="Smith section" isOpen onActivate={() => {}} panelHost={host} />);
}

/** A project that names its client, with an unsaved edit. */
function clientProject() {
  store().newProject();
  store().renameModel(store().activeModelId, "Smith Holdings section A");
  store().setProjectInfo({ title: "Smith Holdings wall", client: "Smith Holdings Ltd", author: "Jane Doe" });
  store().updateMaterial(store().materials[0].id, { name: "Smith clay" });
  store().saveCurrentModel();
  markProjectClean(store());
  store().setProjectInfo({ checker: "John Roe" });
  store().saveCurrentModel();
}

beforeEach(() => {
  mocks.downloadFile.mockReset();
  clientProject();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Save as anonymized in a browser", () => {
  it("downloads an anonymized copy and leaves the open project as it was", async () => {
    const before = JSON.stringify(store().models);
    const dirtyBefore = isProjectDirty(store());
    expect(dirtyBefore).toBe(true);
    const history = useAppStore.temporal.getState().pastStates.length;
    const prompt = vi.spyOn(window, "prompt").mockImplementation((_, value) => value ?? null);

    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /Save as anonymized/ }));
    const dialog = screen.getByRole("dialog", { name: "Save as anonymized" });
    const summary = within(dialog).getByTestId("anonymize-summary").textContent ?? "";
    expect(summary).toMatch(/Project information cleared in 1 model/);
    expect(summary).toMatch(/1 model renamed/);
    expect(summary).toMatch(/1 material renamed/);
    // Results kept, the origin not moved by default.
    expect(within(dialog).getByLabelText(/Remove results/)).not.toBeChecked();
    expect(within(dialog).getByLabelText(/Move to a local origin/)).not.toBeChecked();

    await userEvent.click(within(dialog).getByRole("button", { name: "Save…" }));
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalled());
    expect(prompt).toHaveBeenCalledWith("Save anonymized copy as", "cslope-project-anonymized.cslp");
    const [name, data] = mocks.downloadFile.mock.calls[0] as [string, Uint8Array];
    expect(name).toBe("cslope-project-anonymized.cslp");
    expect(await screen.findByText(/The open project is unchanged/)).toBeTruthy();

    const copy = await readProjectBytes(data);
    expect(copy.models[0].name).toBe("Model 1");
    expect(copy.models[0].materials[0].name).toBe("Material 1");
    expect(copy.models[0].projectInfo).toMatchObject({ title: "", client: "", author: "", checker: "" });
    expect(await archiveText(data)).not.toMatch(/Smith|Jane|John/);

    // The open project: the same models, still unsaved, the same undo history.
    expect(JSON.stringify(store().models)).toBe(before);
    expect(store().projectInfo.client).toBe("Smith Holdings Ltd");
    expect(isProjectDirty(store())).toBe(dirtyBefore);
    expect(useAppStore.temporal.getState().pastStates.length).toBe(history);
  });

  it("warns about free text it does not change, and moves to a local origin on request", async () => {
    store().setParameters([{ id: "p1", name: "H", expression: "10" }]);
    store().saveCurrentModel();
    vi.spyOn(window, "prompt").mockImplementation((_, value) => value ?? null);
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /Save as anonymized/ }));
    const dialog = screen.getByRole("dialog", { name: "Save as anonymized" });
    expect(within(dialog).getByRole("note").textContent).toMatch(
      /Check the file before sharing: names inside parameters, expressions or custom fields are not changed\..*1 parameter/,
    );
    await userEvent.click(within(dialog).getByLabelText(/Move to a local origin/));
    await userEvent.click(within(dialog).getByLabelText(/Also move the lowest point to y = 0/));
    // Results go with a move (they are in the original coordinates).
    expect(within(dialog).getByLabelText(/Remove results/)).toBeChecked();
    expect(within(dialog).getByLabelText(/Remove results/)).toBeDisabled();
    expect(within(dialog).getByTestId("anonymize-summary").textContent).toMatch(/Model 1 moved by .* m in x and .* m in y/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save…" }));
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalled());
    const copy = await readProjectBytes(mocks.downloadFile.mock.calls[0][1] as Uint8Array);
    expect(Math.min(...copy.models[0].coordinates.map((c) => c[0]))).toBe(0);
    expect(Math.min(...copy.models[0].coordinates.map((c) => c[1]))).toBe(0);
  });

  it("saves nothing when the name is cancelled, and closes on Cancel", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /Save as anonymized/ }));
    const dialog = screen.getByRole("dialog", { name: "Save as anonymized" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save…" }));
    // The save is asynchronous: wait until it has asked for the name.
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
