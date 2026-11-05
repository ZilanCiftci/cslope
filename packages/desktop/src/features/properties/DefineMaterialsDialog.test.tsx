import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  screen.getByDisplayValue(/Mohr-Coulomb|Undrained|High|Impenetrable|Spatial|Anisotropic|S = f|Lime|Bedrock|function|SHANSEP/i) as HTMLSelectElement;

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
    await setField("c′ (kPa)", "7");
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
    expect(screen.getByLabelText("φ′ (°)")).toHaveValue("34");
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
    expect(screen.getByLabelText("φ′ (°)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("cell", { name: "Undrained" }));
    expect(screen.queryByLabelText("φ′ (°)")).toBeNull();
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
    expect(screen.getByRole("heading", { level: 2, name: "Materials" })).toBeInTheDocument();
    // The settings below the list name the material they edit.
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(useAppStore.getState().materials[0].name);
    expect(screen.getByRole("combobox", { name: "Material model" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DefineMaterialsDialog — Mohr-Coulomb fields", () => {
  it("edits γ, φ and c, rejecting negative values", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await setField("φ′ (°)", "28.5");
    await setField("c′ (kPa)", "-3");
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
    const c = await setField("c′ (kPa)", "nope");
    expect(mats()[0].modelExpressions?.cohesion).toBe("nope");
    expect(c.getAttribute("style")).toContain("var(--color-vsc-error)");
    // Clearing the field removes the expression.
    await setField("c′ (kPa)", "");
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

  it("sets φb and the maximum suction, and clears them", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    // The maximum is offered once φb is set.
    expect(screen.queryByLabelText("Max suction (kPa)")).toBeNull();
    const phiB = screen.getByLabelText("φb (°)");
    await userEvent.type(phiB, "15");
    expect(model()).toMatchObject({ kind: "mohr-coulomb", phiB: 15 });
    const cap = screen.getByLabelText("Max suction (kPa)");
    await userEvent.type(cap, "80");
    expect(model()).toMatchObject({ phiB: 15, maxSuction: 80 });
    await userEvent.clear(cap);
    expect((model() as { maxSuction?: number }).maxSuction).toBeUndefined();
    await userEvent.clear(phiB);
    expect((model() as { phiB?: number }).phiB).toBeUndefined();
    // 90° and more is not taken
    await userEvent.type(phiB, "95");
    expect((model() as { phiB?: number }).phiB).not.toBe(95);
  });

  it("offers φb for the drained branch of a combined S = f(depth) only, and drops it with the branch", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "s-f-depth");
    expect(screen.queryByLabelText("φb (°)")).toBeNull();
    const combined = screen.getByLabelText("Combined analysis (drained limit)");
    await userEvent.click(combined);
    await userEvent.type(screen.getByLabelText("φb (°)"), "12");
    expect(model()).toMatchObject({ kind: "s-f-depth", phiB: 12 });
    await userEvent.click(combined);
    expect((model() as { phiB?: number }).phiB).toBeUndefined();
    expect(screen.queryByLabelText("φb (°)")).toBeNull();
  });
});

describe("DefineMaterialsDialog — switching the model", () => {
  it("resets to the new kind's defaults but keeps γ, γsat and its expression", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await setField("γ (kN/m³)", "g");
    await setField("c′ (kPa)", "g*2");
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

  it("restores the fields a kind had earlier in the session when switched back", async () => {
    const shansep: MaterialModel = {
      kind: "shansep",
      unitWeight: 16,
      ratio: 0.3,
      exponent: 0.75,
      pop: 10,
      yieldStress: 80,
      yieldFromEarlierStage: true,
      ocrByElevation: [[0, 1.5], [5, 1.2]],
      ru: 0.2,
    };
    store().setMaterials([
      { ...material("a", "Soft clay", shansep), modelExpressions: { ratio: "g/100" } },
    ]);
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "mohr-coulomb");
    expect(model()).toEqual({ kind: "mohr-coulomb", unitWeight: 16, cohesion: 10, frictionAngle: 30, ru: 0.2 });
    await setField("c′ (kPa)", "4");
    await setField("γ (kN/m³)", "17");
    await setField("rᵤ (pore pressure ratio)", "");
    await userEvent.selectOptions(kindSelect(), "undrained");
    await userEvent.selectOptions(kindSelect(), "shansep");
    // The stress history is back; γ and rᵤ are the ones set meanwhile.
    expect(model()).toEqual({ ...shansep, unitWeight: 17, ru: undefined });
    expect(mats()[0].modelExpressions).toEqual({ ratio: "g/100" });
    await userEvent.selectOptions(kindSelect(), "mohr-coulomb");
    expect(model()).toMatchObject({ kind: "mohr-coulomb", cohesion: 4, unitWeight: 17 });
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
    // Constant Su: no cutoff field.
    expect(screen.queryByLabelText("Max Su (cutoff) (kPa)")).toBeNull();
    act(() => {
      store().updateMaterial(mats()[0].id, {
        model: { ...model(), suRateOfChange: 2 } as MaterialModel,
      });
    });
    const cutoff = screen.getByLabelText("Max Su (cutoff) (kPa)");
    await userEvent.type(cutoff, "80");
    expect(model()).toMatchObject({ undrainedShearStrength: 35, suMax: 80 });
    await userEvent.clear(cutoff);
    expect(model()).not.toHaveProperty("suMax", 80);
    expect((model() as { suMax?: number }).suMax).toBeUndefined();
  });

  it("keeps a cutoff on constant Su while it is retyped", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "undrained");
    act(() => {
      store().updateMaterial(mats()[0].id, {
        model: { ...model(), suRateOfChange: 0, suMax: 30 } as MaterialModel,
      });
    });
    // Constant Su with a cutoff set: shown so it can be cleared.
    const cutoff = screen.getByLabelText("Max Su (cutoff) (kPa)");
    await userEvent.clear(cutoff);
    // Emptied while focused: still there to type the new value into.
    expect(screen.getByLabelText("Max Su (cutoff) (kPa)")).toBe(cutoff);
    await userEvent.type(cutoff, "25");
    expect(model()).toMatchObject({ suMax: 25 });
    // Cleared and left: no cutoff, and the field goes.
    await userEvent.clear(cutoff);
    await userEvent.tab();
    expect((model() as { suMax?: number }).suMax).toBeUndefined();
    expect(screen.queryByLabelText("Max Su (cutoff) (kPa)")).toBeNull();
  });

  it("edits S = f(depth) fields", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "s-f-depth");
    await setField("Su at reference depth (kPa)", "20");
    await setField("Reference depth (m)", "-2");
    expect(screen.queryByLabelText(/Su \(cutoff\)/)).toBeNull();
    await setField("Su increase rate (kPa/m)", "1.5");
    expect(screen.getByLabelText("Max Su (cutoff) (kPa)")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Depth measured from"), "ground");
    expect(model()).toMatchObject({
      kind: "s-f-depth",
      suRef: 20,
      depthRef: -2,
      rate: 1.5,
      depthReference: "ground",
    });
  });

  it("edits the combined (drained) branch of S = f(depth)", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "s-f-depth");
    await setField("Su at reference depth (kPa)", "11.4");
    await setField("Su increase rate (kPa/m)", "1.14");
    expect(screen.queryByLabelText("φ′ (°)")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /Combined analysis/ }));
    // defaults: c′ = 0.1·Su with the same depth, φ′ = 30°
    expect(model()).toMatchObject({ drainedCohesion: 1.14, drainedCohesionRate: 0.114, drainedFrictionAngle: 30 });
    await setField("c′ at reference depth (kPa)", "1.2");
    await setField("φ′ (°)", "28");
    expect(model()).toMatchObject({ kind: "s-f-depth", suRef: 11.4, rate: 1.14, drainedCohesion: 1.2, drainedCohesionRate: 0.114, drainedFrictionAngle: 28 });
    await userEvent.click(screen.getByRole("checkbox", { name: /Combined analysis/ }));
    expect((model() as { drainedCohesion?: number }).drainedCohesion).toBeUndefined();
  });

  it("edits S = f(datum) fields", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "s-f-datum");
    await setField("Su at reference level (kPa)", "15");
    await setField("Reference level y (m)", "4");
    await setField("Su increase rate (kPa/m)", "-0.5");
    expect(model()).toMatchObject({ kind: "s-f-datum", suRef: 15, yRef: 4, rate: -0.5 });
    // Su decreasing with depth: the cutoff is a minimum.
    expect(screen.getByLabelText("Min Su (cutoff) (kPa)")).toBeInTheDocument();
  });

  it("edits lime-cement column fields and the drained limit", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "lime-cement-columns");
    await setField("Area ratio a (–)", "1.5");
    expect(model()).toMatchObject({ areaRatio: 1 });
    await setField("Su columns (kPa)", "150");
    await setField("Reference level y (m)", "-3");
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
    await userEvent.click(screen.getByRole("button", { name: "+ Add point" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Remove point 3" }));
    expect(rows()).toHaveLength(2);
  });

  it("edits spatial Mohr-Coulomb data points and interpolation", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "spatial-mohr-coulomb");
    // No errors before the user has entered anything.
    expect(screen.queryByRole("alert", { name: "Validation errors" })).toBeNull();
    expect(screen.getByText("No data points. Add at least one.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ Add point" }));
    const c = screen.getByLabelText("c′ (kPa) row 1");
    await userEvent.clear(c);
    await userEvent.type(c, "12");
    await userEvent.tab();
    const dp = (model() as { dataPoints: number[][] }).dataPoints;
    expect(dp).toEqual([[0, 0, 12, 0, 0]]);
    await userEvent.selectOptions(screen.getByLabelText("Interpolation method"), "nearest");
    expect(model()).toMatchObject({ interpolation: "nearest" });
    // Removing the last point is an error once the user has edited it.
    await userEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    expect(screen.getByRole("alert", { name: "Validation errors" })).toBeInTheDocument();
  });

  it("shows a switched material's errors once it is renamed or left", async () => {
    store().addMaterial();
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const alert = () => screen.queryByRole("alert", { name: "Validation errors" });
    const [first] = mats();
    const listRow = (i: number) =>
      within(screen.getAllByRole("table")[0]).getAllByRole("row")[i + 1];
    await userEvent.selectOptions(kindSelect(), "spatial-mohr-coulomb");
    expect(alert()).toBeNull();
    // Renaming is an edit of the material.
    const name = screen.getAllByLabelText("Material name")[0];
    await userEvent.type(name, "x");
    expect(mats()[0].name).toBe(`${first.name}x`);
    expect(alert()).toBeInTheDocument();

    // Selecting another material and coming back shows them too.
    await userEvent.selectOptions(kindSelect(), "undrained");
    await userEvent.selectOptions(kindSelect(), "spatial-mohr-coulomb");
    expect(alert()).toBeNull();
    await userEvent.click(within(listRow(1)).getAllByRole("cell")[1]);
    expect(mats()[1].model.kind).toBe("mohr-coulomb");
    expect(alert()).toBeNull();
    await userEvent.click(within(listRow(0)).getAllByRole("cell")[1]);
    expect(screen.getByText("No data points. Add at least one.")).toBeInTheDocument();
    expect(alert()).toBeInTheDocument();
  });

  it.each(["high-strength", "impenetrable"])(
    "edits the unit weight of a %s material",
    async (kind) => {
      render(<DefineMaterialsDialog onClose={() => {}} />);
      await userEvent.selectOptions(kindSelect(), kind);
      expect(screen.getByText(/slip surfaces (passing through|cannot enter) this material/)).toBeInTheDocument();
      await setField("γ (kN/m³)", "23");
      expect(model()).toEqual(expect.objectContaining({ kind, unitWeight: 23 }));
      expect(screen.queryByLabelText("c′ (kPa)")).toBeNull();
    },
  );

  it("edits strength values of anisotropic and spatial materials", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "anisotropic-function");
    await setField("φ′ (°)", "25");
    await setField("c′ (kPa)", "4");
    await setField("γ (kN/m³)", "g");
    expect(model()).toMatchObject({ frictionAngle: 25, cohesion: 4, unitWeight: 19 });
    await userEvent.selectOptions(kindSelect(), "spatial-mohr-coulomb");
    await setField("γ (kN/m³)", "21");
    expect(model()).toMatchObject({ kind: "spatial-mohr-coulomb", unitWeight: 21 });
  });

  it.each([
    ["undrained", ["Su (kPa)"], { undrainedShearStrength: "g" }],
    ["s-f-depth", ["Su at reference depth (kPa)", "Reference depth (m)", "Su increase rate (kPa/m)"], { suRef: "g", depthRef: "g", rate: "g" }],
    ["s-f-datum", ["Su at reference level (kPa)", "Reference level y (m)", "Su increase rate (kPa/m)"], { suRef: "g", yRef: "g", rate: "g" }],
  ] as const)("stores parameter expressions for %s strength fields", async (kind, labels, expected) => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), kind);
    for (const label of labels) await setField(label, "g");
    expect(mats()[0].modelExpressions).toEqual(expected);
    for (const key of Object.keys(expected)) {
      expect((model() as unknown as Record<string, number>)[key]).toBe(19);
    }
    await setField("γ (kN/m³)", "17.5");
    expect(model()).toMatchObject({ unitWeight: 17.5 });
    // The strength cutoff only where Su varies with depth.
    if (kind === "undrained") {
      expect(screen.queryByLabelText("Max Su (cutoff) (kPa)")).toBeNull();
      return;
    }
    await userEvent.type(screen.getByLabelText("Max Su (cutoff) (kPa)"), "120");
    expect(model()).toMatchObject({ suMax: 120 });
  });

  it("shows validation errors for invalid values", async () => {
    store().setMaterials([
      material("a", "Bad", { kind: "mohr-coulomb", unitWeight: 19, cohesion: -1, frictionAngle: 30 }),
    ]);
    render(<DefineMaterialsDialog onClose={() => {}} />);
    const alert = screen.getByRole("alert", { name: "Validation errors" });
    expect(alert).toHaveTextContent("Cohesion (c) must be ≥ 0.");
    expect(screen.getByLabelText("c′ (kPa)")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("DefineMaterialsDialog — SHANSEP, shear-normal and B̄", () => {
  it("switches to SHANSEP, edits S, m and OCR, and turns on Su against σ′v", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "shansep");
    expect(model()).toMatchObject({ kind: "shansep", ratio: 0.25, exponent: 0.8, ocr: 1 });
    await setField("S (Su/σ′v)", "0.3");
    await setField("m (exponent)", "0.7");
    await setField("OCR", "1.5");
    expect(model()).toMatchObject({ ratio: 0.3, exponent: 0.7, ocr: 1.5 });
    await userEvent.click(screen.getByLabelText("OCR against elevation"));
    expect(screen.queryByLabelText("OCR")).toBeNull();
    expect(model()).toMatchObject({ ocrByElevation: [[0, 1.5], [10, 1.5]] });
    await userEvent.click(screen.getByLabelText("Su against σ′v"));
    expect(screen.queryByLabelText("S (Su/σ′v)")).toBeNull();
    expect(model()).toMatchObject({ suByStress: [[0, 0], [100, 30]] });
    await userEvent.click(screen.getByLabelText("Su against σ′v"));
    expect((model() as { suByStress?: unknown }).suByStress).toBeUndefined();
    expect(screen.queryByRole("alert", { name: "Validation errors" })).toBeNull();
  });

  it("switches to a shear-normal function with its default points", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.selectOptions(kindSelect(), "shear-normal");
    expect(model()).toMatchObject({ kind: "shear-normal", points: [[0, 0], [100, 60], [300, 150]] });
    expect(screen.getByText("σ′n (kPa)")).toBeInTheDocument();
  });

  it("edits B̄ and the fill flag, and keeps them when the model is switched", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText("B̄ (excess pore pressure from fill above)"), "0.8");
    await userEvent.click(screen.getByLabelText("This material is a fill that loads the B̄ materials below"));
    expect(model()).toMatchObject({ bBar: 0.8, bBarLoad: true });
    await userEvent.selectOptions(kindSelect(), "shansep");
    expect(model()).toMatchObject({ kind: "shansep", bBar: 0.8, bBarLoad: true });
    await userEvent.clear(screen.getByLabelText("B̄ (excess pore pressure from fill above)"));
    await userEvent.click(screen.getByLabelText("This material is a fill that loads the B̄ materials below"));
    expect(model().bBar).toBeUndefined();
    expect(model().bBarLoad).toBeUndefined();
  });

  it("keeps an out-of-range rᵤ and shows the error under the field only, as for B̄", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.getByRole("group", { name: "Additional pore pressure (added to the water line)" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("rᵤ (pore pressure ratio)"), "1.2");
    expect(model().ru).toBe(1.2);
    // Once, under the field (not again in the list of errors), which is outlined, instead of the range hint.
    expect(screen.getByLabelText("rᵤ (pore pressure ratio)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("rᵤ must be at least 0 and below 1.")).toBeInTheDocument();
    expect(screen.queryByText("0 to below 1; empty: none")).toBeNull();
    expect(screen.queryByRole("alert", { name: "Validation errors" })).toBeNull();
    await userEvent.clear(screen.getByLabelText("rᵤ (pore pressure ratio)"));
    await userEvent.type(screen.getByLabelText("rᵤ (pore pressure ratio)"), "0.3");
    expect(model().ru).toBe(0.3);
    expect(screen.queryByRole("alert", { name: "Validation errors" })).toBeNull();
    expect(screen.getByText("0 to below 1; empty: none")).toBeInTheDocument();
  });

  it("turns on the drawdown (R) envelope of a Mohr-Coulomb material, edits cR and φR, and turns it off", async () => {
    render(<DefineMaterialsDialog onClose={() => {}} />);
    expect(screen.queryByLabelText("cR (kPa)")).toBeNull();
    await userEvent.click(screen.getByLabelText("Drawdown strength (R envelope, cR, φR)"));
    await setField("cR (kPa)", "12");
    await setField("φR (°)", "16");
    expect(model()).toMatchObject({ kind: "mohr-coulomb", drawdownStrength: { cohesion: 12, frictionAngle: 16 } });
    await userEvent.click(screen.getByLabelText("Drawdown strength (R envelope, cR, φR)"));
    const m = model();
    expect(m.kind === "mohr-coulomb" ? m.drawdownStrength : undefined).toBeUndefined();
    expect(screen.queryByLabelText("cR (kPa)")).toBeNull();
  });
});
