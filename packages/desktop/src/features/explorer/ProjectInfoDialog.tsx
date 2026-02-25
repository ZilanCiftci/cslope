import { useState } from "react";
import type { ProjectInfo } from "../../store/app-store";

interface Props {
  initialInfo: ProjectInfo;
  onSave: (info: ProjectInfo) => void;
  onClose: () => void;
}

export function ProjectInfoDialog({ initialInfo, onSave, onClose }: Props) {
  const [info, setInfo] = useState<ProjectInfo>(initialInfo);

  const handleChange = (field: keyof ProjectInfo, value: string | number) => {
    setInfo((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="w-[480px] rounded-lg shadow-2xl flex flex-col max-h-[90vh]"
        style={{
          background: "var(--color-vsc-bg)",
          border: "1px solid var(--color-vsc-border)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-vsc-border)]">
          <h3 className="font-semibold text-sm">Model Properties</h3>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center hover:bg-[var(--color-vsc-list-hover)] rounded"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1 opacity-70">
                Title
              </label>
              <input
                type="text"
                value={info.title}
                onChange={(e) => handleChange("title", e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1 opacity-70">
                Subtitle
              </label>
              <input
                type="text"
                value={info.subtitle}
                onChange={(e) => handleChange("subtitle", e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 opacity-70">
                Client
              </label>
              <input
                type="text"
                value={info.client}
                onChange={(e) => handleChange("client", e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 opacity-70">
                Project No.
              </label>
              <input
                type="text"
                value={info.projectNumber}
                onChange={(e) => handleChange("projectNumber", e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 opacity-70">
                Revision
              </label>
              <input
                type="text"
                value={info.revision}
                onChange={(e) => handleChange("revision", e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 opacity-70">
                Date
              </label>
              <input
                type="text"
                value={info.date}
                onChange={(e) => handleChange("date", e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 opacity-70">
                Author
              </label>
              <input
                type="text"
                value={info.author}
                onChange={(e) => handleChange("author", e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 opacity-70">
                Checker
              </label>
              <input
                type="text"
                value={info.checker}
                onChange={(e) => handleChange("checker", e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1 opacity-70">
                Description / Notes
              </label>
              <textarea
                value={info.description}
                onChange={(e) => handleChange("description", e.target.value)}
                rows={3}
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 opacity-70">
                Canvas Width (m)
              </label>
              <input
                type="number"
                min={10}
                max={100000}
                value={info.canvasWidth}
                onChange={(e) =>
                  handleChange("canvasWidth", Number(e.target.value) || 0)
                }
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 opacity-70">
                Canvas Height (m)
              </label>
              <input
                type="number"
                min={10}
                max={100000}
                value={info.canvasHeight}
                onChange={(e) =>
                  handleChange("canvasHeight", Number(e.target.value) || 0)
                }
                className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-vsc-border)] bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-vsc-border)] bg-[var(--color-vsc-surface)] rounded-b-lg">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded hover:bg-[var(--color-vsc-list-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(info)}
            className="px-3 py-1.5 text-xs font-medium rounded text-white bg-[var(--color-vsc-accent)] hover:opacity-90 transition-opacity"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
