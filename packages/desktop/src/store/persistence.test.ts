import { describe, expect, it } from "vitest";
import { parseProjectFile } from "./persistence";

function makeBaseProject(models: unknown[]) {
  return JSON.stringify({
    version: 1,
    activeModelId: "m1",
    models,
  });
}

describe("persistence orientation migration", () => {
  it("defaults to LTR when orientation is missing and crest is on left", () => {
    const json = makeBaseProject([
      {
        id: "m1",
        name: "Legacy LTR",
        coordinates: [
          [0, 0],
          [0, 10],
          [10, 5],
          [10, 0],
        ],
        materials: [
          {
            id: "mat-1",
            name: "M1",
            unitWeight: 20,
            frictionAngle: 30,
            cohesion: 5,
            color: "#6d5f2a",
          },
        ],
      },
    ]);

    const parsed = parseProjectFile(json);
    expect(parsed.models[0].orientation).toBe("ltr");
  });

  it("infers RTL when orientation is missing and crest is on right", () => {
    const json = makeBaseProject([
      {
        id: "m1",
        name: "Legacy RTL",
        coordinates: [
          [0, 0],
          [0, 5],
          [10, 10],
          [10, 0],
        ],
        materials: [
          {
            id: "mat-1",
            name: "M1",
            unitWeight: 20,
            frictionAngle: 30,
            cohesion: 5,
            color: "#6d5f2a",
          },
        ],
      },
    ]);

    const parsed = parseProjectFile(json);
    expect(parsed.models[0].orientation).toBe("rtl");
  });

  it("keeps explicit orientation from file", () => {
    const json = makeBaseProject([
      {
        id: "m1",
        name: "Explicit RTL",
        orientation: "rtl",
        coordinates: [
          [0, 0],
          [0, 10],
          [10, 5],
          [10, 0],
        ],
        materials: [
          {
            id: "mat-1",
            name: "M1",
            unitWeight: 20,
            frictionAngle: 30,
            cohesion: 5,
            color: "#6d5f2a",
          },
        ],
      },
    ]);

    const parsed = parseProjectFile(json);
    expect(parsed.models[0].orientation).toBe("rtl");
  });
});
