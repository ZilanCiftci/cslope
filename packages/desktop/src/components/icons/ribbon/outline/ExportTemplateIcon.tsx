import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Export template (outline). */
export function ExportTemplateIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="outline">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6M9 15l3-3 3 3" />
    </RibbonIcon>
  );
}
