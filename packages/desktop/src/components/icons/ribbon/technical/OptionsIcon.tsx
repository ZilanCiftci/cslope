import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Options (technical). */
export function OptionsIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M18 12h3.5M12 18v3.5M6 12H2.5M12 6V2.5" />
      <path d="M16.24 16.24l2.48 2.48M7.76 16.24l-2.48 2.48M7.76 7.76 5.28 5.28M16.24 7.76l2.48-2.48" />
    </RibbonIcon>
  );
}
