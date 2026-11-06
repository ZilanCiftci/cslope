import type { SliceCreator } from "../helpers";
import type { AppState, BackgroundImage, BackgroundsSlice, ModelLocks } from "../types";
import { withObjectLocked } from "../canvas-selection";

/** The drawings as a model entry keeps them: absent when there are none. */
export function backgroundsEntry(backgrounds: BackgroundImage[]): BackgroundImage[] | undefined {
  return backgrounds.length > 0 ? backgrounds : undefined;
}

/** The placements in drawing order (lowest `order` first). */
export function sortedBackgrounds(backgrounds: readonly BackgroundImage[]): BackgroundImage[] {
  return [...backgrounds].sort((a, b) => a.order - b.order);
}

/**
 * The active model's drawings. Every change is one undo step (backgrounds
 * and locks are in the undo history) and is mirrored into the model's
 * entry, so the explorer and the other windows see it at once.
 */
export const createBackgroundsSlice: SliceCreator<BackgroundsSlice> = (set, get) => {
  const commit = (backgrounds: BackgroundImage[], locks?: ModelLocks) =>
    set((s: AppState) => ({
      backgrounds,
      ...(locks ? { locks } : {}),
      models: s.models.map((m) => {
        if (m.id !== s.activeModelId) return m;
        const next = { ...m };
        const entry = backgroundsEntry(backgrounds);
        if (entry) next.backgrounds = entry;
        else delete next.backgrounds;
        if (locks) {
          if (Object.keys(locks).length > 0) next.locks = locks;
          else delete next.locks;
        }
        return next;
      }),
    }));

  return {
    backgrounds: [],

    addBackground: (placement) => {
      const s = get();
      const order = s.backgrounds.reduce((max, b) => Math.max(max, b.order + 1), 0);
      const placed: BackgroundImage = { ...placement, order };
      commit(
        [...s.backgrounds.filter((b) => b.id !== placement.id), placed],
        withObjectLocked(s.locks, { type: "background", id: placement.id }, true),
      );
    },

    updateBackground: (id, patch) => {
      const s = get();
      if (!s.backgrounds.some((b) => b.id === id)) return;
      const clean: Partial<BackgroundImage> = { ...patch };
      if (clean.opacity !== undefined) clean.opacity = Math.min(1, Math.max(0, clean.opacity));
      commit(s.backgrounds.map((b) => (b.id === id ? { ...b, ...clean } : b)));
    },

    removeBackground: (id) => {
      const s = get();
      if (!s.backgrounds.some((b) => b.id === id)) return;
      commit(
        s.backgrounds.filter((b) => b.id !== id),
        withObjectLocked(s.locks, { type: "background", id }, false),
      );
    },

    moveBackground: (id, direction) => {
      const sorted = sortedBackgrounds(get().backgrounds);
      const i = sorted.findIndex((b) => b.id === id);
      const j = direction === "up" ? i + 1 : i - 1;
      if (i < 0 || j < 0 || j >= sorted.length) return;
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      commit(sorted.map((b, k) => ({ ...b, order: k })));
    },

    moveBackgroundTo: (id, index) => {
      const sorted = sortedBackgrounds(get().backgrounds);
      const i = sorted.findIndex((b) => b.id === id);
      const j = Math.max(0, Math.min(sorted.length - 1, Math.round(index)));
      if (i < 0 || i === j) return;
      const [moved] = sorted.splice(i, 1);
      sorted.splice(j, 0, moved);
      commit(sorted.map((b, k) => ({ ...b, order: k })));
    },
  };
};
