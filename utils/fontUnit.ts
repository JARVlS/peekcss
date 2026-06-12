// utils/fontUnit.ts
// App-wide font unit preference (§5 Settings). Computed styles report px;
// these helpers convert px lengths for display in the preferred unit.
export type FontUnit = 'px' | 'rem' | 'pt';

export const FONT_UNITS: readonly FontUnit[] = ['px', 'rem', 'pt'];

// Converts a computed px length (e.g. "19.2px") into the preferred unit.
// rem is relative to the inspected page's root font size. Non-px values
// ("normal", keywords, percentages) pass through unchanged.
export function formatFontLength(value: string, unit: FontUnit, rootPx: number): string {
  if (unit === 'px') return value;
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  if (!match) return value;
  const px = parseFloat(match[1]);
  if (unit === 'rem') return `${trimNumber(px / (rootPx || 16))}rem`;
  return `${trimNumber(px * 0.75)}pt`; // 1px = 0.75pt (96dpi CSS reference)
}

function trimNumber(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
