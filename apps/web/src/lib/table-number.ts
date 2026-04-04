/** Parse 1, "12", "T3" → integer; non-numeric names → 0 (ignored for max). */
function parseTableNumberOrdinal(tableNumber: string | null | undefined): number {
  if (tableNumber == null) return 0;
  const t = tableNumber.trim();
  if (t === "") return 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (/^T\d+$/i.test(t)) return parseInt(t.slice(1), 10);
  return 0;
}

/** Next numeric table number "1", "2", … from max existing numeric `table_number` values. */
export function nextSequentialTableNumber(tables: { table_number: string | null }[]): string {
  let max = 0;
  for (const row of tables) {
    const n = parseTableNumberOrdinal(row.table_number);
    if (n > max) max = n;
  }
  return String(max + 1);
}

/**
 * Fills empty `table_number` values in order; grows the pool with each row so batch creates
 * get unique sequential numbers (seed with tables already persisted before this save).
 */
export function ensureTableNumbersForSave<T extends { table_number: string | null }>(
  rows: T[],
  seedTables: { table_number: string | null }[],
): T[] {
  let pool: { table_number: string | null }[] = [...seedTables];
  return rows.map((row) => {
    if (row.table_number?.trim()) {
      pool = [...pool, row];
      return row;
    }
    const next = nextSequentialTableNumber(pool);
    const filled = { ...row, table_number: next } as T;
    pool = [...pool, filled];
    return filled;
  });
}
