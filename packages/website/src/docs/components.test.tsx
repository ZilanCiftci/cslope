import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Figure } from "./components";
import { ThemeProvider, THEME_STORAGE_KEY } from "@/components/theme-provider";

const SRC = "/media/tutorials/first-analysis/03-materials.png";

function sources(img: HTMLElement) {
  return [...img.closest("picture")!.querySelectorAll("source")];
}

afterEach(() => localStorage.clear());

describe("Figure", () => {
  it("shows WebP variants of the capture, with its size, and opens it at full size", () => {
    render(<Figure src={SRC} alt="The Materials window" caption="Materials." />);
    const img = screen.getByRole("img", { name: "The Materials window" });
    expect(img).toHaveAttribute("src", SRC);
    expect(Number(img.getAttribute("width"))).toBeGreaterThan(0);
    expect(img).toHaveAttribute("loading", "lazy");
    const [dark, light] = sources(img);
    expect(light.getAttribute("srcset")).toMatch(/03-materials-800\.webp 800w/);
    expect(dark.getAttribute("srcset")).toMatch(/03-materials-dark-800\.webp 800w/);
    // Without a chosen theme the operating system's decides, before any script runs.
    expect(dark).toHaveAttribute("media", "(prefers-color-scheme: dark)");
    expect(screen.getByRole("link", { name: "The Materials window" })).toHaveAttribute("href", SRC);
  });

  it("shows and opens the dark capture in the site's dark theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(
      <ThemeProvider>
        <Figure src={SRC} alt="The Materials window" />
      </ThemeProvider>,
    );
    const img = screen.getByRole("img", { name: "The Materials window" });
    expect(sources(img)[0]).toHaveAttribute("media", "all");
    expect(screen.getByRole("link", { name: "The Materials window" })).toHaveAttribute("href", SRC.replace(".png", "-dark.png"));
  });

  it("shows the light capture when the light theme is chosen, whatever the system's", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <Figure media="criticalSurface" />
      </ThemeProvider>,
    );
    const img = screen.getByRole("img", { name: /critical slip surface/ });
    expect(sources(img)[0]).toHaveAttribute("media", "not all");
    expect(screen.getByRole("link", { name: /critical slip surface/ }).getAttribute("href")).not.toMatch(/-dark/);
  });

  it("stops the build for an image without a recorded size", () => {
    expect(() => render(<Figure src="/media/generated/no-such-image.png" alt="Nothing" />)).toThrow(/media-sizes\.json/);
  });
});
