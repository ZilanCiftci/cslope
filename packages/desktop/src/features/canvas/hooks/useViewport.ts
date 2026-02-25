import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useAppStore, PLOT_MARGINS } from "../../../store/app-store";
import { computePaperFrame } from "../helpers";

export function useViewport(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  containerRef?: RefObject<HTMLDivElement | null>,
) {
  const mode = useAppStore((s) => s.mode);
  const resultViewSettings = useAppStore((s) => s.resultViewSettings);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const coordsForViewport = useAppStore((s) => s.coordinates);

  const editViewOffset = useAppStore((s) => s.editViewOffset);
  const editViewScale = useAppStore((s) => s.editViewScale);
  const resultViewOffset = useAppStore((s) => s.resultViewOffset);
  const resultViewScale = useAppStore((s) => s.resultViewScale);
  const setEditViewOffset = useAppStore((s) => s.setEditViewOffset);
  const setEditViewScale = useAppStore((s) => s.setEditViewScale);
  const setResultViewOffset = useAppStore((s) => s.setResultViewOffset);
  const setResultViewScale = useAppStore((s) => s.setResultViewScale);

  const viewOffset = useMemo(
    () => (mode === "result" ? resultViewOffset : editViewOffset),
    [mode, resultViewOffset, editViewOffset],
  );
  const viewScale = useMemo(
    () => (mode === "result" ? resultViewScale : editViewScale),
    [mode, resultViewScale, editViewScale],
  );

  const worldToCanvas = useCallback(
    (wx: number, wy: number, w: number, h: number): [number, number] => {
      const cx = w / 2 + (wx + viewOffset[0]) * viewScale;
      const cy = h / 2 - (wy + viewOffset[1]) * viewScale; // flip Y
      return [cx, cy];
    },
    [viewOffset, viewScale],
  );

  const canvasToWorld = useCallback(
    (cx: number, cy: number, w: number, h: number): [number, number] => {
      const wx = (cx - w / 2) / viewScale - viewOffset[0];
      const wy = -(cy - h / 2) / viewScale - viewOffset[1];
      return [wx, wy];
    },
    [viewOffset, viewScale],
  );

  const setActiveViewOffset = useCallback(
    (offset: [number, number]) => {
      if (mode === "result") setResultViewOffset(offset);
      else setEditViewOffset(offset);
    },
    [mode, setEditViewOffset, setResultViewOffset],
  );

  const setActiveViewScale = useCallback(
    (scale: number) => {
      if (mode === "result") setResultViewScale(scale);
      else setEditViewScale(scale);
    },
    [mode, setEditViewScale, setResultViewScale],
  );

  const getEventWorldPos = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0] as [number, number];
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      return canvasToWorld(cx, cy, rect.width, rect.height);
    },
    [canvasRef, canvasToWorld],
  );

  const lockWasEnabledRef = useRef(false);
  const lastAppliedLockRef = useRef<string | undefined>(undefined);

  /** Compute and apply viewport from viewLock bounds or auto-fit geometry. */
  const applyView = useCallback(
    (forceFit = false) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = containerRef?.current?.getBoundingClientRect();
      const fallbackRect = canvas.getBoundingClientRect();
      const w = rect?.width ?? fallbackRect.width;
      const h = rect?.height ?? fallbackRect.height;
      if (w === 0 || h === 0) return;

      const state = useAppStore.getState();
      const vl = state.resultViewSettings.viewLock;

      if (state.mode === "result" && vl?.enabled) {
        const { paperSize } = state.resultViewSettings.paperFrame;
        const pf = computePaperFrame(w, h, paperSize);

        const PLOT_PAD_L = pf.w * PLOT_MARGINS.L;
        const PLOT_PAD_B = pf.h * PLOT_MARGINS.B;
        const PLOT_PAD_T = pf.h * PLOT_MARGINS.T;
        const PLOT_PAD_R = pf.w * PLOT_MARGINS.R;

        const ifx = pf.x + PLOT_PAD_L;
        const ify = pf.y + PLOT_PAD_T;
        const ifw = pf.w - PLOT_PAD_L - PLOT_PAD_R;
        const ifh = pf.h - PLOT_PAD_T - PLOT_PAD_B;

        const worldW = vl.topRight[0] - vl.bottomLeft[0];
        const worldH = vl.topRight[1] - vl.bottomLeft[1];

        if (worldW > 0 && worldH > 0 && ifw > 0 && ifh > 0) {
          const scale = Math.min(ifw / worldW, ifh / worldH);
          const worldCx = (vl.bottomLeft[0] + vl.topRight[0]) / 2;
          const worldCy = (vl.bottomLeft[1] + vl.topRight[1]) / 2;
          const targetCx = ifx + ifw / 2;
          const targetCy = ify + ifh / 2;

          const ox = (targetCx - w / 2) / scale - worldCx;
          const oy = (h / 2 - targetCy) / scale - worldCy;

          state.setResultViewScale(scale);
          state.setResultViewOffset([ox, oy]);
        }
        return;
      }

      const coords = state.coordinates;
      if (coords.length < 2) return;

      const xs = coords.map((c) => c[0]);
      const ys = coords.map((c) => c[1]);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const yMin = Math.min(...ys);
      const yMax = Math.max(...ys);
      const worldW = xMax - xMin || 10;
      const worldH = yMax - yMin || 10;

      const activeScale =
        state.mode === "result" ? state.resultViewScale : state.editViewScale;
      const activeOffset =
        state.mode === "result" ? state.resultViewOffset : state.editViewOffset;

      const margin = Math.max(worldW, worldH) * 0.05;

      const currentScale = activeScale > 0 ? activeScale : 0;
      if (!forceFit && currentScale > 0) return;

      const worldWm = worldW + margin * 2;
      const worldHm = worldH + margin * 2;
      const scale = Math.min(w / worldWm, h / worldHm);
      const cx = (xMin + xMax) / 2;
      const cy = (yMin + yMax) / 2;

      if (state.mode === "result") {
        state.setResultViewScale(scale);
        state.setResultViewOffset([-cx, -cy]);
      } else {
        state.setEditViewScale(scale);
        state.setEditViewOffset([-cx, -cy]);
      }
    },
    [canvasRef, containerRef],
  );

  useEffect(() => {
    applyView();
  }, [mode, coordsForViewport, resultViewSettings.viewLock, applyView]);

  useEffect(() => {
    applyView(true);
  }, [activeModelId, applyView]);

  useEffect(() => {
    const vl = resultViewSettings.viewLock;
    const enabledNow = mode === "result" && vl?.enabled;
    const currentKey = vl
      ? `${vl.bottomLeft[0]},${vl.bottomLeft[1]},${vl.topRight[0]},${vl.topRight[1]}`
      : undefined;

    if (!enabledNow) {
      if (lockWasEnabledRef.current) {
        lockWasEnabledRef.current = false;
        lastAppliedLockRef.current = undefined;
        applyView();
      }
      return;
    }

    lockWasEnabledRef.current = true;

    if (!currentKey) return;
    const prevKey = lastAppliedLockRef.current;
    const changed = prevKey !== currentKey;

    if (changed) {
      applyView();
      lastAppliedLockRef.current = currentKey;
    }
  }, [mode, resultViewSettings.viewLock, applyView]);

  return {
    viewOffset,
    viewScale,
    worldToCanvas,
    canvasToWorld,
    setActiveViewOffset,
    setActiveViewScale,
    getEventWorldPos,
  };
}
