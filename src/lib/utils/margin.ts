/**
 * Shared margin normalization utilities.
 * Handles the 0-1 vs 0-100 range ambiguity in gross_margin_pct values.
 */

/** Detect if an array of margin values are in 0-1 decimal range */
export function needsMarginConversion(values: number[]): boolean {
  if (values.length === 0) return false;
  const max = Math.max(...values);
  return max > 0 && max <= 1;
}

/** Convert a single margin value from 0-1 to 0-100 if needed */
export function normalizeMarginValue(value: number, shouldConvert: boolean): number {
  return shouldConvert ? value * 100 : value;
}
