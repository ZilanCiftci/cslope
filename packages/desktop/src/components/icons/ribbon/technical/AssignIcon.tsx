import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Assign (technical). */
export function AssignIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 19h18V5h-8L3 14z" />
      <path d="M3 13h18" />
      <path d="M5 19l5-6M10 19l5-6M15 19l5-6" />
    </RibbonIcon>
  );
}
