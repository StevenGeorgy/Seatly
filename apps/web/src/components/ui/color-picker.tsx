import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

type PresetColor = { name: string; value: string };

const PRESET_COLORS: PresetColor[] = [
  { name: "Gold", value: "#C9A84C" },
  { name: "Red", value: "#EF4444" },
  { name: "Orange", value: "#F97316" },
  { name: "Amber", value: "#F59E0B" },
  { name: "Yellow", value: "#EAB308" },
  { name: "Lime", value: "#84CC16" },
  { name: "Green", value: "#22C55E" },
  { name: "Emerald", value: "#10B981" },
  { name: "Teal", value: "#14B8A6" },
  { name: "Cyan", value: "#06B6D4" },
  { name: "Sky", value: "#0EA5E9" },
  { name: "Blue", value: "#3B82F6" },
  { name: "Indigo", value: "#6366F1" },
  { name: "Violet", value: "#8B5CF6" },
  { name: "Purple", value: "#A855F7" },
  { name: "Fuchsia", value: "#D946EF" },
  { name: "Pink", value: "#EC4899" },
  { name: "Rose", value: "#F43F5E" },
];

export const BACKGROUND_PRESETS: PresetColor[] = [
  { name: "Default", value: "#0A0A0A" },
  { name: "Charcoal", value: "#121212" },
  { name: "Dark Gray", value: "#1A1A1A" },
  { name: "Slate", value: "#1E293B" },
  { name: "Dark Navy", value: "#0F172A" },
  { name: "Midnight", value: "#111827" },
  { name: "Dark Zinc", value: "#18181B" },
  { name: "Dark Stone", value: "#1C1917" },
  { name: "Dark Olive", value: "#1A1C16" },
  { name: "Dark Teal", value: "#132229" },
  { name: "Wine", value: "#1C1015" },
  { name: "Deep Purple", value: "#1A1025" },
  { name: "Warm Gray", value: "#292524" },
  { name: "Cool Gray", value: "#252529" },
  { name: "Off White", value: "#F5F5F4" },
  { name: "White", value: "#FFFFFF" },
  { name: "Cream", value: "#FFFBEB" },
  { name: "Light Gray", value: "#F3F4F6" },
];

type ColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  /** Override the default preset swatches. */
  presets?: PresetColor[];
};

function isValidHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

export function ColorPicker({ value, onChange, label, presets }: ColorPickerProps) {
  const [hexInput, setHexInput] = useState(value);
  const nativeRef = useRef<HTMLInputElement>(null);
  const swatches = presets ?? PRESET_COLORS;

  useEffect(() => {
    setHexInput(value);
  }, [value]);

  function handleHexChange(input: string) {
    let normalized = input.trim();
    if (!normalized.startsWith("#")) normalized = `#${normalized}`;
    setHexInput(normalized);
    if (isValidHex(normalized)) {
      onChange(normalized);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {label && (
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {label}
        </span>
      )}

      {/* Active color preview + hex input */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="relative size-10 shrink-0 overflow-hidden rounded-lg border-2 border-border"
          style={{ backgroundColor: value }}
          onClick={() => nativeRef.current?.click()}
        >
          {/* Hidden native color input for the wheel */}
          <input
            ref={nativeRef}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </button>
        <Input
          value={hexInput}
          onChange={(e) => handleHexChange(e.target.value)}
          placeholder="#C9A84C"
          className="w-28 font-mono text-sm uppercase"
          maxLength={7}
        />
      </div>

      {/* Preset swatches */}
      <div className="flex flex-wrap gap-1.5">
        {swatches.map((preset) => (
          <button
            key={preset.value}
            type="button"
            title={preset.name}
            className={`size-7 rounded-md border-2 transition-transform hover:scale-110 ${
              value.toUpperCase() === preset.value.toUpperCase()
                ? "border-white scale-110"
                : "border-transparent"
            }`}
            style={{ backgroundColor: preset.value }}
            onClick={() => onChange(preset.value)}
          />
        ))}
      </div>
    </div>
  );
}
