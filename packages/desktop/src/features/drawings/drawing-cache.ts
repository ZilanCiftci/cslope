/**
 * The drawings as the canvas draws them: each file opened once (sources.ts),
 * and rasters of the placed regions at a resolution that follows the zoom
 * (a PDF page re-rendered, debounced, when the view zooms in or out by
 * more than a step; an image is its own raster). Drawing never waits: the
 * canvas draws what is ready and is told (onDrawingsChanged) when more is.
 */
import type { BackgroundImage } from "../../store/types";
import { projectAsset } from "./asset-registry";
import { openDrawingSource, type DrawingSource, type PageSize, type Raster } from "./sources";
import type { Crop } from "./transform";

/** Where a file's bytes come from (the main window: the project's attachments; the Place drawing window: what the main window sent). */
export type AssetLoader = (assetId: string) => Promise<{ bytes: Uint8Array; mime: string }>;

const registryLoader: AssetLoader = async (id) => {
  const asset = projectAsset(id);
  if (!asset) throw new Error(`The project has no drawing ${id}.`);
  return { bytes: await asset.data(), mime: asset.mime };
};

let loader: AssetLoader = registryLoader;

/** Use another source of bytes (the Place drawing window). */
export function setAssetLoader(next: AssetLoader): void {
  loader = next;
}

interface SourceEntry {
  promise: Promise<DrawingSource>;
  source: DrawingSource | null;
  error: string | null;
}

const sources = new Map<string, SourceEntry>();
const listeners = new Set<() => void>();
let notifyScheduled = false;

function notify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const l of listeners) l();
  });
}

/** Call `listener` when a drawing or a sharper raster of one is ready; returns the unsubscribe. */
export function onDrawingsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The opened file of an attachment (opened on the first call). */
export function drawingSource(assetId: string): Promise<DrawingSource> {
  let entry = sources.get(assetId);
  if (!entry) {
    const e: SourceEntry = { promise: Promise.resolve(null as unknown as DrawingSource), source: null, error: null };
    e.promise = loader(assetId)
      .then(({ bytes, mime }) => openDrawingSource(bytes, mime))
      .then(
        (source) => {
          e.source = source;
          notify();
          return source;
        },
        (err: unknown) => {
          e.error = err instanceof Error ? err.message : String(err);
          notify();
          throw err;
        },
      );
    // (a failure is reported through drawingError; nobody else awaits it)
    e.promise.catch(() => {});
    entry = e;
    sources.set(assetId, entry);
  }
  return entry.promise;
}

/** The opened file, if it is open already (else it starts opening). */
export function peekSource(assetId: string): DrawingSource | null {
  const entry = sources.get(assetId);
  if (!entry) {
    void drawingSource(assetId);
    return null;
  }
  return entry.source;
}

/** Why an attachment cannot be shown, or null. */
export function drawingError(assetId: string): string | null {
  return sources.get(assetId)?.error ?? null;
}

/** A page's size, if known. */
export function pageSizeOf(assetId: string, page = 1): PageSize | null {
  return peekSource(assetId)?.pageSize(page) ?? null;
}

/** The region of the source a placement shows: its crop, else the whole page (null until the page size is known). */
export function placementExtent(p: Pick<BackgroundImage, "assetId" | "page" | "crop">): Crop | null {
  if (p.crop) return p.crop;
  const size = pageSizeOf(p.assetId, p.page ?? 1);
  return size ? { x0: 0, y0: 0, x1: size.width, y1: size.height } : null;
}

// ── Rasters ─────────────────────────────────────────────────────────

interface RasterEntry {
  raster: Raster | null;
  /** The scale step being rendered or rendered. */
  step: number;
  pending: ReturnType<typeof setTimeout> | null;
  rendering: boolean;
  used: number;
}

const rasters = new Map<string, RasterEntry>();
/** The memory the rasters may hold (RGBA bytes); the least recently used go first. */
const RASTER_BUDGET = 400e6;
const RERENDER_DELAY_MS = 150;
let clock = 0;

const regionKey = (r: Crop) => [r.x0, r.y0, r.x1, r.y1].map((v) => Math.round(v * 100) / 100).join(",");

/** The scale step for a wanted scale: powers of √2, so a zoom re-renders at most once per step. */
export function scaleStep(scale: number): number {
  return Math.pow(Math.SQRT2, Math.ceil(Math.log(Math.max(scale, 1e-6)) / Math.log(Math.SQRT2)));
}

function evict(): void {
  let total = 0;
  for (const e of rasters.values()) total += e.raster ? e.raster.width * e.raster.height * 4 : 0;
  if (total <= RASTER_BUDGET) return;
  const byAge = [...rasters.entries()].sort((a, b) => a[1].used - b[1].used);
  for (const [key, e] of byAge) {
    if (total <= RASTER_BUDGET) break;
    if (!e.raster || e.rendering) continue;
    total -= e.raster.width * e.raster.height * 4;
    rasters.delete(key);
  }
}

/**
 * The raster of a placement's region to draw now (null: none ready yet),
 * for about `scale` raster pixels per source unit. A PDF region is
 * re-rendered (after a pause, so a zoom gesture renders once) when the
 * scale moves to another step. A `tag` keeps a raster of its own (the
 * Place drawing window's magnifier, at another scale than the view's).
 */
export function rasterFor(p: Pick<BackgroundImage, "assetId" | "page" | "crop">, scale: number, tag = ""): Raster | null {
  const source = peekSource(p.assetId);
  if (!source) return null;
  const page = p.page ?? 1;
  if (page < 1 || page > source.pageCount) return null;
  const region = p.crop ?? (() => {
    const size = source.pageSize(page);
    return size ? { x0: 0, y0: 0, x1: size.width, y1: size.height } : null;
  })();
  if (!region) {
    void source.loadPageSize(page).then(notify, () => {});
    return null;
  }
  const key = `${p.assetId}|${page}|${source.fixedResolution ? "" : `${regionKey(region)}|${tag}`}`;
  const step = source.fixedResolution ? 1 : scaleStep(scale);
  let entry = rasters.get(key);
  if (!entry) {
    entry = { raster: null, step: 0, pending: null, rendering: false, used: 0 };
    rasters.set(key, entry);
  }
  entry.used = ++clock;
  const e = entry;
  if (e.step !== step && !e.rendering) {
    if (e.pending) clearTimeout(e.pending);
    const start = () => {
      e.pending = null;
      e.rendering = true;
      e.step = step;
      source
        .render(page, step, source.fixedResolution ? undefined : region)
        .then(
          (raster) => {
            e.raster = raster;
            evict();
          },
          () => {},
        )
        .finally(() => {
          e.rendering = false;
          notify();
        });
    };
    // The first raster at once; a sharper or lighter one after a pause.
    if (!e.raster) start();
    else e.pending = setTimeout(start, RERENDER_DELAY_MS);
  }
  return e.raster;
}

/** A raster of a placement's region at `scale`, rendered now (the PDF export). */
export async function renderPlacement(p: Pick<BackgroundImage, "assetId" | "page" | "crop">, scale: number): Promise<Raster> {
  const source = await drawingSource(p.assetId);
  return source.render(p.page ?? 1, scale, p.crop);
}

/** Forget everything (a test; or the Place drawing window when the project's files change). */
export function clearDrawingCache(): void {
  for (const e of sources.values()) e.source?.dispose();
  sources.clear();
  for (const e of rasters.values()) if (e.pending) clearTimeout(e.pending);
  rasters.clear();
}
