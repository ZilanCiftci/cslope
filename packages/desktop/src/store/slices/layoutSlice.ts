import type { SliceCreator } from "../helpers";
import type { LayoutSlice } from "../types";

export const createLayoutSlice: SliceCreator<LayoutSlice> = (set, get) => ({
  theme:
    (typeof window !== "undefined" &&
      (localStorage.getItem("cslope-theme") as LayoutSlice["theme"])) ||
    "light",
  mode: "edit",
  explorerOpen: true,
  sidebarOpen: true,
  explorerLocation: "left",
  propertiesLocation: "right",
  activeSection: "Exterior Boundary",
  snapToGrid: true,
  gridSnapSize: 0.5,

  setExplorerLocation: (loc) => set({ explorerLocation: loc }),
  setPropertiesLocation: (loc) => set({ propertiesLocation: loc }),

  setTheme: (theme) => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("cslope-theme", theme);
    }
    set({ theme });
  },

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("cslope-theme", next);
    }
    set({ theme: next });
  },

  setMode: (mode) => set({ mode }),
  toggleExplorer: () => set((s) => ({ explorerOpen: !s.explorerOpen })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveSection: (section) => set({ activeSection: section }),
  setSnapToGrid: (enabled) => set({ snapToGrid: enabled }),
  setGridSnapSize: (size) => set({ gridSnapSize: Math.max(0.01, size) }),
});
