/** The contact sheet: every image of a capture run, by section, with its notes and the log. */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Rig } from "./lib";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function writeContactSheet(rig: Rig) {
  const sections = [...new Set(rig.shots.map((s) => s.section))];
  const failed = rig.shots.filter((s) => s.error);
  const body = sections
    .map((section) => {
      const items = rig.shots
        .filter((s) => s.section === section)
        .map((s) => {
          const cls = s.error ? "item failed" : /MISMATCH|NOT FOUND|NOT restore|STILL IN/.test(s.note ?? "") ? "item warn" : "item";
          const img = s.file ? `<a href="${esc(s.file)}"><img src="${esc(s.file)}" loading="lazy" alt=""></a>` : "";
          const note = s.error ? `<p class="err">Failed: ${esc(s.error)}</p>` : s.note ? `<p>${esc(s.note)}</p>` : "";
          return `<figure class="${cls}">${img}<figcaption><b>${esc(s.title)}</b>${note}</figcaption></figure>`;
        })
        .join("\n");
      return `<h2>${esc(section || "Start")}</h2>\n<div class="grid">${items}</div>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>cSlope design capture</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; background: #fafafa; color: #222; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; border-bottom: 1px solid #ccc; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
  figure { margin: 0; background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 8px; }
  figure.failed { border-color: #c33; background: #fff3f3; } figure.warn { border-color: #d90; background: #fffaf0; }
  img { width: 100%; height: 220px; object-fit: contain; object-position: top; background: #eee; display: block; }
  figcaption { margin-top: 6px; font-size: 13px; } figcaption p { margin: 4px 0 0; color: #555; white-space: pre-wrap; }
  .err { color: #b00 !important; } pre { background: #fff; border: 1px solid #ddd; padding: 8px; overflow-x: auto; font-size: 12px; }
</style></head><body>
<h1>cSlope design capture</h1>
<p>${rig.shots.filter((s) => s.file).length} images, ${failed.length} failed steps, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Click an image for full size. Summaries of imports and exports are in <code>text/</code>, exported files in <code>exports/</code>, the files imported in <code>files/</code>.</p>
${failed.length ? `<p class="err">Failed: ${failed.map((f) => esc(f.title)).join(", ")}</p>` : ""}
${body}
<h2>Log</h2><pre>${esc(rig.log.join("\n"))}</pre>
</body></html>
`;
  writeFileSync(join(rig.out, "index.html"), html);
}
