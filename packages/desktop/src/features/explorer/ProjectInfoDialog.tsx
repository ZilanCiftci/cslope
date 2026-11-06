import { useId, useMemo, useState, type ReactNode } from "react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import type { ProjectInfo } from "../../store/app-store";
import { parseDecimalText } from "../../utils/decimal";

interface Props {
  initialInfos: ProjectInfo[];
  onSave: (changes: Partial<ProjectInfo>) => void;
  onClose: () => void;
  /** What the import of the model noted (read-only); absent: not imported. */
  importNotes?: string[];
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

export function ProjectInfoDialog({ initialInfos, onSave, onClose, importNotes }: Props) {
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
        // "," or "." as the decimal separator.
        patch[field] = parseDecimalText(String(info[field])) || 0;
      } else {
        patch[field] = info[field];
      }
    }
    onSave(patch);
  };

  const idBase = useId();
  const fieldId = (key: ProjectInfoKey) => `${idBase}-${key}`;

  /** A labeled field; a value that differs between the models shows the placeholder "Mixed values". */
  const field = (
    label: string,
    key: ProjectInfoKey,
    opts: { wide?: boolean; multiline?: boolean; decimal?: boolean } = {},
  ) => {
    const common = {
      id: fieldId(key),
      value: info[key],
      placeholder: mixedFields.has(key) ? "Mixed values" : "",
    };
    const control: ReactNode = opts.multiline ? (
      <textarea
        {...common}
        rows={3}
        onChange={(e) => handleChange(key, e.target.value)}
        className="w-full resize-none"
      />
    ) : (
      <input
        {...common}
        type="text"
        inputMode={opts.decimal ? "decimal" : undefined}
        onChange={(e) => handleChange(key, e.target.value)}
        className="w-full"
      />
    );
    return (
      <div className={opts.wide ? "col-span-2" : undefined}>
        <label
          htmlFor={fieldId(key)}
          className="block text-[11px] mb-1"
          style={{ color: "var(--color-vsc-text-muted)" }}
        >
          {label}
        </label>
        {control}
      </div>
    );
  };

  return (
    <ModalFrame
      title="Model properties"
      description={
        multiEdit
          ? `Editing ${initialInfos.length} models: a field you change is set in all of them.`
          : "The model's title block, shown by text annotations (#Title, #Client, …) and in the PDF report."
      }
      onClose={onClose}
      widthClassName="w-[480px]"
      buttons={
        <>
          <button type="button" onClick={onClose} className="btn">
            Cancel
          </button>
          <button type="button" onClick={handleSave} className="btn btn-primary">
            Save changes
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {field("Title", "title", { wide: true })}
          {field("Subtitle", "subtitle", { wide: true })}
          {field("Client", "client")}
          {field("Project no.", "projectNumber")}
          {field("Revision", "revision")}
          {field("Date", "date")}
          {field("Author", "author")}
          {field("Checker", "checker")}
          {field("Description", "description", { wide: true, multiline: true })}
          {field("Canvas width (m)", "canvasWidth", { decimal: true })}
          {field("Canvas height (m)", "canvasHeight", { decimal: true })}
        </div>
        {importNotes && importNotes.length > 0 && (
          <section aria-label="Import notes" data-testid="import-notes">
            <h4
              className="text-[10px] font-bold uppercase tracking-[0.08em] mb-1"
              style={{ color: "var(--color-vsc-text-muted)" }}
            >
              Import notes
            </h4>
            <ul className="text-[11px] list-disc pl-4 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
              {importNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ModalFrame>
  );
}
