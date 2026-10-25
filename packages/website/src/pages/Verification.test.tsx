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

  it("marks a disputed published value with its reason", () => {
    renderPage();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Zhu & Lee slope, the paper's surface 3, dry" } });
    const mark = screen.getByText("disputed");
    expect(mark.tagName).toBe("ABBR");
    expect(mark.getAttribute("title")).toMatch(/Table II/);
  });

  it("counts the analyses shown", () => {
    renderPage();
    const s = VERIFICATION.summary;
    const all = `${s.results} of ${s.results} analyses in ${s.problems} problems`;
    expect(screen.getByText(all)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Published value"), { target: { value: "without" } });
    expect(screen.queryByText(all)).toBeNull();
  });

  it("presents results without pass marks and without naming programs", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\b[Pp]rogram [A-Z]\b/);
    expect(text).not.toMatch(/within tolerance|deviation|\u2713|\u2717/i);
    expect(screen.getAllByText("Other programs").length).toBeGreaterThan(0);
  });

  it("gives cSlope's result next to a published value and the problem's note", () => {
    renderPage();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "V001" } });
    const v001 = VERIFICATION.problems.find((p) => p.id === "V001")!;
    const row = document.querySelector("#problems tbody")!;
    expect(row.textContent).toContain(`cSlope ${v001.published[0].computed!.toFixed(3)}`);
    expect(row.textContent).toContain(v001.note!);
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
