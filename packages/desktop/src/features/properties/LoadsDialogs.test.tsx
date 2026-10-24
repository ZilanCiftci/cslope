import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { UdlDialogApp } from "./UdlDialogApp";
import { LineLoadsDialogApp } from "./LineLoadsDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { LineLoadRow, UdlRow } from "../../store/types";

let bridge: FakeBridge;

const PARAMS = [{ id: "p1", name: "H", expression: "4" }];

function hydrate(udls: UdlRow[], lineLoads: LineLoadRow[] = []) {
  bridge.emit("onLoadsState", { udls, lineLoads, parameters: PARAMS });
}

beforeEach(() => {
  useAppStore.getState().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("UdlDialogApp", () => {
  it("requests state on mount and shows the rows sent by the main window", () => {
    render(<UdlDialogApp />);
    expect(bridge.callNames()).toContain("requestLoadsState");
    hydrate([
      { id: "u1", magnitude: 12, x1: 1, x2: 3 },
      { id: "u2", magnitude: 5, x1: 4, x2: 6, expressions: { x2: "H*2" } },
    ]);
    const mags = screen.getAllByLabelText("UDL magnitude") as HTMLInputElement[];
    expect(mags.map((i) => i.value)).toEqual(["12", "5"]);
    // An expression is shown instead of the resolved value.
    const x2s = screen.getAllByLabelText("UDL x2") as HTMLInputElement[];
    expect(x2s[1].value).toBe("H*2");
    expect(useAppStore.getState().parameters).toEqual(PARAMS);
  });

  it("does not echo state that came from the main window", () => {
    render(<UdlDialogApp />);
    hydrate([{ id: "u1", magnitude: 12, x1: 1, x2: 3 }]);
    bridge.emit("onLoadsChanged", {
      udls: [{ id: "u1", magnitude: 13, x1: 1, x2: 3 }],
      lineLoads: [],
    });
    expect(bridge.sentOf("sendLoadsChanged")).toEqual([]);
    expect(useAppStore.getState().udls[0].magnitude).toBe(13);
  });

  it("ignores malformed payloads", () => {
    render(<UdlDialogApp />);
    hydrate([{ id: "u1", magnitude: 12, x1: 1, x2: 3 }]);
    bridge.emit("onLoadsChanged", { udls: "nope" });
    bridge.emit("onLoadsChanged", null);
    expect(useAppStore.getState().udls).toHaveLength(1);
  });

  it("adds, edits and removes rows and broadcasts every change", async () => {
    render(<UdlDialogApp />);
    hydrate([]);
    await userEvent.click(screen.getByRole("button", { name: "+ Add UDL" }));
    expect(useAppStore.getState().udls).toHaveLength(1);
    let last = bridge.sentOf<{ udls: UdlRow[] }>("sendLoadsChanged").at(-1)!;
    expect(last.udls).toHaveLength(1);

    const x1 = screen.getByLabelText("UDL x1");
    await userEvent.clear(x1);
    await userEvent.type(x1, "2,5");
    await userEvent.tab();
    expect(useAppStore.getState().udls[0].x1).toBe(2.5);
    last = bridge.sentOf<{ udls: UdlRow[] }>("sendLoadsChanged").at(-1)!;
    expect(last.udls[0].x1).toBe(2.5);

    await userEvent.click(screen.getByRole("button", { name: "Remove UDL 1" }));
    expect(useAppStore.getState().udls).toEqual([]);
    expect(
      bridge.sentOf<{ udls: UdlRow[] }>("sendLoadsChanged").at(-1)!.udls,
    ).toEqual([]);
  });

  it("places each new row just beyond the last one instead of stacking", async () => {
    render(<UdlDialogApp />);
    hydrate([{ id: "u1", magnitude: 12, x1: 1, x2: 3 }]);
    await userEvent.click(screen.getByRole("button", { name: "+ Add UDL" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Add UDL" }));
    expect(
      useAppStore.getState().udls.map(({ magnitude, x1, x2 }) => [magnitude, x1, x2]),
    ).toEqual([
      [12, 1, 3],
      [12, 3, 5],
      [12, 5, 7],
    ]);
  });

  it("evaluates parameter expressions and stores the expression text", async () => {
    render(<UdlDialogApp />);
    hydrate([{ id: "u1", magnitude: 12, x1: 1, x2: 3 }]);
    const x2 = screen.getByLabelText("UDL x2");
    await userEvent.clear(x2);
    await userEvent.type(x2, "H+1");
    await userEvent.tab();
    const row = useAppStore.getState().udls[0];
    expect(row.x2).toBe(5);
    expect(row.expressions?.x2).toBe("H+1");
    expect((x2 as HTMLInputElement).value).toBe("H+1");

    // Typing a plain number again drops the expression.
    await userEvent.clear(x2);
    await userEvent.type(x2, "7");
    await userEvent.tab();
    expect(useAppStore.getState().udls[0].x2).toBe(7);
    expect(useAppStore.getState().udls[0].expressions?.x2).toBeUndefined();
  });

  it("keeps the last valid value when an expression cannot be evaluated", async () => {
    render(<UdlDialogApp />);
    hydrate([{ id: "u1", magnitude: 12, x1: 1, x2: 3 }]);
    const x1 = screen.getByLabelText("UDL x1");
    await userEvent.clear(x1);
    await userEvent.type(x1, "unknown*2");
    await userEvent.tab();
    const row = useAppStore.getState().udls[0];
    expect(row.x1).toBe(1);
    expect(row.expressions?.x1).toBe("unknown*2");
    expect(x1.getAttribute("style")).toContain("var(--color-vsc-error)");
  });

  it("clamps the magnitude to a small positive value", async () => {
    render(<UdlDialogApp />);
    hydrate([{ id: "u1", magnitude: 12, x1: 1, x2: 3 }]);
    const mag = screen.getByLabelText("UDL magnitude");
    await userEvent.clear(mag);
    await userEvent.type(mag, "-4");
    await userEvent.tab();
    expect(useAppStore.getState().udls[0].magnitude).toBe(0.1);
  });

  it("closes the window from the Close button", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    render(<UdlDialogApp />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalled();
    close.mockRestore();
  });

  it("unsubscribes from IPC on unmount", () => {
    const { unmount } = render(<UdlDialogApp />);
    expect(bridge.listenerCount("onLoadsState")).toBe(1);
    unmount();
    expect(bridge.listenerCount("onLoadsState")).toBe(0);
    expect(bridge.listenerCount("onLoadsChanged")).toBe(0);
  });
});

describe("LineLoadsDialogApp", () => {
  it("adds new line loads 5 m beyond the last one", async () => {
    render(<LineLoadsDialogApp />);
    hydrate([], []);
    await userEvent.click(screen.getByRole("button", { name: "+ Add Line Load" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Add Line Load" }));
    expect(
      useAppStore.getState().lineLoads.map(({ magnitude, x }) => [magnitude, x]),
    ).toEqual([
      [50, 10],
      [50, 15],
    ]);
  });

  it("shows, edits and removes line loads", async () => {
    render(<LineLoadsDialogApp />);
    hydrate([], [{ id: "l1", magnitude: 50, x: 10 }]);
    const mag = screen.getByLabelText("Line load magnitude") as HTMLInputElement;
    expect(mag.value).toBe("50");

    await userEvent.clear(mag);
    await userEvent.type(mag, "75");
    await userEvent.tab();
    expect(useAppStore.getState().lineLoads[0].magnitude).toBe(75);

    const x = screen.getByLabelText("Line load x");
    await userEvent.clear(x);
    await userEvent.type(x, "H*3");
    await userEvent.tab();
    expect(useAppStore.getState().lineLoads[0]).toMatchObject({
      x: 12,
      expressions: { x: "H*3" },
    });
    const sent = bridge.sentOf<{ lineLoads: LineLoadRow[] }>("sendLoadsChanged");
    expect(sent.at(-1)!.lineLoads[0].x).toBe(12);

    // Clearing the cell removes the expression.
    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: "" } });
    fireEvent.blur(x);
    expect(useAppStore.getState().lineLoads[0].expressions?.x).toBeUndefined();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove line load 1" }),
    );
    expect(useAppStore.getState().lineLoads).toEqual([]);
  });

  it("adds a line load with defaults", async () => {
    render(<LineLoadsDialogApp />);
    hydrate([], []);
    await userEvent.click(screen.getByRole("button", { name: /Add/ }));
    expect(useAppStore.getState().lineLoads).toHaveLength(1);
    expect(screen.getAllByLabelText("Line load magnitude")).toHaveLength(1);
  });
});
