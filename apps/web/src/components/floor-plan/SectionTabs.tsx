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
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
      {sections.map((tab) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={[
              "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors",
              disabled
                ? "cursor-not-allowed border border-border/50 bg-bg-surface/50 text-text-muted opacity-70"
                : active
                  ? "border border-gold/40 bg-gold/15 text-gold shadow-sm shadow-gold/10"
                  : "border border-transparent bg-transparent text-text-secondary hover:border-border/60 hover:text-text-primary",
            ].join(" ")}
          >
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
