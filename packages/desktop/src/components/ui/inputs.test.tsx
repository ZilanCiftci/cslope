import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumericInput } from "./NumericInput";
import { ExpressionNumericInput } from "./ExpressionNumericInput";
import { DraftNumberInput } from "./DraftNumberInput";
import { PopupPanel } from "./PopupPanel";

function NumericHarness(props: {
  initial?: number;
  allowNegative?: boolean;
  min?: number;
  fallbackValue?: number;
  commitOnChange?: boolean;
  onValue?: (v: number) => void;
}) {
  const [value, setValue] = useState(props.initial ?? 5);
  return (
    <>
      <NumericInput
        aria-label="n"
        value={value}
        allowNegative={props.allowNegative}
        min={props.min}
        fallbackValue={props.fallbackValue}
        commitOnChange={props.commitOnChange}
        onValueChange={(v) => {
          props.onValue?.(v);
          setValue(v);
        }}
      />
      <output>{value}</output>
    </>
  );
}

function ExpressionHarness(props: {
  initial?: number;
  allowNegative?: boolean;
  min?: number;
  fallbackValue?: number;
}) {
  const [value, setValue] = useState(props.initial ?? 5);
  const [expr, setExpr] = useState<string | undefined>(undefined);
  return (
    <>
      <ExpressionNumericInput
        aria-label="e"
        value={value}
        expression={expr}
        vars={{ a: 2, b: -10 }}
        allowNegative={props.allowNegative}
        min={props.min}
        fallbackValue={props.fallbackValue}
        onValueChange={setValue}
        onExpressionChange={setExpr}
        style={{ borderColor: "green" }}
      />
      <output>{value}</output>
      <span data-testid="expr">{expr ?? "none"}</span>
    </>
  );
}

const output = () => screen.getByRole("status").textContent;

describe("NumericInput", () => {
  it("applies valid numbers while typing and accepts a decimal comma", async () => {
    render(<NumericHarness />);
    const input = screen.getByLabelText("n");
    await userEvent.clear(input);
    await userEvent.type(input, "3,25");
    expect(output()).toBe("3.25");
    expect(input).toHaveValue("3.25");
  });

  it("rejects letters and, when not allowed, a minus sign", async () => {
    render(<NumericHarness allowNegative={false} />);
    const input = screen.getByLabelText("n");
    await userEvent.clear(input);
    await userEvent.type(input, "-x7");
    expect(input).toHaveValue("7");
    expect(output()).toBe("7");
  });

  it("raises values below the minimum and uses the fallback for empty input", async () => {
    const onValue = vi.fn();
    render(<NumericHarness min={1} fallbackValue={2} onValue={onValue} />);
    const input = screen.getByLabelText("n");
    await userEvent.clear(input);
    await userEvent.type(input, "0.5");
    expect(output()).toBe("1");
    await userEvent.clear(input);
    await userEvent.tab();
    expect(output()).toBe("2");
    expect(input).toHaveValue("2");
  });

  it("commits only on blur when commitOnChange is off", async () => {
    const onValue = vi.fn();
    render(<NumericHarness commitOnChange={false} onValue={onValue} />);
    const input = screen.getByLabelText("n");
    await userEvent.clear(input);
    await userEvent.type(input, "42");
    expect(onValue).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onValue).toHaveBeenCalledWith(42);
    expect(output()).toBe("42");
  });
});

describe("ExpressionNumericInput", () => {
  it("evaluates expressions on blur and shows the expression afterwards", async () => {
    render(<ExpressionHarness />);
    const input = screen.getByLabelText("e");
    await userEvent.clear(input);
    await userEvent.type(input, "a*3");
    await userEvent.tab();
    expect(output()).toBe("6");
    expect(screen.getByTestId("expr").textContent).toBe("a*3");
    expect(input).toHaveValue("a*3");
    expect(input.getAttribute("style")).toContain("green");
  });

  it("marks an expression that cannot be evaluated and keeps the value", async () => {
    render(<ExpressionHarness />);
    const input = screen.getByLabelText("e");
    await userEvent.clear(input);
    await userEvent.type(input, "zz+1");
    await userEvent.tab();
    expect(output()).toBe("5");
    expect(input.getAttribute("style")).toContain("var(--color-vsc-error)");
  });

  it("replaces a negative result by the fallback when negatives are not allowed", async () => {
    render(<ExpressionHarness allowNegative={false} fallbackValue={0.5} />);
    const input = screen.getByLabelText("e");
    await userEvent.clear(input);
    await userEvent.type(input, "b");
    await userEvent.tab();
    expect(output()).toBe("0.5");
    await userEvent.clear(input);
    await userEvent.type(input, "-3");
    // Typing a negative literal is ignored until blur, then the fallback applies.
    expect(output()).toBe("0.5");
    await userEvent.tab();
    expect(output()).toBe("0.5");
    expect(screen.getByTestId("expr").textContent).toBe("none");
  });

  it("clamps to the minimum", async () => {
    render(<ExpressionHarness min={1} />);
    const input = screen.getByLabelText("e");
    await userEvent.clear(input);
    await userEvent.type(input, "0,2");
    await userEvent.tab();
    expect(output()).toBe("1");
  });

  it("clearing the field drops the expression but keeps the value", async () => {
    render(<ExpressionHarness />);
    const input = screen.getByLabelText("e");
    await userEvent.clear(input);
    await userEvent.type(input, "a");
    await userEvent.tab();
    expect(screen.getByTestId("expr").textContent).toBe("a");
    await userEvent.clear(input);
    await userEvent.tab();
    expect(screen.getByTestId("expr").textContent).toBe("none");
    expect(output()).toBe("2");
    expect(input).toHaveValue("2");
  });
});

describe("DraftNumberInput", () => {
  it("keeps partial text while typing and shows the stored value after blur", async () => {
    const onValueChange = vi.fn();
    const onBlur = vi.fn();
    render(
      <DraftNumberInput
        aria-label="d"
        value={3}
        onValueChange={onValueChange}
        onBlur={onBlur}
      />,
    );
    const input = screen.getByLabelText("d");
    await userEvent.clear(input);
    await userEvent.type(input, "-");
    expect(onValueChange).not.toHaveBeenCalled();
    await userEvent.type(input, "4");
    expect(onValueChange).toHaveBeenLastCalledWith(-4);
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalled();
    // The parent kept 3, so 3 is shown again.
    expect(input).toHaveValue(3);
  });

  it("shows an empty field for an undefined value", () => {
    render(<DraftNumberInput aria-label="d" value={undefined} onValueChange={() => {}} />);
    expect(screen.getByLabelText("d")).toHaveValue(null);
  });
});

describe("PopupPanel", () => {
  it("renders title, body and footer and closes with the header button and Escape", async () => {
    const onClose = vi.fn();
    render(
      <PopupPanel title="Panel" onClose={onClose} footer={<span>Footer</span>}>
        <p>Body</p>
      </PopupPanel>,
    );
    expect(screen.getByText("Panel")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Close"));
    await userEvent.keyboard("{Escape}");
    // Other keys do not close it.
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("is dragged by its header", () => {
    Element.prototype.setPointerCapture ??= () => {};
    Element.prototype.releasePointerCapture ??= () => {};
    render(
      <PopupPanel title="Drag me" onClose={() => {}} initialPosition={{ x: 10, y: 20 }}>
        <p>Body</p>
      </PopupPanel>,
    );
    const header = screen.getByText("Drag me").parentElement!;
    const panel = header.parentElement!;
    expect(panel.style.left).toBe("10px");
    expect(panel.style.top).toBe("20px");
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: 130, clientY: 90, pointerId: 1 });
    expect(panel.style.left).toBe("40px");
    expect(panel.style.top).toBe("10px");
    fireEvent.pointerUp(header, { pointerId: 1 });
    // After release, moving no longer drags.
    fireEvent.pointerMove(header, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(panel.style.left).toBe("40px");
  });

  it("centres itself horizontally by default", () => {
    render(
      <PopupPanel title="Centred" onClose={() => {}} width={200}>
        <p>Body</p>
      </PopupPanel>,
    );
    const panel = screen.getByText("Centred").parentElement!.parentElement!;
    expect(panel.style.left).toBe(`${Math.round((window.innerWidth - 200) / 2)}px`);
  });
});
