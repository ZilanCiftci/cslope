import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Home } from "./Home";
import { SITE } from "@/site";

const renderPage = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );

describe("Home page", () => {
  it("opens cSlope in the browser at a filled-in section, in a new tab, from the button and the screenshot", () => {
    renderPage();
    const section = screen.getByRole("heading", { name: "Try it in your browser" }).closest("section")!;
    const button = within(section).getByRole("link", { name: /^Open cSlope in the browser/ });
    const image = within(section).getByRole("link", { name: /^cSlope in the browser:/ });
    for (const link of [button, image]) {
      expect(link).toHaveAttribute("href", SITE.appExample);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("links to a filled-in excavation with a haul road on app.cslope.com", () => {
    const url = new URL(SITE.appExample);
    expect(url.origin).toBe(new URL(SITE.app).origin);
    expect(url.pathname).toBe("/");
    // No template named: the excavation, the app's first.
    expect(url.searchParams.get("t")).toBeNull();
    expect(url.searchParams.get("road")).toBe("on");
    expect(Number(url.searchParams.get("layers"))).toBe(2);
    for (const field of ["H", "slope", "layer1.c", "layer1.phi", "layer2.su"]) expect(url.searchParams.get(field), field).toMatch(/^\d/);
  });

  it("keeps the short link under the hero", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Try in the browser" })).toHaveAttribute("href", SITE.app);
  });
});
