import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import {
  useAppStore,
  performUndo,
  performRedo,
} from "../../../store/app-store";
import {
  AssignIcon,
  CustomPlanesIcon,
  DrawingIcon,
  ExteriorIcon,
  InteriorIcon,
  LineLoadIcon,
  MaterialsIcon,
  OptionsIcon,
  ParametersIcon,
  PiezoIcon,
  ReinforcementIcon,
  SearchLimitsIcon,
  UdlIcon,
} from "../../icons/ribbon";
import {
  RibbonGroup,
  RibbonButton,
  RibbonSep,
  RibbonSmallButton,
  RibbonSplitButton,
  RibbonStack,
} from "./RibbonParts";
import { LARGE_ICON, SMALL_ICON } from "./icon-props";
import type { CanvasObjectRef, CanvasObjectType } from "../../../store/types";
import { openNewModelsFromDrawing, openPlaceDrawing } from "../../../features/drawings/window-sync";
import { onProjectAssetsChanged, projectAsset } from "../../../features/drawings/asset-registry";
import { pickLinesTarget } from "../../../features/drawings/pick-lines-target";
import { startLinePick } from "../../../features/drawings/line-pick-store";

/**
 * The Drawing group: one split button. Its click places a drawing; its
 * menu also makes new models from a drawing and picks lines of the
 * topmost shown DWG, DXF or PDF drawing of the model.
 */
function DrawingGroup() {
  const backgrounds = useAppStore((s) => s.backgrounds);
  const [, setTick] = useState(0);
  useEffect(() => onProjectAssetsChanged(() => setTick((t) => t + 1)), []);
  const pick = pickLinesTarget(backgrounds, (id) => projectAsset(id)?.mime);
  return (
    <RibbonGroup label="Drawing">
      <RibbonSplitButton
        icon={<DrawingIcon {...LARGE_ICON} />}
        label="Drawing"
        tooltip="Place drawing… (a section drawing under the model: PNG, JPEG, TIFF, PDF, DWG or DXF)"
        onClick={() => openPlaceDrawing()}
        menuLabel="More drawing commands"
        items={[
          {
            label: "Place drawing…",
            title: "Place a section drawing under the model: PNG, JPEG, TIFF, PDF, DWG or DXF",
            onClick: () => openPlaceDrawing(),
          },
          {
            label: "New models from drawing…",
            title: "Frame each section of a drawing and make a model of each, the drawing placed under it",
            onClick: () => openNewModelsFromDrawing(),
          },
          {
            label: "Pick lines…",
            title: "Pick lines of the drawing on the canvas and use them as the exterior boundary, material boundaries or water lines",
            disabled: "reason" in pick,
            disabledTitle: "reason" in pick ? pick.reason : undefined,
            onClick: () => {
              if (!("id" in pick)) return;
              // Lines are picked on the edit canvas.
              const st = useAppStore.getState();
              if (st.mode !== "edit") st.setMode("edit");
              startLinePick(pick.id);
            },
          },
        ]}
      />
    </RibbonGroup>
  );
}

/**
 * A window of the Model tab is a table of objects on the canvas: opening it
 * selects one of them on the canvas, unless one of its kind is selected
 * already (the exterior; the boundary, water line or plane the window
 * shows; else the first). It changes nothing about what can be edited.
 */
function selectForWindow(type: CanvasObjectType): void {
  const st = useAppStore.getState();
  const sel = st.canvasSelection;
  const kinds: CanvasObjectType[] = type === "reinforcement" ? ["reinforcement", "pile"] : [type];
  if (sel && kinds.includes(sel.object.type)) return;
  let object: CanvasObjectRef | null = null;
  switch (type) {
    case "exterior":
      object = st.coordinates.length > 0 ? { type } : null;
      break;
    case "searchLimits":
      object = st.analysisLimits.enabled ? { type } : null;
      break;
    case "boundary": {
      const id = st.materialBoundaries.find((b) => b.id === st.selectedMaterialBoundaryId)?.id ?? st.materialBoundaries[0]?.id;
      object = id ? { type, id } : null;
      break;
    }
    case "waterLine": {
      const lines = st.piezometricLine.lines;
      const id = lines.find((l) => l.id === st.piezometricLine.activeLineId)?.id ?? lines[0]?.id;
      object = id ? { type, id } : null;
      break;
    }
    case "udl":
      object = st.udls[0] ? { type, id: st.udls[0].id } : null;
      break;
    case "lineLoad":
      object = st.lineLoads[0] ? { type, id: st.lineLoads[0].id } : null;
      break;
    case "reinforcement":
      object = st.reinforcements[0]
        ? { type, id: st.reinforcements[0].id }
        : st.piles[0]
          ? { type: "pile", id: st.piles[0].id }
          : null;
      break;
    case "customPlane":
      object = st.customSearchPlanes[0] ? { type, id: st.customSearchPlanes[0].id } : null;
      break;
    default:
      break;
  }
  if (object) st.selectCanvasObject(object);
}

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function EditMenu({ isOpen, onActivate, panelHost }: Props) {
  const canUndo = useStore(
    useAppStore.temporal,
    (s) => s.pastStates.length > 0,
  );
  const canRedo = useStore(
    useAppStore.temporal,
    (s) => s.futureStates.length > 0,
  );

  // ── Keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      // In a text field, Ctrl+Z undoes the typing, not the model.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();

      // Ctrl+Z  →  Undo
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) {
          performUndo();
        }
      }
      // Ctrl+Shift+Z or Ctrl+Y  →  Redo
      else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        if (canRedo) {
          performRedo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUndo, canRedo]);

  return (
    <div
      className="relative"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={onActivate}
        className="h-[1.9rem] px-4 text-[11px] font-medium flex items-center cursor-pointer relative"
        style={{
          color: isOpen
            ? "var(--color-vsc-text-bright)"
            : "var(--color-vsc-text-muted)",
          background: isOpen ? "var(--color-vsc-tab-active)" : "transparent",
        }}
        aria-expanded={isOpen}
      >
        Model
        {isOpen && (
          <div
            className="absolute bottom-0 left-0 right-0 h-0.5"
            style={{ background: "var(--color-vsc-accent)" }}
          />
        )}
      </button>

      {isOpen &&
        panelHost &&
        createPortal(
          <div className="h-full flex items-stretch gap-0" role="toolbar" aria-label="Model">
            <DrawingGroup />

            <RibbonSep />

            <RibbonGroup label="Boundaries">
              <RibbonButton
                icon={<ExteriorIcon {...LARGE_ICON} />}
                label="Exterior"
                onClick={() => {
                  selectForWindow("exterior");
                  window.cslope.openGeometryDialog();
                }}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<InteriorIcon {...SMALL_ICON} />}
                  label="Interior"
                  onClick={() => {
                    selectForWindow("boundary");
                    window.cslope.openInteriorBoundariesDialog();
                  }}
                />
              </RibbonStack>
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Materials">
              <RibbonButton
                icon={<MaterialsIcon {...LARGE_ICON} />}
                label="Materials"
                onClick={() => window.cslope.openMaterialsDialog()}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<AssignIcon {...SMALL_ICON} />}
                  label="Assign"
                  onClick={() => {
                    window.cslope.openMaterialAssignmentDialog();
                  }}
                />
              </RibbonStack>
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Loads & support">
              <RibbonStack>
                <RibbonSmallButton
                  icon={<UdlIcon {...SMALL_ICON} />}
                  label="Distributed loads"
                  onClick={() => {
                    selectForWindow("udl");
                    window.cslope.openUdlDialog();
                  }}
                />
                <RibbonSmallButton
                  icon={<LineLoadIcon {...SMALL_ICON} />}
                  label="Line loads"
                  onClick={() => {
                    selectForWindow("lineLoad");
                    window.cslope.openLineLoadsDialog();
                  }}
                />
                <RibbonSmallButton
                  icon={<ReinforcementIcon {...SMALL_ICON} />}
                  label="Reinforcement"
                  onClick={() => {
                    selectForWindow("reinforcement");
                    window.cslope.openReinforcementDialog();
                  }}
                />
              </RibbonStack>
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Water & parameters">
              <RibbonButton
                icon={<PiezoIcon {...LARGE_ICON} />}
                label="Piezometric lines"
                onClick={() => {
                  selectForWindow("waterLine");
                  window.cslope.openPiezoDialog();
                }}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<ParametersIcon {...SMALL_ICON} />}
                  label="Parameters"
                  onClick={() => {
                    window.cslope.openParametersDialog();
                  }}
                />
              </RibbonStack>
            </RibbonGroup>

            <RibbonSep />

            <RibbonGroup label="Analysis">
              <RibbonButton
                icon={<OptionsIcon {...LARGE_ICON} />}
                label="Options"
                onClick={() => {
                  window.cslope.openOptionsDialog();
                }}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<SearchLimitsIcon {...SMALL_ICON} />}
                  label="Search limits"
                  onClick={() => {
                    selectForWindow("searchLimits");
                    window.cslope.openSearchLimitsDialog();
                  }}
                />
                <RibbonSmallButton
                  icon={<CustomPlanesIcon {...SMALL_ICON} />}
                  label="Custom surfaces"
                  onClick={() => {
                    selectForWindow("customPlane");
                    window.cslope.openCustomSearchPlanesDialog();
                  }}
                />
              </RibbonStack>
            </RibbonGroup>
          </div>,
          panelHost,
        )}
    </div>
  );
}
