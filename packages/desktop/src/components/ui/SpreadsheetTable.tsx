import { type CSSProperties, type ReactNode, useState } from "react";

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
}: SpreadsheetTableProps<T>) {
  return (
    <div
      className="overflow-hidden rounded-md border"
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
                  className={`py-1.5 px-2 font-semibold text-[11px] uppercase tracking-wide ${column.widthClassName ?? ""} ${alignToClass(column.align)}`}
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

  const bg = selected
    ? "var(--color-vsc-selection)"
    : hovered && clickable
      ? "var(--color-vsc-list-hover)"
      : "transparent";

  return (
    <tr
      onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={clickable ? "cursor-pointer" : undefined}
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
  step = "0.5",
  ariaLabel,
  onChange,
  className,
}: {
  value: number;
  step?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
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

/** Small trash-can icon button for removing a spreadsheet row. */
export function SpreadsheetRemoveButton({
  ariaLabel,
  onClick,
}: {
  ariaLabel: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-5 h-5 flex items-center justify-center rounded-sm opacity-40 hover:opacity-100 hover:bg-red-500/15 hover:text-red-500 cursor-pointer transition-all"
      style={{ color: "var(--color-vsc-text-muted)" }}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5.5 2.5h5M3 4h10M12 4l-.5 8.5a1 1 0 0 1-1 .9H5.5a1 1 0 0 1-1-.9L4 4M6.5 6.5v4M9.5 6.5v4" />
      </svg>
    </button>
  );
}
