import { RibbonIcon, type RibbonIconProps } from "../RibbonIcon";

/** Documentation (technical). */
export function DocumentationIcon(props: RibbonIconProps) {
  return (
    <RibbonIcon {...props} style="technical">
      <path d="M2 5h8l2 2 2-2h8v14h-8l-2 2-2-2H2z" />
      <path d="M12 7v14" />
    </RibbonIcon>
  );
}
