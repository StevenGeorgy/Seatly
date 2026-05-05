import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RESTAURANT_BUSINESS_TYPE_OPTIONS } from "@/lib/restaurant-business-types";

type BusinessTypeSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function BusinessTypeSelect({
  value,
  onValueChange,
  placeholder,
  disabled,
}: BusinessTypeSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {RESTAURANT_BUSINESS_TYPE_OPTIONS.map((businessType) => (
          <SelectItem key={businessType} value={businessType}>
            {businessType}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
