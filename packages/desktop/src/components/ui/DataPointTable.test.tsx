import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataPointTable } from "./DataPointTable";

function Harness({
  initial,
  minRows,
  onRows,
}: {
  initial: number[][];
  minRows?: number;
  onRows?: (rows: number[][]) => void;
}) {
  const [rows, setRows] = useState(initial);
  return (
    <>
      <DataPointTable
        headers={["Depth", "Su"]}
        rows={rows}
        minRows={minRows}
        onChange={(next) => {
          setRows(next);
          onRows?.(next);
        }}
      />
      <button onClick={() => setRows([[100, 200]])}>Replace</button>
    </>
  );
}

const cell = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("DataPointTable", () => {
  it("shows one labelled input per value", () => {
    render(<Harness initial={[[0, 10], [5, 20]]} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Depth",
      "Su",
      "",
    ]);
    expect(cell("Su row 2").value).toBe("20");
  });

  it("applies typed numbers immediately, accepting a decimal comma", async () => {
    const onRows = vi.fn();
    render(<Harness initial={[[0, 10]]} onRows={onRows} />);
    const su = cell("Su row 1");
    await userEvent.clear(su);
    await userEvent.type(su, "12,5");
    expect(su.value).toBe("12.5");
    expect(onRows).toHaveBeenLastCalledWith([[0, 12.5]]);
  });

  it("keeps partial input while typing and ignores letters", async () => {
    const onRows = vi.fn();
    render(<Harness initial={[[0, 10]]} onRows={onRows} />);
    const depth = cell("Depth row 1");
    await userEvent.clear(depth);
    await userEvent.type(depth, "-");
    expect(depth.value).toBe("-");
    await userEvent.type(depth, "x");
    expect(depth.value).toBe("-");
    await userEvent.type(depth, "3");
    expect(onRows).toHaveBeenLastCalledWith([[-3, 10]]);
  });

  it("commits an empty or partial cell as 0 when it is left", async () => {
    const onRows = vi.fn();
    render(<Harness initial={[[4, 10]]} onRows={onRows} />);
    const depth = cell("Depth row 1");
    await userEvent.clear(depth);
    await userEvent.type(depth, "-");
    await userEvent.tab();
    expect(onRows).toHaveBeenLastCalledWith([[0, 10]]);
    expect(depth.value).toBe("0");
  });

  it("adds a row copying the last one, or zeros for an empty table", async () => {
    const onRows = vi.fn();
    const { unmount } = render(<Harness initial={[[1, 2]]} onRows={onRows} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add Row" }));
    expect(onRows).toHaveBeenLastCalledWith([
      [1, 2],
      [1, 2],
    ]);
    unmount();
    render(<Harness initial={[]} onRows={onRows} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add Row" }));
    expect(onRows).toHaveBeenLastCalledWith([[0, 0]]);
  });

  it("removes a row", async () => {
    const onRows = vi.fn();
    render(<Harness initial={[[1, 2], [3, 4]]} onRows={onRows} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(onRows).toHaveBeenLastCalledWith([[3, 4]]);
    expect(cell("Depth row 1").value).toBe("3");
  });

  it("marks the table when it has fewer rows than required", () => {
    render(<Harness initial={[]} minRows={1} />);
    const frame = screen.getByRole("table").parentElement!;
    expect(frame.getAttribute("style")).toContain("var(--color-vsc-error)");
  });
});
