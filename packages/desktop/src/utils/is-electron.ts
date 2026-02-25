/** Returns `true` when the renderer is running inside Electron (preload bridge present). */
export const isElectron = typeof window !== "undefined" && "cslope" in window;
