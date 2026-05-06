export function normalizeReservationSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function compactReservationSearch(value: string): string {
  return normalizeReservationSearch(value).replace(/[^a-z0-9]/g, "");
}

export function matchesReservationSearch(
  query: string,
  values: Array<string | null | undefined>,
): boolean {
  const normalizedQuery = normalizeReservationSearch(query);
  if (!normalizedQuery) return true;

  const compactQuery = compactReservationSearch(query);
  return values.some((value) => {
    if (!value) return false;
    const normalizedValue = normalizeReservationSearch(value);
    if (normalizedValue.includes(normalizedQuery)) return true;
    return compactQuery.length > 0 && compactReservationSearch(value).includes(compactQuery);
  });
}
