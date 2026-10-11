import type { ViewLock } from "../../store/types";

type Pt = [number, number];

/** True when every model point lies inside the locked view. */
export function viewLockContains(lock: ViewLock, coords: Pt[]): boolean {
  const tol = 1e-9;
  return coords.every(
    ([x, y]) =>
      x >= lock.bottomLeft[0] - tol &&
      x <= lock.topRight[0] + tol &&
      y >= lock.bottomLeft[1] - tol &&
      y <= lock.topRight[1] + tol,
  );
}

/**
 * Locked view around the model with a 1 m margin and the plot aspect ratio
 * (the "Use Model Bounds" result).
 */
export function viewLockForModel(coords: Pt[], aspect: number): ViewLock {
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const left = Math.min(...xs) - 1;
  const right = Math.max(...xs) + 1;
  const bottom = Math.min(...ys) - 1;
  let top = bottom + (right - left) / aspect;
  // A tall model must fit too: widen instead of cutting off the top.
  const needTop = Math.max(...ys) + 1;
  if (top < needTop) {
    const width = (needTop - bottom) * aspect;
    const cx = (left + right) / 2;
    top = needTop;
    return { bottomLeft: [cx - width / 2, bottom], topRight: [cx + width / 2, top] };
  }
  return { bottomLeft: [left, bottom], topRight: [right, top] };
}
