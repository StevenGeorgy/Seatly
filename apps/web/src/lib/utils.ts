import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function capitalizeWords(value: string | null | undefined): string {
  if (!value) return ""
  return value.replace(/(^|[\s/&-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase())
}
