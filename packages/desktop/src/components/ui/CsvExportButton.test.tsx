import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CsvExportButton } from "./CsvExportButton";
import { CSV_DECIMAL_KEY } from "../../utils/csv-decimal";

beforeEach(() => localStorage.removeItem(CSV_DECIMAL_KEY));
afterEach(cleanup);

const main = () => screen.getByRole("button", { name: "Export CSV" });
const chevron = () => screen.getByRole("button", { name: "CSV decimal separator" });

describe("CsvExportButton", () => {
  it("exports with a decimal point until a decimal comma is chosen", () => {
    const onExport = vi.fn();
    render(<CsvExportButton onExport={onExport} />);
    fireEvent.click(main());
    expect(onExport).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers decimal point and decimal comma, the current one checked; choosing one exports with it", () => {
    const onExport = vi.fn();
    render(<CsvExportButton onExport={onExport} />);
    fireEvent.click(chevron());
    expect(chevron()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitemradio", { name: "Decimal point (1.5)" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Decimal comma (1,5)" }));
    expect(onExport).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("menu")).toBeNull();
    // The main button now exports with the decimal comma.
    fireEvent.click(main());
    expect(onExport).toHaveBeenLastCalledWith(true);
  });

  it("remembers the last choice for the next window", () => {
    const first = render(<CsvExportButton onExport={vi.fn()} />);
    fireEvent.click(chevron());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Decimal comma (1,5)" }));
    first.unmount();
    const onExport = vi.fn();
    render(<CsvExportButton onExport={onExport} />);
    fireEvent.click(main());
    expect(onExport).toHaveBeenLastCalledWith(true);
  });

  it("closes the menu on Escape without exporting", () => {
    const onExport = vi.fn();
    render(<CsvExportButton onExport={onExport} />);
    fireEvent.click(chevron());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onExport).not.toHaveBeenCalled();
  });

  it("is disabled as a whole", () => {
    render(<CsvExportButton onExport={vi.fn()} disabled />);
    expect(main()).toBeDisabled();
    expect(chevron()).toBeDisabled();
  });
});
