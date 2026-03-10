interface DataPointTableProps {
  /** Column headers (e.g. ["Depth (m)", "Su (kPa)"]). */
  headers: string[];
  /** Rows of numeric values. Each row has same length as headers. */
  rows: number[][];
  /** Called with the full updated rows array. */
  onChange: (rows: number[][]) => void;
  /** Minimum number of columns (for validation display). */
  minRows?: number;
}

export function DataPointTable({
  headers,
  rows,
  onChange,
  minRows = 0,
}: DataPointTableProps) {
  const updateCell = (rowIdx: number, colIdx: number, value: string) => {
    const parsed = parseFloat(value);
    const next = rows.map((r) => [...r]);
    next[rowIdx][colIdx] = Number.isFinite(parsed) ? parsed : 0;
    onChange(next);
  };

  const addRow = () => {
    const lastRow = rows.length > 0 ? rows[rows.length - 1] : undefined;
    const newRow = lastRow
      ? lastRow.map((v) => v)
      : new Array<number>(headers.length).fill(0);
    onChange([...rows, newRow]);
  };

  const removeRow = (rowIdx: number) => {
    onChange(rows.filter((_, i) => i !== rowIdx));
  };

  const tooFew = rows.length < minRows;

  return (
    <div className="space-y-1">
      <div
        className="overflow-hidden rounded-md border"
        style={{
          borderColor: tooFew
            ? "var(--color-vsc-error)"
            : "var(--color-vsc-border)",
        }}
      >
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr style={{ background: "var(--color-vsc-surface-tint-strong)" }}>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="py-1 px-1.5 font-semibold text-[10px] uppercase tracking-wide text-left"
                  style={{
                    color: "var(--color-vsc-text-muted)",
                    borderBottom: "1px solid var(--color-vsc-border)",
                    borderRight:
                      i < headers.length - 1
                        ? "1px solid var(--color-vsc-border)"
                        : "none",
                  }}
                >
                  {h}
                </th>
              ))}
              <th
                className="w-6"
                style={{ borderBottom: "1px solid var(--color-vsc-border)" }}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((val, ci) => (
                  <td
                    key={ci}
                    className="p-0"
                    style={{
                      borderRight:
                        ci < row.length - 1
                          ? "1px solid var(--color-vsc-border)"
                          : "none",
                      borderBottom:
                        ri < rows.length - 1
                          ? "1px solid var(--color-vsc-border)"
                          : "none",
                    }}
                  >
                    <input
                      type="number"
                      value={val}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      className="w-full bg-transparent border-none text-[11px] px-1.5 py-0.5 outline-none"
                      style={{ color: "var(--color-vsc-text)" }}
                      aria-label={`${headers[ci]} row ${ri + 1}`}
                    />
                  </td>
                ))}
                <td
                  className="w-6 text-center"
                  style={{
                    borderBottom:
                      ri < rows.length - 1
                        ? "1px solid var(--color-vsc-border)"
                        : "none",
                  }}
                >
                  <button
                    onClick={() => removeRow(ri)}
                    className="text-[9px] opacity-40 hover:opacity-100 hover:text-red-400 cursor-pointer"
                    aria-label={`Remove row ${ri + 1}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={addRow}
        className="text-[10px] cursor-pointer hover:underline font-medium"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        + Add Row
      </button>
    </div>
  );
}
