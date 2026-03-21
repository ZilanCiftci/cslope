import { useEffect, type MutableRefObject } from "react";
import { useAppStore, getActiveViewport } from "../../../store/app-store";
import { drawCanvas, type DrawCanvasParams } from "../draw";
import type { CanvasSize } from "./useCanvasSizing";

interface UseCanvasDrawLoopParams {
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  canvasSize: CanvasSize;
  drawMetaRef: MutableRefObject<{ dpr: number }>;
  drawRafRef: MutableRefObject<number | null>;
  drawDirtyRef: MutableRefObject<boolean>;
  drawArgsRef: MutableRefObject<DrawCanvasParams | null>;
  drawArgs: DrawCanvasParams;
  themeToken: unknown;
}

export function useCanvasDrawLoop({
  canvasRef,
  canvasSize,
  drawMetaRef,
  drawRafRef,
  drawDirtyRef,
  drawArgsRef,
  drawArgs,
  themeToken,
}: UseCanvasDrawLoopParams) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    drawMetaRef.current = { dpr: canvasSize.dpr };

    void themeToken;

    drawArgsRef.current = drawArgs;

    const requestDraw = () => {
      if (drawRafRef.current !== null) return;
      drawRafRef.current = requestAnimationFrame(() => {
        drawRafRef.current = null;
        if (!drawDirtyRef.current) return;
        drawDirtyRef.current = false;

        const activeCanvas = canvasRef.current;
        const activeArgs = drawArgsRef.current;
        if (!activeCanvas || !activeArgs) return;
        const ctx = activeCanvas.getContext("2d");
        if (!ctx) return;

        const state = useAppStore.getState();
        const { viewOffset: currentViewOffset, viewScale: currentViewScale } =
          getActiveViewport(state);

        const currentWorldToCanvas = (
          wx: number,
          wy: number,
          w: number,
          h: number,
        ): [number, number] => {
          const cx = w / 2 + (wx + currentViewOffset[0]) * currentViewScale;
          const cy = h / 2 - (wy + currentViewOffset[1]) * currentViewScale;
          return [cx, cy];
        };

        const currentCanvasToWorld = (
          cx: number,
          cy: number,
          w: number,
          h: number,
        ): [number, number] => {
          const wx = (cx - w / 2) / currentViewScale - currentViewOffset[0];
          const wy = -(cy - h / 2) / currentViewScale - currentViewOffset[1];
          return [wx, wy];
        };

        const updatedArgs: DrawCanvasParams = {
          ...activeArgs,
          viewScale: currentViewScale,
          worldToCanvas: currentWorldToCanvas,
          canvasToWorld: currentCanvasToWorld,
        };

        ctx.setTransform(
          drawMetaRef.current.dpr,
          0,
          0,
          drawMetaRef.current.dpr,
          0,
          0,
        );
        drawCanvas(ctx, updatedArgs);

        if (drawDirtyRef.current) requestDraw();
      });
    };

    drawDirtyRef.current = true;
    requestDraw();

    const unsub = useAppStore.subscribe((state, prevState) => {
      const oldOffset =
        prevState.mode === "result"
          ? prevState.resultViewOffset
          : prevState.editViewOffset;
      const newOffset =
        state.mode === "result" ? state.resultViewOffset : state.editViewOffset;
      const oldScale =
        prevState.mode === "result"
          ? prevState.resultViewScale
          : prevState.editViewScale;
      const newScale =
        state.mode === "result" ? state.resultViewScale : state.editViewScale;

      const geometryChanged =
        state.coordinates !== prevState.coordinates ||
        state.materialBoundaries !== prevState.materialBoundaries ||
        state.piezometricLine !== prevState.piezometricLine ||
        state.analysisLimits !== prevState.analysisLimits ||
        state.udls !== prevState.udls ||
        state.lineLoads !== prevState.lineLoads;

      const resultViewRenderChanged =
        state.resultViewSettings !== prevState.resultViewSettings ||
        state.result !== prevState.result ||
        state.selectedAnnotationIds !== prevState.selectedAnnotationIds;

      if (
        oldOffset !== newOffset ||
        oldScale !== newScale ||
        geometryChanged ||
        resultViewRenderChanged
      ) {
        if (drawArgsRef.current) {
          drawArgsRef.current = {
            ...drawArgsRef.current,
            coordinates: state.coordinates,
            materialBoundaries: state.materialBoundaries,
            piezometricLine: state.piezometricLine,
            analysisLimits: state.analysisLimits,
            udls: state.udls,
            lineLoads: state.lineLoads,
            result: state.result,
            resultViewSettings: state.resultViewSettings,
            selectedAnnotationIds: state.selectedAnnotationIds,
          };
        }
        drawDirtyRef.current = true;
        requestDraw();
      }
    });

    return () => {
      unsub();
    };
  }, [
    canvasRef,
    canvasSize.width,
    canvasSize.height,
    canvasSize.dpr,
    drawMetaRef,
    drawRafRef,
    drawDirtyRef,
    drawArgsRef,
    drawArgs,
    themeToken,
  ]);
}
