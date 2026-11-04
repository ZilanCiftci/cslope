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

export interface ContextMenuState {
  screenX: number;
  screenY: number;
  items: {
    label: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
}

export interface MaterialPickerState {
  screenX: number;
  screenY: number;
  worldPoint: [number, number];
}
