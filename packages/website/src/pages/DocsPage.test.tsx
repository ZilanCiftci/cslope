import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { DocsPage } from "./DocsPage";
import { DOCS, docPath } from "@/docs/registry";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/docs/*" element={<DocsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DocsPage", () => {
  it("renders every doc with its title and its content", async () => {
    for (const d of DOCS) {
      const { unmount } = renderAt(docPath(d));
      expect(screen.getByRole("heading", { level: 1, name: d.title })).toBeInTheDocument();
      // The content loads lazily, after the title.
      await waitFor(() => expect(screen.queryByText("Loading the documentation")).toBeNull());
      expect(document.querySelector("article")!.textContent.length).toBeGreaterThan(d.title.length + d.description.length);
      unmount();
    }
    // The first test compiles every page.
  }, 60_000);

  it("lists the page's headings once its content is loaded", async () => {
    renderAt("/docs/theory");
    const contents = await screen.findByRole("navigation", { name: "On this page" });
    expect(contents.querySelectorAll("a").length).toBeGreaterThan(1);
  });

  it("links to the next doc and to the source on GitHub", () => {
    renderAt("/docs");
    const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (DOCS.length > 1) expect(screen.getByRole("link", { name: new RegExp(`Next\\s*${escape(DOCS[1].title)}`) })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Suggest a change to this page" }).getAttribute("href")).toMatch(
      /packages\/website\/src\/docs\/index\.mdx$/,
    );
  });

  it("shows the not-found page for an unknown doc", () => {
    renderAt("/docs/no-such-page");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});
