import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Material table (outline). */
export function MaterialTableIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M3 10h18M3 15h18M9 5v14" />
    </RibbonIcon>
  );
}
