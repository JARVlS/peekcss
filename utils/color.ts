export type ColorFormat = 'hex' | 'rgb' | 'hsl';

export const COLOR_FORMATS: ColorFormat[] = ['hex', 'rgb', 'hsl'];

export type RGBA = { r: number; g: number; b: number; a: number };

export function parseColor(input: string): RGBA | null {
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length >= 4 ? parts[3] : 1 };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function rgbToHsl({ r, g, b }: RGBA): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function toHex(c: RGBA): string {
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  if (c.a >= 0.999) return base;
  return base + h(c.a * 255);
}

function toRgb(c: RGBA): string {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  return c.a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(c.a)})`;
}

function toHsl(c: RGBA): string {
  const { h, s, l } = rgbToHsl(c);
  return c.a >= 0.999 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${round(c.a)})`;
}

export function formatRgba(c: RGBA, format: ColorFormat): string {
  switch (format) {
    case 'rgb':
      return toRgb(c);
    case 'hsl':
      return toHsl(c);
    default:
      return toHex(c);
  }
}

// Converts any parseable CSS color string into the requested format.
// Returns the original string unchanged when it can't be parsed
// (e.g. gradients, "none", keywords).
export function formatColor(input: string, format: ColorFormat): string {
  const c = parseColor(input);
  if (!c) return input;
  return formatRgba(c, format);
}
