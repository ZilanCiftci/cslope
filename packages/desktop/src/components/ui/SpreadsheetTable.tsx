import { useState } from "react";
import { CELL_EDITOR_CLASS, cellEditorStyle } from "./cell-editor";

// The spreadsheet tables (points, loads, parameters) are RecordTables in
// "cells" mode; these names stay for their call sites.
export {
  RecordTable as SpreadsheetTable,
  RemoveColumnHeader,
  RowRemoveButton,
  type RecordColumn as SpreadsheetColumn,
} from "./RecordTable";

export function SpreadsheetNumberInput({
  value,
  ariaLabel,
  onChange,
  onBlur,
  className,
}: {
  value: number;
  ariaLabel: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  className?: string;
}) {
  // While the user types, show their text rather than the stored number:
  // partial input such as "-" or "" would otherwise snap back immediately.
  // A text field with "," read as ".", as DraftNumberInput: a number field
  // drops a decimal separator that is not its locale's ("2,5" became 25).
  const [draft, setDraft] = useState<string | null>(null);
  const normalized = (text: string) => text.replace(",", ".");
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(normalized(e.target.value));
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(normalized(e.target.value));
      }}
      className={`${CELL_EDITOR_CLASS} ${className ?? ""}`}
      style={cellEditorStyle}
      aria-label={ariaLabel}
    />
  );
}
