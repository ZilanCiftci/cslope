import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";

/**
 * The one table view for lists of records in the windows (materials,
 * boundaries, lines, points, loads, reinforcement, custom surfaces):
 * 11 px cells in 24 px rows, the selected row in light blue, an "×" at
 * the row's end on hover and "+ Add …" links under the table.
 *
 * Two modes:
 * - "cells" (default): the cells hold editors (`SpreadsheetNumberInput`,
 *   `SpreadsheetExpressionInput`, 22 px high), as in a spreadsheet.
 * - "records": read-only rows that select a record, whose fields are
 *   edited in a detail form under the table. The rows take the focus one
 *   at a time; the arrow keys, Home and End move the selection.
 */

export interface RecordColumn<T> {
  header: ReactNode;
  widthClassName?: string;
  /** Extra classes on the <td>. Text cells get `px-2` in "records" mode; give "px-2" for a text cell in "cells" mode. */
  cellClassName?: string;
  align?: "left" | "center" | "right";
  renderCell: (row: T, rowIndex: number) => ReactNode;
}

export interface AddAction {
  /** The whole link text, "+ Add material". */
  label: string;
  onClick: () => void;
  title?: string;
}

interface RecordTableProps<T> {
  rows: T[];
  columns: RecordColumn<T>[];
  getRowKey: (row: T, rowIndex: number) => string | number;
  mode?: "cells" | "records";
  /** Accessible name of the table. */
  label?: string;
  selectedRowIndex?: number | null;
  onRowClick?: (row: T, rowIndex: number) => void;
  getRowStyle?: (row: T, rowIndex: number) => CSSProperties | undefined;
  /** One muted sentence in the table body while there are no rows ("No distributed loads."). */
  emptyText?: string;
  /** Removes a row: an "×" at the row's end, shown on hover, on the selected row and with the focus. */
  onRemove?: (row: T, rowIndex: number) => void;
  /** Accessible name of a row's "×" ("Remove point 2"). */
  removeLabel?: (row: T, rowIndex: number) => string;
  /** False hides the "×" of that row (e.g. the last material, a line's last two points). */
  canRemove?: (row: T, rowIndex: number) => boolean;
  /** More icon buttons before the "×" (`RowIconButton`), shown like it. */
  rowActions?: (row: T, rowIndex: number) => ReactNode;
  /** "+ Add …" links under the table. */
  addActions?: AddAction[];
  /** Marks the table's border in the error color (e.g. too few points). */
  invalid?: boolean;
  /** Scrolls the body past this height (px), the header staying in view. */
  maxHeight?: number;
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

const border = "1px solid var(--color-vsc-border)";

export function RecordTable<T>({
  rows,
  columns,
  getRowKey,
  mode = "cells",
  label,
  selectedRowIndex = null,
  onRowClick,
  getRowStyle,
  emptyText,
  onRemove,
  removeLabel,
  canRemove,
  rowActions,
  addActions,
  invalid = false,
  maxHeight,
}: RecordTableProps<T>) {
  const records = mode === "records";
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const hasActions = Boolean(onRemove || rowActions);
  const allColumns: RecordColumn<T>[] = hasActions
    ? [
        ...columns,
        {
          header: <RemoveColumnHeader />,
          widthClassName: rowActions ? "w-14" : "w-7",
          cellClassName: "px-0.5 whitespace-nowrap",
          align: "right",
          renderCell: (row, i) => (
            <span className="inline-flex items-center align-middle">
              {rowActions?.(row, i)}
              {onRemove && (canRemove?.(row, i) ?? true) && (
                <RowRemoveButton
                  ariaLabel={removeLabel?.(row, i) ?? `Remove row ${i + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(row, i);
                  }}
                />
              )}
            </span>
          ),
        },
      ]
    : columns;

  // A selection made elsewhere (the canvas, an added record) scrolls into view.
  useEffect(() => {
    if (selectedRowIndex === null || selectedRowIndex < 0) return;
    const row = bodyRef.current?.querySelectorAll<HTMLElement>("tr[data-record-row]")[selectedRowIndex];
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedRowIndex]);

  // "records": one row is in the tab order (the selected one, else the first).
  const focusIndex = Math.max(0, selectedRowIndex ?? 0);
  const moveTo = (index: number) => {
    const k = Math.min(rows.length - 1, Math.max(0, index));
    if (rows[k] === undefined) return;
    onRowClick?.(rows[k], k);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr[data-record-row]")[k]?.focus();
  };
  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, row: T, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(row, i);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveTo(i + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      moveTo(e.key === "Home" ? 0 : rows.length - 1);
    }
  };

  return (
    <div className="space-y-1">
      <div
        className={`rounded-xs border ${maxHeight ? "overflow-auto" : "overflow-hidden"}`}
        style={{
          borderColor: invalid ? "var(--color-vsc-error)" : "var(--color-vsc-border)",
          maxHeight,
        }}
      >
        <table
          role={records ? "grid" : undefined}
          aria-label={label}
          className={`w-full text-[11px] leading-4 border-collapse${records ? " whitespace-nowrap" : ""}`}
        >
          <thead className={maxHeight ? "sticky top-0 z-[1]" : undefined}>
            <tr className="h-6" style={{ background: "var(--color-vsc-surface-tint-strong)" }}>
              {allColumns.map((column, index) => (
                <th
                  key={index}
                  className={`px-2 font-semibold text-[11px] ${column.widthClassName ?? ""} ${alignToClass(column.align)}`}
                  style={{
                    color: "var(--color-vsc-text-muted)",
                    borderBottom: border,
                    borderRight: index === allColumns.length - 1 || (hasActions && index === allColumns.length - 2) ? "none" : border,
                  }}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.length === 0 && emptyText && (
              <tr className="h-6">
                <td colSpan={allColumns.length} className="px-2" style={{ color: "var(--color-vsc-text-muted)" }}>
                  {emptyText}
                </td>
              </tr>
            )}
            {rows.map((row, rowIndex) => (
              <RecordRow
                key={getRowKey(row, rowIndex)}
                row={row}
                rowIndex={rowIndex}
                last={rowIndex === rows.length - 1}
                columns={allColumns}
                hasActions={hasActions}
                records={records}
                selected={selectedRowIndex === rowIndex}
                focusable={records && rowIndex === focusIndex}
                onRowClick={onRowClick}
                onKeyDown={records ? (e) => onRowKeyDown(e, row, rowIndex) : undefined}
                rowStyle={getRowStyle?.(row, rowIndex)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {addActions && addActions.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {addActions.map((a) => (
            <AddLink key={a.label} onClick={a.onClick} title={a.title}>
              {a.label}
            </AddLink>
          ))}
        </div>
      )}
    </div>
  );
}

/* A row with its own hover state. */
function RecordRow<T>({
  row,
  rowIndex,
  last,
  columns,
  hasActions,
  records,
  selected,
  focusable,
  onRowClick,
  onKeyDown,
  rowStyle,
}: {
  row: T;
  rowIndex: number;
  last: boolean;
  columns: RecordColumn<T>[];
  hasActions: boolean;
  records: boolean;
  selected: boolean;
  focusable: boolean;
  onRowClick?: (row: T, rowIndex: number) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTableRowElement>) => void;
  rowStyle?: CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = Boolean(onRowClick);

  // (the light blue of a selected row everywhere in the app)
  const bg = selected
    ? "var(--color-vsc-selected-bg)"
    : hovered && clickable
      ? "var(--color-vsc-list-hover)"
      : "transparent";

  return (
    <tr
      data-record-row=""
      onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={records ? (focusable ? 0 : -1) : undefined}
      className={`group h-6${clickable ? " cursor-pointer" : ""}${records ? " focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1" : ""}`}
      aria-selected={clickable ? selected : undefined}
      style={{
        background: bg,
        color: selected ? "var(--color-vsc-text-bright)" : "var(--color-vsc-text)",
        transition: "background 120ms ease",
        ...rowStyle,
      }}
    >
      {columns.map((column, colIndex) => {
        const isLast = colIndex === columns.length - 1;
        const beforeActions = hasActions && colIndex === columns.length - 2;
        return (
          <td
            key={colIndex}
            className={`align-middle ${records ? "px-2 tabular-nums " : "p-0 "}${column.cellClassName ?? ""} ${alignToClass(column.align)}`}
            style={{
              borderBottom: last ? "none" : border,
              borderRight: isLast || beforeActions ? "none" : border,
            }}
          >
            {column.renderCell(row, rowIndex)}
          </td>
        );
      })}
    </tr>
  );
}

/** A "+ Add …" text link under a table. */
export function AddLink({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="text-[11px] cursor-pointer hover:underline font-medium"
      style={{ color: "var(--color-vsc-link)" }}
    >
      {children}
    </button>
  );
}

/**
 * An icon button at the end of a table row (24 px, a muted 12 px lucide
 * icon), shown while the row is hovered, selected or holds the focus. The
 * row needs the `group` class (RecordTable's rows have it).
 */
export function RowIconButton({
  ariaLabel,
  title,
  onClick,
  danger = false,
  children,
}: {
  ariaLabel: string;
  title?: string;
  onClick: (e: MouseEvent) => void;
  /** Turns to the error color on hover (remove). */
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-6 h-6 inline-flex items-center justify-center rounded-xs cursor-pointer transition-opacity opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-aria-selected:opacity-100 focus-visible:opacity-100 text-[var(--color-vsc-text-muted)] hover:bg-[var(--color-vsc-list-hover)] ${danger ? "hover:text-[var(--color-vsc-error)]" : "hover:text-[var(--color-vsc-text)]"}`}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
    >
      {children}
    </button>
  );
}

/**
 * The remove control at the end of a table row: a muted lucide "×" that
 * turns to the error color on hover.
 */
export function RowRemoveButton({
  ariaLabel,
  onClick,
}: {
  ariaLabel: string;
  onClick: (e: MouseEvent) => void;
}) {
  return (
    <RowIconButton ariaLabel={ariaLabel} onClick={onClick} danger>
      <X size={12} strokeWidth={1.75} aria-hidden />
    </RowIconButton>
  );
}
