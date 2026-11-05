/**
 * The Place drawing window and the main window. The main window keeps the
 * project's drawing files (asset-registry.ts) and the placements (the
 * store); the window gets the model's outline, the files and the
 * placements, asks for a file's bytes when it shows it, adds a file, and
 * places (or replaces) a placement. Each command is applied in the main
 * window's store, so a placement is an undo step there.
 */
import { useAppStore } from "../../store/app-store";
import type { BackgroundImage } from "../../store/types";
import { isElectron } from "../../utils/is-electron";
import { useToolWindowSync } from "../../utils/tool-window-sync";
import { addProjectAsset, onProjectAssetsChanged, openedProjectAssets, projectAsset, projectAssetBySha } from "./asset-registry";
import { DRAWING_MIME } from "./sources";

/** A drawing file of the project, as the window lists it. */
export interface DrawingAssetInfo {
  id: string;
  mime: string;
  originalName: string;
  bytes?: number;
  sha256?: string;
  /** Names of the models that place it. */
  usedBy: string[];
}

/** A placement of any model, for the window's lists (reuse a scale). */
export interface PlacementRef {
  modelId: string;
  modelName: string;
  placement: BackgroundImage;
}

/** What the Place drawing window shows. */
export interface DrawingWindowState {
  modelId: string;
  modelName: string;
  /** The model's exterior and material boundaries, for the preview. */
  outline: { exterior: [number, number][]; lines: [number, number][][] };
  /** The project's drawing files (those placed somewhere, and those added since the project was opened). */
  assets: DrawingAssetInfo[];
  /** Every model's placements (the active model's as they are now). */
  placements: PlacementRef[];
  /**
   * What the window opens for: a placement to recalibrate (from the
   * drawings list or the canvas), or "New models from drawing…"; a new
   * nonce each time.
   */
  edit: { placementId?: string; newModels?: boolean; nonce: number } | null;
}

/** What the window asks of the main window. */
export type DrawingCommand =
  | { type: "requestAsset"; id: string }
  | { type: "addAsset"; id: string; name: string; mime: string; sha256: string; data: Uint8Array }
  | { type: "place"; placement: BackgroundImage }
  | { type: "createModels"; models: { name: string; placement: BackgroundImage }[] };

/** A drawing file's bytes, sent to the window (or why they cannot be). */
export type DrawingAssetPayload = { id: string; mime: string; data: Uint8Array } | { id: string; error: string };

let pendingEdit: DrawingWindowState["edit"] = null;
let editNonce = 0;
const editListeners = new Set<() => void>();

/**
 * Open the Place drawing window: for a new placement, or to recalibrate
 * the active model's placement `placementId`.
 */
export function openPlaceDrawing(placementId?: string): void {
  pendingEdit = placementId ? { placementId, nonce: ++editNonce } : null;
  for (const l of editListeners) l();
  if (isElectron) window.cslope.openPlaceDrawingDialog();
}

/** Open the window for "New models from drawing…": frames drawn on a drawing's sheets, one model each. */
export function openNewModelsFromDrawing(): void {
  pendingEdit = { newModels: true, nonce: ++editNonce };
  for (const l of editListeners) l();
  if (isElectron) window.cslope.openPlaceDrawingDialog();
}

/**
 * New models, each with a drawing placed (the file shared) and an empty
 * geometry, named as given (an empty name: the next default name); the
 * first of them becomes the active model. Like an import, not an undo
 * step (a model is removed in the explorer).
 */
export function createModelsFromDrawing(models: { name: string; placement: BackgroundImage }[]): void {
  if (models.length === 0) return;
  // The models first (a placement may name another's model), then their drawings.
  const modelOf = new Map<string, string>();
  for (const m of models) {
    useAppStore.getState().addModel(m.name.trim() || undefined);
    useAppStore.getState().setCoordinates([]);
    modelOf.set(m.placement.id, useAppStore.getState().activeModelId);
  }
  let first: string | null = null;
  for (const m of models) {
    const id = modelOf.get(m.placement.id)!;
    if (useAppStore.getState().activeModelId !== id) useAppStore.getState().switchModel(id);
    const s = useAppStore.getState();
    // A scale reused from another frame: that frame's model and placement.
    const reuse = m.placement.calibration.axes?.reuseFrom;
    const placement =
      reuse?.startsWith("placement:") && m.placement.calibration.axes
        ? {
            ...m.placement,
            calibration: {
              ...m.placement.calibration,
              axes: { ...m.placement.calibration.axes, reuseFrom: `${modelOf.get(reuse.slice(10)) ?? ""}/${reuse.slice(10)}` },
            },
          }
        : m.placement;
    s.addBackground(placement);
    first ??= useAppStore.getState().activeModelId;
  }
  if (first && useAppStore.getState().activeModelId !== first) useAppStore.getState().switchModel(first);
  useAppStore.setState({ _pendingFitToScreen: true });
  useAppStore.temporal.getState().clear();
}

/** The state the window is sent. */
export function drawingWindowState(): DrawingWindowState {
  const s = useAppStore.getState();
  const placements: PlacementRef[] = s.models.flatMap((m) =>
    (m.id === s.activeModelId ? s.backgrounds : (m.backgrounds ?? [])).map((placement) => ({ modelId: m.id, modelName: m.name, placement })),
  );
  const used = new Map<string, string[]>();
  for (const p of placements) used.set(p.placement.assetId, [...(used.get(p.placement.assetId) ?? []), p.modelName]);
  const assets = openedProjectAssets()
    .filter((a) => DRAWING_MIME[a.mime] !== undefined)
    .map((a) => ({ id: a.id, mime: a.mime, originalName: a.originalName, bytes: a.bytes, sha256: a.sha256, usedBy: [...new Set(used.get(a.id) ?? [])] }));
  return {
    modelId: s.activeModelId,
    modelName: s.models.find((m) => m.id === s.activeModelId)?.name ?? "",
    outline: { exterior: s.coordinates, lines: s.materialBoundaries.map((b) => b.coordinates) },
    assets,
    placements,
    edit: pendingEdit,
  };
}

/** Carry out a command of the window in the main window. */
export async function handleDrawingCommand(command: DrawingCommand, send: (asset: DrawingAssetPayload) => void): Promise<void> {
  switch (command.type) {
    case "requestAsset": {
      const asset = projectAsset(command.id);
      if (!asset) {
        send({ id: command.id, error: "The project has no such drawing." });
        return;
      }
      try {
        send({ id: asset.id, mime: asset.mime, data: await asset.data() });
      } catch (err) {
        send({ id: command.id, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    case "addAsset": {
      if (DRAWING_MIME[command.mime] === undefined || projectAssetBySha(command.sha256)) return;
      const data = command.data;
      addProjectAsset({
        id: command.id,
        mime: command.mime,
        originalName: command.name,
        addedAt: new Date().toISOString(),
        sha256: command.sha256,
        bytes: data.length,
        data: () => data,
      });
      return;
    }
    case "place": {
      const s = useAppStore.getState();
      const { id, ...rest } = command.placement;
      if (s.backgrounds.some((b) => b.id === id)) s.updateBackground(id, rest);
      else s.addBackground(command.placement);
      pendingEdit = null;
      return;
    }
    case "createModels":
      createModelsFromDrawing(command.models);
      pendingEdit = null;
      return;
  }
}

/** Main-window side of the Place drawing window. */
export function useDrawingWindowSync(enabled: boolean): void {
  useToolWindowSync<DrawingWindowState, DrawingCommand>({
    enabled: enabled && isElectron,
    build: drawingWindowState,
    subscribeExtra: (listener) => {
      editListeners.add(listener);
      const offs = [
        onProjectAssetsChanged(listener),
        useAppStore.subscribe((next, prev) => {
          if (
            next.backgrounds !== prev.backgrounds ||
            next.models !== prev.models ||
            next.coordinates !== prev.coordinates ||
            next.materialBoundaries !== prev.materialBoundaries ||
            next.activeModelId !== prev.activeModelId
          ) {
            listener();
          }
        }),
      ];
      return () => {
        editListeners.delete(listener);
        for (const off of offs) off();
      };
    },
    onRequestState: (l) => window.cslope.onDrawingRequestState(l),
    sendState: (s) => window.cslope.sendDrawingState(s),
    sendChanged: (s) => window.cslope.sendDrawingChanged(s),
    onCommand: (l) => window.cslope.onDrawingCommand(l),
    onClosed: (l) => window.cslope.onDrawingClosed(l),
    handleCommand: (command) => void handleDrawingCommand(command, (asset) => window.cslope.sendDrawingAsset(asset)),
    handleClosed: () => {
      pendingEdit = null;
    },
  });
}
