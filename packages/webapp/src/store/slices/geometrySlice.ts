import {
  DEFAULT_COORDS,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  PIEZO_COLORS,
  MATERIAL_COLORS,
  DEFAULT_PROJECT_INFO,
} from "../defaults";
import { nextId, RUN_RESET } from "../helpers";
import type { SliceCreator } from "../helpers";
import type { GeometrySlice, PiezoLine } from "../types";

export const createGeometrySlice: SliceCreator<GeometrySlice> = (set, get) => ({
  orientation: "ltr",
  projectInfo: { ...DEFAULT_PROJECT_INFO },
  coordinates: DEFAULT_COORDS,
  materials: [{ ...DEFAULT_MATERIAL }],
  materialBoundaries: [],
  regionMaterials: {},
  piezometricLine: { ...DEFAULT_PIEZO_LINE },
  selectedPointIndex: null,
  assigningMaterialId: null,
  selectedRegionKey: null,

  setSelectedPoint: (index) => set({ selectedPointIndex: index }),
  setOrientation: (orientation) => set({ orientation, ...RUN_RESET }),
  setAssigningMaterial: (materialId) =>
    set({ assigningMaterialId: materialId }),
  setSelectedRegionKey: (key) => set({ selectedRegionKey: key }),

  setCoordinates: (coords) => set({ coordinates: coords, ...RUN_RESET }),
  setCoordinate: (index, coord) =>
    set((s) => {
      const next = [...s.coordinates];
      next[index] = coord;
      return { coordinates: next, ...RUN_RESET };
    }),
  addCoordinate: (coord) =>
    set((s) => ({ coordinates: [...s.coordinates, coord], ...RUN_RESET })),
  insertCoordinateAt: (index, coord) =>
    set((s) => {
      const next = [...s.coordinates];
      next.splice(index, 0, coord);
      return { coordinates: next, ...RUN_RESET };
    }),
  removeCoordinate: (index) =>
    set((s) => ({
      coordinates: s.coordinates.filter((_, i) => i !== index),
      ...RUN_RESET,
    })),

  setMaterials: (mats) => set({ materials: mats, ...RUN_RESET }),
  updateMaterial: (id, patch) =>
    set((s) => ({
      materials: s.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      ...RUN_RESET,
    })),
  addMaterial: () =>
    set((s) => ({
      materials: [
        ...s.materials,
        {
          id: nextId("mat"),
          name: `Material ${s.materials.length + 1}`,
          unitWeight: 20,
          frictionAngle: 35,
          cohesion: 2,
          color: MATERIAL_COLORS[s.materials.length % MATERIAL_COLORS.length],
        },
      ],
      ...RUN_RESET,
    })),
  removeMaterial: (id) =>
    set((s) => ({
      materials: s.materials.filter((m) => m.id !== id),
      regionMaterials: Object.fromEntries(
        Object.entries(s.regionMaterials).filter(([, matId]) => matId !== id),
      ),
      ...RUN_RESET,
    })),

  addMaterialBoundary: (coordinates) => {
    const id = nextId("bnd");
    set((s) => ({
      materialBoundaries: [...s.materialBoundaries, { id, coordinates }],
      regionMaterials: {
        ...s.regionMaterials,
        [`below-${id}`]: s.materials[0]?.id ?? "",
      },
      ...RUN_RESET,
    }));
  },

  updateMaterialBoundary: (id, patch) =>
    set((s) => ({
      materialBoundaries: s.materialBoundaries.map((b) =>
        b.id === id ? { ...b, ...patch } : b,
      ),
      ...RUN_RESET,
    })),

  removeMaterialBoundary: (id) =>
    set((s) => {
      const rest = { ...s.regionMaterials };
      delete rest[`below-${id}`];
      return {
        materialBoundaries: s.materialBoundaries.filter((b) => b.id !== id),
        regionMaterials: rest,
        ...RUN_RESET,
      };
    }),

  addBoundaryPoint: (boundaryId, coord) =>
    set((s) => ({
      materialBoundaries: s.materialBoundaries.map((b) =>
        b.id === boundaryId
          ? { ...b, coordinates: [...b.coordinates, coord] }
          : b,
      ),
      ...RUN_RESET,
    })),

  insertBoundaryPointAt: (boundaryId, index, coord) =>
    set((s) => ({
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
      ...RUN_RESET,
    })),

  updateBoundaryPoint: (boundaryId, index, coord) =>
    set((s) => ({
      materialBoundaries: s.materialBoundaries.map((b) => {
        if (b.id !== boundaryId) return b;
        const next = [...b.coordinates];
        next[index] = coord;
        return { ...b, coordinates: next };
      }),
      ...RUN_RESET,
    })),

  removeBoundaryPoint: (boundaryId, index) =>
    set((s) => ({
      materialBoundaries: s.materialBoundaries.map((b) =>
        b.id === boundaryId
          ? { ...b, coordinates: b.coordinates.filter((_, i) => i !== index) }
          : b,
      ),
      ...RUN_RESET,
    })),

  setRegionMaterial: (regionKey, materialId) =>
    set((s) => ({
      regionMaterials: { ...s.regionMaterials, [regionKey]: materialId },
      ...RUN_RESET,
    })),

  setPiezometricLine: (pl) =>
    set((s) => {
      const next = { ...s.piezometricLine, ...pl };
      return {
        piezometricLine: {
          ...next,
          enabled: next.lines.length > 0,
        },
        ...RUN_RESET,
      };
    }),

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
    set({
      piezometricLine: {
        ...s.piezometricLine,
        enabled: true,
        lines: [...s.piezometricLine.lines, line],
        activeLineId: id,
      },
      ...RUN_RESET,
    });
  },

  removePiezoLine: (lineId) =>
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
      return {
        piezometricLine: {
          ...s.piezometricLine,
          enabled: lines.length > 0,
          lines,
          activeLineId,
          materialAssignment,
        },
        ...RUN_RESET,
      };
    }),

  renamePiezoLine: (lineId, name) =>
    set((s) => ({
      piezometricLine: {
        ...s.piezometricLine,
        lines: s.piezometricLine.lines.map((l) =>
          l.id === lineId ? { ...l, name } : l,
        ),
      },
      ...RUN_RESET,
    })),

  setActivePiezoLine: (lineId) =>
    set((s) => ({
      piezometricLine: { ...s.piezometricLine, activeLineId: lineId },
      ...RUN_RESET,
    })),

  setPiezoCoordinate: (index, coord) =>
    set((s) => {
      const activeId = s.piezometricLine.activeLineId;
      if (!activeId) return {};
      return {
        piezometricLine: {
          ...s.piezometricLine,
          lines: s.piezometricLine.lines.map((l) => {
            if (l.id !== activeId) return l;
            const coords = [...l.coordinates];
            coords[index] = coord;
            return { ...l, coordinates: coords };
          }),
        },
        ...RUN_RESET,
      };
    }),

  addPiezoPoint: (coord) =>
    set((s) => {
      const activeId = s.piezometricLine.activeLineId;
      if (!activeId) return {};
      return {
        piezometricLine: {
          ...s.piezometricLine,
          lines: s.piezometricLine.lines.map((l) =>
            l.id === activeId
              ? { ...l, coordinates: [...l.coordinates, coord] }
              : l,
          ),
        },
        ...RUN_RESET,
      };
    }),

  insertPiezoPointAt: (index, coord) =>
    set((s) => {
      const activeId = s.piezometricLine.activeLineId;
      if (!activeId) return {};
      return {
        piezometricLine: {
          ...s.piezometricLine,
          lines: s.piezometricLine.lines.map((l) => {
            if (l.id !== activeId) return l;
            const coords = [...l.coordinates];
            coords.splice(index, 0, coord);
            return { ...l, coordinates: coords };
          }),
        },
        ...RUN_RESET,
      };
    }),

  removePiezoPoint: (index) =>
    set((s) => {
      const activeId = s.piezometricLine.activeLineId;
      if (!activeId) return {};
      return {
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
        ...RUN_RESET,
      };
    }),

  setPiezoMaterialAssignment: (materialId, piezoLineId) =>
    set((s) => ({
      piezometricLine: {
        ...s.piezometricLine,
        materialAssignment: {
          ...s.piezometricLine.materialAssignment,
          [materialId]: piezoLineId,
        },
      },
      ...RUN_RESET,
    })),

  enablePiezoWithDefault: () => {
    const s = get();
    if (s.piezometricLine.lines.length > 0) return;

    const coords = s.coordinates;
    if (coords.length < 3) {
      set({
        piezometricLine: { ...s.piezometricLine, enabled: true },
        ...RUN_RESET,
      });
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
    set({
      piezometricLine: {
        enabled: true,
        lines: [defaultLine],
        activeLineId: lineId,
        materialAssignment: {},
      },
      ...RUN_RESET,
    });
  },
});
