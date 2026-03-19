import { useMemo, useState } from "react";
import type { ProjectInfo } from "../../store/app-store";

interface Props {
  initialInfos: ProjectInfo[];
  onSave: (changes: Partial<ProjectInfo>) => void;
  onClose: () => void;
}

type ProjectInfoKey = keyof ProjectInfo;

const STRING_FIELDS: ProjectInfoKey[] = [
  "title",
  "subtitle",
  "client",
  "projectNumber",
  "revision",
  "date",
  "author",
  "checker",
  "description",
];
const NUMBER_FIELDS: ProjectInfoKey[] = ["canvasWidth", "canvasHeight"];

function isNumberField(
  field: ProjectInfoKey,
): field is "canvasWidth" | "canvasHeight" {
  return field === "canvasWidth" || field === "canvasHeight";
}

function allSame<T>(values: T[]): { same: boolean; value: T } {
  const [first] = values;
  return { same: values.every((v) => v === first), value: first };
}

export function ProjectInfoDialog({ initialInfos, onSave, onClose }: Props) {
  const multiEdit = initialInfos.length > 1;

  const { initialValues, mixedFields } = useMemo(() => {
    const first = initialInfos[0];
    const values: Record<ProjectInfoKey, string> = {
      title: first.title,
      subtitle: first.subtitle,
      client: first.client,
      projectNumber: first.projectNumber,
      revision: first.revision,
      date: first.date,
      author: first.author,
      checker: first.checker,
      description: first.description,
      canvasWidth: String(first.canvasWidth),
      canvasHeight: String(first.canvasHeight),
    };
    const mixed = new Set<ProjectInfoKey>();

    const allFields: ProjectInfoKey[] = [...STRING_FIELDS, ...NUMBER_FIELDS];
    for (const field of allFields) {
      const check = allSame(initialInfos.map((info) => info[field]));
      if (check.same) {
        values[field] = String(check.value);
      } else {
        mixed.add(field);
        values[field] = "";
      }
    }

    return { initialValues: values, mixedFields: mixed };
  }, [initialInfos]);

  const [info, setInfo] =
    useState<Record<ProjectInfoKey, string>>(initialValues);
  const [touchedFields, setTouchedFields] = useState<Set<ProjectInfoKey>>(
    () => new Set(),
  );

  const handleChange = (field: ProjectInfoKey, value: string) => {
    setInfo((prev) => ({ ...prev, [field]: value }));
    setTouchedFields((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  };

  const handleSave = () => {
    const patch: Partial<ProjectInfo> = {};
    for (const field of touchedFields) {
      if (isNumberField(field)) {
        patch[field] = Number(info[field]) || 0;
      } else {
        patch[field] = info[field];
      }
    }
    onSave(patch);
  };

  const inputClassName =
    "w-full px-2 py-1.5 text-xs rounded border bg-[var(--color-vsc-input-bg)] text-[var(--color-vsc-text)] focus:border-[var(--color-vsc-accent)] outline-none";

  const fieldBorder = (field: ProjectInfoKey) => {
    const isMixedUntouched =
      mixedFields.has(field) && !touchedFields.has(field);
    return isMixedUntouched
      ? {
          border: "1px dashed var(--color-vsc-accent)",
          background:
            "color-mix(in srgb, var(--color-vsc-input-bg) 90%, var(--color-vsc-accent) 10%)",
        }
      : { border: "1px solid var(--color-vsc-border)" };
  };

  const fieldLabel = (label: string, field: ProjectInfoKey) => (
    <label className="block text-xs font-medium mb-1 opacity-70">
      {label}
      {mixedFields.has(field) && !touchedFields.has(field) ? " (mixed)" : ""}
    </label>
  );

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
          <div>
            <h3 className="font-semibold text-sm">Model Properties</h3>
            {multiEdit ? (
              <p className="text-[11px] opacity-65 mt-0.5">
                Editing {initialInfos.length} models
              </p>
            ) : null}
          </div>
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
              {fieldLabel("Title", "title")}
              <input
                type="text"
                value={info.title}
                onChange={(e) => handleChange("title", e.target.value)}
                placeholder={mixedFields.has("title") ? "Mixed values" : ""}
                className={inputClassName}
                style={fieldBorder("title")}
              />
            </div>
            <div className="col-span-2">
              {fieldLabel("Subtitle", "subtitle")}
              <input
                type="text"
                value={info.subtitle}
                onChange={(e) => handleChange("subtitle", e.target.value)}
                placeholder={mixedFields.has("subtitle") ? "Mixed values" : ""}
                className={inputClassName}
                style={fieldBorder("subtitle")}
              />
            </div>
            <div>
              {fieldLabel("Client", "client")}
              <input
                type="text"
                value={info.client}
                onChange={(e) => handleChange("client", e.target.value)}
                placeholder={mixedFields.has("client") ? "Mixed values" : ""}
                className={inputClassName}
                style={fieldBorder("client")}
              />
            </div>
            <div>
              {fieldLabel("Project No.", "projectNumber")}
              <input
                type="text"
                value={info.projectNumber}
                onChange={(e) => handleChange("projectNumber", e.target.value)}
                placeholder={
                  mixedFields.has("projectNumber") ? "Mixed values" : ""
                }
                className={inputClassName}
                style={fieldBorder("projectNumber")}
              />
            </div>
            <div>
              {fieldLabel("Revision", "revision")}
              <input
                type="text"
                value={info.revision}
                onChange={(e) => handleChange("revision", e.target.value)}
                placeholder={mixedFields.has("revision") ? "Mixed values" : ""}
                className={inputClassName}
                style={fieldBorder("revision")}
              />
            </div>
            <div>
              {fieldLabel("Date", "date")}
              <input
                type="text"
                value={info.date}
                onChange={(e) => handleChange("date", e.target.value)}
                placeholder={mixedFields.has("date") ? "Mixed values" : ""}
                className={inputClassName}
                style={fieldBorder("date")}
              />
            </div>
            <div>
              {fieldLabel("Author", "author")}
              <input
                type="text"
                value={info.author}
                onChange={(e) => handleChange("author", e.target.value)}
                placeholder={mixedFields.has("author") ? "Mixed values" : ""}
                className={inputClassName}
                style={fieldBorder("author")}
              />
            </div>
            <div>
              {fieldLabel("Checker", "checker")}
              <input
                type="text"
                value={info.checker}
                onChange={(e) => handleChange("checker", e.target.value)}
                placeholder={mixedFields.has("checker") ? "Mixed values" : ""}
                className={inputClassName}
                style={fieldBorder("checker")}
              />
            </div>
            <div className="col-span-2">
              {fieldLabel("Description / Notes", "description")}
              <textarea
                value={info.description}
                onChange={(e) => handleChange("description", e.target.value)}
                rows={3}
                placeholder={
                  mixedFields.has("description") ? "Mixed values" : ""
                }
                className={`${inputClassName} resize-none`}
                style={fieldBorder("description")}
              />
            </div>

            <div>
              {fieldLabel("Canvas Width (m)", "canvasWidth")}
              <input
                type="number"
                min={10}
                max={100000}
                value={info.canvasWidth}
                onChange={(e) => handleChange("canvasWidth", e.target.value)}
                placeholder={
                  mixedFields.has("canvasWidth") ? "Mixed values" : ""
                }
                className={inputClassName}
                style={fieldBorder("canvasWidth")}
              />
            </div>
            <div>
              {fieldLabel("Canvas Height (m)", "canvasHeight")}
              <input
                type="number"
                min={10}
                max={100000}
                value={info.canvasHeight}
                onChange={(e) => handleChange("canvasHeight", e.target.value)}
                placeholder={
                  mixedFields.has("canvasHeight") ? "Mixed values" : ""
                }
                className={inputClassName}
                style={fieldBorder("canvasHeight")}
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
            onClick={handleSave}
            className="px-3 py-1.5 text-xs font-medium rounded text-white bg-[var(--color-vsc-accent)] hover:opacity-90 transition-opacity"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
