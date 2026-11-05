import { useEffect } from "react";
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
  RibbonStack,
} from "./RibbonParts";
import { LARGE_ICON, SMALL_ICON } from "./icon-props";

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function EditMenu({ isOpen, onActivate, panelHost }: Props) {
  const setActiveSection = useAppStore((s) => s.setActiveSection);

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
        aria-haspopup="menu"
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
          <div className="h-full flex items-stretch gap-0" role="menu">
            <RibbonGroup label="Boundaries">
              <RibbonButton
                icon={<ExteriorIcon {...LARGE_ICON} />}
                label="Exterior"
                onClick={() => {
                  setActiveSection("Exterior Boundary");
                  window.cslope.openGeometryDialog();
                }}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<InteriorIcon {...SMALL_ICON} />}
                  label="Interior"
                  onClick={() => {
                    setActiveSection("Interior Boundaries");
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
                    setActiveSection("Material Assignment");
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
                    setActiveSection("Loads");
                    window.cslope.openUdlDialog();
                  }}
                />
                <RibbonSmallButton
                  icon={<LineLoadIcon {...SMALL_ICON} />}
                  label="Line loads"
                  onClick={() => {
                    setActiveSection("Loads");
                    window.cslope.openLineLoadsDialog();
                  }}
                />
                <RibbonSmallButton
                  icon={<ReinforcementIcon {...SMALL_ICON} />}
                  label="Reinforcement"
                  onClick={() => {
                    setActiveSection("Loads");
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
                  setActiveSection("Piezometric Lines");
                  window.cslope.openPiezoDialog();
                }}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<ParametersIcon {...SMALL_ICON} />}
                  label="Parameters"
                  onClick={() => {
                    setActiveSection("Parameters");
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
                  setActiveSection("Options");
                  window.cslope.openOptionsDialog();
                }}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<SearchLimitsIcon {...SMALL_ICON} />}
                  label="Search limits"
                  onClick={() => {
                    setActiveSection("Search Limits");
                    window.cslope.openSearchLimitsDialog();
                  }}
                />
                <RibbonSmallButton
                  icon={<CustomPlanesIcon {...SMALL_ICON} />}
                  label="Custom surfaces"
                  onClick={() => {
                    setActiveSection("Custom Search Planes");
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
