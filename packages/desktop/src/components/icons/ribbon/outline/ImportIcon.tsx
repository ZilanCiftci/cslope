import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Import (outline). */
export function ImportIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M4 10V4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2" />
      <path d="M14 2v6h6" />
      <path d="M2 14h8M7 11l3 3-3 3" />
    </RibbonIcon>
  );
}
