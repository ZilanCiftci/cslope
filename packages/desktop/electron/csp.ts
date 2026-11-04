/**
 * The Content Security Policy of the app's page. main.ts sets it as a
 * response header on every document (setupCSP); vite.config.ts also writes
 * the production policy into the built index.html as a <meta> fallback, so
 * the page keeps it should the header ever not be applied.
 */

/**
 * Production: strict. 'wasm-unsafe-eval' lets the engine's WebAssembly
 * compile (no JavaScript eval); styles need 'unsafe-inline' for React's
 * style attributes. Nothing may frame the page, rebase its URLs, submit a
 * form or embed a plugin.
 */
export const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';";

/** Development: also the Vite HMR websocket and eval for fast refresh. */
export const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*; worker-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';";

/**
 * A policy for a <meta http-equiv="Content-Security-Policy">: the same,
 * without frame-ancestors, which browsers ignore (and report) in a meta tag.
 */
export function metaCsp(csp: string): string {
  return csp.replace(/\s*frame-ancestors[^;]*;/, "");
}
