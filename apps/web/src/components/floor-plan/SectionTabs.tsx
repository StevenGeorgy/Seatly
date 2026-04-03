import { useTranslation } from "react-i18next";

import type { SectionRow } from "@/hooks/useFloorPlan";

type SectionTabsProps = {
  sections: SectionRow[];
  selected: string;
  onChange: (id: string) => void;
};

export function SectionTabs({ sections, selected, onChange }: SectionTabsProps) {
  const { t } = useTranslation();

  if (sections.length === 0) return null;

  const tabs = [{ id: "all", name: t("dashboard.floorPlan.allSections") }, ...sections];

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
      {tabs.map((tab) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={[
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-gold text-bg-base shadow-sm shadow-gold/25"
                : "border border-border bg-bg-elevated text-text-secondary hover:border-border/80 hover:text-text-primary",
            ].join(" ")}
          >
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
