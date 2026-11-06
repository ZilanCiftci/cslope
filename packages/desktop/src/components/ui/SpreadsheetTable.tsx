import { type CSSProperties, type ReactNode, useState } from "react";
import { X } from "lucide-react";

export interface SpreadsheetColumn<T> {
  header: ReactNode;
  widthClassName?: string;
  /** Extra classes on the <td>. Use "py-1 px-2" for non-editable cells. */
  cellClassName?: string;
  align?: "left" | "center" | "right";
  renderCell: (row: T, rowIndex: number) => ReactNode;
}

interface SpreadsheetTableProps<T> {
  rows: T[];
  columns: SpreadsheetColumn<T>[];
  getRowKey: (row: T, rowIndex: number) => string | number;
  selectedRowIndex?: number | null;
  onRowClick?: (row: T, rowIndex: number) => void;
  getRowStyle?: (row: T, rowIndex: number) => CSSProperties | undefined;
  /** One muted sentence in the table body while there are no rows ("No distributed loads."). */
  emptyText?: string;
}

/** The header of a remove column: no visible text, "Remove" for screen readers. */
export function RemoveColumnHeader() {
  return <span className="sr-only">Remove</span>;
}

function alignToClass(align?: "left" | "center" | "right") {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return "text-left";
}

export function SpreadsheetTable<T>({
  rows,
  columns,
  getRowKey,
  selectedRowIndex = null,
  onRowClick,
  getRowStyle,
  emptyText,
}: SpreadsheetTableProps<T>) {
  return (
    <div
      className="overflow-hidden rounded-xs border"
      style={{ borderColor: "var(--color-vsc-border)" }}
    >
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr
            style={{
              background: "var(--color-vsc-surface-tint-strong)",
            }}
          >
            {columns.map((column, index) => {
              const isLast = index === columns.length - 1;
              return (
                <th
                  key={index}
                  className={`py-1.5 px-2 font-semibold text-[11px] ${column.widthClassName ?? ""} ${alignToClass(column.align)}`}
                  style={{
                    color: "var(--color-vsc-text-muted)",
                    borderBottom: "1px solid var(--color-vsc-border)",
                    borderRight: isLast
                      ? "none"
                      : "1px solid var(--color-vsc-border)",
                  }}
                >
                  {column.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyText && (
            <tr>
              <td
                colSpan={columns.length}
                className="py-1.5 px-2 text-[11px]"
                style={{ color: "var(--color-vsc-text-muted)" }}
              >
                {emptyText}
              </td>
            </tr>
          )}
          {rows.map((row, rowIndex) => {
            const clickable = Boolean(onRowClick);
            const selected = selectedRowIndex === rowIndex;
            return (
              <SpreadsheetRow
                key={getRowKey(row, rowIndex)}
                row={row}
                rowIndex={rowIndex}
                columns={columns}
                clickable={clickable}
                selected={selected}
                onRowClick={onRowClick}
                rowStyle={getRowStyle?.(row, rowIndex)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* Extracted row so we can track hover state per-row */
function SpreadsheetRow<T>({
  row,
  rowIndex,
  columns,
  clickable,
  selected,
  onRowClick,
  rowStyle,
}: {
  row: T;
  rowIndex: number;
  columns: SpreadsheetColumn<T>[];
  clickable: boolean;
  selected: boolean;
  onRowClick?: (row: T, rowIndex: number) => void;
  rowStyle?: CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);

  // (the light blue of a selected row everywhere in the app)
  const bg = selected
    ? "var(--color-vsc-selected-bg)"
    : hovered && clickable
      ? "var(--color-vsc-list-hover)"
      : "transparent";

  return (
    <tr
      onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group${clickable ? " cursor-pointer" : ""}`}
      aria-selected={clickable ? selected : undefined}
      style={{
        background: bg,
        transition: "background 120ms ease",
        ...rowStyle,
      }}
    >
      {columns.map((column, colIndex) => {
        const isLast = colIndex === columns.length - 1;
        return (
          <td
            key={colIndex}
            className={`p-0 ${column.cellClassName ?? ""} ${alignToClass(column.align)}`}
            style={{
              borderBottom: "1px solid var(--color-vsc-border)",
              borderRight: isLast
                ? "none"
                : "1px solid var(--color-vsc-border)",
            }}
          >
            {column.renderCell(row, rowIndex)}
          </td>
        );
      })}
    </tr>
  );
}

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
      className={`w-full h-full py-1 px-2 text-[12px] outline-none border-2 border-transparent focus:border-[var(--color-vsc-accent)] ${className ?? ""}`}
      style={{
        background: "var(--color-vsc-input-bg)",
        color: "var(--color-vsc-text)",
        borderRadius: 0,
        boxShadow: "none",
        margin: 0,
      }}
      aria-label={ariaLabel}
    />
  );
}

/**
 * The remove control at the end of a table row: a muted lucide "×" in a
 * 24 px icon button, shown while the row is hovered, selected or holds the
 * focus; it turns to the error color on hover. The row needs the `group`
 * class (SpreadsheetTable's rows have it).
 */
export function RowRemoveButton({
  ariaLabel,
  onClick,
}: {
  ariaLabel: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-6 h-6 inline-flex items-center justify-center rounded-xs cursor-pointer transition-opacity opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-aria-selected:opacity-100 focus-visible:opacity-100 text-[var(--color-vsc-text-muted)] hover:text-[var(--color-vsc-error)] hover:bg-[var(--color-vsc-list-hover)]"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <X size={12} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
