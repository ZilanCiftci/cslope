import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import {
  SpreadsheetNumberInput,
  SpreadsheetRemoveButton,
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../../components/ui/SpreadsheetTable";

export function GeometrySection() {
  const coordinates = useAppStore((s) => s.coordinates);
  const setCoordinate = useAppStore((s) => s.setCoordinate);
  const removeCoordinate = useAppStore((s) => s.removeCoordinate);
  const addCoordinate = useAppStore((s) => s.addCoordinate);
  const selectedPointIndex = useAppStore((s) => s.selectedPointIndex);
  const setSelectedPoint = useAppStore((s) => s.setSelectedPoint);

  const handleChange = (i: number, axis: 0 | 1, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const c: [number, number] = [...coordinates[i]];
    c[axis] = num;
    setCoordinate(i, c);
  };

  const columns: SpreadsheetColumn<[number, number]>[] = [
    {
      header: <Label>#</Label>,
      widthClassName: "w-8",
      cellClassName: "py-1 px-2",
      renderCell: (_row, i) => (
        <span
          style={{
            color: "var(--color-vsc-text-muted)",
            fontSize: "10px",
          }}
        >
          {i + 1}
        </span>
      ),
    },
    {
      header: <Label>X</Label>,
      renderCell: ([x], i) => (
        <SpreadsheetNumberInput
          value={x}
          ariaLabel={`Point ${i + 1} X`}
          onChange={(value) => handleChange(i, 0, value)}
        />
      ),
    },
    {
      header: <Label>Y</Label>,
      renderCell: ([, y], i) => (
        <SpreadsheetNumberInput
          value={y}
          ariaLabel={`Point ${i + 1} Y`}
          onChange={(value) => handleChange(i, 1, value)}
        />
      ),
    },
    {
      header: null,
      widthClassName: "w-8",
      cellClassName: "py-1 px-2",
      align: "right",
      renderCell: (_row, i) =>
        coordinates.length > 3 ? (
          <SpreadsheetRemoveButton
            ariaLabel={`Remove point ${i + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              removeCoordinate(i);
            }}
          />
        ) : null,
    },
  ];

  return (
    <Section title="Exterior Boundary">
      <SpreadsheetTable
        rows={coordinates}
        columns={columns}
        getRowKey={(_row, i) => i}
        selectedRowIndex={selectedPointIndex}
        onRowClick={(_row, i) => setSelectedPoint(i)}
      />
      <button
        onClick={() => {
          const last = coordinates[coordinates.length - 1];
          addCoordinate([last[0] + 5, last[1]]);
        }}
        className="text-[11px] mt-1 cursor-pointer hover:underline font-medium"
        style={{ color: "var(--color-vsc-accent)" }}
      >
        + Add Point
      </button>
    </Section>
  );
}
