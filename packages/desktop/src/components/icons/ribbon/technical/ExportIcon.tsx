import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Export (technical). */
export function ExportIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M19 10V7l-5-5H5v20h14v-3" />
      <path d="M14 2v5h5" />
      <path d="M12 14h10M19 11l3 3-3 3" />
    </RibbonIcon>
  );
}
