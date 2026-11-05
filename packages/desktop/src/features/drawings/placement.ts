/**
 * A drawing's placement in a model (models/<id>/backgrounds.json): read
 * and validated, including the first form of an entry (origin, scale,
 * rotation; converted to the affine transform), and the helpers the
 * canvas and the window share.
 */
import type { BackgroundImage, DrawingCalibration } from "../../store/types";
import { isUsable, legacyTransform, normalizeCrop, type Affine } from "./transform";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const point = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) ? [v[0], v[1]] : null);

/** True when an entry of backgrounds.json is of the first form (originX, scale, ...). */
export function isLegacyEntry(raw: unknown): boolean {
  return isObject(raw) && isObject(raw.transform) && "originX" in raw.transform;
}

function readCalibration(raw: unknown): DrawingCalibration {
  if (!isObject(raw)) return { mode: "drawing", points: [] };
  const mode = raw.mode === "points" || raw.mode === "axes" || raw.mode === "scale" || raw.mode === "drawing" ? raw.mode : "drawing";
  const points: DrawingCalibration["points"] = [];
  if (Array.isArray(raw.points)) {
    for (const p of raw.points) {
      if (!isObject(p)) continue;
      const source = point(p.source);
      const model = point(p.model);
      if (source && model) points.push({ source, model });
    }
  }
  const out: DrawingCalibration = { mode, points };
  if (isObject(raw.axes)) {
    const ticks = (v: unknown) =>
      (Array.isArray(v) ? v : []).flatMap((t) => {
        if (!isObject(t)) return [];
        const source = point(t.source);
        return source && finite(t.value) ? [{ source, value: t.value }] : [];
      });
    out.axes = { x: ticks(raw.axes.x), y: ticks(raw.axes.y) };
    if (typeof raw.axes.reuseFrom === "string") out.axes.reuseFrom = raw.axes.reuseFrom;
  }
  if (isObject(raw.scale) && finite(raw.scale.metersPerUnit) && raw.scale.metersPerUnit > 0) {
    const unit = raw.scale.unit === "pt" || raw.scale.unit === "mm" || raw.scale.unit === "du" ? raw.scale.unit : "px";
    out.scale = { metersPerUnit: raw.scale.metersPerUnit, unit };
  }
  return out;
}

function readAffine(raw: unknown): Affine | null {
  if (!isObject(raw)) return null;
  const { a, b, c, d, e, f } = raw;
  if (![a, b, c, d, e, f].every(finite)) return null;
  const m = { a, b, c, d, e, f } as Affine;
  return isUsable(m) ? m : null;
}

/**
 * backgrounds.json validated: entries of the shape BackgroundImage (an
 * entry of the first form converted, with the pixel size of its image
 * from `legacySize`; without one, the image's top-left corner is taken
 * as the origin), sorted by `order`. Ids are made unique.
 */
export function normalizeBackgrounds(
  raw: unknown,
  legacySize: (assetId: string) => { width: number; height: number } | null = () => null,
): BackgroundImage[] {
  if (!Array.isArray(raw)) return [];
  const out: BackgroundImage[] = [];
  const ids = new Set<string>();
  raw.forEach((item, index) => {
    if (!isObject(item) || typeof item.assetId !== "string" || !SAFE_ID.test(item.assetId)) return;
    let transform: Affine | null;
    let calibration: DrawingCalibration;
    if (isLegacyEntry(item)) {
      const t = item.transform as Record<string, unknown>;
      if (!finite(t.originX) || !finite(t.originY) || !finite(t.scale) || t.scale <= 0) return;
      const size = legacySize(item.assetId) ?? { width: 0, height: 0 };
      transform = legacyTransform(
        { originX: t.originX, originY: t.originY, scale: t.scale, rotationDeg: finite(t.rotationDeg) ? t.rotationDeg : 0, mirrored: t.mirrored === true },
        size.width,
        size.height,
      );
      calibration = { mode: "drawing", points: [] };
    } else {
      transform = readAffine(item.transform);
      calibration = readCalibration(item.calibration);
    }
    if (!transform || !isUsable(transform)) return;
    let id = typeof item.id === "string" && SAFE_ID.test(item.id) ? item.id : `drawing-${index + 1}`;
    while (ids.has(id)) id = `${id}-1`;
    ids.add(id);
    const entry: BackgroundImage = {
      id,
      assetId: item.assetId,
      calibration,
      transform,
      opacity: finite(item.opacity) ? Math.min(1, Math.max(0, item.opacity)) : 1,
      visible: item.visible !== false,
      order: finite(item.order) ? item.order : index,
    };
    if (typeof item.name === "string" && item.name.trim()) entry.name = item.name;
    if (finite(item.page) && Number.isInteger(item.page) && item.page >= 1) entry.page = item.page;
    if (isObject(item.crop) && [item.crop.x0, item.crop.y0, item.crop.x1, item.crop.y1].every(finite)) {
      const crop = normalizeCrop(item.crop as { x0: number; y0: number; x1: number; y1: number });
      if (crop.x1 - crop.x0 > 0 && crop.y1 - crop.y0 > 0) entry.crop = crop;
    }
    if (item.showInResults === true) entry.showInResults = true;
    if (Array.isArray(item.hiddenLayers)) {
      const names = [...new Set(item.hiddenLayers.filter((n): n is string => typeof n === "string"))];
      if (names.length > 0) entry.hiddenLayers = names;
    }
    out.push(entry);
  });
  return out.sort((a, b) => a.order - b.order);
}

/**
 * The calibration of a drawing moved by (dx, dy) in the model: its model
 * points and axis values move with it, so recalibrating starts from where
 * the drawing is.
 */
export function translateCalibration(c: DrawingCalibration, dx: number, dy: number): DrawingCalibration {
  const out: DrawingCalibration = {
    ...c,
    points: c.points.map((p) => ({ source: p.source, model: [p.model[0] + dx, p.model[1] + dy] })),
  };
  if (c.axes) {
    out.axes = {
      ...c.axes,
      x: c.axes.x.map((t) => ({ ...t, value: t.value + dx })),
      y: c.axes.y.map((t) => ({ ...t, value: t.value + dy })),
    };
  }
  return out;
}

/** What the drawings list and the canvas call a placement. */
export function placementLabel(b: Pick<BackgroundImage, "name" | "page">, originalName = ""): string {
  if (b.name) return b.name;
  const base = originalName || "Drawing";
  return b.page ? `${base}, page ${b.page}` : base;
}

/** A new placement id. */
export function newPlacementId(): string {
  return `drawing-${crypto.randomUUID()}`;
}
