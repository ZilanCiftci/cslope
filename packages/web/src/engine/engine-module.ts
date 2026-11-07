/**
 * The engine's WebAssembly as a static asset: Vite copies it to
 * dist/assets with a content hash in its name (vercel.json caches
 * /assets for a year), and the page fetches and compiles it once. The
 * compiled module is posted to the worker, which starts the engine from
 * it (analysis.worker.ts).
 */
import engineUrl from "@cslope/engine/wasm?url";

/** The URL the page loads the engine from (for tests and the developer console). */
export const ENGINE_URL = engineUrl;

/** Fetches and compiles the engine; streaming when the server says it is wasm. */
export async function loadEngineModule(url: string = engineUrl): Promise<WebAssembly.Module> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The engine could not be downloaded (${response.status} for ${url}).`);
  const type = response.headers.get("content-type") ?? "";
  if (typeof WebAssembly.compileStreaming === "function" && type.split(";")[0].trim() === "application/wasm") {
    return WebAssembly.compileStreaming(response);
  }
  return WebAssembly.compile(await response.arrayBuffer());
}
