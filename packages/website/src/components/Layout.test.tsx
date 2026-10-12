import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Layout } from "./Layout";
import { ThemeProvider } from "./theme-provider";
import { FOOTER_PRODUCT, NAV } from "@/site";
import { routes } from "@/routes";

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Layout>
          <Routes>
            <Route path="*" element={<p>page</p>} />
          </Routes>
        </Layout>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

describe("Layout", () => {
  it("links only to pages that exist", () => {
    const paths = new Set(routes.map((r) => r.path));
    expect([...NAV, ...FOOTER_PRODUCT].filter((l) => !paths.has(l.to))).toEqual([]);
  });

  it("opens the mobile menu and closes it on navigation", () => {
    renderAt("/");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = document.getElementById("mobile-nav")!;
    expect(menu).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("link", { name: NAV[0].label }));
    expect(document.getElementById("mobile-nav")).toBeNull();
  });

  it("switches the theme and remembers it", () => {
    renderAt("/");
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("cslope-ui-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("names the company in the footer", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Ibirico" })).toHaveAttribute("href", "https://ibirico.se");
  });
});
