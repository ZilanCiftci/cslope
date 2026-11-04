import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Assign (outline). */
export function AssignIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 19h18V5h-8L3 14z" />
      <path d="M3 13h18" />
      <path d="M3 13h18v6H3z" fill="currentColor" fillOpacity={0.25} stroke="none" />
    </RibbonIcon>
  );
}
