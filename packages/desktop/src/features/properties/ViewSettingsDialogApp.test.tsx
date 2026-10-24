import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { ViewSettingsDialogApp } from "./ViewSettingsDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { ResultViewSettings } from "../../store/types";
import { getPlotAspectRatio } from "../view/paper";
import { modelViewLock, viewLockContains } from "../view/viewLock";
import type { PaperContent } from "../view/extents";

let bridge: FakeBridge;
const rvs = () => useAppStore.getState().resultViewSettings;
const COORDS: [number, number][] = [
  [0, 0],
  [0, 10],
  [30, 10],
  [30, 0],
];

function hydrate(patch: Partial<ResultViewSettings> = {}, paperContent?: PaperContent) {
  const base = structuredClone(useAppStore.getState().resultViewSettings);
  bridge.emit("onViewSettingsState", {
    ...(paperContent ? { paperContent } : {}),
    resultViewSettings: {
      ...base,
      paperFrame: { ...base.paperFrame, paperSize: "A4", landscape: true },
      viewLock: { bottomLeft: [0, 0], topRight: [20, 10] },
      ...patch,
    },
    coordinates: COORDS,
    resultViewScale: 2,
    resultViewOffset: [5, 6],
  });
}

/** The extent inputs are labelled by the caption next to them. */
const extent = (caption: string) =>
  screen.getByText(caption).nextElementSibling as HTMLInputElement;

const lastSent = () =>
  bridge
    .sentOf<{ resultViewSettings: ResultViewSettings; resultViewScale: number }>(
      "sendViewSettingsChanged",
    )
    .at(-1)!;

beforeEach(() => {
  useAppStore.getState().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("ViewSettingsDialogApp", () => {
  it("shows the settings from the main window without echoing them", () => {
    render(<ViewSettingsDialogApp />);
    expect(bridge.callNames()).toContain("requestViewSettingsState");
    hydrate({ gridSpacing: 5, minorTicks: 4 });
    expect(extent("Left X").value).toBe("0.00");
    expect(extent("Right X").value).toBe("20.00");
    expect(extent("Top Y").value).toBe("10.00");
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects[0].value).toBe("A4");
    expect(selects[1].value).toBe("landscape");
    expect(screen.getByPlaceholderText("Auto")).toHaveValue(5);
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
    expect(bridge.sentOf("sendViewSettingsChanged")).toEqual([]);
    expect(useAppStore.getState().resultViewScale).toBe(2);
  });

  it("changes the paper size and broadcasts the view scale with it", async () => {
    render(<ViewSettingsDialogApp />);
    hydrate();
    await userEvent.selectOptions(screen.getAllByRole("combobox")[0], "A3");
    expect(rvs().paperFrame.paperSize).toBe("A3");
    expect(lastSent().resultViewSettings.paperFrame.paperSize).toBe("A3");
    expect(lastSent().resultViewScale).toBe(2);
  });

  it("keeps the plot aspect ratio when the orientation changes", async () => {
    render(<ViewSettingsDialogApp />);
    hydrate();
    await userEvent.selectOptions(screen.getAllByRole("combobox")[1], "portrait");
    const ar = getPlotAspectRatio("A4", false);
    expect(rvs().paperFrame.landscape).toBe(false);
    expect(rvs().viewLock!.bottomLeft).toEqual([0, 0]);
    expect(rvs().viewLock!.topRight[0]).toBe(20);
    expect(rvs().viewLock!.topRight[1]).toBeCloseTo(20 / ar, 9);
  });

  it("sets the grid spacing, and clears it back to Auto", async () => {
    render(<ViewSettingsDialogApp />);
    hydrate();
    const spacing = screen.getByPlaceholderText("Auto");
    await userEvent.type(spacing, "2.5");
    expect(rvs().gridSpacing).toBe(2.5);
    await userEvent.clear(spacing);
    expect(rvs().gridSpacing).toBeUndefined();
    // Zero means automatic spacing too.
    await userEvent.type(spacing, "0");
    expect(rvs().gridSpacing).toBeUndefined();
  });

  it("clamps and rounds minor ticks", () => {
    render(<ViewSettingsDialogApp />);
    hydrate({ minorTicks: 2 });
    const ticks = screen.getByDisplayValue("2");
    fireEvent.change(ticks, { target: { value: "35" } });
    expect(rvs().minorTicks).toBe(20);
    fireEvent.change(ticks, { target: { value: "3.6" } });
    expect(rvs().minorTicks).toBe(4);
    fireEvent.change(ticks, { target: { value: "0" } });
    expect(rvs().minorTicks).toBeUndefined();
    fireEvent.change(ticks, { target: { value: "" } });
    expect(rvs().minorTicks).toBeUndefined();
  });

  it("commits an extent on Enter and keeps the aspect ratio via Top Y", async () => {
    render(<ViewSettingsDialogApp />);
    hydrate();
    const ar = getPlotAspectRatio("A4", true);
    const right = extent("Right X");
    await userEvent.clear(right);
    await userEvent.type(right, "40{Enter}");
    expect(rvs().viewLock!.topRight[0]).toBe(40);
    expect(rvs().viewLock!.topRight[1]).toBeCloseTo(40 / ar, 9);
    expect(right).not.toHaveFocus();
    expect(Number(right.value)).toBe(40);
  });

  it("moving Top Y shifts Bottom Y and keeps the width", async () => {
    render(<ViewSettingsDialogApp />);
    hydrate();
    const ar = getPlotAspectRatio("A4", true);
    const top = extent("Top Y");
    await userEvent.clear(top);
    await userEvent.type(top, "30");
    await userEvent.tab();
    const vl = rvs().viewLock!;
    expect(vl.topRight).toEqual([20, 30]);
    expect(vl.bottomLeft[0]).toBe(0);
    expect(vl.bottomLeft[1]).toBeCloseTo(30 - 20 / ar, 9);
  });

  it("restores the stored extent when the field is left empty", async () => {
    render(<ViewSettingsDialogApp />);
    hydrate();
    const left = extent("Left X");
    await userEvent.clear(left);
    await userEvent.tab();
    expect(rvs().viewLock!.bottomLeft[0]).toBe(0);
    expect(left.value).not.toBe("");
    expect(Number(left.value)).toBe(0);
  });

  it("fits the extents to the model as the main window does, with what it draws", async () => {
    render(<ViewSettingsDialogApp />);
    // The main window sends the loads, water and reinforcement along.
    const content: PaperContent = { coordinates: COORDS, lineLoads: [{ x: 15, magnitude: 80 }] };
    hydrate({}, content);
    await userEvent.click(screen.getByRole("button", { name: "Use model bounds" }));
    const vl = rvs().viewLock!;
    expect(vl).toEqual(modelViewLock(content, rvs()));
    expect(vl.topRight[1]).toBeGreaterThan(modelViewLock({ coordinates: COORDS }, rvs()).topRight[1]);
    expect(lastSent().resultViewSettings.viewLock).toEqual(vl);
  });

  it("fits a tall, narrow model whole instead of cutting off its top", async () => {
    render(<ViewSettingsDialogApp />);
    const base = structuredClone(useAppStore.getState().resultViewSettings);
    const tall: [number, number][] = [[0, 0], [5, 0], [5, 40], [0, 40]];
    bridge.emit("onViewSettingsState", {
      resultViewSettings: { ...base, paperFrame: { ...base.paperFrame, paperSize: "A4", landscape: true } },
      coordinates: tall,
      resultViewScale: 2,
      resultViewOffset: [0, 0],
    });
    await userEvent.click(screen.getByRole("button", { name: "Use model bounds" }));
    const vl = rvs().viewLock!;
    expect(viewLockContains(vl, tall)).toBe(true);
    const ar = getPlotAspectRatio("A4", true);
    expect((vl.topRight[0] - vl.bottomLeft[0]) / (vl.topRight[1] - vl.bottomLeft[1])).toBeCloseTo(ar, 9);
  });

  it("creates a view lock from the shown extents when there is none", async () => {
    render(<ViewSettingsDialogApp />);
    // E.g. after importing a view template without a locked view.
    hydrate({ viewLock: undefined });
    const left = extent("Left X");
    expect(Number(left.value)).toBe(-1);
    await userEvent.clear(left);
    await userEvent.type(left, "2{Enter}");
    const ar = getPlotAspectRatio("A4", true);
    const vl = rvs().viewLock!;
    expect(vl).toBeDefined();
    expect(vl.bottomLeft).toEqual([2, -1]);
    expect(vl.topRight[0]).toBe(26);
    expect(vl.topRight[1]).toBeCloseTo(-1 + 24 / ar, 9);
    expect(Number(left.value)).toBe(2);
  });
});
