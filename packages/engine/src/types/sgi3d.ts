/** 3D effects of a temporary slope after SGI's guidance (see model/sgi3d.ts). */

export interface Sgi3dOptions {
  /** Length of the critical stretch L (m), the stage of the excavation open at a time. */
  length: number;
  /**
   * F_2D,överstark,min of the adjacent stretches (eq. 2-4). Not set:
   * infinitely overstrong adjacent stability (eq. 2-3).
   */
  overstrongF2D?: number;
  /** Materials not counted in the end faces, by name (besides friction soil). */
  excludeMaterials?: readonly string[];
  /** Size of the integration cells (m), at least: coarser to keep a large model to about 400 000 cells. Default 0.05. */
  cellSize?: number;
}

/** One analysed surface with its 3D factor, its circle in model space. */
export interface Sgi3dSurface {
  cx: number;
  cy: number;
  radius: number;
  /** F_2D of the surface. */
  f2d: number;
  /** Driving moment M_E (kNm per metre). */
  drivingMoment: number;
  /** Area of cohesive soil in the end face counted (m²). */
  endFaceArea: number;
  /** ∫ c_u r dA over that area (kNm per end face). */
  endFaceMoment: number;
  /** F_P, plane end faces (eq. 2-2). */
  fp: number;
  /** F_3D (eq. 2-3 or 2-4). */
  f3d: number;
}

export interface Sgi3dResult {
  /** The smallest F_3D over the analysed circular surfaces. */
  factorOfSafety: number;
  /** F_2D,krit,min: the smallest F_2D of the analysis (non-circular surfaces included). */
  f2dCritical: number;
  /** The surface of the smallest F_3D. */
  critical: Sgi3dSurface;
  /** Eq. 2-3 (infinitely overstrong adjacent stability) or 2-4 (finite). */
  equation: "2-3" | "2-4";
  options: { length: number; overstrongF2D: number | null; excludeMaterials: string[] };
  warnings: string[];
}

/** The analysis option: 3D effects after the 2D analysis (AnalysisOptions.sgi3d). */
export interface Sgi3dSettings extends Omit<Sgi3dOptions, "overstrongF2D" | "excludeMaterials"> {
  enabled: boolean;
  /** F_2D,överstark,min (eq. 2-4); null: infinitely overstrong (eq. 2-3). */
  overstrongF2D: number | null;
  /** Materials not counted in the end faces, by name. */
  excludeMaterials: string[];
}
