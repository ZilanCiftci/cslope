import { type CSSProperties, type ReactNode } from "react";

export interface SpreadsheetColumn<T> {
  header: ReactNode;
  widthClassName?: string;
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
      className="overflow-hidden border"
      style={{ borderColor: "var(--color-vsc-border)" }}
    >
      <table className="w-full text-[12px] border-collapse">
        <thead
          className="text-left"
          style={{ background: "var(--color-vsc-surface-tint)" }}
        >
          <tr>
            {columns.map((column, index) => {
              const isLast = index === columns.length - 1;
              return (
                <th
                  key={index}
                  className={`py-1.5 px-2 ${column.widthClassName ?? ""} ${alignToClass(column.align)}`}
                  style={{
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
              <tr
                key={getRowKey(row, rowIndex)}
                onClick={
                  onRowClick ? () => onRowClick(row, rowIndex) : undefined
                }
                className={clickable ? "cursor-pointer" : undefined}
                style={{
                  background: selected
                    ? "var(--color-vsc-selection)"
                    : "transparent",
                  ...getRowStyle?.(row, rowIndex),
                }}
              >
                {columns.map((column, colIndex) => {
                  const isLast = colIndex === columns.length - 1;
                  return (
                    <td
                      key={colIndex}
                      className={`py-1 px-2 ${alignToClass(column.align)}`}
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
          })}
        </tbody>
      </table>
    </div>
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
      className={`w-full ${className ?? ""}`}
      style={{
        background: "transparent",
        border: "none",
        borderRadius: 0,
        padding: 0,
        boxShadow: "none",
      }}
      aria-label={ariaLabel}
    />
  );
}
