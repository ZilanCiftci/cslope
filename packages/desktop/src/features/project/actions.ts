/**
 * Pure project file-action helpers.
 *
 * These functions contain **zero** React or Zustand dependencies so they can be
 * unit-tested without any UI framework and reused from any context (hook,
 * Electron main-process handler, CLI, etc.).
 */

import {
  parseProjectFile,
  serializeProject,
  type ProjectFile,
} from "../../store/persistence";
import type { AppState } from "../../store/types";

// ── Filename helpers ────────────────────────────────────────────────

/** Ensure a filename ends with `.json`. */
export const ensureJsonName = (name: string): string =>
  name.toLowerCase().endsWith(".json") ? name : `${name}.json`;

/** Strip the `.json` extension for display purposes. */
export const stripJsonExt = (name: string): string =>
  name.replace(/\.json$/i, "");

// ── Browser download helper ─────────────────────────────────────────

/** Trigger a JSON file download in a regular browser context. */
export function triggerBrowserDownload(json: string, fileName: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Serialise / parse wrappers ──────────────────────────────────────

/**
 * Build a pretty-printed JSON string from the current app state.
 *
 * The caller must call `state.saveCurrentModel()` **before** invoking this
 * function so that the latest in-flight edits are flushed into the model array.
 */
export function buildProjectJson(state: AppState): string {
  const snapshot: ProjectFile = serializeProject(state);
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Parse raw file contents into a validated `ProjectFile`.
 *
 * Re-exported from persistence for convenience – consumers no longer need to
 * import from `store/persistence` directly.
 */
export { parseProjectFile };
