/**
 * File › Save as anonymized…: the options, a summary of what the copy
 * leaves out, and the save (a save dialog in the desktop app, a download
 * in a browser), then a confirmation. The copy is written from a
 * snapshot of the project; the open project, its file and its unsaved
 * state are not changed.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { anonymizeProject, DEFAULT_ANONYMIZE_OPTIONS, summaryLines, type AnonymizeOptions } from "./anonymize";
import { openedProjectAssets } from "./cslp";
import type { ProjectFile } from "../../store/persistence";
import { saveAnonymizedCopy } from "./saveAnonymized";

interface Props {
  /** The project to anonymize: projectSnapshot() when the dialog was asked for. */
  snapshot: ProjectFile;
  /** The open project's file name (browser; empty when untitled or in the desktop app, which knows it). */
  fileName: string;
  onClose: () => void;
}

function Option({ label, hint, checked, disabled, onChange, children }: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="py-1">
      <label className={`flex items-start gap-2 ${disabled ? "opacity-60" : "cursor-pointer"}`} title={hint}>
        <input
          type="checkbox"
          className="accent-blue-500 mt-[2px]"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="flex flex-col">
          <span>{label}</span>
          {hint && <span className="text-[11px]" style={{ color: "var(--color-vsc-text-muted)" }}>{hint}</span>}
        </span>
      </label>
      {children}
    </div>
  );
}

export function AnonymizeDialog({ snapshot, fileName, onClose }: Props) {
  const [options, setOptions] = useState<AnonymizeOptions>(DEFAULT_ANONYMIZE_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<AnonymizeOptions>) => setOptions((o) => ({ ...o, ...patch }));

  const summary = useMemo(() => anonymizeProject(snapshot, options, openedProjectAssets()).summary, [snapshot, options]);
  const lines = summaryLines(summary, options);
  const moving = options.localOrigin !== "none";

  // Escape closes; captured so that the canvas shortcuts do not react.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, busy]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = await saveAnonymizedCopy(options, fileName, snapshot);
      if (name) setSaved(name);
    } catch (err) {
      setError(`Unable to save the anonymized copy: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const title = saved ? "Anonymized copy saved" : "Save as anonymized";
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[600px] max-w-[94vw] rounded-lg shadow-2xl flex flex-col max-h-[90vh] text-xs"
        style={{ background: "var(--color-vsc-bg)", color: "var(--color-vsc-text)", border: "1px solid var(--color-vsc-border)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-vsc-border)]">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            title="Close (Esc)"
            className="w-6 h-6 flex items-center justify-center hover:bg-[var(--color-vsc-list-hover)] rounded cursor-pointer"
          >
            ✕
          </button>
        </div>

        {saved ? (
          <div className="px-4 py-4 flex flex-col gap-2" role="status">
            <p>
              Saved <strong>{saved}</strong>.
            </p>
            <p>The open project is unchanged. Open the copy to check it before you share it.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            <p>
              Saves a copy of the project without what identifies the client or the site, for example to attach it to a public issue. The open
              project is not changed.
            </p>
            <div>
              <Option
                label="Remove project information"
                hint="Title, subtitle, client, project number, revision, author, checker, date, description and import notes"
                checked={options.projectInfo}
                onChange={(projectInfo) => set({ projectInfo })}
              />
              <Option label="Rename models to Model 1, 2, …" checked={options.renameModels} onChange={(renameModels) => set({ renameModels })} />
              <Option
                label="Rename materials to Material 1, 2, …"
                hint="Their parameters are kept"
                checked={options.renameMaterials}
                onChange={(renameMaterials) => set({ renameMaterials })}
              />
              <Option
                label="Give other objects generic names"
                hint="Water lines, reinforcement and pile labels, reference lines, drawings and head lines"
                checked={options.renameObjects}
                onChange={(renameObjects) => set({ renameObjects })}
              />
              <Option
                label="Remove drawings and their files"
                checked={options.removeDrawings}
                onChange={(removeDrawings) => set({ removeDrawings })}
              />
              <Option
                label="Remove free text from text annotations"
                hint="Variables such as #FOS and #Method stay"
                checked={options.textAnnotations !== "keep"}
                onChange={(on) => set({ textAnnotations: on ? "replace" : "keep" })}
              >
                {options.textAnnotations !== "keep" && (
                  <div className="ml-6 mt-1 flex flex-col gap-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="anonymize-text"
                        checked={options.textAnnotations === "replace"}
                        onChange={() => set({ textAnnotations: "replace" })}
                      />
                      Replace it with “Text”
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="anonymize-text"
                        checked={options.textAnnotations === "delete"}
                        onChange={() => set({ textAnnotations: "delete" })}
                      />
                      Delete the text annotations
                    </label>
                  </div>
                )}
              </Option>
              <Option
                label="Remove results"
                hint={
                  moving
                    ? "Removed when moving to a local origin: they are in the original coordinates"
                    : "Results do not name the client and help reproduce a problem, but they contain coordinates"
                }
                checked={options.removeResults || moving}
                disabled={moving}
                onChange={(removeResults) => set({ removeResults })}
              />
              <Option
                label="Move to a local origin"
                hint="Hides the real chainage and levels: every coordinate (also datum elevations) is shifted so that the smallest x is 0. A rigid shift does not change the factor of safety."
                checked={moving}
                onChange={(on) => set({ localOrigin: on ? "x" : "none" })}
              >
                {moving && (
                  <label className="ml-6 mt-1 flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-blue-500"
                      checked={options.localOrigin === "xy"}
                      onChange={(e) => set({ localOrigin: e.target.checked ? "xy" : "x" })}
                    />
                    Also move the lowest point to y = 0
                  </label>
                )}
              </Option>
            </div>

            <div>
              <h4 className="font-semibold mb-1">Summary</h4>
              <ul className="list-disc ml-5 flex flex-col gap-0.5" data-testid="anonymize-summary">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            {summary.unchanged.length > 0 && (
              <div
                role="note"
                className="rounded px-3 py-2"
                style={{ border: "1px solid var(--color-vsc-warning, #d29922)", background: "color-mix(in srgb, var(--color-vsc-warning, #d29922) 10%, transparent)" }}
              >
                <p className="font-semibold">Check the file before sharing: names inside parameters, expressions or custom fields are not changed.</p>
                <ul className="list-disc ml-5 mt-1">
                  {summary.unchanged.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {error && (
              <p role="alert" style={{ color: "var(--color-vsc-error, #f14c4c)" }}>
                {error}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-vsc-border)]">
          {saved ? (
            <button type="button" onClick={onClose} className="btn btn-primary min-w-[80px]">
              Close
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="btn min-w-[80px]">
                Cancel
              </button>
              <button type="button" onClick={() => void save()} disabled={busy} className="btn btn-primary min-w-[80px]">
                {busy ? "Saving…" : "Save…"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
