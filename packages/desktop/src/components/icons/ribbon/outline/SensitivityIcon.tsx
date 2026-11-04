import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Sensitivity (outline). */
export function SensitivityIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M3 3v18h18" />
      <path d="M7 16 19 7M7 7l12 9" />
      <circle cx="13" cy="11.5" r="1.4" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
