// utils/storage.ts
// Typed settings storage. All persistent state goes through
// browser.storage.local (§2); WXT's storage wrapper adds typing, fallbacks,
// and change-watching. Keys keep their original names so existing user data
// carries over. Account/license state lives in utils/tier.ts.
import { storage } from 'wxt/utils/storage';
import type { ColorFormat } from './color';
import type { FontUnit } from './fontUnit';

export type Theme = 'light' | 'dark';

export const themeItem = storage.defineItem<Theme>('local:theme', {
  fallback: 'dark',
});

export const colorFormatItem = storage.defineItem<ColorFormat>('local:colorFormat', {
  fallback: 'hex',
});

export const fontUnitItem = storage.defineItem<FontUnit>('local:fontUnit', {
  fallback: 'px',
});
