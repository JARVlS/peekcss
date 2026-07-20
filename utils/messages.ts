export const INSPECTOR_PORT = 'peekcss:inspector';

import type { ColorFormat } from './color';
import type { FontUnit } from './fontUnit';

export interface InspectionData {
  selector: { tag: string; id: string | null; classes: string[] };
  dimensions: { width: number; height: number };
  // Root font size of the inspected page, used for px → rem conversion.
  rootFontSize: number;
  typography: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    lineHeight: string;
    letterSpacing: string;
    color: string;
  };
  box: {
    paddingTop: string;
    paddingRight: string;
    paddingBottom: string;
    paddingLeft: string;
    marginTop: string;
    marginRight: string;
    marginBottom: string;
    marginLeft: string;
    border: string;
    borderRadius: string;
  };
  background: { color: string; image: string };
  layout: { display: string; position: string };
  effects: { boxShadow: string; opacity: string };
  contrast: {
    ratio: number;
    level: string;
    textColor: string;
    bgColor: string;
    fontSize: number;
    isLargeText: boolean;
    aa: boolean;
    aaa: boolean;
  } | null;
  allCss: string;
}

export type ColorPurpose = 'text' | 'background' | 'border';

// One palette entry with usage counts per CSS purpose (§5: rule-based
// grouping by the properties the color came from).
export interface PaletteColor {
  color: string;
  count: number;
  text: number;
  background: number;
  border: number;
}

export interface ImageInfo {
  src: string;
  thumb: string;
  width: number;
  height: number;
  kind: 'img' | 'background';
}

// A single element whose text fails WCAG AA contrast.
export interface ContrastIssue {
  selector: string;
  ratio: number;
  required: number;
  textColor: string;
  bgColor: string;
  fontSize: number;
  largeText: boolean;
  sample: string;
}

// A pair of palette colors that become hard to tell apart under a
// color-vision deficiency.
export interface ColorBlindConflict {
  a: string;
  b: string;
  type: string;
}

// Page-wide accessibility audit shown in the overview.
export interface AccessibilityReport {
  score: number;
  grade: string;
  rating: string;
  contrast: {
    score: number;
    checked: number;
    passed: number;
    failed: number;
    issues: ContrastIssue[];
  };
  textSize: {
    score: number;
    checked: number;
    smallCount: number;
    smallestPx: number;
  };
  colorBlind: {
    score: number;
    checkedPairs: number;
    conflicts: ColorBlindConflict[];
  };
}

export interface OverviewData {
  colors: PaletteColor[];
  images: ImageInfo[];
  accessibility: AccessibilityReport;
}

// Typography tab (§5): font usage per family with a tag-based role heuristic.
export type FontRole = 'heading' | 'body' | 'ui' | 'other';

export interface FontUsage {
  family: string;
  count: number;
  roles: Record<FontRole, number>;
  sizes: number[]; // distinct computed px sizes, ascending
  weights: number[]; // distinct font weights, ascending
  // The family name pre-rendered in its own font by the content script (where
  // the page's web fonts are actually loaded — the sidepanel can't see them).
  // A transparent PNG of the glyphs, used as a mask so the panel can tint it to
  // the current theme. Absent when the font isn't genuinely available (e.g. the
  // stack fell back), so we never fake a mislabeled preview.
  nameImage?: { data: string; width: number; height: number };
}

export interface TypographyData {
  fonts: FontUsage[];
  rootFontSize: number;
}

// Discriminated union → adding a new message kind forces both sides
// to handle it. Keeps stringly-typed bugs out.

// Content script → Sidepanel
export type InspectorMessage =
  | { kind: 'update'; data: InspectionData }
  | { kind: 'overview'; data: OverviewData }
  | { kind: 'typography'; data: TypographyData }
  | { kind: 'shortcut'; action: 'toggle-theme' | 'toggle-inspector' | 'toggle-popup' | 'cycle-tab' }
  | { kind: 'cleared' };

// Sidepanel → Content script
export type SidepanelMessage =
  | { kind: 'set-active'; active: boolean }
  | { kind: 'set-popup'; enabled: boolean }
  | { kind: 'set-color-format'; format: ColorFormat }
  | { kind: 'set-font-unit'; unit: FontUnit }
  | { kind: 'scan-overview' }
  | { kind: 'scan-typography' };

// Popup → Background (runtime.sendMessage). Only http(s) URLs are routed here:
// the background can hand them straight to the downloads API, which fetches
// with the browser's own privileges (no CORS). data:/blob: URLs are NOT sent
// here — they are converted to object URLs and downloaded from the popup,
// because URL.createObjectURL is unavailable in a Chrome MV3 service worker.
export type DownloadRequest = { kind: 'download-request'; url: string; filename: string };

// Background → Popup (response to DownloadRequest). Carries the failure reason
// so the popup can show a per-image error instead of failing silently.
export type DownloadResult = { ok: true; downloadId: number } | { ok: false; error: string };
