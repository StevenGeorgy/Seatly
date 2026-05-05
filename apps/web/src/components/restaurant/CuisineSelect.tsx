import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RESTAURANT_CUISINE_OPTIONS } from "@/lib/restaurant-cuisines";

type CuisineSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function CuisineSelect({
  value,
  onValueChange,
  placeholder,
  disabled,
}: CuisineSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {RESTAURANT_CUISINE_OPTIONS.map((cuisine) => (
          <SelectItem key={cuisine} value={cuisine}>
            {cuisine}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
