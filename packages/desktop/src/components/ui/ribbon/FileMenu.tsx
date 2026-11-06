import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isElectron } from "../../../utils/is-electron";
import { useProjectActions } from "../../../features/project/useProjectActions";
import {
  RibbonGroup,
  RibbonButton,
  RibbonMenuButton,
  RibbonSep,
  RibbonSmallButton,
  RibbonStack,
} from "./RibbonParts";
import { LARGE_ICON, SMALL_ICON } from "./icon-props";
import { importDxf } from "../../../features/project/importDxf";
import { openNewModelsFromDrawing } from "../../../features/drawings/window-sync";
import { importDwg } from "../../../features/project/importDwg";
import { importGsz } from "../../../features/project/importGsz";
import { exportGsz } from "../../../features/project/exportGsz";
import { importStix } from "../../../features/project/importStix";
import { exportStix } from "../../../features/project/exportStix";
import { importSli } from "../../../features/project/importSli";
import { exportSli } from "../../../features/project/exportSli";
import { fileTooLarge } from "../../../features/project/file-limits";
import {
  ExitIcon,
  ExportIcon,
  ImportIcon,
  NewIcon,
  OpenIcon,
  SaveAnonymizedIcon,
  SaveAsIcon,
  SaveIcon,
} from "../../icons/ribbon";
import { SummaryDialog } from "../SummaryDialog";
import { AnonymizeDialog } from "../../../features/project/AnonymizeDialog";
import { projectSnapshot } from "../../../features/project/saveAnonymized";
import type { ProjectFile } from "../../../store/persistence";

interface Props {
  activeModelName?: string;
  isOpen: boolean;
  onActivate: () => void;
  panelHost: HTMLElement | null;
}

export function FileMenu({
  activeModelName,
  isOpen,
  onActivate,
  panelHost,
}: Props) {
  const defaultBaseName = activeModelName?.trim() || "cslope-project";
  const {
    fileName,
    fileInputRef,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleFileChange,
  } = useProjectActions(defaultBaseName);

  // What an import or export did (or why it failed), shown in a dialog.
  const [summary, setSummary] = useState<{ title: string; text: string } | null>(null);
  // File > Save as anonymized: the project it anonymizes, while its dialog is open.
  const [anonymizing, setAnonymizing] = useState<ProjectFile | null>(null);
  const failure = (what: string, err: unknown) =>
    // The title says what failed; the text says why.
    setSummary({ title: `${what} failed`, text: err instanceof Error ? err.message : String(err) });

  const handleImportDxf = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".dxf";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const tooLarge = fileTooLarge(file);
      if (tooLarge) {
        setSummary({ title: `Import of ${file.name} failed`, text: tooLarge });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          setSummary({ title: `Import of ${file.name}`, text: importDxf(String(reader.result ?? ""), file.name) });
        } catch (err) {
          failure(`Import of ${file.name}`, err);
        }
      };
      reader.onerror = () => setSummary({ title: `Import of ${file.name} failed`, text: `Could not read ${file.name}.` });
      reader.readAsText(file);
    };
    input.click();
  };

  /** Import a binary file (a DWG drawing, or a project file of another program) with `run`. */
  const importBinary = (extension: string, run: (bytes: Uint8Array, name: string) => Promise<string | null>) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extension;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const tooLarge = fileTooLarge(file);
      if (tooLarge) {
        setSummary({ title: `Import of ${file.name} failed`, text: tooLarge });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        run(new Uint8Array(reader.result as ArrayBuffer), file.name).then(
          (text) => setSummary(text ? { title: `Import of ${file.name}`, text } : null),
          (err) => failure(`Import of ${file.name}`, err),
        );
      };
      reader.onerror = () => setSummary({ title: `Import of ${file.name} failed`, text: `Could not read ${file.name}.` });
      reader.readAsArrayBuffer(file);
    };
    input.click();
  };
  const handleImportDwg = () => importBinary(".dwg", importDwg);
  const handleImportGsz = () => importBinary(".gsz", importGsz);
  const handleImportStix = () => importBinary(".stix", importStix);
  const handleImportSli = () => importBinary(".sli,.slim,.slmd", importSli);

  const exportAs = (extension: string, run: () => string | null) => {
    try {
      const text = run();
      setSummary(text ? { title: `Export as ${extension}`, text } : null);
    } catch (err) {
      failure(`Export as ${extension}`, err);
    }
  };
  const handleExportGsz = () => exportAs(".gsz", exportGsz);
  const handleExportStix = () => exportAs(".stix", exportStix);
  const handleExportSli = () => exportAs(".slim", exportSli);

  // ── Keyboard shortcuts (Ctrl+N/O/S/Shift+S) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        handleNew();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void handleOpen();
      } else if (e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void handleSaveAs();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
        File
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
          <div className="h-full flex items-stretch gap-0" role="toolbar" aria-label="File">
            <RibbonGroup label="Project">
              <RibbonButton
                icon={<NewIcon {...LARGE_ICON} />}
                label="New"
                shortcut="Ctrl+N"
                onClick={handleNew}
              />
              <RibbonButton
                icon={<OpenIcon {...LARGE_ICON} />}
                label="Open"
                shortcut="Ctrl+O"
                onClick={handleOpen}
              />
              <RibbonStack>
                <RibbonMenuButton
                  icon={<ImportIcon {...SMALL_ICON} />}
                  label="Import"
                  items={[
                    { label: "DXF file…", title: "Import a DXF file", onClick: handleImportDxf },
                    { label: "DWG file…", title: "Import a DWG drawing (version R11 or later)", onClick: handleImportDwg },
                    {
                      label: "New models from drawing…",
                      title: "Frame each section of a drawing (PDF, DWG, DXF or image) and make a model of each, the drawing placed under it",
                      onClick: () => openNewModelsFromDrawing(),
                    },
                    { label: ".gsz file…", title: "Import a .gsz project file", onClick: handleImportGsz },
                    { label: ".stix file…", title: "Import a .stix project file", onClick: handleImportStix },
                    { label: ".sli/.slim/.slmd file…", title: "Import a .sli, .slim or .slmd model file", onClick: handleImportSli },
                  ]}
                />
                <RibbonMenuButton
                  icon={<ExportIcon {...SMALL_ICON} />}
                  label="Export"
                  items={[
                    { label: ".gsz file…", title: "Export the active model as a .gsz project file", onClick: handleExportGsz },
                    { label: ".stix file…", title: "Export the active model as a .stix project file", onClick: handleExportStix },
                    { label: ".slim file…", title: "Export the active model as a .slim model file", onClick: handleExportSli },
                  ]}
                />
              </RibbonStack>
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Save">
              <RibbonButton
                icon={<SaveIcon {...LARGE_ICON} />}
                label="Save"
                shortcut="Ctrl+S"
                onClick={handleSave}
              />
              <RibbonStack>
                <RibbonSmallButton
                  icon={<SaveAsIcon {...SMALL_ICON} />}
                  label="Save as"
                  shortcut="Ctrl+Shift+S"
                  onClick={handleSaveAs}
                />
                <RibbonSmallButton
                  icon={<SaveAnonymizedIcon {...SMALL_ICON} />}
                  label="Save as anonymized…"
                  title="Save a copy without client names, project information and drawings, to share it (for example in an issue)"
                  onClick={() => setAnonymizing(projectSnapshot())}
                />
              </RibbonStack>
            </RibbonGroup>
            {isElectron && (
              <>
                <RibbonSep />
                <RibbonGroup label="">
                  <RibbonStack>
                    <RibbonSmallButton
                      icon={<ExitIcon {...SMALL_ICON} />}
                      label="Exit"
                      onClick={() => window.cslope.close()}
                    />
                  </RibbonStack>
                </RibbonGroup>
              </>
            )}
          </div>,
          panelHost,
        )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".cslp,.json,.cslope"
        className="hidden"
        onChange={handleFileChange}
      />

      {anonymizing && <AnonymizeDialog snapshot={anonymizing} fileName={fileName} onClose={() => setAnonymizing(null)} />}
      {summary && <SummaryDialog title={summary.title} text={summary.text} onClose={() => setSummary(null)} />}
    </div>
  );
}
