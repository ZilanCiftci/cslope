import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./app-store";
import { nextId } from "./helpers";

const store = () => useAppStore.getState();
const active = () => store().models.find((m) => m.id === store().activeModelId)!;

beforeEach(() => {
  store().newProject();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("piles", () => {
  it("adds, updates and removes piles on the flat state and the active model", () => {
    useAppStore.setState({ runState: "done", result: { minFOS: 1 } as never });
    store().addPile();
    store().addPile("sheet-pile");
    const [pile, sheet] = store().piles;
    expect(pile.type).toBe("pile");
    expect(sheet.type).toBe("sheet-pile");
    expect(active().piles).toEqual(store().piles);
    // Any load change discards the result.
    expect(store().result).toBeNull();

    store().updatePile(pile.id, { x1: 12.5 });
    expect(store().piles[0].x1).toBe(12.5);
    expect(store().piles[1]).toEqual(sheet);
    expect(active().piles?.[0].x1).toBe(12.5);

    store().removePile(pile.id);
    expect(store().piles.map((p) => p.id)).toEqual([sheet.id]);
    expect(active().piles?.map((p) => p.id)).toEqual([sheet.id]);
  });

  it("load edits leave the other load lists of the model untouched", () => {
    store().addUdl();
    store().addLineLoad();
    store().addReinforcement("nail");
    const { udls, lineLoads, reinforcements } = store();
    store().addPile();
    expect(active()).toMatchObject({ udls, lineLoads, reinforcements });
    expect(reinforcements[0].type).toBe("nail");
  });

  it("only the active model receives the edit", () => {
    const a = store().activeModelId;
    store().addModel("B");
    const b = store().activeModelId;
    store().switchModel(a);
    store().addPile();
    expect(store().models.find((m) => m.id === b)!.piles ?? []).toEqual([]);
  });
});

describe("nextId", () => {
  it("uses random UUIDs when available", () => {
    expect(nextId("udl")).toMatch(/^udl-[0-9a-f-]{36}$/);
    expect(nextId("udl")).not.toBe(nextId("udl"));
  });

  it("falls back to a counter without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {});
    const a = nextId("x");
    const b = nextId("x");
    expect(a).toMatch(/^x-\d+$/);
    expect(Number(b.slice(2))).toBe(Number(a.slice(2)) + 1);
  });
});

describe("distributed load direction", () => {
  it("keeps a load normal to the ground through the project file and passes it to the engine", async () => {
    const { parseProjectFile, serializeProject } = await import("./persistence");
    const { buildSlopeDTOFromModel } = await import("./helpers");
    store().addUdl();
    const id = store().udls[0].id;
    store().updateUdl(id, { direction: "normal", magnitude: 20, x1: 1, x2: 4 });
    store().saveCurrentModel();
    const loaded = parseProjectFile(JSON.stringify(serializeProject(store()))).models[0];
    expect(loaded.udls[0].direction).toBe("normal");
    expect(buildSlopeDTOFromModel(loaded).udls![0]).toMatchObject({ magnitude: 20, direction: "normal" });
    // vertical (not set) stays without a direction
    store().updateUdl(id, { direction: undefined });
    store().saveCurrentModel();
    const again = parseProjectFile(JSON.stringify(serializeProject(store()))).models[0];
    expect("direction" in again.udls[0]).toBe(false);
  });
});
