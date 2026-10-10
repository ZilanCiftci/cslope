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

describe("resolveAnnotationText tag matching", () => {
  it("does not replace a tag that is only the prefix of a parameter name", () => {
    const out = resolveAnnotationText({
      text: "#FOS / #FOS_target",
      projectInfo: {},
      result: { minFOS: 1.234 } as never,
      parameters: [{ id: "p1", name: "FOS_target", expression: "1.5" }],
    });
    expect(out).toBe("1.234 / 1.5");
  });

  it("keeps dollar signs in project values literally", () => {
    const out = resolveAnnotationText({
      text: "#Title",
      projectInfo: { title: "Cost $& and $$5" },
    });
    expect(out).toBe("Cost $& and $$5");
  });
});
