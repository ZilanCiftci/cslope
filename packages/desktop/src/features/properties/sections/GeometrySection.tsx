import { useAppStore } from "../../../store/app-store";
import { Section } from "../../../components/ui/Section";
import { Label } from "../../../components/ui/Label";
import {
  SpreadsheetTable,
  type SpreadsheetColumn,
} from "../../../components/ui/SpreadsheetTable";
import { SpreadsheetExpressionInput } from "../../../components/ui/SpreadsheetExpressionInput";
import { resolveParameters } from "../../../utils/expression";

interface GeometrySectionProps {
  plain?: boolean;
}

export function GeometrySection({ plain = false }: GeometrySectionProps) {
  const coordinates = useAppStore((s) => s.coordinates);
  const coordinateExpressions = useAppStore((s) => s.coordinateExpressions);
  const parameters = useAppStore((s) => s.parameters);
  const setCoordinate = useAppStore((s) => s.setCoordinate);
  const setCoordinateExpression = useAppStore((s) => s.setCoordinateExpression);
  const removeCoordinate = useAppStore((s) => s.removeCoordinate);
  const addCoordinate = useAppStore((s) => s.addCoordinate);
  const selectedPointIndex = useAppStore((s) => s.selectedPointIndex);
  const setSelectedPoint = useAppStore((s) => s.setSelectedPoint);

  const parameterValues = resolveParameters(parameters).resolved;

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
      header: <Label>x (m)</Label>,
      renderCell: ([x], i) => (
        <SpreadsheetExpressionInput
          value={x}
          expression={coordinateExpressions[i]?.x}
          vars={parameterValues}
          ariaLabel={`Point ${i + 1} X`}
          onResolvedValue={(nextX) => {
            const c: [number, number] = [...coordinates[i]];
            c[0] = nextX;
            setCoordinate(i, c);
          }}
          onExpressionChange={(expr) => setCoordinateExpression(i, "x", expr)}
        />
      ),
    },
    {
      header: <Label>y (m)</Label>,
      renderCell: ([, y], i) => (
        <SpreadsheetExpressionInput
          value={y}
          expression={coordinateExpressions[i]?.y}
          vars={parameterValues}
          ariaLabel={`Point ${i + 1} Y`}
          onResolvedValue={(nextY) => {
            const c: [number, number] = [...coordinates[i]];
            c[1] = nextY;
            setCoordinate(i, c);
          }}
          onExpressionChange={(expr) => setCoordinateExpression(i, "y", expr)}
        />
      ),
    },
  ];

  const content = (
    <>
      <SpreadsheetTable
        rows={coordinates}
        columns={columns}
        getRowKey={(_row, i) => i}
        selectedRowIndex={selectedPointIndex}
        onRowClick={(_row, i) => setSelectedPoint(i)}
        onRemove={(_row, i) => removeCoordinate(i)}
        removeLabel={(_row, i) => `Remove point ${i + 1}`}
        // The exterior keeps at least three points.
        canRemove={() => coordinates.length > 3}
        addActions={[
          {
            label: "+ Add point",
            onClick: () => {
              const last = coordinates[coordinates.length - 1];
              addCoordinate([last[0] + 5, last[1]]);
            },
          },
        ]}
      />
    </>
  );

  if (plain) {
    return <div className="space-y-2.5">{content}</div>;
  }

  return <Section title="Exterior boundary">{content}</Section>;
}
