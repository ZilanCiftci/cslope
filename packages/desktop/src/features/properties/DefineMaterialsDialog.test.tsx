import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MaterialModel } from "@cslope/engine";

import { DefineMaterialsDialog } from "./DefineMaterialsDialog";
import { useAppStore } from "../../store/app-store";
import type { MaterialRow } from "../../store/types";

const store = () => useAppStore.getState();
const mats = () => store().materials;
const model = <T extends MaterialModel = MaterialModel>(i = 0) => mats()[i].model as T;

function material(id: string, name: string, m: MaterialModel): MaterialRow {
  return { id, name, color: "#123456", model: m, modelExpressions: {} };
}

async function setField(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  if (text) await userEvent.type(input, text);
  await userEvent.tab();
  return input as HTMLInputElement;
}

const kindSelect = () =>
  screen.getByDisplayValue(/Mohr-Coulomb|Undrained|High|Impenetrable|Spatial|Anisotropic|S = f|Lime|Bedrock|function/i) as HTMLSelectElement;

beforeEach(() => {
  store().newProject();
  store().setParameters([{ id: "p", name: "g", expression: "19" }]);
});

afterEach(() => {
  cleanup();
});

describe("DefineMaterialsDialog — material list", () => {
  it("lists materials with their model and edits name and colour", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const m = mats()[0];
    const nameInput = screen.getByDisplayValue(m.name);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Clay");
    expect(mats()[0].name).toBe("Clay");
    fireEvent.change(screen.getByLabelText("Color for Clay"), {
      target: { value: "#ff0000" },
    });
    expect(mats()[0].color).toBe("#ff0000");
  });

  it("cannot delete the last material", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(del);
    expect(mats()).toHaveLength(1);
  });

  it("adds a material, selects it, and deletes the selected one", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const firstId = mats()[0].id;
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mats()).toHaveLength(2);
    const newId = mats()[1].id;
    // The new material's fields are shown: edit them.
    await setField("c (kPa)", "7");
    expect(mats()[1].model).toMatchObject({ cohesion: 7 });
    expect(mats()[0].model).not.toMatchObject({ cohesion: 7 });

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mats().map((m) => m.id)).toEqual([firstId]);
    expect(mats().some((m) => m.id === newId)).toBe(false);
  });

  it("deletes the shown material after the list was replaced from outside", async () => {
    // The Materials window mounts before the main window's state arrives.
    render(<DefineMaterialsDialog onClose={() => {}} />);
    act(() => {
      store().setMaterials([
        material("a", "Sand", { kind: "mohr-coulomb", unitWeight: 19, cohesion: 0, frictionAngle: 34 }),
        material("b", "Clay", { kind: "undrained", unitWeight: 17, undrainedShearStrength: 40 }),
      ]);
    });
    // The first material is shown...
    expect(screen.getByLabelText("φ (°)")).toHaveValue("34");
    // ...and Delete removes it.
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mats().map((m) => m.id)).toEqual(["b"]);
    expect(screen.getByLabelText("Su (kPa)")).toHaveValue("40");
  });

  it("selects a material by clicking its row", async () => {
    store().setMaterials([
      material("a", "Sand", { kind: "mohr-coulomb", unitWeight: 19, cohesion: 0, frictionAngle: 34 }),
      material("b", "Clay", { kind: "undrained", unitWeight: 17, undrainedShearStrength: 40 }),
    ]);
    render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.getByLabelText("φ (°)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("cell", { name: "Undrained" }));
    expect(screen.queryByLabelText("φ (°)")).toBeNull();
    expect(screen.getByLabelText("Su (kPa)")).toHaveValue("40");
  });

  it("closes from the footer, the header and with Escape in popup mode", async () => {
    const onClose = vi.fn();
    render(<DefineMaterialsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByTitle("Close"));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("renders as a full window with a Close button in window mode", async () => {
    const onClose = vi.fn();
    render(<DefineMaterialsDialog onClose={onClose} mode="window" />);
    expect(screen.getByRole("heading", { name: "Define Materials" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DefineMaterialsDialog — Mohr-Coulomb fields", () => {
  it("edits γ, φ and c, rejecting negative values", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await setField("φ (°)", "28.5");
    await setField("c (kPa)", "-3");
    await setField("γ (kN/m³)", "0");
    expect(model()).toMatchObject({ frictionAngle: 28.5, cohesion: 0, unitWeight: 0.01 });
  });

  it("stores parameter expressions and evaluates them", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const gamma = await setField("γ (kN/m³)", "g+1");
    expect(model().unitWeight).toBe(20);
    expect(mats()[0].modelExpressions).toEqual({ unitWeight: "g+1" });
    expect(gamma.value).toBe("g+1");
    // An unknown name keeps the value and marks the field.
    const c = await setField("c (kPa)", "nope");
    expect(mats()[0].modelExpressions?.cohesion).toBe("nope");
    expect(c.getAttribute("style")).toContain("var(--color-vsc-error)");
    // Clearing the field removes the expression.
    await setField("c (kPa)", "");
    expect(mats()[0].modelExpressions?.cohesion).toBeUndefined();
  });

  it("sets and clears the saturated unit weight", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const sat = screen.getByLabelText("Saturated unit weight");
    await userEvent.type(sat, "21");
    expect(model().unitWeightSat).toBe(21);
    await userEvent.clear(sat);
    expect(model().unitWeightSat).toBeUndefined();
  });
});

describe("DefineMaterialsDialog — switching the model", () => {
  it("resets to the new kind's defaults but keeps γ, γsat and its expression", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await setField("γ (kN/m³)", "g");
    await setField("c (kPa)", "g*2");
    await userEvent.type(screen.getByLabelText("Saturated unit weight"), "22");
    await userEvent.selectOptions(kindSelect(), "undrained");
    expect(model()).toEqual({
      kind: "undrained",
      unitWeight: 19,
      undrainedShearStrength: 50,
      unitWeightSat: 22,
    });
    expect(mats()[0].modelExpressions).toEqual({ unitWeight: "g" });
    // The list shows the new model name.
    expect(screen.getByRole("cell", { name: "Undrained" })).toBeInTheDocument();
  });

  it("drops γsat for an impenetrable material and hides its field", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText("Saturated unit weight"), "22");
    await userEvent.selectOptions(kindSelect(), "impenetrable");
    expect(model().unitWeightSat).toBeUndefined();
    expect(screen.queryByLabelText("Saturated unit weight")).toBeNull();
  });

  it("edits undrained strength and the cutoff", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "undrained");
    await setField("Su (kPa)", "35");
    const cutoff = screen.getByLabelText("Max Su (cutoff) (kPa)");
    await userEvent.type(cutoff, "80");
    expect(model()).toMatchObject({ undrainedShearStrength: 35, suMax: 80 });
    await userEvent.clear(cutoff);
    expect(model()).not.toHaveProperty("suMax", 80);
    expect((model() as { suMax?: number }).suMax).toBeUndefined();
  });

  it("edits S = f(depth) fields", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "s-f-depth");
    await setField("Su ref (kPa)", "20");
    await setField("Depth ref (m)", "-2");
    await setField("Rate (kPa/m)", "1.5");
    await userEvent.selectOptions(screen.getByLabelText("Depth measured from"), "ground");
    expect(model()).toMatchObject({
      kind: "s-f-depth",
      suRef: 20,
      depthRef: -2,
      rate: 1.5,
      depthReference: "ground",
    });
  });

  it("edits S = f(datum) fields", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "s-f-datum");
    await setField("Su ref (kPa)", "15");
    await setField("Y ref (m)", "4");
    await setField("Rate (kPa/m)", "-0.5");
    expect(model()).toMatchObject({ kind: "s-f-datum", suRef: 15, yRef: 4, rate: -0.5 });
  });

  it("edits lime-cement column fields and the drained limit", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "lime-cement-columns");
    await setField("Area ratio a (–)", "1.5");
    expect(model()).toMatchObject({ areaRatio: 1 });
    await setField("Su columns (kPa)", "150");
    await setField("Su soil at level (m)", "-3");
    expect(model()).toMatchObject({ columnSu: 150, suRefDepth: -3 });

    expect(screen.queryByLabelText("c′ columns (kPa)")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /Drained limit/ }));
    expect(model()).toMatchObject({ columnCohesion: 45, columnFrictionAngle: 30 });
    await setField("φ′ columns (°)", "95");
    expect(model()).toMatchObject({ columnFrictionAngle: 89 });
    await userEvent.click(screen.getByRole("checkbox", { name: /Drained limit/ }));
    expect((model() as { columnCohesion?: number }).columnCohesion).toBeUndefined();
    expect(screen.queryByLabelText("c′ columns (kPa)")).toBeNull();
  });

  it("edits the anisotropic modifier table", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "anisotropic-function");
    await userEvent.click(screen.getByRole("button", { name: "+ Add Row" }));
    const rows = () => (model() as { modifierFunction: [number, number][] }).modifierFunction;
    expect(rows()).toEqual([
      [0, 1],
      [90, 1],
      [90, 1],
    ]);
    const factor = screen.getByLabelText("Factor row 3");
    await userEvent.clear(factor);
    await userEvent.type(factor, "0,8");
    await userEvent.tab();
    expect(rows()[2]).toEqual([90, 0.8]);
    await userEvent.click(screen.getByRole("button", { name: "Remove row 3" }));
    expect(rows()).toHaveLength(2);
  });

  it("edits spatial Mohr-Coulomb data points and interpolation", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "spatial-mohr-coulomb");
    expect(screen.getByRole("alert", { name: "Validation errors" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ Add Row" }));
    const c = screen.getByLabelText("c (kPa) row 1");
    await userEvent.clear(c);
    await userEvent.type(c, "12");
    await userEvent.tab();
    const dp = (model() as { dataPoints: number[][] }).dataPoints;
    expect(dp).toEqual([[0, 0, 12, 0, 0]]);
    await userEvent.selectOptions(screen.getByLabelText("Interpolation method"), "nearest");
    expect(model()).toMatchObject({ interpolation: "nearest" });
  });

  it.each(["high-strength", "impenetrable"])(
    "edits the unit weight of a %s material",
    async (kind) => {
      render(<DefineMaterialsDialog onClose={() => {}} />);
      await userEvent.selectOptions(kindSelect(), kind);
      expect(screen.getByText(/slip surfaces (passing through|cannot enter) this material/)).toBeInTheDocument();
      await setField("γ (kN/m³)", "23");
      expect(model()).toEqual(expect.objectContaining({ kind, unitWeight: 23 }));
      expect(screen.queryByLabelText("c (kPa)")).toBeNull();
    },
  );

  it("edits strength values of anisotropic and spatial materials", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "anisotropic-function");
    await setField("φ (°)", "25");
    await setField("c (kPa)", "4");
    await setField("γ (kN/m³)", "g");
    expect(model()).toMatchObject({ frictionAngle: 25, cohesion: 4, unitWeight: 19 });
    await userEvent.selectOptions(kindSelect(), "spatial-mohr-coulomb");
    await setField("γ (kN/m³)", "21");
    expect(model()).toMatchObject({ kind: "spatial-mohr-coulomb", unitWeight: 21 });
  });

  it.each([
    ["undrained", ["Su (kPa)"], { undrainedShearStrength: "g" }],
    ["s-f-depth", ["Su ref (kPa)", "Depth ref (m)", "Rate (kPa/m)"], { suRef: "g", depthRef: "g", rate: "g" }],
    ["s-f-datum", ["Su ref (kPa)", "Y ref (m)", "Rate (kPa/m)"], { suRef: "g", yRef: "g", rate: "g" }],
  ] as const)("stores parameter expressions for %s strength fields", async (kind, labels, expected) => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), kind);
    for (const label of labels) await setField(label, "g");
    expect(mats()[0].modelExpressions).toEqual(expected);
    for (const key of Object.keys(expected)) {
      expect((model() as unknown as Record<string, number>)[key]).toBe(19);
    }
    // γ and the strength cutoff can be set for these kinds too.
    await setField("γ (kN/m³)", "17.5");
    await userEvent.type(screen.getByLabelText("Max Su (cutoff) (kPa)"), "120");
    expect(model()).toMatchObject({ unitWeight: 17.5, suMax: 120 });
  });

  it("shows validation errors for invalid values", async () => {
    store().setMaterials([
      material("a", "Bad", { kind: "mohr-coulomb", unitWeight: 19, cohesion: -1, frictionAngle: 30 }),
    ]);
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const alert = screen.getByRole("alert", { name: "Validation errors" });
    expect(alert).toHaveTextContent("Cohesion (c) must be ≥ 0.");
    expect(screen.getByLabelText("c (kPa)")).toHaveAttribute("aria-invalid", "true");
  });
});
