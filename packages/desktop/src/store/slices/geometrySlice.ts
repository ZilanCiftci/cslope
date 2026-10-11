import {
  DEFAULT_COORDS,
  DEFAULT_COORDINATE_EXPRESSIONS,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  PIEZO_COLORS,
  MATERIAL_COLORS,
  createDefaultProjectInfo,
} from "../defaults";
import { nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import { createDefaultModel } from "../../features/properties/sections/material-forms/model-defaults";
import { computeRegions, isClosedBoundary } from "../../utils/regions";
import { isPointInPolygon } from "@cslope/engine";
import type { GeometrySlice, ModelEntry, PiezoLine } from "../types";

type GeometryState = GeometrySlice & {
  activeModelId: string;
  models: ModelEntry[];
};

/** "Material N" with N one higher than any existing "Material <n>". */
function nextMaterialName(materials: { name: string }[]): string {
  let max = materials.length;
  for (const m of materials) {
    const match = /^Material (\d+)$/.exec(m.name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Material ${max + 1}`;
}

const syncActiveModel = (
  state: GeometryState,
  patch: Partial<GeometrySlice>,
) => {
  const modelPatch = {
    orientation: patch.orientation ?? state.orientation,
    projectInfo: patch.projectInfo ?? state.projectInfo,
    coordinates: patch.coordinates ?? state.coordinates,
    coordinateExpressions:
      patch.coordinateExpressions ?? state.coordinateExpressions,
    materials: patch.materials ?? state.materials,
    materialBoundaries: patch.materialBoundaries ?? state.materialBoundaries,
    regionMaterials: patch.regionMaterials ?? state.regionMaterials,
    piezometricLine: patch.piezometricLine ?? state.piezometricLine,
  };
  return {
    ...patch,
    models: state.models.map((m) =>
      m.id === state.activeModelId ? { ...m, ...modelPatch } : m,
    ),
  };
};

const alignCoordinateExpressions = (
  coordinates: [number, number][],
  existing: GeometrySlice["coordinateExpressions"],
): GeometrySlice["coordinateExpressions"] =>
  coordinates.map((_, i) => existing[i] ?? {});

export const createGeometrySlice: SliceCreator<GeometrySlice> = (set, get) => ({
  orientation: "ltr",
  projectInfo: createDefaultProjectInfo(),
  coordinates: DEFAULT_COORDS,
  coordinateExpressions: [...DEFAULT_COORDINATE_EXPRESSIONS],
  materials: [{ ...DEFAULT_MATERIAL }],
  materialBoundaries: [],
  regionMaterials: [],
  piezometricLine: { ...DEFAULT_PIEZO_LINE },
  selectedPointIndex: null,
  selectedMaterialBoundaryId: null,
  interiorBoundariesDialogOpen: false,
  assigningMaterialId: null,
  selectedRegionKey: null,

  setSelectedPoint: (index) => set({ selectedPointIndex: index }),
  setSelectedMaterialBoundary: (boundaryId) =>
    set({ selectedMaterialBoundaryId: boundaryId }),
  setInteriorBoundariesDialogOpen: (open) =>
    set({ interiorBoundariesDialogOpen: open }),
  setOrientation: (orientation) => {
    set((s) => syncActiveModel(s, { orientation }));
    get().invalidateAnalysis();
  },
  setAssigningMaterial: (materialId) =>
    set({ assigningMaterialId: materialId }),
  setSelectedRegionKey: (key) => set({ selectedRegionKey: key }),

  setCoordinates: (coords) => {
    set((s) =>
      syncActiveModel(s, {
        coordinates: coords,
        coordinateExpressions: alignCoordinateExpressions(
          coords,
          s.coordinateExpressions,
        ),
      }),
    );
    get().invalidateAnalysis();
  },
  setCoordinate: (index, coord) => {
    set((s) => {
      const next = [...s.coordinates];
      const old = next[index];
      next[index] = coord;

      // Interior boundary and piezometric points that sit on the moved
      // exterior vertex are the same vertex: move them along, or the
      // boundary no longer reaches the exterior and its region is lost.
      // A point shared with another exterior vertex at the same spot (e.g.
      // an intermediate value while typing landed on a neighbour) belongs
      // to that vertex and stays put.
      const sharedWithOther =
        !!old &&
        s.coordinates.some(
          (c, i) =>
            i !== index &&
            Math.abs(c[0] - old[0]) < 1e-9 &&
            Math.abs(c[1] - old[1]) < 1e-9,
        );
      const follow = (pts: [number, number][]): [number, number][] => {
        if (!old || sharedWithOther) return pts;
        let moved = false;
        const out = pts.map((p) => {
          if (Math.abs(p[0] - old[0]) < 1e-9 && Math.abs(p[1] - old[1]) < 1e-9) {
            moved = true;
            return coord;
          }
          return p;
        });
        return moved ? out : pts;
      };
      const materialBoundaries = s.materialBoundaries.map((b) => {
        const coordinates = follow(b.coordinates);
        return coordinates === b.coordinates ? b : { ...b, coordinates };
      });
      const piezometricLine = {
        ...s.piezometricLine,
        lines: s.piezometricLine.lines.map((l) => {
          const coordinates = follow(l.coordinates);
          return coordinates === l.coordinates ? l : { ...l, coordinates };
        }),
      };

      return syncActiveModel(s, {
        coordinates: next,
        coordinateExpressions: alignCoordinateExpressions(
          next,
          s.coordinateExpressions,
        ),
        materialBoundaries,
        piezometricLine,
      });
    });
    get().invalidateAnalysis();
  },
  setCoordinateExpression: (index, axis, expr) => {
    set((s) => {
      const next = alignCoordinateExpressions(
        s.coordinates,
        s.coordinateExpressions,
      );
      const current = { ...(next[index] ?? {}) };
      if (!expr || expr.trim().length === 0) {
        delete current[axis];
      } else {
        current[axis] = expr;
      }
      next[index] = current;
      return syncActiveModel(s, { coordinateExpressions: next });
    });
    get().invalidateAnalysis();
  },
  addCoordinate: (coord) => {
    set((s) =>
      syncActiveModel(s, {
        coordinates: [...s.coordinates, coord],
        coordinateExpressions: [...s.coordinateExpressions, {}],
      }),
    );
    get().invalidateAnalysis();
  },
  insertCoordinateAt: (index, coord) => {
    set((s) => {
      const next = [...s.coordinates];
      next.splice(index, 0, coord);
      const nextExpr = [...s.coordinateExpressions];
      nextExpr.splice(index, 0, {});
      return syncActiveModel(s, {
        coordinates: next,
        coordinateExpressions: nextExpr,
      });
    });
    get().invalidateAnalysis();
  },
  removeCoordinate: (index) => {
    set((s) =>
      syncActiveModel(s, {
        coordinates: s.coordinates.filter((_, i) => i !== index),
        coordinateExpressions: s.coordinateExpressions.filter(
          (_, i) => i !== index,
        ),
      }),
    );
    get().invalidateAnalysis();
  },

  setMaterials: (mats) => {
    set((s) => syncActiveModel(s, { materials: mats }));
    get().invalidateAnalysis();
  },
  setMaterialBoundaries: (boundaries) => {
    set((s) => {
      const selectedExists = boundaries.some(
        (b) => b.id === s.selectedMaterialBoundaryId,
      );
      return {
        ...syncActiveModel(s, { materialBoundaries: boundaries }),
        selectedMaterialBoundaryId: selectedExists
          ? s.selectedMaterialBoundaryId
          : null,
      };
    });
    get().invalidateAnalysis();
  },
  setRegionMaterials: (assignments) => {
    set((s) => syncActiveModel(s, { regionMaterials: assignments }));
    get().invalidateAnalysis();
  },
  updateMaterial: (id, patch) => {
    set((s) =>
      syncActiveModel(s, {
        materials: s.materials.map((m) =>
          m.id === id ? { ...m, ...patch } : m,
        ),
      }),
    );
    get().invalidateAnalysis();
  },
  addMaterial: () => {
    set((s) =>
      syncActiveModel(s, {
        materials: [
          ...s.materials,
          {
            id: nextId("mat"),
            name: nextMaterialName(s.materials),
            color: MATERIAL_COLORS[s.materials.length % MATERIAL_COLORS.length],
            modelExpressions: {},
            model: createDefaultModel("mohr-coulomb", 20),
          },
        ],
      }),
    );
    get().invalidateAnalysis();
  },
  removeMaterial: (id) => {
    // A model always keeps at least one material (the default region).
    if (get().materials.length <= 1) return;
    set((s) => {
      const materialAssignment = { ...s.piezometricLine.materialAssignment };
      delete materialAssignment[id];
      return {
        ...syncActiveModel(s, {
          materials: s.materials.filter((m) => m.id !== id),
          regionMaterials: s.regionMaterials.filter((a) => a.materialId !== id),
          piezometricLine: { ...s.piezometricLine, materialAssignment },
        }),
        assigningMaterialId:
          s.assigningMaterialId === id ? null : s.assigningMaterialId,
      };
    });
    get().invalidateAnalysis();
  },

  addMaterialBoundary: (coordinates) => {
    const id = nextId("bnd");
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: [
          ...s.materialBoundaries,
          {
            id,
            coordinates,
            coordinateExpressions: coordinates.map(() => ({})),
          },
        ],
      }),
    );
    get().invalidateAnalysis();
  },

  updateMaterialBoundary: (id, patch) => {
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: s.materialBoundaries.map((b) =>
          b.id === id ? { ...b, ...patch } : b,
        ),
      }),
    );
    get().invalidateAnalysis();
  },

  removeMaterialBoundary: (id) => {
    set((s) => {
      const nextBoundaries = s.materialBoundaries.filter((b) => b.id !== id);
      return {
        ...syncActiveModel(s, {
          materialBoundaries: nextBoundaries,
        }),
        selectedMaterialBoundaryId:
          s.selectedMaterialBoundaryId === id
            ? (nextBoundaries[0]?.id ?? null)
            : s.selectedMaterialBoundaryId,
      };
    });
    get().invalidateAnalysis();
  },

  addBoundaryPoint: (boundaryId, coord) => {
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: s.materialBoundaries.map((b) =>
          b.id !== boundaryId
            ? b
            : isClosedBoundary(b.coordinates)
              ? {
                  // Keep a closed boundary closed: insert before the
                  // closing vertex instead of appending after it.
                  ...b,
                  coordinates: [
                    ...b.coordinates.slice(0, -1),
                    coord,
                    b.coordinates[b.coordinates.length - 1],
                  ],
                  coordinateExpressions: (() => {
                    const e = b.coordinates.map(
                      (_, i) => b.coordinateExpressions?.[i] ?? {},
                    );
                    return [...e.slice(0, -1), {}, e[e.length - 1]];
                  })(),
                }
              : {
                  ...b,
                  coordinates: [...b.coordinates, coord],
                  coordinateExpressions: [
                    ...(b.coordinateExpressions ?? []),
                    {},
                  ],
                },
        ),
      }),
    );
    get().invalidateAnalysis();
  },

  insertBoundaryPointAt: (boundaryId, index, coord) => {
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: s.materialBoundaries.map((b) =>
          b.id === boundaryId
            ? {
                ...b,
                coordinates: [
                  ...b.coordinates.slice(0, index),
                  coord,
                  ...b.coordinates.slice(index),
                ],
                coordinateExpressions: [
                  ...(b.coordinateExpressions ?? []).slice(0, index),
                  {},
                  ...(b.coordinateExpressions ?? []).slice(index),
                ],
              }
            : b,
        ),
      }),
    );
    get().invalidateAnalysis();
  },

  updateBoundaryPoint: (boundaryId, index, coord) => {
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: s.materialBoundaries.map((b) => {
          if (b.id !== boundaryId) return b;
          const next = [...b.coordinates];
          const last = next.length - 1;
          next[index] = coord;
          // The first and last points of a closed boundary are the same
          // vertex: move both or the polygon opens.
          if (isClosedBoundary(b.coordinates) && (index === 0 || index === last)) {
            next[0] = coord;
            next[last] = coord;
          }
          return {
            ...b,
            coordinates: next,
            coordinateExpressions: next.map(
              (_, i) => b.coordinateExpressions?.[i] ?? {},
            ),
          };
        }),
      }),
    );
    get().invalidateAnalysis();
  },

  removeBoundaryPoint: (boundaryId, index) => {
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: s.materialBoundaries.map((b) => {
          if (b.id !== boundaryId) return b;
          const coords = b.coordinates;
          const exprs = coords.map((_, i) => b.coordinateExpressions?.[i] ?? {});
          const last = coords.length - 1;
          if (!isClosedBoundary(coords)) {
            return {
              ...b,
              coordinates: coords.filter((_, i) => i !== index),
              coordinateExpressions: exprs.filter((_, i) => i !== index),
            };
          }
          // Closed: keep at least a triangle, and treat the shared
          // first/last vertex as one point so the polygon stays closed.
          if (coords.length <= 4) return b;
          const ring = coords.slice(0, last);
          const ringExprs = exprs.slice(0, last);
          const drop = index === last ? 0 : index;
          const keptCoords = ring.filter((_, i) => i !== drop);
          const keptExprs = ringExprs.filter((_, i) => i !== drop);
          return {
            ...b,
            coordinates: [...keptCoords, keptCoords[0]],
            coordinateExpressions: [...keptExprs, keptExprs[0]],
          };
        }),
      }),
    );
    get().invalidateAnalysis();
  },

  setRegionMaterial: (point, materialId) => {
    const s = get();
    const defaultMatId = s.materials[0]?.id ?? "";
    const regions = computeRegions(
      s.coordinates,
      s.materialBoundaries,
      s.regionMaterials,
      defaultMatId,
    );
    // Holes belong to the regions inside them, not to the ring around them.
    const inRegion = (p: [number, number], r: (typeof regions)[number]) =>
      isPointInPolygon(p[0], p[1], r.px, r.py) &&
      !(r.holes ?? []).some((h) => isPointInPolygon(p[0], p[1], h.px, h.py));
    // Find the region that contains the clicked point
    const targetRegion = regions.find((r) => inRegion(point, r));
    // Remove any existing assignments whose point falls inside the same region
    const filtered = targetRegion
      ? s.regionMaterials.filter((a) => !inRegion(a.point, targetRegion))
      : s.regionMaterials;
    set((st) =>
      syncActiveModel(st, {
        regionMaterials: [...filtered, { point, materialId }],
      }),
    );
    get().invalidateAnalysis();
  },

  setPiezometricLine: (pl) => {
    set((s) => {
      const next = { ...s.piezometricLine, ...pl };
      return syncActiveModel(s, {
        piezometricLine: {
          ...next,
          enabled: next.lines.length > 0,
        },
      });
    });
    get().invalidateAnalysis();
  },

  addPiezoLine: (coords) => {
    const s = get();
    const idx = s.piezometricLine.lines.length;
    const color = PIEZO_COLORS[idx % PIEZO_COLORS.length];
    const id = nextId("piezo");
    const line: PiezoLine = {
      id,
      name: `Line ${idx + 1}`,
      color,
      coordinates: coords ?? [],
      coordinateExpressions: (coords ?? []).map(() => ({})),
    };
    set((state) =>
      syncActiveModel(state, {
        piezometricLine: {
          ...s.piezometricLine,
          enabled: true,
          lines: [...s.piezometricLine.lines, line],
          activeLineId: id,
        },
      }),
    );
    get().invalidateAnalysis();
  },

  removePiezoLine: (lineId) => {
    set((s) => {
      const lines = s.piezometricLine.lines.filter((l) => l.id !== lineId);
      const activeLineId =
        s.piezometricLine.activeLineId === lineId
          ? (lines[0]?.id ?? null)
          : s.piezometricLine.activeLineId;
      const materialAssignment = { ...s.piezometricLine.materialAssignment };
      for (const [matId, plId] of Object.entries(materialAssignment)) {
        if (plId === lineId) delete materialAssignment[matId];
      }
      return syncActiveModel(s, {
        piezometricLine: {
          ...s.piezometricLine,
          enabled: lines.length > 0,
          lines,
          activeLineId,
          materialAssignment,
        },
      });
    });
    get().invalidateAnalysis();
  },

  renamePiezoLine: (lineId, name) => {
    set((s) =>
      syncActiveModel(s, {
        piezometricLine: {
          ...s.piezometricLine,
          lines: s.piezometricLine.lines.map((l) =>
            l.id === lineId ? { ...l, name } : l,
          ),
        },
      }),
    );
  },

  setActivePiezoLine: (lineId) => {
    set((s) =>
      syncActiveModel(s, {
        piezometricLine: { ...s.piezometricLine, activeLineId: lineId },
      }),
    );
  },

  setPiezoCoordinate: (index, coord) => {
    set((s) => {
      const activeId = s.piezometricLine.activeLineId;
      if (!activeId) return {};
      return syncActiveModel(s, {
        piezometricLine: {
          ...s.piezometricLine,
          lines: s.piezometricLine.lines.map((l) => {
            if (l.id !== activeId) return l;
            const coords = [...l.coordinates];
            coords[index] = coord;
            return {
              ...l,
              coordinates: coords,
              coordinateExpressions: coords.map(
                (_, i) => l.coordinateExpressions?.[i] ?? {},
              ),
            };
          }),
        },
      });
    });
    get().invalidateAnalysis();
  },

  addPiezoPoint: (coord) => {
    set((s) => {
      const activeId = s.piezometricLine.activeLineId;
      if (!activeId) return {};
      return syncActiveModel(s, {
        piezometricLine: {
          ...s.piezometricLine,
          lines: s.piezometricLine.lines.map((l) =>
            l.id === activeId
              ? {
                  ...l,
                  coordinates: [...l.coordinates, coord],
                  coordinateExpressions: [
                    ...(l.coordinateExpressions ?? []),
                    {},
                  ],
                }
              : l,
          ),
        },
      });
    });
    get().invalidateAnalysis();
  },

  insertPiezoPointAt: (index, coord) => {
    set((s) => {
      const activeId = s.piezometricLine.activeLineId;
      if (!activeId) return {};
      return syncActiveModel(s, {
        piezometricLine: {
          ...s.piezometricLine,
          lines: s.piezometricLine.lines.map((l) => {
            if (l.id !== activeId) return l;
            const coords = [...l.coordinates];
            coords.splice(index, 0, coord);
            const coordinateExpressions = [...(l.coordinateExpressions ?? [])];
            coordinateExpressions.splice(index, 0, {});
            return { ...l, coordinates: coords, coordinateExpressions };
          }),
        },
      });
    });
    get().invalidateAnalysis();
  },

  removePiezoPoint: (index) => {
    set((s) => {
      const activeId = s.piezometricLine.activeLineId;
      if (!activeId) return {};
      return syncActiveModel(s, {
        piezometricLine: {
          ...s.piezometricLine,
          lines: s.piezometricLine.lines.map((l) =>
            l.id === activeId
              ? {
                  ...l,
                  coordinates: l.coordinates.filter((_, i) => i !== index),
                  coordinateExpressions: (l.coordinateExpressions ?? []).filter(
                    (_, i) => i !== index,
                  ),
                }
              : l,
          ),
        },
      });
    });
    get().invalidateAnalysis();
  },

  setPiezoMaterialAssignment: (materialId, piezoLineId) => {
    set((s) =>
      syncActiveModel(s, {
        piezometricLine: {
          ...s.piezometricLine,
          materialAssignment: {
            ...s.piezometricLine.materialAssignment,
            [materialId]: piezoLineId,
          },
        },
      }),
    );
    get().invalidateAnalysis();
  },

  setPiezoFreeWater: (enabled) => {
    set((s) =>
      syncActiveModel(s, {
        piezometricLine: { ...s.piezometricLine, freeWater: enabled },
      }),
    );
    get().invalidateAnalysis();
  },

  enablePiezoWithDefault: () => {
    const s = get();
    if (s.piezometricLine.lines.length > 0) return;

    const coords = s.coordinates;
    if (coords.length < 3) {
      set((state) =>
        syncActiveModel(state, {
          piezometricLine: { ...s.piezometricLine, enabled: true },
        }),
      );
      get().invalidateAnalysis();
      return;
    }

    const allX = coords.map((c) => c[0]);
    const allY = coords.map((c) => c[1]);
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const midY = (Math.min(...allY) + Math.max(...allY)) / 2;
    const lineId = nextId("piezo");
    const defaultLine: PiezoLine = {
      id: lineId,
      name: "Line 1",
      color: PIEZO_COLORS[0],
      coordinates: [
        [minX, midY],
        [maxX, midY],
      ],
      coordinateExpressions: [{}, {}],
    };
    set((state) =>
      syncActiveModel(state, {
        piezometricLine: {
          enabled: true,
          lines: [defaultLine],
          activeLineId: lineId,
          materialAssignment: {},
        },
      }),
    );
    get().invalidateAnalysis();
  },
});
