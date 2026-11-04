/**
 * Open a cSlope project file and print what it holds, or the first error:
 * the format (a .cslp archive in this version's layout, the first .cslp
 * layout, or a JSON project), the manifest, the models with their results
 * (and whether each result still matches its model's input), the
 * attachments and the thumbnail. Exits 1 when the file cannot be opened.
 *
 *   bun scripts/check-project.ts <file.cslp | file.json>
 *
 * The reader is the app's (src/features/project/cslp.ts) with the engine
 * started, as the app starts it; nothing is written.
 */
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { initEngineSync } from "@cslope/engine";

const file = process.argv[2];
if (!file) {
  console.error("usage: bun scripts/check-project.ts <file.cslp>");
  process.exit(2);
}

initEngineSync(readFileSync(createRequire(import.meta.url).resolve("@cslope/engine/wasm")));
// (after the engine: the reader's validation calls it)
const { openProject } = await import("../src/features/project/cslp");
const { analysisInputHash } = await import("../src/features/project/input-hash");

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

try {
  const bytes = new Uint8Array(readFileSync(file));
  const opened = await openProject(bytes);
  const { file: project, manifest, layout } = opened;
  const layouts = { cslp: "a .cslp archive (models in folders)", "cslp-3file": "a .cslp archive of the first layout (project.json and results.json)", json: "a JSON project file" };
  console.log(`${file}: ${layouts[layout]}, ${kb(statSync(file).size)}`);
  if (manifest) {
    console.log(`  format ${manifest.format} ${manifest.formatVersion} (readers from ${manifest.minReaderVersion}), saved by ${manifest.generator || "unknown"}`);
    console.log(`  created ${manifest.created || "unknown"}, modified ${manifest.modified || "unknown"}`);
  }
  console.log(`  project schema version ${project.version}, units ${project.units}, ${project.models.length} model(s), active ${project.activeModelId}`);
  for (const model of project.models) {
    const active = model.id === project.activeModelId ? " (active)" : "";
    const parts = [`${model.coordinates.length} ground points`, `${model.materials.length} material(s)`];
    if (model.backgrounds?.length) parts.push(`${model.backgrounds.length} background(s)`);
    console.log(`  model ${model.id}${active}: "${model.name}", ${parts.join(", ")}`);
    const info = opened.results.get(model.id);
    if (model.runState === "done" && model.result) {
      const fresh = info ? (info.inputHash === (await analysisInputHash(model)) ? "input unchanged" : "INPUT CHANGED since the analysis") : "";
      const engine = info?.engine.version ? ` by engine ${info.engine.version}${info.engine.sourceHash ? ` (${info.engine.sourceHash.slice(0, 12)})` : ""}` : "";
      console.log(`    result: F = ${model.result.minFOS.toFixed(3)} (${model.result.method}, ${model.result.allSurfaces.length} surfaces)${engine}${fresh ? `; ${fresh}` : ""}`);
    } else if (model.runState === "error") {
      console.log(`    result: error "${model.errorMessage}"`);
    } else {
      console.log("    no result");
    }
  }
  if (opened.assets.length > 0) {
    console.log(`  ${opened.assets.length} attachment(s):`);
    for (const a of opened.assets) {
      let state = "ok";
      try {
        await opened.readAsset(a.id);
      } catch (err) {
        state = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
      console.log(`    ${a.id}: ${a.originalName || a.path} (${a.mime}, ${kb(a.bytes)}) ${state}`);
    }
  }
  const thumbnail = await opened.readThumbnail();
  if (thumbnail) console.log(`  thumbnail.png: ${kb(thumbnail.length)}`);
} catch (err) {
  console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
