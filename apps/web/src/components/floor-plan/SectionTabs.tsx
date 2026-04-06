import type { SectionRow } from "@/hooks/useFloorPlan";

type SectionTabsProps = {
  sections: SectionRow[];
  selected: string;
  onChange: (id: string) => void;
  /** When true, tabs are non-interactive (e.g. while editing a floor layout). */
  disabled?: boolean;
};

export function SectionTabs({ sections, selected, onChange, disabled = false }: SectionTabsProps) {
  if (sections.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
      {sections.map((tab) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={[
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              disabled
                ? "cursor-not-allowed border border-border/60 bg-bg-surface text-text-muted opacity-70"
                : active
                  ? "bg-gold text-bg-base shadow-sm shadow-gold/25"
                  : "border border-border bg-bg-surface text-text-secondary hover:border-border/80 hover:text-text-primary",
            ].join(" ")}
          >
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
