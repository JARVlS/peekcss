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

// --- Contrast & accessibility helpers ---

// Composites a foreground color over a background using its alpha channel.
export function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

export function relativeLuminance(c: RGBA): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

// WCAG contrast ratio between two opaque colors (1..21).
export function contrastRatio(a: RGBA, b: RGBA): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// WCAG "large text": >= 24px, or >= 18.66px when bold (weight >= 700).
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

export interface WcagLevels {
  aa: boolean;
  aaa: boolean;
  label: string;
}

// WCAG conformance for a contrast ratio at the given text size.
export function wcagLevels(ratio: number, large: boolean): WcagLevels {
  const aa = ratio >= (large ? 3 : 4.5);
  const aaa = ratio >= (large ? 4.5 : 7);
  const label = aaa ? 'AAA' : aa ? (large ? 'AA Large' : 'AA') : 'Fail';
  return { aa, aaa, label };
}

export type CvdType = 'protanopia' | 'deuteranopia' | 'tritanopia';

export const CVD_TYPES: CvdType[] = ['protanopia', 'deuteranopia', 'tritanopia'];

// Common sRGB color-vision-deficiency simulation matrices.
const CVD_MATRICES: Record<CvdType, number[][]> = {
  protanopia: [
    [0.152, 1.053, -0.205],
    [0.115, 0.786, 0.099],
    [-0.004, -0.048, 1.052],
  ],
  deuteranopia: [
    [0.367, 0.861, -0.228],
    [0.28, 0.673, 0.047],
    [-0.012, 0.043, 0.969],
  ],
  tritanopia: [
    [1.256, -0.077, -0.179],
    [-0.078, 0.93, 0.148],
    [0.005, 0.691, 0.304],
  ],
};

// Approximates how a color is perceived under a color-vision deficiency.
export function simulateCvd(c: RGBA, type: CvdType): RGBA {
  const m = CVD_MATRICES[type];
  const clamp = (n: number) => Math.min(255, Math.max(0, n));
  return {
    r: clamp(m[0][0] * c.r + m[0][1] * c.g + m[0][2] * c.b),
    g: clamp(m[1][0] * c.r + m[1][1] * c.g + m[1][2] * c.b),
    b: clamp(m[2][0] * c.r + m[2][1] * c.g + m[2][2] * c.b),
    a: c.a,
  };
}

// Perceptual color distance (redmean approximation), range ~0..765.
export function colorDistance(a: RGBA, b: RGBA): number {
  const rmean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}
