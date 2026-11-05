/**
 * The project's attachments (the drawing files): the store keeps only
 * their ids in the placements, the bytes are here. Those of the project
 * last opened are read from its archive when asked for (a save, a drawing
 * shown); a file added in the Place drawing window is kept in memory. A
 * save writes those some model refers to (cslp.ts); the others are
 * dropped then.
 */

/** An attachment: its index fields and its bytes (read when needed). */
export interface ProjectAsset {
  id: string;
  mime: string;
  originalName: string;
  addedAt: string;
  /** SHA-256 of the bytes (lowercase hex), when known: a file added twice is kept once. */
  sha256?: string;
  /** The size in bytes, when known. */
  bytes?: number;
  data: () => Promise<Uint8Array> | Uint8Array;
}

let assets: ProjectAsset[] = [];
const listeners = new Set<() => void>();
const replacedListeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

/**
 * Keep `list` (from readProject; none for a new project or the example
 * models) as the project's attachments: call it where the project read is
 * loaded, not before, so a file read and then not opened (the user
 * cancels, or saves the current project first) leaves the current
 * project's attachments in place. What was made of the previous project's
 * drawings (drawing-cache.ts) is dropped.
 */
export function adoptProjectAssets(list: ProjectAsset[]): void {
  assets = list;
  for (const l of replacedListeners) l();
  emit();
}

/** Call `listener` when another project's attachments replace these (adoptProjectAssets); returns the unsubscribe. */
export function onProjectAssetsReplaced(listener: () => void): () => void {
  replacedListeners.add(listener);
  return () => replacedListeners.delete(listener);
}

/** The project's attachments (a save takes these by default). */
export function openedProjectAssets(): ProjectAsset[] {
  return assets;
}

/** One attachment by id. */
export function projectAsset(id: string): ProjectAsset | undefined {
  return assets.find((a) => a.id === id);
}

/** The attachment with these bytes (by hash), if the project has it already. */
export function projectAssetBySha(sha256: string): ProjectAsset | undefined {
  return assets.find((a) => a.sha256 === sha256);
}

/** Add an attachment (a file placed as a drawing); an id already there is kept as it is. */
export function addProjectAsset(asset: ProjectAsset): void {
  if (assets.some((a) => a.id === asset.id)) return;
  assets = [...assets, asset];
  emit();
}

/** Call `listener` when the attachments change; returns the unsubscribe. */
export function onProjectAssetsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
