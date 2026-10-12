import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Section } from "./Section";
import { SpreadsheetTable, type SpreadsheetColumn } from "./SpreadsheetTable";
import { HelpMenu } from "./ribbon/HelpMenu";
import { RibbonButton } from "./ribbon/RibbonParts";
import { useAppStore } from "../../store/app-store";

beforeEach(() => {
  useAppStore.getState().newProject();
  useAppStore.getState().setActiveSection(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Section", () => {
  it("opens one side panel section at a time", async () => {
    render(
      <>
        <Section title="First">
          <p>first body</p>
        </Section>
        <Section title="Second">
          <p>second body</p>
        </Section>
      </>,
    );
    expect(screen.queryByText("first body")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByText("first body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Second" }));
    expect(screen.queryByText("first body")).toBeNull();
    expect(screen.getByText("second body")).toBeInTheDocument();
    expect(useAppStore.getState().activeSection).toBe("Second");
    await userEvent.click(screen.getByRole("button", { name: "Second" }));
    expect(useAppStore.getState().activeSection).toBeNull();
  });

  it("is open by default only while no section is active, and keys by sectionKey", async () => {
    render(
      <>
        <Section title="Default" defaultOpen>
          <p>default body</p>
        </Section>
        <Section title="Keyed" sectionKey="result:Keyed">
          <p>keyed body</p>
        </Section>
      </>,
    );
    expect(screen.getByText("default body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keyed" }));
    expect(useAppStore.getState().activeSection).toBe("result:Keyed");
    expect(screen.queryByText("default body")).toBeNull();
  });

  it("can be controlled by its parent", async () => {
    const onToggle = vi.fn();
    render(
      <Section title="Controlled" open onToggle={onToggle}>
        <p>controlled body</p>
      </Section>,
    );
    expect(screen.getByText("controlled body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Controlled" }));
    expect(onToggle).toHaveBeenCalled();
    expect(useAppStore.getState().activeSection).toBeNull();
  });
});

describe("SpreadsheetTable", () => {
  type Row = { id: string; v: number };
  const columns: SpreadsheetColumn<Row>[] = [
    { header: "Id", renderCell: (r) => r.id },
    { header: "Value", align: "right", renderCell: (r) => r.v },
    { header: "Mid", align: "center", renderCell: () => "-" },
  ];

  it("renders headers and rows and reports row clicks", async () => {
    const onRowClick = vi.fn();
    render(
      <SpreadsheetTable
        rows={[
          { id: "a", v: 1 },
          { id: "b", v: 2 },
        ]}
        columns={columns}
        getRowKey={(r) => r.id}
        selectedRowIndex={1}
        onRowClick={onRowClick}
        getRowStyle={(r) => (r.id === "a" ? { fontWeight: "bold" } : undefined)}
      />,
    );
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Id",
      "Value",
      "Mid",
    ]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(["a1-", "b2-"]);
    expect(rows[1].style.background).toContain("var(--color-vsc-selection)");
    expect(rows[0].style.fontWeight).toBe("bold");
    await userEvent.hover(rows[0]);
    expect(rows[0].style.background).toContain("var(--color-vsc-list-hover)");
    await userEvent.unhover(rows[0]);
    expect(rows[0].style.background).toBe("transparent");
    await userEvent.click(rows[0]);
    expect(onRowClick).toHaveBeenCalledWith({ id: "a", v: 1 }, 0);
  });

  it("does not highlight rows on hover when they are not clickable", async () => {
    render(
      <SpreadsheetTable rows={[{ id: "a", v: 1 }]} columns={columns} getRowKey={(r) => r.id} />,
    );
    const row = screen.getAllByRole("row")[1];
    await userEvent.hover(row);
    expect(row.style.background).toBe("transparent");
  });
});

describe("HelpMenu in a browser", () => {
  it("shows About in an alert", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(<HelpMenu isOpen onActivate={() => {}} panelHost={host} />);
    await userEvent.click(screen.getByTitle("About"));
    expect(alert.mock.calls[0][0]).toMatch(/cSlope/);
    host.remove();
  });
});

describe("RibbonButton", () => {
  it("ignores clicks while disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <RibbonButton icon={null} label="Go" shortcut="G" onClick={onClick} disabled />,
    );
    const button = screen.getByRole("menuitem", { name: "Go" });
    expect(button).toHaveAttribute("title", "Go (G)");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<RibbonButton icon={null} label="Go" onClick={onClick} active />);
    await userEvent.click(screen.getByRole("menuitem", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
