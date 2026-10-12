import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";

const store = () => useAppStore.getState();
const piezo = () => store().piezometricLine;
const active = () => store().models.find((m) => m.id === store().activeModelId)!;

beforeEach(() => {
  store().newProject();
});

describe("piezometric lines", () => {
  it("point edits do nothing without an active line", () => {
    store().addPiezoLine();
    store().setActivePiezoLine(null);
    const before = piezo();
    store().addPiezoPoint([1, 1]);
    store().setPiezoCoordinate(0, [2, 2]);
    store().insertPiezoPointAt(0, [3, 3]);
    store().removePiezoPoint(0);
    expect(piezo()).toBe(before);
  });

  it("edits the active line's points and keeps expressions aligned", () => {
    store().addPiezoLine();
    store().addPiezoLine();
    const [first, second] = piezo().lines;
    store().setActivePiezoLine(second.id);
    const n = second.coordinates.length;
    store().addPiezoPoint([50, 1]);
    store().insertPiezoPointAt(0, [-5, 2]);
    let line = piezo().lines[1];
    expect(line.coordinates[0]).toEqual([-5, 2]);
    expect(line.coordinates.at(-1)).toEqual([50, 1]);
    expect(line.coordinates).toHaveLength(n + 2);
    expect(line.coordinateExpressions).toHaveLength(n + 2);

    store().setPiezoCoordinate(1, [7, 7]);
    line = piezo().lines[1];
    expect(line.coordinates[1]).toEqual([7, 7]);
    expect(line.coordinateExpressions).toHaveLength(line.coordinates.length);

    store().removePiezoPoint(0);
    expect(piezo().lines[1].coordinates[0]).toEqual([7, 7]);
    expect(piezo().lines[1].coordinateExpressions).toHaveLength(n + 1);
    // The other line is untouched and the model entry follows.
    expect(piezo().lines[0]).toEqual(first);
    expect(active().piezometricLine).toEqual(piezo());
  });

  it("removing a line moves the selection, drops its assignments and main-line role", () => {
    store().addPiezoLine();
    store().addPiezoLine();
    const [a, b] = piezo().lines;
    const matId = store().materials[0].id;
    store().setPiezoMaterialAssignment(matId, b.id);
    store().setPiezoMainLine(b.id);
    store().setActivePiezoLine(b.id);

    store().removePiezoLine(b.id);
    expect(piezo().lines.map((l) => l.id)).toEqual([a.id]);
    expect(piezo().activeLineId).toBe(a.id);
    expect(piezo().materialAssignment).toEqual({});
    expect(piezo().mainLineId).toBeUndefined();
    expect(piezo().enabled).toBe(true);

    store().removePiezoLine(a.id);
    expect(piezo().lines).toEqual([]);
    expect(piezo().activeLineId).toBeNull();
    expect(piezo().enabled).toBe(false);
  });

  it("removing another line keeps the selection and the main line", () => {
    store().addPiezoLine();
    store().addPiezoLine();
    const [a, b] = piezo().lines;
    store().setPiezoMainLine(a.id);
    store().setActivePiezoLine(a.id);
    store().removePiezoLine(b.id);
    expect(piezo().activeLineId).toBe(a.id);
    expect(piezo().mainLineId).toBe(a.id);
  });

  it("free water can be switched off and on", () => {
    store().setPiezoFreeWater(false);
    expect(piezo().freeWater).toBe(false);
    expect(active().piezometricLine.freeWater).toBe(false);
    store().setPiezoFreeWater(true);
    expect(piezo().freeWater).toBe(true);
  });

  it("a default water line needs a slope; without one it only enables water", () => {
    useAppStore.setState({ coordinates: [[0, 0], [1, 1]] });
    store().enablePiezoWithDefault();
    expect(piezo().enabled).toBe(true);
    expect(piezo().lines).toEqual([]);
  });

  it("does not add a default line when lines exist", () => {
    store().addPiezoLine();
    const before = piezo();
    store().enablePiezoWithDefault();
    expect(piezo()).toBe(before);
  });
});

describe("boundary points", () => {
  const loop: [number, number][] = [[2, 2], [6, 2], [6, 5], [2, 5], [2, 2]];

  function withBoundary(coordinates: [number, number][]) {
    useAppStore.setState({
      materialBoundaries: [{ id: "b", coordinates, coordinateExpressions: [] }],
    });
  }
  const boundary = () => store().materialBoundaries[0];

  it("moving the first or last point of a closed boundary moves both", () => {
    withBoundary(loop);
    store().updateBoundaryPoint("b", 0, [1, 1]);
    expect(boundary().coordinates[0]).toEqual([1, 1]);
    expect(boundary().coordinates[4]).toEqual([1, 1]);
    store().updateBoundaryPoint("b", 4, [0, 1]);
    expect(boundary().coordinates[0]).toEqual([0, 1]);
    expect(boundary().coordinateExpressions).toHaveLength(5);
    // A middle point moves alone.
    store().updateBoundaryPoint("b", 2, [7, 6]);
    expect(boundary().coordinates).toEqual([[0, 1], [6, 2], [7, 6], [2, 5], [0, 1]]);
  });

  it("other boundaries are not touched", () => {
    useAppStore.setState({
      materialBoundaries: [
        { id: "b", coordinates: loop },
        { id: "c", coordinates: [[0, 1], [9, 1]] },
      ],
    });
    const other = store().materialBoundaries[1];
    store().updateBoundaryPoint("b", 1, [6, 3]);
    store().removeBoundaryPoint("b", 1);
    expect(store().materialBoundaries[1]).toBe(other);
  });

  it("removing a point of a closed boundary keeps it closed", () => {
    withBoundary(loop);
    store().removeBoundaryPoint("b", 1);
    expect(boundary().coordinates).toEqual([[2, 2], [6, 5], [2, 5], [2, 2]]);
    expect(boundary().coordinateExpressions).toHaveLength(4);
  });

  it("removing the shared start/end vertex re-closes on the next point", () => {
    withBoundary(loop);
    store().removeBoundaryPoint("b", 4);
    expect(boundary().coordinates).toEqual([[6, 2], [6, 5], [2, 5], [6, 2]]);
  });

  it("a closed triangle keeps all its points", () => {
    const tri: [number, number][] = [[2, 2], [6, 2], [6, 5], [2, 2]];
    withBoundary(tri);
    store().removeBoundaryPoint("b", 1);
    expect(boundary().coordinates).toEqual(tri);
  });

  it("removing a point of an open boundary drops just that point", () => {
    withBoundary([[0, 1], [5, 2], [9, 1]]);
    store().removeBoundaryPoint("b", 1);
    expect(boundary().coordinates).toEqual([[0, 1], [9, 1]]);
    expect(boundary().coordinateExpressions).toEqual([{}, {}]);
  });
});
