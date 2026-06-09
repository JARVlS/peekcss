export const INSPECTOR_PORT = 'peekcss:inspector';

import type { ColorFormat } from './color';

export interface InspectionData {
  selector: { tag: string; id: string | null; classes: string[] };
  dimensions: { width: number; height: number };
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
  contrast: { ratio: number; level: string; textColor: string; bgColor: string } | null;
  allCss: string;
}

export interface ImageInfo {
  src: string;
  thumb: string;
  width: number;
  height: number;
  kind: 'img' | 'background';
}

export interface OverviewData {
  colors: string[];
  images: ImageInfo[];
}

// Discriminated union → adding a new message kind forces both sides
// to handle it. Keeps stringly-typed bugs out.

// Content script → Sidepanel
export type InspectorMessage =
  | { kind: 'update'; data: InspectionData }
  | { kind: 'overview'; data: OverviewData }
  | { kind: 'shortcut'; action: 'toggle-theme' | 'toggle-inspector' | 'toggle-popup' }
  | { kind: 'cleared' };

// Sidepanel → Content script
export type SidepanelMessage =
  | { kind: 'set-active'; active: boolean }
  | { kind: 'set-popup'; enabled: boolean }
  | { kind: 'set-color-format'; format: ColorFormat }
  | { kind: 'scan-overview' }
  | { kind: 'download-image'; src: string };
