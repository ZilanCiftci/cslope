import { useEffect, useRef } from "react";
import type { PickedChain } from "./line-pick";
import { apply } from "./transform";

type ToCanvas = (wx: number, wy: number) => [number, number];

/** The picked lines (and the one under the pointer) through the placement's transform, on a canvas of their own. */
export function PickedLines({
  chains,
  hover,
  transform,
  toCanvas,
  size,
}: {
  chains: PickedChain[];
  hover: PickedChain | null;
  transform: { a: number; b: number; c: number; d: number; e: number; f: number };
  toCanvas: ToCanvas;
  size: { width: number; height: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.width * dpr);
    c.height = Math.round(size.height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    const stroke = (chain: PickedChain, color: string, width: number) => {
      ctx.beginPath();
      chain.points.forEach((q, i) => {
        const [x, y] = toCanvas(...apply(transform, q));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (chain.closed) ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    };
    if (hover) stroke(hover, "rgba(245,158,11,0.55)", 5);
    for (const ch of chains) {
      stroke(ch, "rgba(0,0,0,0.35)", 6);
      stroke(ch, "#f59e0b", 3);
    }
  }, [chains, hover, transform, toCanvas, size]);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none z-30" data-testid="picked-lines" />;
}
