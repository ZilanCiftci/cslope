/**
 * File › Save as anonymized… in the desktop app: the copy goes to the main
 * process's save-a-copy dialog (next to the open file, "-anonymized"
 * added), never through Save or Save As, and the project stays unsaved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { AnonymizeDialog } from "./AnonymizeDialog";
import { isProjectDirty, markProjectClean, useAppStore } from "../../store/app-store";
import { readProjectBytes } from "./cslp";
import { projectSnapshot } from "./saveAnonymized";

const bridge = {
  saveCopy: vi.fn<(content: Uint8Array, suffix: string) => Promise<string | null>>(),
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
};

beforeEach(() => {
  const s = useAppStore.getState();
  s.newProject();
  s.setProjectInfo({ client: "Smith Holdings Ltd" });
  s.saveCurrentModel();
  for (const fn of Object.values(bridge)) fn.mockReset();
  (window as unknown as { cslope: unknown }).cslope = bridge;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { cslope?: unknown }).cslope;
});

describe("Save as anonymized in the desktop app", () => {
  it("saves the copy through the save-a-copy dialog and confirms it", async () => {
    markProjectClean(useAppStore.getState());
    bridge.saveCopy.mockResolvedValue("Dike-anonymized.cslp");
    const onClose = vi.fn();
    render(<AnonymizeDialog snapshot={projectSnapshot()} fileName="" onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Save as anonymized" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save…" }));
    await waitFor(() => expect(bridge.saveCopy).toHaveBeenCalledTimes(1));
    const [bytes, suffix] = bridge.saveCopy.mock.calls[0];
    expect(suffix).toBe("-anonymized");
    expect((await readProjectBytes(bytes)).models[0].projectInfo?.client).toBe("");
    expect(bridge.saveFile).not.toHaveBeenCalled();
    expect(bridge.saveFileAs).not.toHaveBeenCalled();
    expect(await screen.findByText("Dike-anonymized.cslp")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Anonymized copy saved" })).toBeTruthy();
    // Saving a copy does not count as saving the project.
    useAppStore.getState().setProjectInfo({ client: "Other" });
    useAppStore.getState().saveCurrentModel();
    expect(isProjectDirty(useAppStore.getState())).toBe(true);
    await userEvent.click(screen.getAllByRole("button", { name: "Close" })[1]);
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open without a confirmation when the dialog is cancelled, and shows a failure", async () => {
    bridge.saveCopy.mockResolvedValueOnce(null);
    render(<AnonymizeDialog snapshot={projectSnapshot()} fileName="" onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    await waitFor(() => expect(bridge.saveCopy).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "Save as anonymized" })).toBeTruthy();
    bridge.saveCopy.mockRejectedValueOnce(new Error("disk full"));
    await userEvent.click(screen.getByRole("button", { name: "Save…" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Unable to save the anonymized copy: disk full");
  });
});
