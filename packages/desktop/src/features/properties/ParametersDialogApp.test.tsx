import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/is-electron", () => ({ isElectron: true }));

import { ParametersDialogApp } from "./ParametersDialogApp";
import { useAppStore } from "../../store/app-store";
import { installFakeBridge, type FakeBridge } from "../../test/fake-bridge";
import type { ParameterDef } from "../../store/types";

let bridge: FakeBridge;
const params = () => useAppStore.getState().parameters;

function hydrate(parameters: ParameterDef[]) {
  bridge.emit("onParametersState", { parameters });
}

const names = () =>
  (screen.queryAllByLabelText("Parameter name") as HTMLInputElement[]).map(
    (i) => i.value,
  );

beforeEach(() => {
  useAppStore.getState().newProject();
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  bridge.uninstall();
});

describe("ParametersDialogApp", () => {
  it("lists parameters alphabetically with their resolved values", () => {
    render(<ParametersDialogApp />);
    expect(bridge.callNames()).toContain("requestParametersState");
    hydrate([
      { id: "a", name: "width", expression: "H*2" },
      { id: "b", name: "H", expression: "5" },
      { id: "c", name: "", expression: "0" },
    ]);
    // Unnamed parameters go last.
    expect(names()).toEqual(["H", "width", ""]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("5");
    expect(rows[1]).toHaveTextContent("10");
    expect(rows[2]).toHaveTextContent("Parameter name is empty.");
    expect(bridge.sentOf("sendParametersChanged")).toEqual([]);
  });

  it("adds a parameter and broadcasts the list", async () => {
    render(<ParametersDialogApp />);
    hydrate([]);
    await userEvent.click(screen.getByRole("button", { name: "+ Add Parameter" }));
    expect(params()).toHaveLength(1);
    expect(params()[0]).toMatchObject({ name: "p1", expression: "0" });
    // A new row gets a valid name, so it shows its value, not an error.
    expect(screen.queryByText("Parameter name is empty.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "+ Add Parameter" }));
    expect(params().map((p) => p.name)).toEqual(["p1", "p2"]);
    const sent = bridge.sentOf<{ parameters: ParameterDef[] }>(
      "sendParametersChanged",
    );
    expect(sent.at(-1)!.parameters).toHaveLength(2);
  });

  it("renames and edits expressions, recomputing dependants", async () => {
    render(<ParametersDialogApp />);
    hydrate([
      { id: "a", name: "H", expression: "5" },
      { id: "b", name: "D", expression: "H/2" },
    ]);
    const exprs = screen.getAllByLabelText("Parameter expression");
    // Sorted: D first, then H.
    await userEvent.clear(exprs[1]);
    await userEvent.type(exprs[1], "8");
    expect(params().find((p) => p.id === "a")!.expression).toBe("8");
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("4");

    const nameInputs = screen.getAllByLabelText("Parameter name");
    await userEvent.clear(nameInputs[0]);
    await userEvent.type(nameInputs[0], "depth");
    expect(params().find((p) => p.id === "b")!.name).toBe("depth");
    expect(names()).toEqual(["depth", "H"]);
  });

  it("flags invalid and duplicate names and unresolved expressions", () => {
    render(<ParametersDialogApp />);
    hydrate([
      { id: "a", name: "H", expression: "5" },
      { id: "b", name: "H", expression: "6" },
      { id: "c", name: "1bad", expression: "1" },
      { id: "d", name: "x", expression: "y+1" },
    ]);
    const inputs = screen.getAllByLabelText("Parameter name");
    const errorStyle = (el: HTMLElement) =>
      el.getAttribute("style")!.includes("var(--color-vsc-error)");
    const byName = (n: string) =>
      inputs.filter((i) => (i as HTMLInputElement).value === n);
    expect(byName("H").every(errorStyle)).toBe(true);
    expect(byName("1bad").every(errorStyle)).toBe(true);
    expect(byName("x").every(errorStyle)).toBe(false);
    expect(screen.getAllByText("Duplicate parameter name.")).toHaveLength(2);
    expect(screen.getByText("Parameter name is invalid.")).toBeInTheDocument();
    const xRow = screen
      .getAllByRole("row")
      .find((r) => r.querySelector("input")?.value === "x")!;
    expect(xRow.textContent).not.toMatch(/\d$/);
  });

  it("removes the parameter in the clicked (sorted) row", async () => {
    render(<ParametersDialogApp />);
    hydrate([
      { id: "a", name: "zeta", expression: "1" },
      { id: "b", name: "alpha", expression: "2" },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Remove parameter 1" }));
    expect(params().map((p) => p.name)).toEqual(["zeta"]);
  });
});
