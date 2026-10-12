import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
  it("renders every doc with its title", () => {
    for (const d of DOCS) {
      const { unmount } = renderAt(docPath(d));
      expect(screen.getByRole("heading", { level: 1, name: d.title })).toBeInTheDocument();
      unmount();
    }
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
