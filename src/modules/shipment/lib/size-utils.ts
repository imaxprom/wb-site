/**
 * Shared utilities for size-related operations.
 * Used by: calculation-engine, excel-parser, wb-transformers, export-excel.
 */

/**
 * Guess the number of items per box based on size name.
 * Larger sizes → fewer items per box.
 */
export function guessPerBox(size: string): number {
  const s = size.toLowerCase();
  if (
    s.includes("5xl") ||
    s.includes("52-54") ||
    s.includes("4xl") ||
    s.includes("50-52")
  ) {
    return 70;
  }
  if (
    s.includes("3xl") ||
    s.includes("48-50") ||
    s.includes("xxxl") ||
    s.includes("46-48")
  ) {
    return 80;
  }
  return 90;
}

/**
 * Returns true if the size string contains letters (e.g. "40-42 (L)").
 * Returns false for purely numeric sizes (e.g. "101-103").
 */
export function sizeHasLetters(size: string): boolean {
  return /[a-zA-Z]/.test(size);
}

/**
 * Compute a sorting key for a size string.
 * Group 0: sizes with letters (e.g. "40-42 (L)") — sorted by first number ascending.
 * Group 1: purely numeric sizes (e.g. "101-103") — sorted by first number ascending.
 */
function sizeSortKey(size: string): [number, number] {
  const match = size.match(/(\d+)/);
  const num = match ? parseInt(match[1], 10) : 9999;
  return [sizeHasLetters(size) ? 0 : 1, num];
}

/**
 * Sort an array of objects by their `size` field.
 * First: sizes with letters (ascending by number), then: purely numeric (ascending).
 */
export function sortBySize<T extends { size: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ka = sizeSortKey(a.size);
    const kb = sizeSortKey(b.size);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    return ka[1] - kb[1];
  });
}
