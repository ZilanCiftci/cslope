import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Sensitivity (technical). */
export function SensitivityIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 3v18h18" />
      <path d="M2 9h1M2 15h1M9 21v1M15 21v1" />
      <path d="M7 16 19 7M7 7l12 9" />
    </RibbonIcon>
  );
}
