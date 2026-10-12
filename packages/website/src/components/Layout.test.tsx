import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Link } from "react-router";
import { MemoryRouter, Route, Routes, matchPath } from "react-router";
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
    const known = (to: string) => routes.some((r) => matchPath(r.path, to));
    expect([...NAV, ...FOOTER_PRODUCT].filter((l) => !known(l.to))).toEqual([]);
  });

  it("opens the mobile menu and closes it on navigation", () => {
    renderAt("/");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = document.getElementById("mobile-nav")!;
    expect(menu).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("link", { name: NAV[0].label }));
    expect(document.getElementById("mobile-nav")).toBeNull();
  });

  it("closes the mobile menu with Escape", () => {
    renderAt("/");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(document.getElementById("mobile-nav")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
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

describe("scrolling on navigation", () => {
  it("scrolls to the heading a link's #fragment names", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    window.scrollTo = vi.fn();
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/"]}>
          <Layout>
            <Routes>
              <Route path="/" element={<Link to="/docs/water#pore-pressure">go</Link>} />
              <Route path="/docs/water" element={<h2 id="pore-pressure">Pore pressure</h2>} />
            </Routes>
          </Layout>
        </MemoryRouter>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "go" }));
    await screen.findByRole("heading", { name: "Pore pressure" });
    expect(scrolled).toHaveBeenCalled();
    expect((scrolled.mock.contexts[0] as HTMLElement).id).toBe("pore-pressure");
  });
});
