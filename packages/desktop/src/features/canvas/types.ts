export type LimitHandle =
  | "entryLeftX"
  | "entryRightX"
  | "exitLeftX"
  | "exitRightX";
export type UdlHandle = "x1" | "x2";

export type PointHit =
  | { kind: "external"; index: number }
  | { kind: "boundary"; boundaryId: string; pointIndex: number }
  | { kind: "piezo"; lineId: string; index: number }
  | { kind: "limit"; handle: LimitHandle }
  | { kind: "udl"; udlId: string; handle: UdlHandle }
  | { kind: "lineLoad"; loadId: string }
  /** A distributed load's strip: a drag moves the load whole. */
  | { kind: "udlBody"; udlId: string }
  /** An end of a reinforcement element or a pile. */
  | { kind: "elementEnd"; element: "reinforcement" | "pile"; id: string; end: "end1" | "end2" }
  /** A custom non-circular surface's line: a drag moves it whole. */
  | { kind: "customPlaneBody"; planeId: string }
  /** A drawing (unlocked) moved whole. */
  | { kind: "backgroundBody"; id: string }
  | { kind: "annotation"; annoId: string }
  /** A custom search circle: its centre dot, or its rim (drag sets the radius). */
  | { kind: "customCircle"; planeId: string; handle: "centre" | "rim" }
  /** A vertex of a custom non-circular surface. */
  | { kind: "customVertex"; planeId: string; pointIndex: number }
  /** A vertex of a reference polyline (result view). */
  | { kind: "referenceVertex"; annoId: string; pointIndex: number }
  /** A reference circle: its centre, or its arc (a drag sets the radius). */
  | { kind: "referenceCircle"; annoId: string; handle: "centre" | "rim" }
  /** A reference polyline's line itself: a drag moves it whole. */
  | { kind: "referenceLine"; annoId: string };

export type EdgeHit =
  | { kind: "external"; insertIndex: number; snapPoint: [number, number] }
  | {
      kind: "boundary";
      boundaryId: string;
      insertIndex: number;
      snapPoint: [number, number];
    }
  | {
      kind: "piezo";
      lineId: string;
      insertIndex: number;
      snapPoint: [number, number];
    }
  /** A segment of a custom non-circular surface. */
  | {
      kind: "customPlane";
      planeId: string;
      insertIndex: number;
      snapPoint: [number, number];
    }
  /** A segment of a reference polyline (result view). */
  | {
      kind: "reference";
      annoId: string;
      insertIndex: number;
      snapPoint: [number, number];
    };

export interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A line above the item, setting it apart from the ones before. */
  separator?: boolean;
  /** Items shown beside this one while it is hovered (its own action is not used). */
  submenu?: ContextMenuItem[];
}

export interface ContextMenuState {
  screenX: number;
  screenY: number;
  items: ContextMenuItem[];
}

export interface MaterialPickerState {
  screenX: number;
  screenY: number;
  worldPoint: [number, number];
}
