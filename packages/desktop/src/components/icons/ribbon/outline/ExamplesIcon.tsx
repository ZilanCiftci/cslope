import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Examples (outline). */
export function ExamplesIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M6 17h3l5-6h4" />
    </RibbonIcon>
  );
}
