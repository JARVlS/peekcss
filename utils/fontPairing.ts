// utils/fontPairing.ts
// Font pairing suggestions (§5 Typography, Pro). Privacy-first design: we
// download Google Fonts' *public catalog* (family/category/popularity) and do
// all matching locally — detected font names never leave the browser. The
// catalog fetch needs the fonts.google.com host permission, requested at
// first use so install-time permissions stay unchanged.
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';

export type FontCategory = 'Serif' | 'Sans Serif' | 'Display' | 'Handwriting' | 'Monospace';

export interface GoogleFontMeta {
  family: string;
  category: FontCategory;
  /** Popularity rank — lower is more popular. */
  popularity: number;
}

export interface FontPairingSuggestion {
  family: string;
  category: FontCategory;
  /** Specimen page; only visited if the user clicks the link. */
  url: string;
}

const CATALOG_URL = 'https://fonts.google.com/metadata/fonts';
const CATALOG_ORIGIN = 'https://fonts.google.com/*';
const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CatalogCache {
  fetchedAt: number;
  fonts: GoogleFontMeta[];
}

const catalogItem = storage.defineItem<CatalogCache | null>('local:googleFontsCatalog', {
  fallback: null,
});

// Must be called from a user gesture (button click) or the browser rejects
// the permission prompt outright.
export async function requestCatalogAccess(): Promise<boolean> {
  try {
    if (await browser.permissions.contains({ origins: [CATALOG_ORIGIN] })) return true;
    return await browser.permissions.request({ origins: [CATALOG_ORIGIN] });
  } catch {
    return false;
  }
}

export async function loadCatalog(): Promise<GoogleFontMeta[] | null> {
  const cached = await catalogItem.getValue();
  if (cached && Date.now() - cached.fetchedAt < CATALOG_MAX_AGE_MS) return cached.fonts;

  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) return cached?.fonts ?? null;
    let raw = await res.text();
    // Google sometimes prefixes JSON endpoints with an XSSI guard.
    if (raw.startsWith(")]}'")) raw = raw.slice(4);
    const data = JSON.parse(raw) as {
      familyMetadataList?: Array<{ family?: string; category?: string; popularity?: number }>;
    };
    const fonts: GoogleFontMeta[] = (data.familyMetadataList ?? [])
      .filter(
        (f): f is { family: string; category: FontCategory; popularity: number } =>
          typeof f.family === 'string' &&
          typeof f.popularity === 'number' &&
          ['Serif', 'Sans Serif', 'Display', 'Handwriting', 'Monospace'].includes(
            f.category ?? '',
          ),
      )
      .map((f) => ({ family: f.family, category: f.category, popularity: f.popularity }));
    if (fonts.length === 0) return cached?.fonts ?? null;
    await catalogItem.setValue({ fetchedAt: Date.now(), fonts });
    return fonts;
  } catch {
    return cached?.fonts ?? null;
  }
}

// Category of a detected font: exact catalog match first, then a name-based
// guess so non-Google fonts (e.g. Helvetica, Georgia) still pair sensibly.
export function categorize(family: string, catalog: GoogleFontMeta[]): FontCategory {
  const lower = family.toLowerCase();
  const match = catalog.find((f) => f.family.toLowerCase() === lower);
  if (match) return match.category;
  if (/mono|consol|courier|code/.test(lower)) return 'Monospace';
  if (/script|hand|cursive|brush/.test(lower)) return 'Handwriting';
  if (/georgia|times|garamond|baskerville|palatino|cambria|book/.test(lower)) return 'Serif';
  if (lower.includes('serif') && !lower.includes('sans')) return 'Serif';
  return 'Sans Serif';
}

// Classic pairing rule: contrast the category. Serif headings ↔ sans body;
// decorative faces pair with quiet text faces.
const COMPLEMENTS: Record<FontCategory, FontCategory[]> = {
  Serif: ['Sans Serif'],
  'Sans Serif': ['Serif'],
  Display: ['Sans Serif', 'Serif'],
  Handwriting: ['Sans Serif', 'Serif'],
  Monospace: ['Sans Serif'],
};

export function suggestPairings(
  family: string,
  catalog: GoogleFontMeta[],
  limit = 4,
): FontPairingSuggestion[] {
  const lower = family.toLowerCase();
  const complements = COMPLEMENTS[categorize(family, catalog)];
  return catalog
    .filter((f) => complements.includes(f.category) && f.family.toLowerCase() !== lower)
    .sort((a, b) => a.popularity - b.popularity)
    .slice(0, limit)
    .map((f) => ({
      family: f.family,
      category: f.category,
      url: `https://fonts.google.com/specimen/${encodeURIComponent(f.family).replace(/%20/g, '+')}`,
    }));
}
