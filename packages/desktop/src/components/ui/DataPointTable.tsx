import { useState } from "react";
import { RecordTable, type RecordColumn } from "./RecordTable";
import { CELL_EDITOR_CLASS, cellEditorStyle } from "./cell-editor";

const normalizeDecimalSeparator = (value: string): string =>
  value.replace(/,/g, ".");

interface DataPointTableProps {
  /** Column headers (e.g. ["Depth (m)", "Su (kPa)"]). */
  headers: string[];
  /** Rows of numeric values. Each row has same length as headers. */
  rows: number[][];
  /** Called with the full updated rows array. */
  onChange: (rows: number[][]) => void;
  /** Minimum number of columns (for validation display). */
  minRows?: number;
  /** Shown in place of the rows while there are none. */
  emptyText?: string;
}

export function DataPointTable({
  headers,
  rows,
  onChange,
  minRows = 0,
  emptyText,
}: DataPointTableProps) {
  const [draftCells, setDraftCells] = useState<Record<string, string>>({});

  const cellKey = (rowIdx: number, colIdx: number) => `${rowIdx}:${colIdx}`;

  const updateCell = (rowIdx: number, colIdx: number, value: number) => {
    const next = rows.map((r) => [...r]);
    next[rowIdx][colIdx] = value;
    onChange(next);
  };

  const updateDraftCell = (rowIdx: number, colIdx: number, value: string) => {
    const key = cellKey(rowIdx, colIdx);
    setDraftCells((current) => ({ ...current, [key]: value }));
  };

  /** Show the stored value again, e.g. when the cell is left. */
  const clearDraftCell = (rowIdx: number, colIdx: number) => {
    const key = cellKey(rowIdx, colIdx);
    setDraftCells((current) => {
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  };

  const canBeNumericDraft = (value: string) => /^-?\d*\.?\d*$/.test(value);

  const isTransientDraft = (value: string) =>
    value === "" || value === "-" || value === "." || value === "-.";

  const addRow = () => {
    const lastRow = rows.length > 0 ? rows[rows.length - 1] : undefined;
    const newRow = lastRow
      ? lastRow.map((v) => v)
      : new Array<number>(headers.length).fill(0);
    setDraftCells({});
    onChange([...rows, newRow]);
  };

  const removeRow = (rowIdx: number) => {
    setDraftCells({});
    onChange(rows.filter((_, i) => i !== rowIdx));
  };

  const tooFew = rows.length < minRows;

  const columns: RecordColumn<number[]>[] = headers.map((header, ci) => ({
    header,
    renderCell: (row, ri) => (
      <input
        type="text"
        inputMode="decimal"
        value={draftCells[cellKey(ri, ci)] ?? String(row[ci])}
        onChange={(e) => {
          const nextDraft = normalizeDecimalSeparator(e.target.value);
          if (!canBeNumericDraft(nextDraft)) {
            return;
          }

          updateDraftCell(ri, ci, nextDraft);

          if (isTransientDraft(nextDraft)) {
            return;
          }

          const parsed = Number(nextDraft);
          if (Number.isFinite(parsed)) {
            updateCell(ri, ci, parsed);
          }
        }}
        onBlur={(e) => {
          const nextDraft = normalizeDecimalSeparator(e.target.value);
          let resolved = 0;

          if (!isTransientDraft(nextDraft)) {
            const parsed = Number(nextDraft);
            if (Number.isFinite(parsed)) {
              resolved = parsed;
            }
          }

          // A kept draft would hide rows passed in later.
          clearDraftCell(ri, ci);
          updateCell(ri, ci, resolved);
        }}
        className={CELL_EDITOR_CLASS}
        style={cellEditorStyle}
        aria-label={`${headers[ci]} row ${ri + 1}`}
      />
    ),
  }));

  return (
    <RecordTable
      rows={rows}
      columns={columns}
      getRowKey={(_row, ri) => ri}
      emptyText={emptyText}
      invalid={tooFew}
      onRemove={(_row, ri) => removeRow(ri)}
      removeLabel={(_row, ri) => `Remove point ${ri + 1}`}
      addActions={[{ label: "+ Add point", onClick: addRow }]}
    />
  );
}
