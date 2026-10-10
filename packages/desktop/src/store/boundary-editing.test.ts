import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";
import type { MaterialBoundaryRow } from "./types";

const SQUARE: [number, number][] = [
  [-5, -5],
  [5, -5],
  [5, 5],
  [-5, 5],
  [-5, -5],
];

function setBoundaries(boundaries: MaterialBoundaryRow[]) {
  useAppStore.setState({ materialBoundaries: boundaries });
}

function boundary(id: string) {
  return useAppStore.getState().materialBoundaries.find((b) => b.id === id)!;
}

describe("closed boundary editing", () => {
  beforeEach(() => {
    useAppStore.getState().newProject();
    setBoundaries([
      { id: "lens", coordinates: SQUARE, coordinateExpressions: [] },
    ]);
  });

  it("moving the start vertex keeps the polygon closed", () => {
    useAppStore.getState().updateBoundaryPoint("lens", 0, [-7, -6]);
    const c = boundary("lens").coordinates;
    expect(c[0]).toEqual([-7, -6]);
    expect(c[c.length - 1]).toEqual([-7, -6]);
  });

  it("deleting the start vertex keeps the polygon closed", () => {
    useAppStore.getState().removeBoundaryPoint("lens", 0);
    const c = boundary("lens").coordinates;
    expect(c).toHaveLength(4);
    expect(c[0]).toEqual(c[c.length - 1]);
    expect(c).not.toContainEqual([-5, -5]);
  });

  it("does not shrink a closed boundary below a triangle", () => {
    useAppStore.getState().removeBoundaryPoint("lens", 1);
    expect(boundary("lens").coordinates).toHaveLength(4);
    useAppStore.getState().removeBoundaryPoint("lens", 1);
    expect(boundary("lens").coordinates).toHaveLength(4);
  });
});

describe("moving an exterior vertex", () => {
  it("moves interior boundary and piezometric points that sit on it", () => {
    useAppStore.getState().newProject();
    const exterior: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [10, 10],
      [0, 10],
      [0, 5],
    ];
    useAppStore.setState({
      coordinates: exterior,
      materialBoundaries: [
        {
          id: "layer",
          coordinates: [
            [0, 5],
            [10, 5],
          ],
          coordinateExpressions: [],
        },
      ],
      piezometricLine: {
        ...useAppStore.getState().piezometricLine,
        lines: [
          {
            id: "w",
            name: "W",
            color: "#00f",
            coordinates: [
              [0, 5],
              [10, 3],
            ],
          } as never,
        ],
      },
    });
    useAppStore.getState().setCoordinate(5, [-2, 5]);
    const s = useAppStore.getState();
    expect(s.materialBoundaries[0].coordinates[0]).toEqual([-2, 5]);
    expect(s.materialBoundaries[0].coordinates[1]).toEqual([10, 5]);
    expect(s.piezometricLine.lines[0].coordinates[0]).toEqual([-2, 5]);
  });
});
