export type LimitHandle =
  | "entryLeftX"
  | "entryRightX"
  | "exitLeftX"
  | "exitRightX";
export type UdlHandle = "x1" | "x2";

export type PointHit =
  | { kind: "external"; index: number }
  | { kind: "boundary"; boundaryId: string; pointIndex: number }
  | { kind: "piezo"; index: number }
  | { kind: "limit"; handle: LimitHandle }
  | { kind: "udl"; udlId: string; handle: UdlHandle }
  | { kind: "lineLoad"; loadId: string }
  | { kind: "annotation"; annoId: string };

export type EdgeHit =
  | { kind: "external"; insertIndex: number; snapPoint: [number, number] }
  | {
      kind: "boundary";
      boundaryId: string;
      insertIndex: number;
      snapPoint: [number, number];
    }
  | { kind: "piezo"; insertIndex: number; snapPoint: [number, number] };

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
  regionKey: string;
}
