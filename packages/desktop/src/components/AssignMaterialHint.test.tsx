import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AssignMaterialHint } from "./AssignMaterialHint";

describe("AssignMaterialHint", () => {
  it("names the material and cancels", () => {
    const onCancel = vi.fn();
    render(<AssignMaterialHint name="Clay" color="#a0522d" onCancel={onCancel} />);
    expect(screen.getByRole("status")).toHaveTextContent("Click a region to assign Clay");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
