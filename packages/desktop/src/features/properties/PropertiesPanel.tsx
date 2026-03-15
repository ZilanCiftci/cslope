import { CustomSearchPlanesSection } from "./sections/CustomSearchPlanesSection";
import { OptionsSection } from "./sections/OptionsSection";
import { SearchLimitsSection } from "./sections/SearchLimitsSection";

export function PropertiesPanel() {
  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        background: "var(--color-vsc-sidebar)",
      }}
    >
      <SearchLimitsSection />
      <CustomSearchPlanesSection />
      <OptionsSection />
    </div>
  );
}
