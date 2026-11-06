/**
 * Properties › Layers: what the result sheet draws, topmost first, as in a
 * drawing program. The annotations and the display layers the Results
 * ribbon turns on (soil colors, surfaces, slices, center, FOS label, ...)
 * and the drawings shown in results. A row is dragged by its grip, or moved
 * with Alt+Up and Alt+Down, to change the order the result view and the
 * PDF draw them in (the model's `layerOrder`, an undo step). A click on an
 * annotation selects it (Ctrl, Cmd or Shift: adds it); its button removes
 * it. A display layer's button turns it off, as the ribbon does; a
 * drawing's takes it out of the results ("Show in results").
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EyeOff, GripVertical, Target, X } from "lucide-react";
import {
  CentreIcon,
  ColorBarIcon,
  CustomPlanesIcon,
  DrawingIcon,
  FeMeshIcon,
  FosLabelIcon,
  MaterialTableIcon,
  PlasticZoneIcon,
  PlotIcon,
  ReferenceLineIcon,
  SlicesIcon,
  SoilColorsIcon,
  SurfacesIcon,
  TextIcon,
} from "../../components/icons/ribbon";
import { useAppStore } from "../../store/app-store";
import type { Annotation, ResultViewSettings } from "../../store/types";
import { referenceListName } from "../annotations/reference";
import { projectAsset } from "../drawings/asset-registry";
import { placementLabel } from "../drawings/placement";
import { movedLayerOrder, resultLayers, type DisplayLayerKey, type LayerSource, type ResultLayer } from "./layers";

// The ribbon's icon of each thing (the button that adds or shows it), at list size.
const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

/** A display layer's name (as the ribbon's button), icon and what turns it off. */
const DISPLAY: Record<DisplayLayerKey, { name: string; icon: ReactNode; off?: Partial<ResultViewSettings> }> = {
  soilColor: { name: "Soil colors", icon: <SoilColorsIcon {...ICON} />, off: { showSoilColor: false } },
  femMesh: { name: "FE mesh", icon: <FeMeshIcon {...ICON} />, off: { showFemMesh: false } },
  femPlasticZone: { name: "Plastic zone", icon: <PlasticZoneIcon {...ICON} />, off: { showFemPlasticZone: false } },
  surfaces: { name: "Surfaces", icon: <SurfacesIcon {...ICON} />, off: { surfaceDisplay: "critical" } },
  customSurfaces: { name: "Custom surfaces", icon: <CustomPlanesIcon {...ICON} />, off: { showCustomSurfaces: false } },
  // Always drawn: no button (and no ribbon icon).
  criticalSurface: { name: "Critical surface", icon: <Target {...ICON} /> },
  slices: { name: "Slices", icon: <SlicesIcon {...ICON} />, off: { showSlices: false } },
  center: { name: "Center", icon: <CentreIcon {...ICON} />, off: { showCentreMarker: false } },
  fosLabel: { name: "FOS label", icon: <FosLabelIcon {...ICON} />, off: { showFosLabel: false } },
};

/** What the button of a display layer says it does. */
function offTitle(key: DisplayLayerKey): string {
  if (key === "surfaces") return "Turn off (shows the critical surface only, as Surfaces › Critical only in the ribbon)";
  return `Turn off (as the ${DISPLAY[key].name} button in the ribbon)`;
}

/** An annotation's icon. */
function annotationIcon(a: Annotation): ReactNode {
  switch (a.type) {
    case "reference":
      return <ReferenceLineIcon {...ICON} />;
    case "material-table":
      return <MaterialTableIcon {...ICON} />;
    case "color-bar":
      return <ColorBarIcon {...ICON} />;
    case "plot":
      return <PlotIcon {...ICON} />;
    default:
      // Every text, with variables (#FOS, {{ }}) or without: one kind of object.
      return <TextIcon {...ICON} />;
  }
}

interface RowView {
  layer: ResultLayer;
  name: string;
  title: string;
  icon: ReactNode;
}

export function LayersList({ resolveText }: { resolveText: (text: string) => string }) {
  const rvs = useAppStore((s) => s.resultViewSettings);
  const result = useAppStore((s) => s.result);
  const backgrounds = useAppStore((s) => s.backgrounds);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  const updateBackground = useAppStore((s) => s.updateBackground);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds);
  const setSelectedAnnotations = useAppStore((s) => s.setSelectedAnnotations);
  const toggleAnnotationSelection = useAppStore((s) => s.toggleAnnotationSelection);

  const src: LayerSource = { resultViewSettings: rvs, result, backgrounds };
  // Topmost first.
  const layers = resultLayers(src).reverse();

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  // The row to focus after a change of the list (a moved or removed row's).
  const pendingFocus = useRef<string | null>(null);
  const setFocusKey = (key: string) => {
    pendingFocus.current = key;
  };
  useEffect(() => {
    if (pendingFocus.current === null) return;
    rowRefs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  /** Move `key` to `displayIndex` of the list (topmost first, after the move). */
  const moveTo = (key: string, displayIndex: number) => {
    const n = layers.length;
    const from = layers.findIndex((l) => l.key === key);
    if (from < 0) return;
    const to = Math.max(0, Math.min(n - 1, displayIndex));
    if (to === from) return;
    setRvs({ layerOrder: movedLayerOrder(src, key, n - 1 - to) });
  };

  const view = (layer: ResultLayer): RowView => {
    if (layer.kind === "display") {
      const d = DISPLAY[layer.layer];
      return { layer, name: d.name, title: d.name, icon: d.icon };
    }
    if (layer.kind === "drawing") {
      const name = placementLabel(layer.drawing, projectAsset(layer.drawing.assetId)?.originalName);
      return { layer, name, title: `Drawing: ${name}`, icon: <DrawingIcon {...ICON} /> };
    }
    const a = layer.annotation;
    if (a.type === "reference") {
      // "Reference circle" says it already; a label ("F = 1.2, other program") does not.
      const own = referenceListName(a);
      const name = /^reference\b/i.test(own) ? own : `Reference: ${own}`;
      return { layer, name, title: name, icon: annotationIcon(a) };
    }
    if (a.type === "text") {
      const shown = resolveText(a.text ?? "").replace(/\s+/g, " ").trim();
      return { layer, name: shown || "Text (empty)", title: `Text: ${shown}`, icon: annotationIcon(a) };
    }
    const name = a.type === "color-bar" ? "Color bar" : a.type === "material-table" ? "Material table" : "Plot";
    return { layer, name, title: name, icon: annotationIcon(a) };
  };

  const remove = (layer: ResultLayer) => {
    if (layer.kind === "annotation") removeAnnotation(layer.annotation.id);
    else if (layer.kind === "drawing") updateBackground(layer.drawing.id, { showInResults: false });
    else {
      const off = DISPLAY[layer.layer].off;
      if (off) setRvs(off);
    }
  };

  if (layers.length === 0) {
    return (
      <p className="text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>
        Nothing is drawn yet.
      </p>
    );
  }

  return (
    <ul
      // Row content on the section's 16 px edge, the first row's text level with the
      // other sections' first line; the grip hangs in the left gutter.
      className="-mx-4 -my-1"
      aria-label="Layers, topmost first"
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
      }}
    >
      {layers.map((layer, index) => {
        const { name, title, icon } = view(layer);
        const isAnnotation = layer.kind === "annotation";
        const selected = isAnnotation && selectedAnnotationIds.includes(layer.key);
        const removable = layer.kind !== "display" || DISPLAY[layer.layer].off !== undefined;
        const removeTitle =
          layer.kind === "annotation"
            ? "Remove annotation"
            : layer.kind === "drawing"
              ? "Hide from the results (turns off Show in results)"
              : offTitle(layer.layer);
        const dropHere = drop?.key === layer.key && dragKey !== null && dragKey !== layer.key ? drop : null;
        return (
          <li
            key={layer.key}
            ref={(el) => {
              if (el) rowRefs.current.set(layer.key, el);
              else rowRefs.current.delete(layer.key);
            }}
            data-testid="layer-row"
            data-layer={layer.key}
            tabIndex={0}
            aria-label={name}
            aria-current={selected || undefined}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
            className="group relative flex items-center gap-1.5 h-6 pl-3 pr-0.5 mx-1 rounded-sm text-[12px] select-none cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-(--color-vsc-accent) hover:bg-(--color-vsc-list-hover)"
            style={{
              background: selected ? "var(--color-vsc-selected-bg)" : undefined,
              color: selected ? "var(--color-vsc-text-bright)" : "var(--color-vsc-text)",
              opacity: dragKey === layer.key ? 0.5 : 1,
            }}
            title={title}
            draggable
            onDragStart={(e) => {
              setDragKey(layer.key);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", layer.key);
            }}
            onDragOver={(e) => {
              if (dragKey === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const r = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > r.top + r.height / 2;
              if (drop?.key !== layer.key || drop.after !== after) setDrop({ key: layer.key, after });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey !== null && dragKey !== layer.key) {
                const from = layers.findIndex((l) => l.key === dragKey);
                let to = index + (drop?.key === layer.key && drop.after ? 1 : 0);
                if (from < to) to -= 1;
                moveTo(dragKey, to);
              }
              setDragKey(null);
              setDrop(null);
            }}
            onDragEnd={() => {
              setDragKey(null);
              setDrop(null);
            }}
            onClick={(e) => {
              if (!isAnnotation) return;
              if (e.ctrlKey || e.metaKey || e.shiftKey) toggleAnnotationSelection(layer.key, true);
              else if (!selected) setSelectedAnnotations([layer.key]);
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if ((e.key === "Delete" || e.key === "Backspace") && removable) {
                // This row only (not the canvas's Delete of the selection).
                e.preventDefault();
                e.stopPropagation();
                const next = layers[index + 1] ?? layers[index - 1];
                remove(layer);
                if (next) setFocusKey(next.key);
                return;
              }
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
                if ((e.key === "Enter" || e.key === " ") && isAnnotation) {
                  e.preventDefault();
                  setSelectedAnnotations([layer.key]);
                }
                return;
              }
              // Not the canvas's nudge of the selected annotations.
              e.preventDefault();
              e.stopPropagation();
              const step = e.key === "ArrowUp" ? -1 : 1;
              if (e.altKey) {
                moveTo(layer.key, index + step);
                setFocusKey(layer.key);
              } else {
                const next = layers[index + step];
                if (next) rowRefs.current.get(next.key)?.focus();
              }
            }}
          >
            {dropHere && (
              <span
                aria-hidden
                data-testid="layer-drop-indicator"
                className="pointer-events-none absolute left-1 right-1 h-[2px] rounded-full"
                style={{ background: "var(--color-vsc-accent)", [dropHere.after ? "bottom" : "top"]: -1 }}
              />
            )}
            <span
              className="absolute left-0 inset-y-0 w-3 flex items-center justify-center opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60 cursor-grab"
              style={{ color: "var(--color-vsc-text-muted)" }}
              aria-hidden
              title="Drag to change the order (or Alt+Up, Alt+Down)"
            >
              <GripVertical size={12} strokeWidth={1.75} />
            </span>
            <span className="shrink-0 flex items-center" style={{ color: "var(--color-vsc-text-muted)" }}>
              {icon}
            </span>
            <span className="flex-1 min-w-0 truncate">{name}</span>
            {removable && (
              <button
                type="button"
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus-visible:opacity-100 hover:bg-(--color-vsc-list-active) cursor-pointer"
                style={{ color: "var(--color-vsc-text-muted)", background: undefined, border: "none" }}
                title={removeTitle}
                aria-label={`${removeTitle}: ${name}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(layer);
                }}
              >
                {layer.kind === "annotation" ? <X size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
