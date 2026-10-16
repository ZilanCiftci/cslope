import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Verification } from "./Verification";
import { REPORT } from "@/content/report";
import { VERIFICATION } from "@/content/verification";

const renderPage = () =>
  render(
    <MemoryRouter>
      <Verification />
    </MemoryRouter>,
  );

const problemRows = () => document.querySelectorAll("#problems tbody").length;

describe("Verification page", () => {
  it("shows the first problems and more on request", () => {
    renderPage();
    expect(problemRows()).toBe(30);
    fireEvent.click(screen.getByRole("button", { name: "Show more problems" }));
    expect(problemRows()).toBe(60);
  });

  it("filters by search text and resets the paging", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Show more problems" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Fredlund" } });
    expect(problemRows()).toBeGreaterThan(0);
    expect(problemRows()).toBeLessThan(10);
    expect(screen.queryByRole("button", { name: "Show more problems" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no such problem at all" } });
    expect(screen.getByText("No problems match the filter.")).toBeInTheDocument();
  });

  it("counts the checks shown", () => {
    renderPage();
    const s = VERIFICATION.summary;
    expect(screen.getByText(`${s.checks} of ${s.checks} checks in ${s.problems} problems`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Published by"), { target: { value: "literature" } });
    expect(screen.queryByText(`${s.checks} of ${s.checks} checks in ${s.problems} problems`)).toBeNull();
  });

  it("names the document title", () => {
    renderPage();
    expect(document.title).toBe("Verification · cSlope");
  });

  it("links the verification report the site serves (scripts/report.test.ts checks the file)", () => {
    renderPage();
    const link = screen.getByRole("link", { name: "Verification report (PDF)" });
    expect(link.getAttribute("href")).toBe(REPORT);
    expect(link.hasAttribute("download")).toBe(true);
  });
});
