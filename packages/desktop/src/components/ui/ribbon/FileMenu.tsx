import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isElectron } from "../../../utils/is-electron";
import { useProjectActions } from "../../../features/project/useProjectActions";
import { RibbonGroup, RibbonButton, RibbonMenuButton, RibbonSep } from "./RibbonParts";
import { importDxf } from "../../../features/project/importDxf";
import { importGsz } from "../../../features/project/importGsz";
import { exportGsz } from "../../../features/project/exportGsz";
import { importStix } from "../../../features/project/importStix";
import { exportStix } from "../../../features/project/exportStix";
import { importSli } from "../../../features/project/importSli";
import { exportSli } from "../../../features/project/exportSli";
import { fileTooLarge } from "../../../features/project/file-limits";
import {
  NewIcon,
  OpenIcon,
  SaveIcon,
  SaveAsIcon,
  ExitIcon,
} from "../../icons/FileActionIcons";
import { SummaryDialog } from "../SummaryDialog";

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
    fileInputRef,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleFileChange,
  } = useProjectActions(defaultBaseName);

  // What an import or export did (or why it failed), shown in a dialog.
  const [summary, setSummary] = useState<{ title: string; text: string } | null>(null);
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

  /** Import a project file of another program (a ZIP archive) with `run`. */
  const importBinary = (extension: string, run: (bytes: Uint8Array, name: string) => Promise<string>) => {
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
          (text) => setSummary({ title: `Import of ${file.name}`, text }),
          (err) => failure(`Import of ${file.name}`, err),
        );
      };
      reader.onerror = () => setSummary({ title: `Import of ${file.name} failed`, text: `Could not read ${file.name}.` });
      reader.readAsArrayBuffer(file);
    };
    input.click();
  };
  const handleImportGsz = () => importBinary(".gsz", importGsz);
  const handleImportStix = () => importBinary(".stix", importStix);
  const handleImportSli = () => importBinary(".sli,.slim,.slmd", importSli);

  const exportAs = (extension: string, run: () => string) => {
    try {
      setSummary({ title: `Export as ${extension}`, text: run() });
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
        aria-haspopup="menu"
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
          <div className="h-full flex items-center gap-0" role="menu">
            <RibbonGroup label="Project">
              <RibbonButton
                icon={<NewIcon />}
                label="New"
                shortcut="Ctrl+N"
                onClick={handleNew}
              />
              <RibbonButton
                icon={<OpenIcon />}
                label="Open"
                shortcut="Ctrl+O"
                onClick={handleOpen}
              />
              <RibbonMenuButton
                icon={<ImportFileIcon />}
                label="Import"
                items={[
                  { label: "DXF file…", title: "Import a DXF file", onClick: handleImportDxf },
                  { label: ".gsz file…", title: "Import a .gsz project file", onClick: handleImportGsz },
                  { label: ".stix file…", title: "Import a .stix project file", onClick: handleImportStix },
                  { label: ".sli/.slim/.slmd file…", title: "Import a .sli, .slim or .slmd model file", onClick: handleImportSli },
                ]}
              />
              <RibbonMenuButton
                icon={<ExportFileIcon />}
                label="Export"
                items={[
                  { label: ".gsz file…", title: "Export the active model as a .gsz project file", onClick: handleExportGsz },
                  { label: ".stix file…", title: "Export the active model as a .stix project file", onClick: handleExportStix },
                  { label: ".slim file…", title: "Export the active model as a .slim model file", onClick: handleExportSli },
                ]}
              />
            </RibbonGroup>
            <RibbonSep />
            <RibbonGroup label="Save">
              <RibbonButton
                icon={<SaveIcon />}
                label="Save"
                shortcut="Ctrl+S"
                onClick={handleSave}
              />
              <RibbonButton
                icon={<SaveAsIcon />}
                label="Save As"
                shortcut="Ctrl+Shift+S"
                onClick={handleSaveAs}
              />
            </RibbonGroup>
            {isElectron && (
              <>
                <RibbonSep />
                <RibbonGroup label="">
                  <RibbonButton
                    icon={<ExitIcon />}
                    label="Exit"
                    onClick={() => window.cslope.close()}
                  />
                </RibbonGroup>
              </>
            )}
          </div>,
          panelHost,
        )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      {summary && <SummaryDialog title={summary.title} text={summary.text} onClose={() => setSummary(null)} />}
    </div>
  );
}

function ExportFileIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path
        d="M7 3h12l7 7v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
        fill="#e8eaed"
        stroke="#90a4ae"
        strokeWidth="1.2"
      />
      <path d="M16 23V12m0 0l-4 4m4-4l4 4" stroke="#1e88e5" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** A page with an arrow into it (any file format). */
function ImportFileIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path
        d="M7 3h12l7 7v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
        fill="#e8eaed"
        stroke="#90a4ae"
        strokeWidth="1.2"
      />
      <path d="M16 12v11m0 0l-4-4m4 4l4-4" stroke="#26a69a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}
