import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpreadsheetNumberInput } from "./SpreadsheetTable";

function Harness() {
  const [value, setValue] = useState(3);
  return (
    <>
      <SpreadsheetNumberInput
        value={value}
        ariaLabel="cell"
        onChange={(text) => {
          const next = parseFloat(text);
          if (Number.isFinite(next)) setValue(next);
        }}
      />
      <output>{value}</output>
    </>
  );
}

describe("SpreadsheetNumberInput", () => {
  it("lets the user type a negative number character by character", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("cell");
    await userEvent.clear(input);
    await userEvent.type(input, "-5");
    expect(screen.getByRole("status").textContent).toBe("-5");
  });
});
