#!/usr/bin/env bun
/**
 * Automatic rule checks over the design review measurements (run.ts) and
 * the desktop sources, against docs/design-rules.md:
 *
 * - contrast below 4.5:1 (3:1 for 18 px, or bold 14 px, text)
 * - controls not 22 px high (.btn, inputs, selects), icon buttons not 24 × 24
 * - font sizes outside 10, 11, 12 px (13 and 14 px allowed for bold headings)
 * - title case in labels, buttons, headings and menus (word-list heuristic)
 * - controls without an accessible name; axe-core violations
 * - more than one .btn-primary in a dialog; a primary button that is not
 *   the right-most in the button row
 * - literal colors (#hex, rgb()) in .tsx components outside the canvas and
 *   PDF drawing code
 * - dialog windows whose padding, heading or button row differ from the majority
 * - a scroll bar without visible overflow (content within a rounded pixel
 *   of the box, #42); a window taller than the screen's available height
 *   or the work area the app sized it to, or asked for more than that (a
 *   window the system would clamp, its bottom row hidden, #48)
 *
 * Writes design-review-out/findings-auto.json: every finding once (scene,
 * rule, element, measured, expected) with the scenes it occurs in, and the
 * count by rule.
 *
 *   bun packages/desktop/tools/design-review/check.ts
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DESKTOP_DIR, OUT_DIR, ROOT, type PageMetrics } from "./lib";
import type { IndexEntry } from "./run";

interface Finding {
  rule: string;
  scene: string;
  element: string;
  measured: string;
  expected: string;
  /** Every capture (scene-theme) the same finding occurs in. */
  scenes: string[];
}

type Metrics = PageMetrics & { id: string; sceneId: string; area: string; theme: string; url: string };

const index = JSON.parse(readFileSync(join(OUT_DIR, "index.json"), "utf-8")) as { scenes: IndexEntry[] };
const findings = new Map<string, Finding>();

function add(rule: string, capture: string, element: string, measured: string, expected: string, key = `${rule}|${element}|${measured}`) {
  const f = findings.get(key);
  if (f) {
    if (!f.scenes.includes(capture)) f.scenes.push(capture);
    return;
  }
  findings.set(key, { rule, scene: capture, element, measured, expected, scenes: [capture] });
}

// ── Title case ─────────────────────────────────────────────────────────

/** Words that are capitalized in a sentence: names, abbreviations, keys. */
const PROPER = new Set(
  (
    "I FOS PDF DWG DXF SGI FE M-C PNG JPEG TIFF CSV XLSX SVG Excel cSlope Mohr-Coulomb Mohr Coulomb Hoek-Brown Hoek Brown SHANSEP Bishop Janbu Spencer " +
    "Morgenstern-Price Morgenstern Price Sarma GLE Lowe Karafiath Corps Engineers Ito Matsui Davis Eurocode EC7 Ctrl Shift Alt Enter Esc Escape Tab Home End " +
    "Del Backspace PgUp PgDn F1 F5 Windows Linux macOS AutoCAD Release SI Skempton Bradwell London Ontario Clouterre Amherst Leshchinsky Han MSE ACADS " +
    "T-ACADS Arai Tagyo Monte Carlo Cao Duncan Wright Brandon Swedish Vägledning OCR POP Su Su/σ'v B̄ Model Models"
  ).split(" "),
);
/**
 * Text that looks like title case: in a phrase (split at ":", "·" and
 * a full stop; parentheses and leading numbers or symbols left out), half
 * or more of the words after the first capitalized, not names.
 */
function titleCase(text: string): string[] {
  const caps: string[] = [];
  for (const phrase of text.replace(/\([^)]*\)/g, " ").split(/[:·]|\.\s/)) {
    const words = phrase
      .replace(/[…,;"“”‘’?!›▾+/]/g, " ")
      .split(/\s+/)
      .filter((w) => /[A-Za-z]/.test(w));
    if (words.length < 2 || words.length > 8) continue;
    const c = words.slice(1).filter((w) => /^[A-Z][a-z]+$/.test(w) && !PROPER.has(w));
    if (c.length >= 1 && c.length >= Math.ceil((words.length - 1) / 2)) caps.push(...c);
  }
  return caps;
}
const UI_TEXT = /(^|> )(button|label|h[1-6]|th|summary|legend)\b|\[role=(menuitem|tab|heading|menu)\]/;

// ── Per capture ────────────────────────────────────────────────────────

const ALLOWED_SIZES = new Set([10, 11, 12]);
const layouts: { capture: string; m: Metrics }[] = [];

for (const e of index.scenes) {
  if (!e.metrics) continue;
  const m = JSON.parse(readFileSync(join(OUT_DIR, e.metrics), "utf-8")) as Metrics;
  const capture = `${e.id}-${e.theme}`;

  for (const t of m.texts) {
    const el = `"${t.text.slice(0, 60)}" (${t.path})`;
    const min = t.large ? 3 : 4.5;
    if (t.contrast !== null && t.contrast < min && t.color !== t.background) {
      add("contrast", capture, el, `${t.contrast}:1 (${t.color} on ${t.background}, ${t.fontSize} px/${t.fontWeight})`, `≥ ${min}:1`, `contrast|${e.theme}|${t.path}|${t.text.slice(0, 40)}|${t.color}|${t.background}`);
    }
    const size = Math.round(t.fontSize * 10) / 10;
    if (!ALLOWED_SIZES.has(size) && !((size === 13 || size === 14) && t.fontWeight >= 600)) {
      add("font-size", capture, el, `${size} px, weight ${t.fontWeight}`, "10, 11 or 12 px (13–14 px for bold headings)", `font-size|${t.path}|${t.text.slice(0, 40)}|${size}`);
    }
    if (UI_TEXT.test(t.path) || t.tag === "button" || t.tag === "label" || /^h[1-6]$/.test(t.tag)) {
      const caps = titleCase(t.text);
      if (caps.length) add("title-case", capture, el, `capitalized: ${caps.join(", ")}`, "sentence case", `title-case|${t.text}`);
    }
  }

  for (const c of m.controls) {
    const el = `${c.tag}${c.role ? `[role=${c.role}]` : ""} "${(c.name || c.text).slice(0, 50)}" (${c.path})`;
    if (!c.name) add("accessible-name", capture, el, "no accessible name", "aria-label, label or text", `accessible-name|${c.path}|${c.classes}`);
    const isRibbon = c.role === "menuitem" || c.role === "treeitem" || c.role === "tab" || c.role === "option" || /ribbon/.test(c.path);
    const field = (c.tag === "input" && !["checkbox", "radio", "color", "range", "file"].includes(c.type ?? "text")) || c.tag === "select";
    const btn = /\bbtn\b/.test(c.classes);
    if (!isRibbon && (btn || field) && Math.abs(c.height - 22) > 0.6) {
      add("control-height", capture, el, `${c.height} px high`, "22 px", `control-height|${c.path}|${c.classes}|${c.height}`);
    }
    const iconOnly = c.tag === "button" && !c.text && !btn && !isRibbon;
    if (iconOnly && (Math.abs(c.height - 24) > 0.6 || Math.abs(c.width - 24) > 0.6)) {
      add("icon-button-size", capture, el, `${c.width} × ${c.height} px`, "24 × 24 px", `icon-button-size|${c.path}|${c.classes}|${c.width}x${c.height}`);
    }
  }

  for (const v of m.axe) {
    for (const n of v.nodes) {
      add(`axe:${v.id}`, capture, `${n.target} ${n.html.slice(0, 120)}`, `${v.impact ?? ""}: ${v.help}`, "no violation", `axe|${v.id}|${n.target}|${n.html.slice(0, 80)}`);
    }
  }

  for (const sc of m.overflow.scrollers) {
    if (sc.scrollBar > 0 && sc.scrollHeight <= sc.clientHeight + 1) {
      add("scroll-bar-without-overflow", capture, sc.path, `${sc.scrollBar} px scroll bar; content ${sc.scrollHeight} px in a ${sc.height} px box`, "no scroll bar when the content fits", `scroll-bar|${m.url}|${sc.path}|${sc.height}`);
    }
  }
  const w = m.window;
  // The height available: the screen's, or the (simulated) work area the app sized the window to.
  const avail = Math.min(w.screen?.availHeight ?? Infinity, w.size?.workArea.height ?? Infinity);
  const asked = w.size?.opened.height;
  if (w.outerHeight && w.outerHeight > avail) {
    add("taller-than-screen", capture, m.url, `window ${w.outerHeight} px high on a ${avail} px screen`, "fits the screen's available height", `taller|${m.url}|${w.outerHeight}|${avail}`);
  } else if (asked !== undefined && asked > avail) {
    // Clamped by the system to the screen: the window is as high as the screen, its bottom behind the taskbar.
    add("taller-than-screen", capture, m.url, `window asked for ${asked} px on a ${avail} px screen (opened ${w.outerHeight} px)`, "asks for no more than the screen's available height", `taller-asked|${m.url}|${asked}|${avail}`);
  }

  const L = m.layout;
  if (L.primaryButtons.length > 1) {
    add("one-primary", capture, L.primaryButtons.map((b) => `"${b.text}"`).join(", "), `${L.primaryButtons.length} .btn-primary`, "one .btn-primary per dialog", `one-primary|${e.sceneId}|${L.primaryButtons.map((b) => b.text).join()}`);
  }
  for (const p of L.primaryButtons) {
    const row = L.buttonRow;
    if (!row) {
      add("primary-placement", capture, `"${p.text}"`, "not in a .dialog-buttons row", "right-aligned in .dialog-buttons", `primary-row|${e.sceneId}|${p.text}`);
    } else if (row.x + row.width - (p.x + p.width) > 2 || row.buttons[row.buttons.length - 1] !== p.text) {
      add("primary-placement", capture, `"${p.text}"`, `right edge ${Math.round(row.x + row.width - (p.x + p.width))} px from the row's; row: ${row.buttons.join(" | ")}`, "right-most in the button row", `primary-right|${e.sceneId}|${p.text}`);
    }
  }
  if (e.area === "windows" && e.dpr === 2 && e.theme === "light") layouts.push({ capture, m });
}

// ── Dialog layout against the majority ────────────────────────────────

const mode = (values: (number | string)[]) => {
  const counts = new Map<number | string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const measures: [string, (m: Metrics) => number | string | null][] = [
  ["heading left (px)", (m) => (m.layout.heading ? Math.round(m.layout.heading.x - m.layout.rootBox.x) : null)],
  ["heading top (px)", (m) => (m.layout.heading ? Math.round(m.layout.heading.y - m.layout.rootBox.y) : null)],
  ["heading size/weight", (m) => (m.layout.heading ? `${m.layout.heading.fontSize}/${m.layout.heading.fontWeight}` : null)],
  ["heading present", (m) => (m.layout.heading ? "yes" : "no")],
  ["subtitle size", (m) => (m.layout.subtitle ? m.layout.subtitle.fontSize : "none")],
  ["button row present", (m) => (m.layout.buttonRow ? "yes" : "no")],
  ["button row bottom gap (px)", (m) => (m.layout.buttonRow ? Math.round(m.layout.rootBox.y + m.layout.rootBox.height - (m.layout.buttonRow.y + m.layout.buttonRow.height)) : null)],
  ["button row right gap (px)", (m) => (m.layout.buttonRow ? Math.round(m.layout.rootBox.x + m.layout.rootBox.width - (m.layout.buttonRow.x + m.layout.buttonRow.width)) : null)],
  ["first field left (px)", (m) => (m.layout.firstField ? Math.round(m.layout.firstField.x - m.layout.rootBox.x) : null)],
];
const layoutTable: Record<string, Record<string, number | string | null>> = {};
for (const { capture, m } of layouts) {
  layoutTable[capture] = Object.fromEntries(measures.map(([name, f]) => [name, f(m)]));
}
for (const [name, f] of measures) {
  const values = layouts.map(({ m }) => f(m)).filter((v): v is number | string => v !== null);
  const majority = mode(values);
  if (majority === undefined) continue;
  for (const { capture, m } of layouts) {
    const v = f(m);
    if (v !== null && v !== majority) add("dialog-layout", capture, `${m.url}: ${name}`, String(v), `${majority} (the majority of ${values.length} window captures)`, `layout|${m.url}|${name}|${v}`);
  }
}

// ── Literal colors in the components ───────────────────────────────────

/** Canvas and PDF drawing code draws with colors of its own (the paper, the ink). */
const DRAWING_CODE = /features\/(pdf|rendering|export)\/|features\/canvas\/(draw|ink|reference-draw|reinforcement-draw)|\.test\.tsx$/;
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
for (const file of walk(join(DESKTOP_DIR, "src"))) {
  const rel = relative(ROOT, file);
  if (DRAWING_CODE.test(rel)) continue;
  readFileSync(file, "utf-8")
    .split("\n")
    .forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (/^\s*(\*|\/\*)/.test(code)) return;
      if (!/style|color|background|border|fill|stroke|shadow|outline/i.test(code)) return;
      const m = code.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g);
      if (!m) return;
      // Hex inside a CSS variable fallback or an id selector is not a color literal of a style.
      const literal = m.filter((c) => !/^#[0-9]+$/.test(c) || c.length > 4);
      if (!literal.length) return;
      add("literal-color", `${rel}:${i + 1}`, `${rel}:${i + 1}`, `${literal.join(", ")}: ${line.trim().slice(0, 140)}`, "--color-vsc-* tokens only", `literal|${rel}|${i + 1}`);
    });
}

// ── Output ─────────────────────────────────────────────────────────────

const list = [...findings.values()].sort((a, b) => a.rule.localeCompare(b.rule) || b.scenes.length - a.scenes.length);
const byRule: Record<string, number> = {};
for (const f of list) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
writeFileSync(
  join(OUT_DIR, "findings-auto.json"),
  JSON.stringify({ generated: new Date().toISOString(), counts: byRule, total: list.length, dialogLayout: layoutTable, findings: list }, null, 1),
);
console.log(`\n  ${list.length} findings (each once, with the captures it occurs in):\n`);
for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${rule}`);
console.log(`\n  → ${join(OUT_DIR, "findings-auto.json")}\n`);
