import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Parameters (technical). */
export function ParametersIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M3 6h18M3 12h18M3 18h18" />
      <path d="M6.5 4.5h3v3h-3z" fill="currentColor" stroke="none" />
      <path d="M13.5 10.5h3v3h-3z" fill="currentColor" stroke="none" />
      <path d="M9.5 16.5h3v3h-3z" fill="currentColor" stroke="none" />
    </RibbonIcon>
  );
}
