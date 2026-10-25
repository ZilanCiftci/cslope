/// <reference types="vite/client" />
import type { ModelEntry } from "./types";

/**
 * Project models kept on this machine only (store/lovo.local.ts, ignored by
 * git: client project data never goes into the repository). Empty when the
 * file is absent, as in every checkout but the developer's.
 */
const local = import.meta.glob<{ LOVO_MODELS: ModelEntry[] }>("./lovo.local.ts", { eager: true });

export const LOCAL_LOVO_MODELS: ModelEntry[] = Object.values(local)[0]?.LOVO_MODELS ?? [];
