/**
 * Write src/features/project/fixtures/cslp-v1.cslp: the fixture of this
 * version's .cslp layout, made by the app's writer from the legacy-json-v3
 * fixture (two models, one result, one error) with a background image, its
 * attachment (a 1 × 1 PNG) and a thumbnail, at a fixed time. Run it again
 * when the layout or the project schema changes, and commit the file; the
 * fixtures test opens it.
 *
 *   bun scripts/make-project-fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initEngineSync } from "@cslope/engine";

const require = createRequire(import.meta.url);
initEngineSync(readFileSync(require.resolve("@cslope/engine/wasm")));
// The versions Vite defines for the app (src/utils/app-version.ts), so the
// manifest and the results name the real app and engine.
const engineDir = join(import.meta.dirname, "../../engine");
const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
Object.assign(globalThis, {
  __APP_VERSION__: json(join(import.meta.dirname, "../package.json")).version,
  __ENGINE_BUILD__: { version: json(join(engineDir, "package.json")).version, sourceHash: json(join(engineDir, "src/wasm/BUILD-INFO.json")).sourceHash },
});
const { writeProjectArchive, openProject } = await import("../src/features/project/cslp");
const { parseProjectFile } = await import("../src/store/persistence");

const fixtures = join(import.meta.dirname, "../src/features/project/fixtures");
const file = parseProjectFile(readFileSync(join(fixtures, "legacy-json-v3.json"), "utf8"));

/** A 1 × 1 PNG (70 bytes). */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const ASSET_ID = "0c8f4a2e-6b1d-4f3a-9e7b-2d5c8a1f6e43";

file.models[0].backgrounds = [
  { assetId: ASSET_ID, transform: { originX: 0, originY: -5, scale: 0.1, rotationDeg: 0, mirrored: false }, opacity: 0.6, visible: true, order: 0 },
];
const bytes = await writeProjectArchive(file, {
  modified: new Date("2026-11-04T10:00:00Z"),
  created: "2026-11-04T09:00:00.000Z",
  thumbnail: PNG,
  assets: [{ id: ASSET_ID, mime: "image/png", originalName: "section.png", addedAt: "2026-11-04T09:30:00.000Z", data: () => PNG }],
});
const out = join(fixtures, "cslp-v1.cslp");
writeFileSync(out, bytes);
const back = await openProject(bytes);
console.log(`${out}: ${bytes.length} bytes, ${back.file.models.length} models, ${back.assets.length} attachment(s)`);
