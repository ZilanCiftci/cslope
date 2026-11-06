import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordTable, RowIconButton, type RecordColumn } from "./RecordTable";
import { SpreadsheetNumberInput } from "./SpreadsheetTable";

type Row = { id: string; name: string; v: number };
const ROWS: Row[] = [
  { id: "a", name: "Sand", v: 1 },
  { id: "b", name: "Clay", v: 2 },
  { id: "c", name: "Silt", v: 3 },
];
const columns: RecordColumn<Row>[] = [
  { header: "Name", renderCell: (r) => r.name },
  { header: "Value", align: "right", renderCell: (r) => r.v },
];

describe("RecordTable, records mode", () => {
  it("selects rows by click and with the arrow keys, Home and End", async () => {
    const onRowClick = vi.fn();
    const { rerender } = render(
      <RecordTable mode="records" label="Things" rows={ROWS} columns={columns} getRowKey={(r) => r.id} selectedRowIndex={0} onRowClick={onRowClick} />,
    );
    const rows = within(screen.getByRole("grid", { name: "Things" })).getAllByRole("row").slice(1);
    // One row in the tab order: the selected one.
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(rows[1]).getByText("Clay"));
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1], 1);
    rerender(
      <RecordTable mode="records" label="Things" rows={ROWS} columns={columns} getRowKey={(r) => r.id} selectedRowIndex={1} onRowClick={onRowClick} />,
    );
    rows[1].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[2], 2);
    expect(rows[2]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0], 0);
    await userEvent.keyboard("{End}");
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[2], 2);
  });

  it("removes a row with its × without selecting it, and hides the × where it may not remove", async () => {
    const onRowClick = vi.fn();
    const onRemove = vi.fn();
    render(
      <RecordTable
        mode="records"
        rows={ROWS}
        columns={columns}
        getRowKey={(r) => r.id}
        onRowClick={onRowClick}
        onRemove={onRemove}
        removeLabel={(r) => `Remove ${r.name}`}
        canRemove={(r) => r.id !== "a"}
      />,
    );
    expect(screen.queryByRole("button", { name: "Remove Sand" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove Clay" }));
    expect(onRemove).toHaveBeenCalledWith(ROWS[1], 1);
    expect(onRowClick).not.toHaveBeenCalled();
    // The remove column has a header for screen readers only.
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Name", "Value", "Remove"]);
  });

  it("shows row actions before the × and + Add links under the table", async () => {
    const onAdd = vi.fn();
    const onAction = vi.fn();
    render(
      <RecordTable
        mode="records"
        rows={ROWS.slice(0, 1)}
        columns={columns}
        getRowKey={(r) => r.id}
        onRemove={() => {}}
        removeLabel={(r) => `Remove ${r.name}`}
        rowActions={(r) => (
          <RowIconButton ariaLabel={`Show ${r.name}`} onClick={onAction}>
            S
          </RowIconButton>
        )}
        addActions={[{ label: "+ Add thing", onClick: onAdd }]}
      />,
    );
    const cell = screen.getByRole("button", { name: "Remove Sand" }).closest("td")!;
    expect(within(cell).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Show Sand", "Remove Sand"]);
    await userEvent.click(screen.getByRole("button", { name: "Show Sand" }));
    expect(onAction).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "+ Add thing" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("shows one muted sentence while empty", () => {
    render(<RecordTable mode="records" rows={[]} columns={columns} getRowKey={(r: Row) => r.id} emptyText="No things." />);
    expect(screen.getByText("No things.")).toBeInTheDocument();
  });
});

describe("RecordTable layout", () => {
  it("has 24 px rows and 22 px cell editors", () => {
    render(
      <RecordTable
        rows={ROWS.slice(0, 1)}
        columns={[{ header: "Value", renderCell: (r) => <SpreadsheetNumberInput value={r.v} ariaLabel="Value 1" onChange={() => {}} /> }]}
        getRowKey={(r) => r.id}
      />,
    );
    for (const row of screen.getAllByRole("row")) expect(row).toHaveClass("h-6");
    expect(screen.getByLabelText("Value 1")).toHaveClass("h-[22px]", "text-[11px]");
  });
});
