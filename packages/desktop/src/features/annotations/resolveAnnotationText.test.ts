import { describe, expect, it } from "vitest";
import { ANNOTATION_TAGS, resolveAnnotationText } from "./resolveAnnotationText";

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

describe("resolveAnnotationText single pass (round 5)", () => {
  it("does not re-process text inserted for a tag", () => {
    const out = resolveAnnotationText({
      text: "#Title",
      projectInfo: { title: "Cut #H {{H*2}} C:\\new" },
      parameters: [{ id: "p", name: "H", expression: "10" }],
    });
    expect(out).toBe("Cut #H {{H*2}} C:\\new");
  });

  it("lets a parameter named like a built-in tag be shown", () => {
    const out = resolveAnnotationText({
      text: "date=#date fos=#FOS",
      projectInfo: { date: "2024" },
      parameters: [{ id: "p", name: "date", expression: "3" }],
    });
    expect(out).toBe("date=3 fos=N/A");
  });
});

describe("resolveAnnotationText #FOS3D", () => {
  const sgi3d = { factorOfSafety: 1.61234, equation: "2-3" };

  it("shows the smallest 3D factor of safety when the result has one", () => {
    const out = resolveAnnotationText({
      text: "F2D #FOS, F3D #FOS3D (#fos3d)",
      projectInfo: {},
      result: { minFOS: 1.2, sgi3d } as never,
    });
    expect(out).toBe("F2D 1.200, F3D 1.612 (1.612)");
  });

  it("shows N/A without a 3D result, like #FOS without a result", () => {
    expect(
      resolveAnnotationText({ text: "#FOS3D", projectInfo: {}, result: { minFOS: 1.2 } as never }),
    ).toBe("N/A");
    expect(
      resolveAnnotationText({
        text: "#FOS3D",
        projectInfo: {},
        result: { minFOS: 1.2, sgi3dError: "not circular" } as never,
      }),
    ).toBe("N/A");
    expect(resolveAnnotationText({ text: "#FOS3D|#FOS", projectInfo: {}, result: null })).toBe("N/A|N/A");
  });

  it("does not treat #FOS3D as #FOS followed by text", () => {
    expect(
      resolveAnnotationText({ text: "#FOS3D", projectInfo: {}, result: { minFOS: 1.2 } as never }),
    ).not.toContain("1.200");
  });
});

describe("ANNOTATION_TAGS", () => {
  it("is the one list of built-in tags, each resolved by the resolver", () => {
    expect(ANNOTATION_TAGS.map((t) => t.tag)).toEqual([
      "Title", "Subtitle", "Client", "ProjectNumber", "Revision", "Author", "Checker",
      "Date", "Description", "Method", "FOS", "MinFOS", "FOS3D",
    ]);
    for (const t of ANNOTATION_TAGS) {
      expect(t.description.length).toBeGreaterThan(0);
      // Without a model value every tag shows its documented fallback, not "#tag".
      expect(resolveAnnotationText({ text: `#${t.tag}`, projectInfo: {}, result: null })).toBe(t.missing);
    }
  });

  it("resolves project information and results through the table", () => {
    const projectInfo = {
      title: "T", subtitle: "S", client: "C", projectNumber: "P1", revision: "B",
      author: "A", checker: "K", date: "2026", description: "D",
    };
    const result = { minFOS: 1.4041, method: "Spencer", sgi3d: { factorOfSafety: 1.7 } } as never;
    const text = ANNOTATION_TAGS.map((t) => `#${t.tag}`).join("|");
    expect(resolveAnnotationText({ text, projectInfo, result })).toBe(
      "T|S|C|P1|B|A|K|2026|D|Spencer|1.404|1.404|1.700",
    );
  });
});
