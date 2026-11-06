/**
 * The frontmatter of a documentation page, read without compiling the page:
 * the docs registry loads every page's frontmatter at once (the sidebar,
 * the page titles) and each page's content only when it is opened. The
 * Vite plugin serves `page.mdx?frontmatter` as a module whose default
 * export is the page's frontmatter.
 *
 * The frontmatter is a flat list of `key: value` lines (strings and
 * numbers); anything else is an error, so that a page never gets a
 * different frontmatter here than its compiled module exports.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

export function parseFrontmatter(file: string, text: string): Record<string, string | number> {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!block) throw new Error(`${file}: no frontmatter`);
  const result: Record<string, string | number> = {};
  for (const line of block[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) throw new Error(`${file}: frontmatter line "${line}" is not "key: value"`);
    let value: string | number = m[2].trim();
    if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    else if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else if (/^[[{|>&*!%@`#]/.test(value)) throw new Error(`${file}: frontmatter value "${value}" is not a plain string or number`);
    result[m[1]] = value;
  }
  return result;
}

const QUERY = "?frontmatter";
const PREFIX = "\0mdx-frontmatter:";

export function frontmatterPlugin(): Plugin {
  return {
    name: "mdx-frontmatter-only",
    enforce: "pre",
    resolveId(source, importer) {
      if (!source.endsWith(`.mdx${QUERY}`)) return null;
      const path = source.slice(0, -QUERY.length);
      const file = importer && !path.startsWith("/") ? resolve(dirname(importer.split("?")[0]), path) : path;
      // The \0 prefix keeps the MDX and React plugins off this module.
      return `${PREFIX}${file}`;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length);
      this.addWatchFile(file);
      return `export default ${JSON.stringify(parseFrontmatter(file, readFileSync(file, "utf8")))};`;
    },
  };
}
