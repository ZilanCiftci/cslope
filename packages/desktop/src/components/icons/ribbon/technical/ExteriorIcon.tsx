import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Exterior (technical). */
export function ExteriorIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 19h18V5h-8L3 14z" />
      <path d="M5 21.5l2.5-2.5M9.5 21.5l2.5-2.5M14 21.5l2.5-2.5M18.5 21.5l2.5-2.5" />
    </RibbonIcon>
  );
}
