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
import { downloadFile } from "../../utils/download";

export {
  buildProjectArchive,
  ensureCslpName,
  isProjectFileName,
  readProjectBytes,
  stripProjectExt,
} from "./cslp";

// ── Browser download helper ─────────────────────────────────────────

/** Offer a project file (.cslp archive) as a download in a regular browser context. */
export function triggerBrowserDownload(data: Uint8Array, fileName: string): void {
  downloadFile(fileName, data as BlobPart, "application/octet-stream");
}

// ── Serialise / parse wrappers ──────────────────────────────────────

/**
 * Build a pretty-printed JSON string from the current app state (the
 * project as one JSON document, as project files were before .cslp).
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
