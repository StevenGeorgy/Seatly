// 2026-05-28 (PR-K): proportional integer-cent split.
//
// Used by split-tender modify flows (charge delta across N payers
// proportional to their original contribution, refund shrink across
// all N proportional to their original contribution).
//
// Largest-remainder method:
//   - Compute the exact (float) share each weight earns.
//   - Floor each share.
//   - Distribute the leftover cents to the slices with the largest
//     fractional remainders (ties broken by index order, deterministic).
//
// This guarantees `sum(result) === totalCents` exactly — never a penny
// off. Critical for refund parity with the original charges.
export function proportionalSplitCents(
  totalCents: number,
  weights: number[],
): number[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (weightSum <= 0 || totalCents === 0) return weights.map(() => 0);
  const exact = weights.map((w) =>
    (totalCents * Math.max(0, w)) / weightSum,
  );
  const floors = exact.map(Math.floor);
  const floorSum = floors.reduce((s, f) => s + f, 0);
  let remainder = totalCents - floorSum;
  if (remainder === 0) return floors;
  const fracs = exact.map((e, i) => ({ i, frac: e - floors[i] }));
  fracs.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remainder; k++) {
    floors[fracs[k % fracs.length].i] += 1;
  }
  return floors;
}
