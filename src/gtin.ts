/** Strip the spaces and dashes people paste into barcodes. */
export function normalizeGtin(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

/**
 * Validate a GTIN-8, UPC-12 (GTIN-12), EAN-13 (GTIN-13) or ITF-14 (GTIN-14) with its GS1 mod-10 check digit.
 * Spaces and dashes are ignored. Leading zeros are significant, so always keep barcodes as strings.
 */
export function isValidGtin(raw: string): boolean {
  const gtin = normalizeGtin(raw);
  if (!/^\d+$/.test(gtin) || ![8, 12, 13, 14].includes(gtin.length)) return false;
  const digits = [...gtin].map(Number);
  const check = digits.pop()!;
  // From the right, weights alternate 3, 1, 3, 1…
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
