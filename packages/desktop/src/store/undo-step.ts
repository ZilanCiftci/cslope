/**
 * Several store changes as one undo step: the history is paused while
 * `change` runs and the state before it is pushed once (when anything
 * changed), so Undo takes the whole change back.
 */
import { undoableState, useAppStore } from "./app-store";

export function asOneUndoStep<T>(change: () => T): T {
  const temporal = useAppStore.temporal;
  const before = undoableState(useAppStore.getState());
  const tracking = temporal.getState().isTracking;
  temporal.getState().pause();
  let result: T;
  try {
    result = change();
  } finally {
    if (tracking) temporal.getState().resume();
  }
  const after = undoableState(useAppStore.getState());
  if (tracking && JSON.stringify(before) !== JSON.stringify(after)) {
    temporal.setState((s) => ({
      pastStates: s.pastStates.length >= 50 ? [...s.pastStates.slice(1), before] : [...s.pastStates, before],
      futureStates: [],
    }));
  }
  return result;
}
