// utils/palette.ts
// Palette purpose grouping and text-based exports (§5 Overview).
import type { ColorPurpose, PaletteColor } from './messages';

// Assigns a palette color to the purpose it serves most often.
// Ties favor background > text > border (larger surfaces first).
export function dominantPurpose(c: PaletteColor): ColorPurpose {
  if (c.background >= c.text && c.background >= c.border) return 'background';
  if (c.text >= c.border) return 'text';
  return 'border';
}

export type PaletteExportFormat = 'css' | 'scss' | 'json' | 'tailwind';

export const PALETTE_EXPORT_FORMATS: readonly PaletteExportFormat[] = [
  'css',
  'scss',
  'json',
  'tailwind',
];

// Builds the export text for the given format. Colors are named by their
// dominant purpose (bg-1, text-2, …); values use the caller's preferred
// color format. PDF / Adobe ASE are explicitly out of scope (§5 stretch).
export function exportPalette(
  palette: PaletteColor[],
  format: PaletteExportFormat,
  fmt: (color: string) => string,
): string {
  const named = namePalette(palette, fmt);
  switch (format) {
    case 'css':
      return `:root {\n${named.map(({ name, value }) => `  --${name}: ${value};`).join('\n')}\n}\n`;
    case 'scss':
      return `${named.map(({ name, value }) => `$${name}: ${value};`).join('\n')}\n`;
    case 'json':
      return `${JSON.stringify(Object.fromEntries(named.map(({ name, value }) => [name, value])), null, 2)}\n`;
    case 'tailwind':
      return `// Add to theme.extend.colors in tailwind.config\n{\n${named
        .map(({ name, value }) => `  '${name}': '${value}',`)
        .join('\n')}\n}\n`;
  }
}

function namePalette(
  palette: PaletteColor[],
  fmt: (color: string) => string,
): Array<{ name: string; value: string }> {
  const counters: Record<ColorPurpose, number> = { background: 0, text: 0, border: 0 };
  const prefixes: Record<ColorPurpose, string> = { background: 'bg', text: 'text', border: 'border' };
  return palette.map((entry) => {
    const purpose = dominantPurpose(entry);
    counters[purpose]++;
    return { name: `${prefixes[purpose]}-${counters[purpose]}`, value: fmt(entry.color) };
  });
}
