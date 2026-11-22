/**
 * Properties › Layers: what the result sheet draws, topmost first, as in a
 * drawing program. The annotations and the display layers the Results
 * ribbon turns on (soil colors, surfaces, slices, center, FOS label, ...)
 * and the drawings shown in results. A row is dragged by its grip, or moved
 * with Alt+Up and Alt+Down, to change the order the result view and the
 * PDF draw them in (the model's `layerOrder`, an undo step). A click on an
 * annotation selects it (Ctrl, Cmd or Shift: adds it); its button removes
 * it. A click on a display layer selects it: its properties
 * (LayerProperties) show in the sidebar, also while it is off.
 *
 * The built-in layers (the display layers, the material table and the
 * color bar) are never removed: their eye turns them off and on, as the
 * ribbon does, and a layer turned off stays listed, greyed, with its eye
 * showing. A drawing's button takes it out of the results ("Show in
 * results").
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff, GripVertical, Target, X } from "lucide-react";
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
import { isBuiltInAnnotationType, type Annotation, type BuiltInAnnotationType, type ResultViewSettings } from "../../store/types";
import { referenceListName } from "../annotations/reference";
import { projectAsset } from "../drawings/asset-registry";
import { placementLabel } from "../drawings/placement";
import {
  DISPLAY_LAYER_NAMES,
  isBuiltInPlaceholderKey,
  movedLayerOrder,
  resultLayers,
  type DisplayLayerKey,
  type LayerSource,
  type ResultLayer,
} from "./layers";

// The ribbon's icon of each thing (the button that adds or shows it), at list size.
const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

type Toggle = { off: Partial<ResultViewSettings>; on: Partial<ResultViewSettings> };

/** A display layer's icon and what turns it off and on (its name: DISPLAY_LAYER_NAMES). */
const DISPLAY: Record<DisplayLayerKey, { icon: ReactNode; toggle?: Toggle }> = {
  soilColor: { icon: <SoilColorsIcon {...ICON} />, toggle: { off: { showSoilColor: false }, on: { showSoilColor: true } } },
  femMesh: { icon: <FeMeshIcon {...ICON} />, toggle: { off: { showFemMesh: false }, on: { showFemMesh: true } } },
  femPlasticZone: {
    icon: <PlasticZoneIcon {...ICON} />,
    toggle: { off: { showFemPlasticZone: false }, on: { showFemPlasticZone: true } },
  },
  surfaces: { icon: <SurfacesIcon {...ICON} />, toggle: { off: { surfaceDisplay: "critical" }, on: { surfaceDisplay: "all" } } },
  customSurfaces: {
    icon: <CustomPlanesIcon {...ICON} />,
    toggle: { off: { showCustomSurfaces: false }, on: { showCustomSurfaces: true } },
  },
  // Always drawn: no button (and no ribbon icon).
  criticalSurface: { icon: <Target {...ICON} /> },
  slices: { icon: <SlicesIcon {...ICON} />, toggle: { off: { showSlices: false }, on: { showSlices: true } } },
  center: { icon: <CentreIcon {...ICON} />, toggle: { off: { showCentreMarker: false }, on: { showCentreMarker: true } } },
  fosLabel: { icon: <FosLabelIcon {...ICON} />, toggle: { off: { showFosLabel: false }, on: { showFosLabel: true } } },
};

/** The names of the built-in annotations (as their ribbon buttons). */
const BUILT_IN_NAMES: Record<BuiltInAnnotationType, string> = {
  "material-table": "Material table",
  "color-bar": "Color bar",
};

/** What the eye of a built-in layer says it does: turn it off, or on when `off`. */
function toggleTitle(name: string, surfaces: boolean, off: boolean): string {
  if (surfaces) {
    return off
      ? "Turn on (shows all surfaces, as Surfaces › All surfaces in the ribbon)"
      : "Turn off (shows the critical surface only, as Surfaces › Critical only in the ribbon)";
  }
  return `${off ? "Turn on" : "Turn off"} (as the ${name} button in the ribbon)`;
}

/** The built-in type of an annotation layer (material table, color bar), or null. */
function builtInType(layer: ResultLayer): BuiltInAnnotationType | null {
  return layer.kind === "annotation" && isBuiltInAnnotationType(layer.annotation.type) ? layer.annotation.type : null;
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

const muted = { color: "var(--color-vsc-text-muted)" };

export function LayersList({ resolveText }: { resolveText: (text: string) => string }) {
  const rvs = useAppStore((s) => s.resultViewSettings);
  const offAnnotations = useAppStore((s) => s.offAnnotations[s.activeModelId]);
  const setBuiltInShown = useAppStore((s) => s.setBuiltInAnnotationShown);
  const result = useAppStore((s) => s.result);
  const backgrounds = useAppStore((s) => s.backgrounds);
  const setRvs = useAppStore((s) => s.setResultViewSettings);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  const updateBackground = useAppStore((s) => s.updateBackground);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds);
  const setSelectedAnnotations = useAppStore((s) => s.setSelectedAnnotations);
  const toggleAnnotationSelection = useAppStore((s) => s.toggleAnnotationSelection);
  const selectedLayer = useAppStore((s) => s.selectedResultLayer);
  const setSelectedLayer = useAppStore((s) => s.setSelectedResultLayer);

  const src: LayerSource = { resultViewSettings: rvs, result, backgrounds, offBuiltIns: offAnnotations };
  // Topmost first, with the built-in layers turned off.
  const layers = resultLayers(src, true).reverse();

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
    const movable = layers.filter((l) => !isBuiltInPlaceholderKey(l.key));
    const n = movable.length;
    const from = movable.findIndex((l) => l.key === key);
    if (from < 0) return;
    const to = Math.max(0, Math.min(n - 1, displayIndex - (layers.findIndex((l) => l.key === key) - from)));
    if (to === from) return;
    setRvs({ layerOrder: movedLayerOrder(src, key, n - 1 - to, true) });
  };

  const view = (layer: ResultLayer): RowView => {
    if (layer.kind === "display") {
      const d = DISPLAY[layer.layer];
      const name = DISPLAY_LAYER_NAMES[layer.layer];
      return { layer, name, title: name, icon: d.icon };
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
    const name = isBuiltInAnnotationType(a.type) ? BUILT_IN_NAMES[a.type] : "Plot";
    return { layer, name, title: name, icon: annotationIcon(a) };
  };

  /** Removes an annotation, takes a drawing out of the results. */
  const remove = (layer: ResultLayer) => {
    if (layer.kind === "annotation") removeAnnotation(layer.annotation.id);
    else if (layer.kind === "drawing") updateBackground(layer.drawing.id, { showInResults: false });
  };

  /** Turns a built-in layer off, or on when it is off; a display layer stays selected. */
  const toggle = (layer: ResultLayer) => {
    const type = builtInType(layer);
    if (type) setBuiltInShown(type, layer.off === true);
    else if (layer.kind === "display") {
      const t = DISPLAY[layer.layer].toggle;
      if (t) setRvs(layer.off ? t.on : t.off);
    }
  };

  if (layers.length === 0) {
    return (
      <p className="text-[11px]" style={muted}>
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
        const off = layer.off === true;
        const type = builtInType(layer);
        // A built-in annotation turned off is not on the sheet: nothing to select.
        const isAnnotation = layer.kind === "annotation" && !off;
        const selected = isAnnotation ? selectedAnnotationIds.includes(layer.key) : layer.kind === "display" && selectedLayer === layer.layer;
        // Built-in layers: an eye that turns them off and on; never removed.
        const builtIn = type !== null || (layer.kind === "display" && DISPLAY[layer.layer].toggle !== undefined);
        const removable = !builtIn && layer.kind !== "display";
        const buttonTitle = builtIn
          ? toggleTitle(name, layer.kind === "display" && layer.layer === "surfaces", off)
          : layer.kind === "annotation"
            ? "Remove annotation"
            : "Hide from the results (turns off Show in results)";
        // The row of a built-in annotation the model has none of has no place in the order.
        const draggable = !isBuiltInPlaceholderKey(layer.key);
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
            data-off={off || undefined}
            tabIndex={0}
            aria-label={off ? `${name} (off)` : name}
            aria-current={selected || undefined}
            aria-keyshortcuts={removable ? "Alt+ArrowUp Alt+ArrowDown Delete" : "Alt+ArrowUp Alt+ArrowDown"}
            className="group relative flex items-center gap-1.5 h-6 pl-3 pr-0.5 mx-1 rounded-sm text-[12px] select-none cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-(--color-vsc-accent) hover:bg-(--color-vsc-list-hover)"
            style={{
              background: selected ? "var(--color-vsc-selected-bg)" : undefined,
              color: off ? "var(--color-vsc-text-muted)" : selected ? "var(--color-vsc-text-bright)" : "var(--color-vsc-text)",
              opacity: dragKey === layer.key ? 0.5 : 1,
            }}
            title={off ? `${title} (off)` : title}
            draggable={draggable}
            onDragStart={(e) => {
              if (!draggable) return;
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
              // A display layer: its properties (style) in the sidebar.
              if (layer.kind === "display") {
                if (!selected) setSelectedLayer(layer.layer);
                return;
              }
              if (!isAnnotation) return;
              if (e.ctrlKey || e.metaKey || e.shiftKey) toggleAnnotationSelection(layer.key, true);
              else if (!selected) setSelectedAnnotations([layer.key]);
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Delete" || e.key === "Backspace") {
                // This row only (not the canvas's Delete of the selection);
                // a built-in layer is never removed.
                e.preventDefault();
                e.stopPropagation();
                if (!removable) return;
                const next = layers[index + 1] ?? layers[index - 1];
                remove(layer);
                if (next) setFocusKey(next.key);
                return;
              }
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
                if ((e.key === "Enter" || e.key === " ") && isAnnotation) {
                  e.preventDefault();
                  setSelectedAnnotations([layer.key]);
                } else if ((e.key === "Enter" || e.key === " ") && layer.kind === "display") {
                  e.preventDefault();
                  setSelectedLayer(layer.layer);
                }
                return;
              }
              // Not the canvas's nudge of the selected annotations.
              e.preventDefault();
              e.stopPropagation();
              const step = e.key === "ArrowUp" ? -1 : 1;
              if (e.altKey) {
                if (!draggable) return;
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
            {draggable && (
              <span
                className="absolute left-0 inset-y-0 w-3 flex items-center justify-center opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60 cursor-grab"
                style={muted}
                aria-hidden
                title="Drag to change the order (or Alt+Up, Alt+Down)"
              >
                <GripVertical size={12} strokeWidth={1.75} />
              </span>
            )}
            <span className="shrink-0 flex items-center" style={muted}>
              {icon}
            </span>
            <span className="flex-1 min-w-0 truncate">{name}</span>
            {(builtIn || removable) && (
              <button
                type="button"
                // A layer turned off shows its eye at all times: its state at a glance.
                className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-sm ${off ? "" : "opacity-0 "}group-hover:opacity-100 focus:opacity-100 group-focus-visible:opacity-100 hover:bg-(--color-vsc-list-active) cursor-pointer`}
                style={{ ...muted, background: undefined, border: "none" }}
                title={buttonTitle}
                aria-label={`${buttonTitle}: ${name}`}
                aria-pressed={builtIn ? off : undefined}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (builtIn) toggle(layer);
                  else remove(layer);
                }}
              >
                {builtIn ? (
                  off ? (
                    <EyeOff size={13} aria-hidden />
                  ) : (
                    <Eye size={13} aria-hidden />
                  )
                ) : layer.kind === "annotation" ? (
                  <X size={13} aria-hidden />
                ) : (
                  <EyeOff size={13} aria-hidden />
                )}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
