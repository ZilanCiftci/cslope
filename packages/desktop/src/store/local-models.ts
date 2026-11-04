/// <reference types="vite/client" />
import type { ModelEntry } from "./types";

/**
 * Project models kept on this machine only (store/lovo.local.ts, ignored by
 * git: client project data never goes into the repository). Loaded lazily,
 * and only in development: in a production build the glob is dead code, so
 * `vite build` never bundles the file, whether or not it exists
 * (scripts/check-local-data.ts proves it after every build). Empty when the
 * file is absent, as in every checkout but the developer's.
 */
const local = import.meta.env.DEV ? import.meta.glob<{ LOVO_MODELS: ModelEntry[] }>("./lovo.local.ts") : {};

/** Whether this development build has the local models. */
export const HAS_LOCAL_LOVO_MODELS = Object.keys(local).length > 0;

/** The local models: none without the file, and none in a production build. */
export async function loadLocalLovoModels(): Promise<ModelEntry[]> {
  const load = Object.values(local)[0];
  return load ? (await load()).LOVO_MODELS : [];
}
