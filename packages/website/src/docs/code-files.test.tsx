// @vitest-environment node
/**
 * Code shown from the repository's files: each file a doc imports with
 * `?raw` is shown with <CodeFile> under its own path, and is one of the
 * example files the Python tests run (tests/test_examples.py), so that a
 * page shows only code that is tested as it is shown.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeFile } from "./components";

const DOCS = import.meta.dirname;
const ROOT = resolve(DOCS, "../../../..");

/** The folders whose example files the Python tests run. */
const TESTED = ["packages/engine-rs/crates/cslope-py/examples/", "skills/cslope/examples/"];

const IMPORT = /^import (\w+) from "([^"]+)\?raw";$/gm;

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? mdxFiles(join(dir, e.name)) : e.name.endsWith(".mdx") ? [join(dir, e.name)] : [],
  );
}

describe("code files in the docs", () => {
  const included = mdxFiles(DOCS).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(IMPORT)].map(([, name, source]) => ({
      page: relative(DOCS, file),
      name,
      path: relative(ROOT, resolve(dirname(file), source)).split(sep).join("/"),
      text: readFileSync(file, "utf8"),
    })),
  );

  it("include the Python and agent examples", () => {
    expect(included.map((i) => i.page)).toEqual(expect.arrayContaining(["python.mdx", "agents.mdx"]));
  });

  it("are tested example files, each shown under its own path", () => {
    for (const { page, name, path, text } of included) {
      expect(existsSync(join(ROOT, path)), `${page}: ${path}`).toBe(true);
      expect(TESTED.some((t) => path.startsWith(t) && path.endsWith(".py")), `${page}: ${path} is not a tested example`).toBe(true);
      expect(text, page).toContain(`<CodeFile path="${path}" code={${name}} />`);
    }
  });

  it("are listed by the test that runs them", () => {
    const test = readFileSync(join(ROOT, "packages/engine-rs/crates/cslope-py/tests/test_examples.py"), "utf8");
    for (const { path } of included.filter((i) => i.path.startsWith(TESTED[0]))) {
      expect(test).toContain(`("${path.slice(TESTED[0].length)}", [`);
    }
  });
});

describe("CodeFile", () => {
  it("shows the file whole, with its path linked to the repository", () => {
    const html = renderToStaticMarkup(<CodeFile path="skills/cslope/examples/single_slope.py" code={"import cslope\n\n"} />);
    expect(html).toContain('href="https://github.com/ZilanCiftci/cslope/blob/main/skills/cslope/examples/single_slope.py"');
    expect(html).toContain('<pre tabindex="0" aria-label="skills/cslope/examples/single_slope.py" class="mt-0"><code>import cslope</code></pre>');
  });
});
