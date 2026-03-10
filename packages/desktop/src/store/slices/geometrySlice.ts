import {
  DEFAULT_COORDS,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  PIEZO_COLORS,
  MATERIAL_COLORS,
  createDefaultProjectInfo,
} from "../defaults";
import { nextId } from "../helpers";
import type { SliceCreator } from "../helpers";
import { createDefaultModel } from "../../features/properties/sections/material-forms/model-defaults";
import { computeRegions } from "../../utils/regions";
import { isPointInPolygon } from "@cslope/engine";
import type { GeometrySlice, ModelEntry, PiezoLine } from "../types";

type GeometryState = GeometrySlice & {
  activeModelId: string;
  models: ModelEntry[];
};

const syncActiveModel = (
  state: GeometryState,
  patch: Partial<GeometrySlice>,
) => {
  const modelPatch = {
    orientation: patch.orientation ?? state.orientation,
    projectInfo: patch.projectInfo ?? state.projectInfo,
    coordinates: patch.coordinates ?? state.coordinates,
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

export const createGeometrySlice: SliceCreator<GeometrySlice> = (set, get) => ({
  orientation: "ltr",
  projectInfo: createDefaultProjectInfo(),
  coordinates: DEFAULT_COORDS,
  materials: [{ ...DEFAULT_MATERIAL }],
  materialBoundaries: [],
  regionMaterials: [],
  piezometricLine: { ...DEFAULT_PIEZO_LINE },
  selectedPointIndex: null,
  assigningMaterialId: null,
  selectedRegionKey: null,

  setSelectedPoint: (index) => set({ selectedPointIndex: index }),
  setOrientation: (orientation) => {
    set((s) => syncActiveModel(s, { orientation }));
    get().invalidateAnalysis();
  },
  setAssigningMaterial: (materialId) =>
    set({ assigningMaterialId: materialId }),
  setSelectedRegionKey: (key) => set({ selectedRegionKey: key }),

  setCoordinates: (coords) => {
    set((s) => syncActiveModel(s, { coordinates: coords }));
    get().invalidateAnalysis();
  },
  setCoordinate: (index, coord) => {
    set((s) => {
      const next = [...s.coordinates];
      next[index] = coord;
      return syncActiveModel(s, { coordinates: next });
    });
    get().invalidateAnalysis();
  },
  addCoordinate: (coord) => {
    set((s) => syncActiveModel(s, { coordinates: [...s.coordinates, coord] }));
    get().invalidateAnalysis();
  },
  insertCoordinateAt: (index, coord) => {
    set((s) => {
      const next = [...s.coordinates];
      next.splice(index, 0, coord);
      return syncActiveModel(s, { coordinates: next });
    });
    get().invalidateAnalysis();
  },
  removeCoordinate: (index) => {
    set((s) =>
      syncActiveModel(s, {
        coordinates: s.coordinates.filter((_, i) => i !== index),
      }),
    );
    get().invalidateAnalysis();
  },

  setMaterials: (mats) => {
    set((s) => syncActiveModel(s, { materials: mats }));
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
            name: `Material ${s.materials.length + 1}`,
            color: MATERIAL_COLORS[s.materials.length % MATERIAL_COLORS.length],
            model: createDefaultModel("mohr-coulomb", 20),
          },
        ],
      }),
    );
    get().invalidateAnalysis();
  },
  removeMaterial: (id) => {
    set((s) =>
      syncActiveModel(s, {
        materials: s.materials.filter((m) => m.id !== id),
        regionMaterials: s.regionMaterials.filter((a) => a.materialId !== id),
      }),
    );
    get().invalidateAnalysis();
  },

  addMaterialBoundary: (coordinates) => {
    const id = nextId("bnd");
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: [...s.materialBoundaries, { id, coordinates }],
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
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: s.materialBoundaries.filter((b) => b.id !== id),
      }),
    );
    get().invalidateAnalysis();
  },

  addBoundaryPoint: (boundaryId, coord) => {
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: s.materialBoundaries.map((b) =>
          b.id === boundaryId
            ? { ...b, coordinates: [...b.coordinates, coord] }
            : b,
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
          next[index] = coord;
          return { ...b, coordinates: next };
        }),
      }),
    );
    get().invalidateAnalysis();
  },

  removeBoundaryPoint: (boundaryId, index) => {
    set((s) =>
      syncActiveModel(s, {
        materialBoundaries: s.materialBoundaries.map((b) =>
          b.id === boundaryId
            ? {
                ...b,
                coordinates: b.coordinates.filter((_, i) => i !== index),
              }
            : b,
        ),
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
    // Find the region that contains the clicked point
    const targetRegion = regions.find((r) =>
      isPointInPolygon(point[0], point[1], r.px, r.py),
    );
    // Remove any existing assignments whose point falls inside the same region
    const filtered = targetRegion
      ? s.regionMaterials.filter(
          (a) =>
            !isPointInPolygon(
              a.point[0],
              a.point[1],
              targetRegion.px,
              targetRegion.py,
            ),
        )
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
    get().invalidateAnalysis();
  },

  setActivePiezoLine: (lineId) => {
    set((s) =>
      syncActiveModel(s, {
        piezometricLine: { ...s.piezometricLine, activeLineId: lineId },
      }),
    );
    get().invalidateAnalysis();
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
            return { ...l, coordinates: coords };
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
              ? { ...l, coordinates: [...l.coordinates, coord] }
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
            return { ...l, coordinates: coords };
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
