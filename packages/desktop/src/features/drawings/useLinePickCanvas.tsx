/**
 * "Pick lines from drawing" on the edit canvas: while it is on, a click
 * picks the polyline under the pointer (chained end to end,
 * line-pick.ts), Shift+click adds or removes one, a drag picks every line
 * inside the window; the right-click menu and the banner make model
 * objects of them. Escape (or Done) ends it. The picked lines are drawn
 * over the canvas, the one under the pointer lighter.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { useAppStore } from "../../store/app-store";
import { SNAP_THRESHOLD } from "../canvas/constants";
import type { ContextMenuItem, ContextMenuState } from "../canvas/types";
import { snapSourceFor } from "./drawing-cache";
import { chainsInWindow, connectedChain, pathAt, type PickedChain } from "./line-pick";
import { useLinePick, pickedLinesAs, withChain, type UseAs } from "./line-pick-store";
import { PickedLines } from "./PickedLines";
import { placementLabel } from "./placement";
import { projectAsset } from "./asset-registry";

type ToCanvas = (wx: number, wy: number) => [number, number];

interface Params {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  getEventWorldPos: (e: { clientX: number; clientY: number }) => [number, number];
  viewScale: number;
  setContextMenu: (menu: ContextMenuState | null) => void;
}

const DRAG_PX = 4;

/** The bar's buttons: the app's ordinary buttons, on one line. */
const BANNER_BUTTON = "btn text-[11px] whitespace-nowrap shrink-0";
const BANNER_BUTTON_STYLE = {} as const; // (kept for the action buttons)

export function useLinePickCanvas({ canvasRef, getEventWorldPos, viewScale, setContextMenu }: Params) {
  const placementId = useLinePick((s) => s.placementId);
  const chains = useLinePick((s) => s.chains);
  const message = useLinePick((s) => s.message);
  const placement = useAppStore((s) => s.backgrounds.find((b) => b.id === placementId) ?? null);
  const active = !!placementId;
  const [hover, setHover] = useState<PickedChain | null>(null);
  const [windowRect, setWindowRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const press = useRef<{ x: number; y: number; world: [number, number]; shift: boolean; moved: boolean } | null>(null);

  // The drawing removed (or undone away): picking ends.
  useEffect(() => {
    if (placementId && !placement) useLinePick.getState().stop();
  }, [placementId, placement]);

  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") useLinePick.getState().stop();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [active]);

  const tol = SNAP_THRESHOLD / Math.max(viewScale, 1e-9);

  const chainAt = useCallback(
    (wx: number, wy: number): PickedChain | null => {
      if (!placement) return null;
      const src = snapSourceFor(placement);
      if (!src) return null;
      const path = pathAt(src, wx, wy, tol);
      return path === null ? null : connectedChain(src.drawing, path, placement.hiddenLayers);
    },
    [placement, tol],
  );

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>): boolean => {
    if (!active || e.button !== 0) return false;
    setContextMenu(null);
    const p = local(e);
    press.current = { ...p, world: getEventWorldPos(e), shift: e.shiftKey, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    return true;
  };

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>): boolean => {
    if (!active) return false;
    const pr = press.current;
    const p = local(e);
    if (pr) {
      if (!pr.moved && Math.hypot(p.x - pr.x, p.y - pr.y) >= DRAG_PX) pr.moved = true;
      if (pr.moved) setWindowRect({ x0: Math.min(pr.x, p.x), y0: Math.min(pr.y, p.y), x1: Math.max(pr.x, p.x), y1: Math.max(pr.y, p.y) });
      return true;
    }
    const [wx, wy] = getEventWorldPos(e);
    const c = chainAt(wx, wy);
    setHover((h) => (h === c || (h && c && h.paths.join() === c.paths.join()) ? h : c));
    return true;
  };

  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>): boolean => {
    if (!active) return false;
    const pr = press.current;
    press.current = null;
    setWindowRect(null);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!pr || !placement) return true;
    const st = useLinePick.getState();
    if (pr.moved) {
      const src = snapSourceFor(placement);
      if (!src) return true;
      const [wx, wy] = getEventWorldPos(e);
      const rect = { x0: Math.min(pr.world[0], wx), y0: Math.min(pr.world[1], wy), x1: Math.max(pr.world[0], wx), y1: Math.max(pr.world[1], wy) };
      let next = pr.shift ? [...st.chains] : [];
      for (const c of chainsInWindow(src, rect)) next = withChain(next, c, true);
      st.setChains(next);
      return true;
    }
    const c = chainAt(pr.world[0], pr.world[1]);
    if (c) st.setChains(withChain(st.chains, c, pr.shift));
    else if (!pr.shift) st.setChains([]);
    return true;
  };

  const run = useCallback(
    (as: UseAs) => {
      const r = pickedLinesAs(as, tol);
      useLinePick.getState().setMessage(r.message);
    },
    [tol],
  );

  const menuItems = useCallback(
    (close: (fn: () => void) => () => void): ContextMenuItem[] => {
      const none = useLinePick.getState().chains.length === 0;
      return [
        { label: "Use as exterior boundary", disabled: none, action: close(() => run("exterior")) },
        { label: "Use as material boundary", disabled: none, action: close(() => run("boundary")) },
        { label: "Use as water line", disabled: none, action: close(() => run("waterLine")) },
        { label: "Clear picked lines", separator: true, disabled: none, action: close(() => useLinePick.getState().setChains([])) },
        { label: "Done picking lines", action: close(() => useLinePick.getState().stop()) },
      ];
    },
    [run],
  );

  const onContextMenu = (e: RMouseEvent<HTMLCanvasElement>): boolean => {
    if (!active) return false;
    e.preventDefault();
    const p = local(e);
    // A right-click on a line not picked yet picks it first.
    const [wx, wy] = getEventWorldPos(e);
    const c = chainAt(wx, wy);
    const st = useLinePick.getState();
    if (c && !st.chains.some((x) => x.paths.join() === c.paths.join())) st.setChains(withChain(st.chains, c, e.shiftKey));
    const close = (fn: () => void) => () => {
      fn();
      setContextMenu(null);
    };
    setContextMenu({ screenX: p.x, screenY: p.y, items: menuItems(close) });
    return true;
  };

  const label = placement ? placementLabel(placement, projectAsset(placement.assetId)?.originalName) : "";

  return {
    active,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onContextMenu,
    /** The banner, the picked lines and the window, over the canvas. */
    overlay: (toCanvas: ToCanvas, size: { width: number; height: number }) =>
      active && placement ? (
        <>
          <PickedLines chains={chains} hover={hover} transform={placement.transform} toCanvas={toCanvas} size={size} />
          {windowRect && (
            <div
              className="absolute pointer-events-none z-35"
              style={{
                left: windowRect.x0,
                top: windowRect.y0,
                width: windowRect.x1 - windowRect.x0,
                height: windowRect.y1 - windowRect.y0,
                border: "1px dashed var(--color-canvas-pick)",
                background: "color-mix(in srgb, var(--color-canvas-pick) 8%, transparent)",
              }}
            />
          )}
          {/* As wide as it needs, up to the canvas: the explanation wraps, the buttons do not.
              Styled like the floating toolbar (panel, border, ordinary buttons). */}
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 w-max max-w-[calc(100%-16px)] z-40 flex flex-col items-center gap-1 select-none"
            data-testid="line-pick-banner"
          >
            <div
              className="flex items-center gap-2 px-2.5 py-1 rounded-xs shadow-md text-[12px]"
              style={{ background: "var(--color-vsc-sidebar)", color: "var(--color-vsc-text)", border: "1px solid var(--color-vsc-border)" }}
            >
              <span className="min-w-0">
                Pick lines of <strong>{label}</strong>: click a line, Shift+click to add, drag a window.{" "}
                {chains.length > 0 ? `${chains.length} picked.` : ""}
              </span>
              {(
                [
                  ["exterior", "Exterior"],
                  ["boundary", "Material boundary"],
                  ["waterLine", "Water line"],
                ] as const
              ).map(([as, text]) => (
                <button
                  key={as}
                  className={BANNER_BUTTON}
                  style={BANNER_BUTTON_STYLE}
                  disabled={chains.length === 0}
                  title={chains.length === 0 ? "Pick lines first" : `Use as ${text.toLowerCase()}${as === "exterior" ? " boundary" : ""}`}
                  onClick={() => run(as)}
                >
                  {text}
                </button>
              ))}
              <button className={`${BANNER_BUTTON} btn-primary`} title="Stop picking lines (Esc)" onClick={() => useLinePick.getState().stop()}>
                Done
              </button>
            </div>
            {message && (
              <div
                role="status"
                className="px-2 py-1 rounded text-[11px] max-w-[560px] text-center"
                style={{ background: "var(--color-vsc-input-bg)", color: "var(--color-vsc-text)", border: "1px solid var(--color-vsc-border)" }}
              >
                {message}
              </div>
            )}
          </div>
        </>
      ) : null,
  };
}
