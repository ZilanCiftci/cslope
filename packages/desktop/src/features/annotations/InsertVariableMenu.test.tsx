import { afterEach, describe, expect, it } from "vitest";
import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnalysisResult } from "@cslope/engine";
import type { ParameterDef } from "../../store/types";
import { InsertVariableMenu } from "./InsertVariableMenu";
import { insertAtCaret, variableItems } from "./insertVariable";
import { ANNOTATION_TAGS, type AnnotationTagContext } from "./resolveAnnotationText";

afterEach(cleanup);

const RESULT = { minFOS: 1.4041, method: "Spencer", sgi3d: { factorOfSafety: 1.7123 } } as unknown as AnalysisResult;

function Harness({
  initial,
  ctx = { projectInfo: { title: "Cut A" }, result: RESULT },
  parameters = [],
}: {
  initial: string;
  ctx?: AnnotationTagContext;
  parameters?: ParameterDef[];
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <textarea aria-label="Text" ref={ref} value={text} onChange={(e) => setText(e.target.value)} />
      <InsertVariableMenu textareaRef={ref} text={text} onChange={setText} ctx={ctx} parameters={parameters} />
    </div>
  );
}

const textarea = () => screen.getByLabelText("Text") as HTMLTextAreaElement;
const button = () => screen.getByRole("button", { name: /Insert variable/ });

describe("insertAtCaret", () => {
  it("inserts at the caret and replaces a selection", () => {
    expect(insertAtCaret("FOS = ", 6, 6, "#FOS")).toEqual({ text: "FOS = #FOS", caret: 10 });
    expect(insertAtCaret("a XX b", 2, 4, "#Title")).toEqual({ text: "a #Title b", caret: 8 });
    expect(insertAtCaret("", 0, 0, "#FOS3D")).toEqual({ text: "#FOS3D", caret: 6 });
  });

  it("adds a space when the next character would run into the tag", () => {
    expect(insertAtCaret("Fend", 1, 1, "#FOS")).toEqual({ text: "F#FOS end", caret: 6 });
    expect(insertAtCaret("x: .", 3, 3, "#FOS")).toEqual({ text: "x: #FOS.", caret: 7 });
  });

  it("clamps a caret outside the text", () => {
    expect(insertAtCaret("ab", 9, 9, "#FOS")).toEqual({ text: "ab#FOS", caret: 6 });
  });
});

describe("variableItems", () => {
  it("lists every tag of the table with its description and current value", () => {
    const items = variableItems({ projectInfo: { title: "Cut A" }, result: RESULT });
    expect(items.map((i) => i.insert)).toEqual(ANNOTATION_TAGS.map((t) => `#${t.tag}`));
    expect(items.map((i) => i.description)).toEqual(ANNOTATION_TAGS.map((t) => t.description));
    const by = (tag: string) => items.find((i) => i.insert === tag)!;
    expect(by("#FOS").preview).toBe("1.404");
    expect(by("#FOS3D").preview).toBe("1.712");
    expect(by("#Title").preview).toBe("Cut A");
    expect(by("#Client").preview).toBeNull();
  });

  it("has no preview for results without a result, and lists parameters after the tags", () => {
    const items = variableItems({ projectInfo: {}, result: null }, [
      { id: "p1", name: "H", expression: "2*5" },
      { id: "p2", name: "FOS", expression: "3" },
      { id: "p3", name: "bad name", expression: "1" },
    ]);
    expect(items.find((i) => i.insert === "#FOS3D")!.preview).toBeNull();
    expect(items.find((i) => i.insert === "#Method")!.preview).toBeNull();
    // A parameter named like a tag wins on the sheet: listed once, with its value.
    expect(items.filter((i) => i.insert === "#FOS")).toHaveLength(1);
    expect(items.find((i) => i.insert === "#FOS")!.preview).toBe("3");
    expect(items.at(-1)).toEqual({ insert: "#H", description: "Parameter", preview: "10" });
    expect(items.some((i) => i.insert.includes("bad"))).toBe(false);
  });
});

describe("InsertVariableMenu", () => {
  it("opens a menu listing all tags with descriptions and values", () => {
    render(<Harness initial="" />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button());
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(ANNOTATION_TAGS.length);
    // Project information is said once, in its group's name; the other
    // tags each describe themselves.
    const project = screen.getByRole("group", { name: "Project information (empty if not set)" });
    ANNOTATION_TAGS.forEach((t, i) => {
      expect(items[i]).toHaveTextContent(`#${t.tag}`);
      if (t.group === "project") expect(project).toContainElement(items[i]);
      else expect(items[i]).toHaveTextContent(t.description);
    });
    expect(screen.getByRole("menu")).not.toHaveTextContent("(project information");
    const fos = items.find((el) => el.textContent?.startsWith("#FOS("))!;
    expect(fos).toHaveTextContent("(1.404)");
    const fos3d = items.find((el) => el.textContent?.startsWith("#FOS3D"))!;
    expect(fos3d).toHaveTextContent("(1.712)");
    expect(fos3d).toHaveTextContent("N/A without the 3D effects option");
  });

  it("inserts the clicked tag at the caret, focusing the text with the caret after it", () => {
    render(<Harness initial="FOS  here" />);
    act(() => {
      textarea().focus();
      textarea().setSelectionRange(4, 4);
    });
    fireEvent.click(button());
    fireEvent.click(screen.getAllByRole("menuitem").find((el) => el.textContent?.startsWith("#FOS("))!);
    expect(textarea().value).toBe("FOS #FOS here");
    expect(document.activeElement).toBe(textarea());
    expect(textarea().selectionStart).toBe(8);
    expect(textarea().selectionEnd).toBe(8);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is keyboard accessible: arrows move, Enter inserts, Escape closes", () => {
    render(<Harness initial="x" />);
    act(() => textarea().setSelectionRange(0, 0));
    // ArrowDown on the button opens the menu on the first item.
    fireEvent.keyDown(button(), { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    // Wraps to the last item.
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button());
    expect(textarea().value).toBe("x");

    fireEvent.keyDown(button(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem").at(-1));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });
    // #FOS3D before "x": a space keeps the tag's name apart.
    expect(textarea().value).toBe("#FOS3D x");
    expect(document.activeElement).toBe(textarea());
    expect(textarea().selectionStart).toBe(7);
  });

  it("keeps keys in the menu from reaching the canvas shortcuts", () => {
    let seen = 0;
    const onKey = () => seen++;
    document.addEventListener("keydown", onKey);
    try {
      render(<Harness initial="" />);
      fireEvent.keyDown(button(), { key: "ArrowDown" });
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Delete" });
      fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
      expect(seen).toBe(0);
    } finally {
      document.removeEventListener("keydown", onKey);
    }
  });

  it("closes on a click elsewhere", () => {
    render(<Harness initial="" />);
    fireEvent.click(button());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
