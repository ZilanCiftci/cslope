import { describe, expect, it } from "vitest";
import { resolveAnnotationText } from "./resolveAnnotationText";

describe("resolveAnnotationText", () => {
  const parameters = [
    { id: "p1", name: "road_x1", expression: "10" },
    { id: "p2", name: "road_width", expression: "5" },
  ];

  it("resolves static tags and parameter hash tags", () => {
    const text = "#Title | x1=#road_x1";
    const resolved = resolveAnnotationText({
      text,
      projectInfo: { title: "Demo" },
      parameters,
    });

    expect(resolved).toBe("Demo | x1=10");
  });

  it("resolves expression blocks using parameters", () => {
    const text = "x2={{road_x1 + road_width}}";
    const resolved = resolveAnnotationText({
      text,
      projectInfo: {},
      parameters,
    });

    expect(resolved).toBe("x2=15");
  });

  it("keeps invalid expression blocks unchanged", () => {
    const text = "bad={{unknown + 1}}";
    const resolved = resolveAnnotationText({
      text,
      projectInfo: {},
      parameters,
    });

    expect(resolved).toBe("bad={{unknown + 1}}");
  });
});
