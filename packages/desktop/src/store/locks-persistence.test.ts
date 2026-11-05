/**
 * Locks are saved with each model (an optional `locks` field of the model
 * entry), read back from JSON projects and .cslp archives, and absent in
 * older files; imported models start with their geometry locked.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { SlopeDefinition } from "@cslope/engine";
import { useAppStore } from "./app-store";
import { parseProjectFile, serializeProject } from "./persistence";
import { buildProjectArchive, readProjectBytes } from "../features/project/cslp";
import { openZip } from "../utils/zip";
import { addImportedModels } from "../features/project/importedModels";
import { importDxf } from "../features/project/importDxf";
import { isProjectDirty, markProjectClean } from "./unsaved";

const s = () => useAppStore.getState();

beforeEach(() => {
  s().newProject();
  s().addMaterialBoundary([
    [0, 5],
    [50, 5],
  ]);
  s().addPiezoLine([
    [0, 8],
    [50, 6],
  ]);
  s().addUdl();
});

function lockSome() {
  s().setObjectLocked({ type: "exterior" }, true);
  s().setObjectLocked({ type: "boundary", id: s().materialBoundaries[0].id }, true);
  s().setObjectLocked({ type: "udl", id: s().udls[0].id }, true);
  s().setObjectLocked({ type: "searchLimits" }, true);
  return s().locks;
}

describe("locks in a JSON project", () => {
  it("round-trip with the model", () => {
    const locks = lockSome();
    s().saveCurrentModel();
    const loaded = parseProjectFile(JSON.stringify(serializeProject(s())));
    expect(loaded.models[0].locks).toEqual(locks);
    s().loadProject(loaded);
    expect(s().locks).toEqual(locks);
  });

  it("are left out of a model with nothing locked, and read as none from older files", () => {
    s().saveCurrentModel();
    const file = JSON.parse(JSON.stringify(serializeProject(s())));
    expect(file.models[0]).not.toHaveProperty("locks");
    const loaded = parseProjectFile(JSON.stringify(file));
    expect(loaded.models[0].locks).toBeUndefined();
    s().loadProject(loaded);
    expect(s().locks).toEqual({});
    // An older file opens as saved.
    markProjectClean(s());
    expect(isProjectDirty(s())).toBe(false);
  });

  it("keep only valid entries: known keys, the right shapes, ids of the model's objects", () => {
    s().saveCurrentModel();
    const file = JSON.parse(JSON.stringify(serializeProject(s())));
    const bnd = s().materialBoundaries[0].id;
    file.models[0].locks = { exterior: 1, boundaries: [bnd, "nope", 7], waterLines: true, loads: "all", searchLimits: true, extra: [1] };
    expect(parseProjectFile(JSON.stringify(file)).models[0].locks).toEqual({ boundaries: [bnd], searchLimits: true });
    file.models[0].locks = "locked";
    expect(parseProjectFile(JSON.stringify(file)).models[0].locks).toBeUndefined();
  });
});

describe("locks in a .cslp archive", () => {
  it("are written in model.json and read back", async () => {
    const locks = lockSome();
    s().saveCurrentModel();
    const bytes = await buildProjectArchive(s());
    const zip = await openZip(bytes);
    const id = s().activeModelId;
    const modelJson = JSON.parse(new TextDecoder().decode(await zip.read(`models/${id}/model.json`)));
    expect(modelJson.locks).toEqual(locks);
    const opened = await readProjectBytes(bytes);
    expect(opened.models[0].locks).toEqual(locks);
  });

  it("have no entry for a model with nothing locked", async () => {
    s().saveCurrentModel();
    const bytes = await buildProjectArchive(s());
    const zip = await openZip(bytes);
    const modelJson = JSON.parse(new TextDecoder().decode(await zip.read(`models/${s().activeModelId}/model.json`)));
    expect(modelJson).not.toHaveProperty("locks");
    expect((await readProjectBytes(bytes)).models[0].locks).toBeUndefined();
  });
});

describe("imported models", () => {
  const definition: SlopeDefinition = {
    orientation: "ltr",
    coordinates: [
      [0, 0],
      [0, 10],
      [20, 10],
      [40, 0],
    ],
    materials: [{ name: "Clay", color: "#a08060", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 25 } }],
    materialBoundaries: [{ coordinates: [[0, 5], [30, 5]], materialName: "Clay" }],
  } as SlopeDefinition;

  it("from another program's file start with the exterior and material boundaries locked", () => {
    addImportedModels([{ name: "Imported", definition, options: {}, notes: [] }], "a.gsz", "circle");
    const model = s().models.find((m) => m.id === s().activeModelId)!;
    const ids = s().materialBoundaries.map((b) => b.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(model.locks).toEqual({ exterior: true, boundaries: ids, fromImport: true });
    expect(s().locks).toEqual(model.locks);
    // Locked, the geometry is still selectable; the import is no undo step.
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it("from a DXF drawing start with the outline and boundaries locked, no undo step", () => {
    const pairs = (p: (string | number)[][]) => p.map(([c, v]) => `${c}\n${v}`).join("\n") + "\n";
    const lw = (layer: string, closed: boolean, pts: number[][]) => [
      [0, "LWPOLYLINE"], [8, layer], [90, pts.length], [70, closed ? 1 : 0],
      ...pts.flatMap(([x, y]) => [[10, x], [20, y]]),
    ];
    importDxf(
      pairs([
        [0, "SECTION"], [2, "ENTITIES"],
        ...lw("outline", true, [[0, -20], [0, -10], [20, -10], [40, 0], [60, 0], [60, -20]]),
        ...lw("layer", false, [[0, -14], [60, -12]]),
        [0, "ENDSEC"], [0, "EOF"],
      ]),
      "Profile.dxf",
    );
    expect(s().locks).toEqual({ exterior: true, boundaries: [s().materialBoundaries[0].id], fromImport: true });
    expect(useAppStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
