import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Export (outline). */
export function ExportIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M20 10V8l-6-6H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2" />
      <path d="M14 2v6h6" />
      <path d="M12 14h10M19 11l3 3-3 3" />
    </RibbonIcon>
  );
}
