import { useState } from "react";
import { createPortal } from "react-dom";
import { isProjectDirty, useAppStore } from "../../../store/app-store";
import { confirmUnsavedChanges } from "../../../features/project/unsavedGuard";
import { adoptProjectAssets } from "../../../features/drawings/asset-registry";

/**
 * Before replacing the project: offer to save unsaved changes, or else
 * ask the plain confirmation question.
 */
async function confirmReplace(question: string): Promise<boolean> {
  if (isProjectDirty(useAppStore.getState())) return confirmUnsavedChanges();
  return window.confirm(question);
}
import { isElectron } from "../../../utils/is-electron";
import { PopupPanel } from "../PopupPanel";
import { AboutDialog } from "../../AboutDialog";
import {
  AboutIcon,
  BenchmarksIcon,
  DocumentationIcon,
  ExamplesIcon,
  ShortcutsIcon,
} from "../../icons/ribbon";
import {
  RibbonGroup,
  RibbonButton,
  RibbonSmallButton,
  RibbonStack,
} from "./RibbonParts";
import { LARGE_ICON, SMALL_ICON } from "./icon-props";
import { openDocumentation } from "../../../utils/docs";


/** The keyboard shortcuts of the main window, as listed in Help. */
const KEYBOARD_SHORTCUTS: [keys: string, action: string][] = [
  ["Ctrl+N", "New project"],
  ["Ctrl+O", "Open project"],
  ["Ctrl+S", "Save"],
  ["Ctrl+Shift+S", "Save as"],
  ["Ctrl+Z", "Undo"],
  ["Ctrl+Y or Ctrl+Shift+Z", "Redo"],
  ["F5 or Ctrl+Enter", "Run the analysis"],
  ["Delete or Backspace", "Delete the selected point (edit mode) or the selected annotations (result mode)"],
  ["Arrow keys", "Edit mode: move the selected point one snap step. Result mode: move the selected annotations"],
  ["Shift+arrow keys", "Edit mode: ten snap steps. Result mode: smaller steps"],
  ["Alt+Up or Alt+Down", "In the Layers list of the result sidebar: draw the focused layer one above or below"],
  ["Esc", "Close a menu or a window; on the canvas, clear the selection or stop picking lines"],
  ["Double-click", "Edit mode: type the exact coordinates of a point of the selected object; on a region, choose its material"],
  ["Shift+click", "While picking lines: add a line, or remove a picked one"],
];

interface Props {
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function HelpMenu({ isOpen, onActivate, panelHost }: Props) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Replace the project with a set of models, as a new unsaved project.
  const loadModels = async (what: string, load: () => void) => {
    const ok = await confirmReplace(`Open ${what} as a new project? The current project will be closed.`);
    if (!ok) return;
    adoptProjectAssets([]);
    load();
    useAppStore.temporal.getState().clear();
    // The examples are a new, unsaved project: Ctrl+S must not write them
    // over the file that was open before.
    if (isElectron) window.cslope.menuNew();
  };

  const handleLoadExamples = () => loadModels("the example models", () => useAppStore.getState().loadExamples());
  const handleLoadBenchmarks = () =>
    loadModels("the verification problems", () => useAppStore.getState().loadBenchmarks());

  const handleDocs = () => {
    openDocumentation();
  };

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
        Help
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
          <div className="h-full flex items-stretch gap-0" role="toolbar" aria-label="Help">
            <RibbonGroup label="Resources">
              <RibbonButton
                icon={<DocumentationIcon {...LARGE_ICON} />}
                label="Documentation"
                onClick={handleDocs}
              />
              <RibbonButton
                icon={<ExamplesIcon {...LARGE_ICON} />}
                label="Examples"
                onClick={handleLoadExamples}
              />
              <RibbonButton
                icon={<BenchmarksIcon {...LARGE_ICON} />}
                label="Benchmarks"
                onClick={handleLoadBenchmarks}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<ShortcutsIcon {...SMALL_ICON} />}
                  label="Shortcuts"
                  title="Keyboard shortcuts"
                  onClick={() => setShortcutsOpen(true)}
                />
                <RibbonSmallButton
                  icon={<AboutIcon {...SMALL_ICON} />}
                  label="About"
                  onClick={() => setAboutOpen(true)}
                />
              </RibbonStack>
            </RibbonGroup>
          </div>,
          panelHost,
        )}

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}

      {shortcutsOpen && (
        <PopupPanel
          title="Keyboard shortcuts"
          onClose={() => setShortcutsOpen(false)}
          width={460}
        >
          <table className="w-full text-[11px]" aria-label="Keyboard shortcuts">
            <tbody>
              {KEYBOARD_SHORTCUTS.map(([keys, action]) => (
                <tr key={keys}>
                  <td
                    className="py-0.5 pr-3 whitespace-nowrap align-top font-medium"
                    style={{ color: "var(--color-vsc-text-bright)" }}
                  >
                    {keys}
                  </td>
                  <td className="py-0.5" style={{ color: "var(--color-vsc-text)" }}>
                    {action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px]" style={{ color: "var(--color-vsc-text-muted)" }}>
            On macOS, Cmd instead of Ctrl. The mouse actions are listed in
            the documentation, under Keyboard and mouse.
          </p>
        </PopupPanel>
      )}
    </div>
  );
}
