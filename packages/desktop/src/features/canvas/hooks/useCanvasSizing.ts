import { useEffect, useState, type RefObject } from "react";

export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

export function useCanvasSizing(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  overlayCanvasRef?: RefObject<HTMLCanvasElement | null>,
): CanvasSize {
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({
    width: 0,
    height: 0,
    dpr: window.devicePixelRatio || 1,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (rect.width <= 0 || rect.height <= 0) return;

      setCanvasSize((prev) => {
        if (
          rect.width === prev.width &&
          rect.height === prev.height &&
          dpr === prev.dpr
        ) {
          return prev;
        }

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        return { width: rect.width, height: rect.height, dpr };
      });
    };

    updateSize();
    const ro = new ResizeObserver(() => updateSize());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvasRef]);

  useEffect(() => {
    const overlay = overlayCanvasRef?.current;
    if (!overlay || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    overlay.setAttribute("width", String(canvasSize.width * canvasSize.dpr));
    overlay.setAttribute("height", String(canvasSize.height * canvasSize.dpr));
  }, [overlayCanvasRef, canvasSize]);

  return canvasSize;
}
