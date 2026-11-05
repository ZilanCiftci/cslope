import { useEffect, useState } from "react";
import { useAppStore } from "../store/app-store";
import { snapshotFromState } from "../store/slices/analysisSlice";
import type { AppState, ModelEntry } from "../store/types";

/** The active model as the analysis sees it, with its name. */
export function activeModelSnapshot(state: AppState = useAppStore.getState()): ModelEntry {
  const name = state.models.find((m) => m.id === state.activeModelId)?.name ?? "";
  return { ...snapshotFromState(state), name };
}

/** The store fields a model snapshot is made of. */
const SNAPSHOT_KEYS = [
  "activeModelId",
  "orientation",
  "coordinates",
  "coordinateExpressions",
  "parameters",
  "materials",
  "materialBoundaries",
  "regionMaterials",
  "piezometricLine",
  "udls",
  "lineLoads",
  "reinforcements",
  "piles",
  "customSearchPlanes",
  "customPlanesOnly",
  "blockSearchObjects",
  "waternet",
  "earlierStage",
  "options",
  "analysisLimits",
] as const satisfies readonly (keyof AppState)[];

/** True when the active model (or its name) differs between two states. */
export function modelChanged(next: AppState, prev: AppState): boolean {
  if (SNAPSHOT_KEYS.some((k) => next[k] !== prev[k])) return true;
  const name = (s: AppState) => s.models.find((m) => m.id === s.activeModelId)?.name;
  return name(next) !== name(prev);
}

/**
 * Main-window side of a tool window: answer its state requests, send it
 * every change while it is open (coalesced, so a run's progress does not
 * flood the channel), and carry out its commands. `onClosed` runs when
 * the window closes and when the active model changes.
 */
export function useToolWindowSync<S, C>(bridge: {
  enabled: boolean;
  build: () => S;
  /** Stores whose changes are sent; the app store only when the model changes. */
  subscribeExtra: (listener: () => void) => () => void;
  onRequestState: (listener: () => void) => () => void;
  sendState: (state: S) => void;
  sendChanged: (state: S) => void;
  onCommand: (listener: (event: unknown, command: C) => void) => () => void;
  onClosed: (listener: () => void) => () => void;
  handleCommand: (command: C) => void;
  handleClosed: () => void;
}): void {
  const { enabled } = bridge;
  useEffect(() => {
    if (!enabled) return;
    let open = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      if (!open || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (open) bridge.sendChanged(bridge.build());
      }, 40);
    };
    const offs = [
      bridge.onRequestState(() => {
        open = true;
        bridge.sendState(bridge.build());
      }),
      bridge.onCommand((_event, command) => bridge.handleCommand(command)),
      bridge.onClosed(() => {
        open = false;
        bridge.handleClosed();
      }),
      bridge.subscribeExtra(changed),
      useAppStore.subscribe((next, prev) => {
        // Another model: its run (and result) does not belong to this one.
        if (next.activeModelId !== prev.activeModelId) bridge.handleClosed();
        if (modelChanged(next, prev)) changed();
      }),
    ];
    return () => {
      clearTimeout(timer);
      for (const off of offs) off();
    };
    // The bridge is built anew on every render; it has no state of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/**
 * Tool-window side: the state the main window sends, null until the first
 * one arrives (the window asks for it when it opens).
 */
export function useToolWindowState<S>(bridge: {
  enabled: boolean;
  request: () => void;
  onState: (listener: (event: unknown, state: S) => void) => () => void;
  onChanged: (listener: (event: unknown, state: S) => void) => () => void;
}): S | null {
  const [state, setState] = useState<S | null>(null);
  const { enabled } = bridge;
  useEffect(() => {
    if (!enabled) return;
    const apply = (_event: unknown, next: S) => setState(next);
    const offs = [bridge.onState(apply), bridge.onChanged(apply)];
    bridge.request();
    return () => {
      for (const off of offs) off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return state;
}
