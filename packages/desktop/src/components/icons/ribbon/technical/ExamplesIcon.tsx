import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Examples (technical). */
export function ExamplesIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 3h20v18H2z" />
      <path d="M14 21v-3h8" />
      <path d="M5 16h3l5-6h6" />
    </RibbonIcon>
  );
}
