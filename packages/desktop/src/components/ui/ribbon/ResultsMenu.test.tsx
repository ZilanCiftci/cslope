import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalysisResult } from "@cslope/engine";

const mocks = vi.hoisted(() => ({
  exportVectorPdf: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("../../../features/pdf/pdf-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/pdf/pdf-export")>()),
  exportVectorPdf: mocks.exportVectorPdf,
}));
vi.mock("../../../utils/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/download")>()),
  downloadFile: mocks.downloadFile,
}));

import { ResultsMenu } from "./ResultsMenu";
import { useAppStore } from "../../../store/app-store";
import { useSensitivityStore } from "../../../features/sensitivity/store";
import { useReliabilityStore } from "../../../features/reliability/store";

const store = () => useAppStore.getState();
const rvs = () => store().resultViewSettings;

function fakeResult(): AnalysisResult {
  const [a, b] = store().coordinates;
  const surface = {
    cx: (a[0] + b[0]) / 2,
    cy: 20,
    radius: 15,
    fos: 1.234,
    entryPoint: a,
    exitPoint: b,
  };
  return {
    minFOS: 1.234,
    maxFOS: 1.234,
    criticalSurface: surface,
    allSurfaces: [surface],
    criticalSlices: [],
    method: "Bishop",
    elapsedMs: 1,
  };
}

function renderMenu({ withResult = true } = {}) {
  if (withResult) act(() => useAppStore.setState({ result: fakeResult(), runState: "done" }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onActivate = vi.fn();
  const utils = render(<ResultsMenu isOpen onActivate={onActivate} panelHost={host} />);
  return { host, onActivate, ...utils };
}

beforeEach(() => {
  store().newProject();
  mocks.exportVectorPdf.mockReset();
  mocks.downloadFile.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResultsMenu", () => {
  it("activates from its tab and shows no panel when closed", async () => {
    const onActivate = vi.fn();
    render(<ResultsMenu isOpen={false} onActivate={onActivate} panelHost={document.body} />);
    const tab = screen.getByRole("button", { name: "Results" });
    expect(tab).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(tab);
    expect(onActivate).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables the results plot and export without a result", () => {
    renderMenu({ withResult: false });
    expect(screen.getByTitle("Results Plot")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTitle("Export PDF")).toBeDisabled();
    expect(screen.getByTitle("More export options")).toBeDisabled();
  });

  it("explains that the results plot needs the desktop app in a browser", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderMenu();
    await userEvent.click(screen.getByTitle("Results Plot"));
    await userEvent.click(screen.getByTitle("Settings"));
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[0][0]).toMatch(/desktop app/);
  });

  it("opens the sensitivity and probabilistic panels", async () => {
    useSensitivityStore.getState().setOpen(false);
    useReliabilityStore.getState().setOpen(false);
    renderMenu();
    await userEvent.click(screen.getByTitle("Sensitivity"));
    await userEvent.click(screen.getByTitle("Probabilistic"));
    expect(useSensitivityStore.getState().open).toBe(true);
    expect(useReliabilityStore.getState().open).toBe(true);
  });

  it("toggles the display options", async () => {
    renderMenu();
    const before = rvs();
    await userEvent.click(screen.getByTitle("Show slices"));
    await userEvent.click(screen.getByTitle("Show FOS label"));
    await userEvent.click(screen.getByTitle("Show centre mark"));
    await userEvent.click(screen.getByTitle("Grid lines"));
    await userEvent.click(screen.getByTitle("Soil colors"));
    const after = rvs();
    expect(after.showSlices).toBe(!before.showSlices);
    expect(after.showFosLabel).toBe(!before.showFosLabel);
    expect(after.showCentreMarker).toBe(!before.showCentreMarker);
    expect(after.showGrid).toBe(!before.showGrid);
    expect(after.showSoilColor).toBe(!(before.showSoilColor ?? true));
  });

  it("chooses which surfaces to show and filters by FOS", async () => {
    renderMenu();
    await userEvent.click(screen.getByTitle(/^Surfaces:/));
    await userEvent.click(screen.getByRole("button", { name: "All surfaces" }));
    expect(rvs().surfaceDisplay).toBe("all");
    expect(screen.getByTitle("Surfaces: All")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All surfaces" })).toBeNull();

    await userEvent.click(screen.getByTitle("Surfaces: All"));
    await userEvent.click(screen.getByRole("button", { name: "Filter by FOS" }));
    await userEvent.click(screen.getByTitle("Surfaces: Filter"));
    const max = screen.getByLabelText("Maximum FOS shown");
    await userEvent.clear(max);
    await userEvent.type(max, "1.5");
    expect(rvs().fosFilterMax).toBe(1.5);
    // Zero is not a valid maximum.
    fireEvent.change(max, { target: { value: "0" } });
    expect(rvs().fosFilterMax).toBe(1.5);
    // An outside click closes the menu.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText("Maximum FOS shown")).toBeNull();
  });

  it("adds annotations", async () => {
    renderMenu();
    const count = store().resultViewSettings.annotations.length;
    await userEvent.click(screen.getByTitle("Add Text"));
    await userEvent.click(screen.getByTitle("Add Plot"));
    await userEvent.click(screen.getByTitle("Add Material Table"));
    await userEvent.click(screen.getByTitle("Add Color Bar"));
    const types = store().resultViewSettings.annotations.slice(count).map((a) => a.type);
    expect(types).toEqual(["text", "plot", "material-table", "color-bar"]);
  });

  it("exports the view settings as a template", async () => {
    renderMenu();
    await userEvent.click(screen.getByTitle("Export"));
    expect(mocks.downloadFile).toHaveBeenCalledTimes(1);
    const [name, data, type] = mocks.downloadFile.mock.calls[0];
    expect(name).toBe("view-template.json");
    expect(type).toBe("application/json");
    expect(JSON.parse(data as string)).toEqual({
      version: 1,
      resultViewSettings: JSON.parse(JSON.stringify(rvs())),
    });
  });

  it("imports a template and rejects invalid files", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    let picker: HTMLInputElement | null = null;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      picker = this;
    });
    act(() => store().setResultViewSettings({ gridSpacing: 7, minorTicks: 3 }));
    renderMenu();

    const choose = (content: string) => {
      const file = new File([content], "t.json", { type: "application/json" });
      Object.defineProperty(picker!, "files", { value: [file], configurable: true });
      act(() => {
        picker!.onchange?.(new Event("change"));
      });
    };

    await userEvent.click(screen.getByTitle("Import"));
    expect(picker!.accept).toBe(".json");
    const template = { ...JSON.parse(JSON.stringify(rvs())), showGrid: !rvs().showGrid };
    delete template.gridSpacing;
    delete template.minorTicks;
    const expectedGrid = template.showGrid;
    choose(JSON.stringify({ version: 1, resultViewSettings: template }));
    await waitFor(() => expect(rvs().showGrid).toBe(expectedGrid));
    // Fields missing in the template are not kept from the current view.
    expect(rvs().gridSpacing).toBeUndefined();
    expect(rvs().minorTicks).toBeUndefined();

    await userEvent.click(screen.getByTitle("Import"));
    choose("{ not json");
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Invalid template file."));
    alert.mockClear();
    await userEvent.click(screen.getByTitle("Import"));
    choose(JSON.stringify({ version: 1 }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Invalid template file."));
  });

  it("exports a PDF with the locked view as bounds", async () => {
    act(() =>
      store().setResultViewSettings({
        viewLock: { bottomLeft: [-2, -3], topRight: [40, 20] },
      }),
    );
    renderMenu();
    await userEvent.click(screen.getByTitle("Export PDF"));
    expect(mocks.exportVectorPdf).toHaveBeenCalledTimes(1);
    const arg = mocks.exportVectorPdf.mock.calls[0][0];
    expect(arg.viewBounds).toEqual({ xMin: -2, xMax: 40, yMin: -3, yMax: 20 });
    expect(arg.result.minFOS).toBe(1.234);
    expect(arg.coordinates).toEqual(store().coordinates);
  });

  it("exports a PDF of the paper frame without a view lock", async () => {
    act(() => {
      store().setResultViewSettings({ viewLock: undefined });
      useAppStore.setState({ resultViewScale: 10, resultViewOffset: [0, 0] });
    });
    const canvas = document.createElement("canvas");
    canvas.dataset.testid = "slope-canvas";
    document.body.appendChild(canvas);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    renderMenu();
    await userEvent.click(screen.getByTitle("More export options"));
    await userEvent.click(screen.getByRole("button", { name: "Export as PDF" }));
    const { viewBounds } = mocks.exportVectorPdf.mock.calls[0][0];
    // The frame is centred on the canvas: symmetric about the origin.
    expect(viewBounds.xMin).toBeCloseTo(-viewBounds.xMax, 6);
    expect(viewBounds.yMin).toBeCloseTo(-viewBounds.yMax, 6);
    expect(viewBounds.xMax).toBeGreaterThan(0);
    expect(viewBounds.xMax).toBeLessThan(40);
  });

  it("exports slice data as Excel and CSV files named after the model", async () => {
    renderMenu();
    const name = store().models.find((m) => m.id === store().activeModelId)!.name;
    const pick = async (label: string) => {
      await userEvent.click(screen.getByTitle("More export options"));
      await userEvent.click(screen.getByRole("button", { name: label }));
    };
    await pick("Slice data (Excel)");
    await pick("Slice data (CSV)");
    await pick("Slice data (CSV, ; and ,)");
    const calls = mocks.downloadFile.mock.calls;
    expect(calls.map((c) => c[0])).toEqual([
      `${name} slices.xlsx`,
      `${name} slices.csv`,
      `${name} slices.csv`,
    ]);
    expect(calls[1][1]).toMatch(/^﻿/);
    expect(String(calls[2][1])).toContain(";");
    expect(calls[1][2]).toBe("text/csv;charset=utf-8");
  });

  it("exports a PNG of the paper area and restores the selection", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const canvas = document.createElement("canvas");
    canvas.dataset.testid = "slope-canvas";
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);
    const drawImage = vi.fn();
    const realCreate = document.createElement.bind(document);
    let exportCanvas: HTMLCanvasElement | null = null;
    let link: HTMLAnchorElement | null = null;
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = realCreate(tag);
      if (tag === "canvas") {
        exportCanvas = el as HTMLCanvasElement;
        (el as HTMLCanvasElement).getContext = (() => ({
          fillRect: () => {},
          drawImage,
          fillStyle: "",
        })) as unknown as HTMLCanvasElement["getContext"];
        (el as HTMLCanvasElement).toDataURL = () => "data:image/png;base64,xx";
      }
      if (tag === "a") {
        link = el as HTMLAnchorElement;
        link.click = () => {};
      }
      return el;
    }) as typeof document.createElement);
    act(() => useAppStore.setState({ selectedAnnotationIds: ["a1"] }));
    renderMenu();
    await userEvent.click(screen.getByTitle("More export options"));
    await userEvent.click(screen.getByRole("button", { name: "Export as PNG" }));
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(exportCanvas!.width).toBeGreaterThan(0);
    expect(link!.download).toMatch(/\.png$/);
    expect(link!.href).toBe("data:image/png;base64,xx");
    expect(store().selectedAnnotationIds).toEqual(["a1"]);
  });
});
