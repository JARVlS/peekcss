// entrypoints/sidepanel/main.ts
// Orchestrates the side panel: manages the connection to the inspected tab,
// the shared color-format preference, the header toggles, and keyboard
// shortcuts, delegating rendering to the view modules.
import {
  INSPECTOR_PORT,
  type DownloadRequest,
  type DownloadResult,
  type InspectorMessage,
  type SidepanelMessage,
} from '@/utils/messages';
import { type ColorFormat, COLOR_FORMATS, formatColor } from '@/utils/color';
import { applyBlobExtension, dataUrlToBlob, type DownloadOutcome } from '@/utils/download';
import { hasTier, initUserTier } from '@/utils/tier';
import { ThemeController } from './theme';
import { NavigationController } from './navigation';
import { InspectorView } from './inspectorView';
import { OverviewView } from './overviewView';
import { GatingController } from './gating';

const toggleBtn = document.getElementById('toggle')!;
const iconOn = document.getElementById('toggle-icon-on')!;
const iconOff = document.getElementById('toggle-icon-off')!;
const popupToggleBtn = document.getElementById('popup-toggle')!;
const popupIconOn = document.getElementById('popup-icon-on')!;
const popupIconOff = document.getElementById('popup-icon-off')!;
const colorFormatSelect = document.getElementById('color-format') as HTMLSelectElement;

let port: ReturnType<typeof browser.tabs.connect> | undefined;
let generation = 0;
let inspectorActive = true;
let popupEnabled = false;
let colorFormat: ColorFormat = 'hex';

const fmtColor = (c: string) => formatColor(c, colorFormat);

// Routes a single asset download. The popup is the right place for this:
//   - It is a privileged DOM context, so it can call browser.downloads.download
//     directly AND use URL.createObjectURL (needed for data:/blob:).
//   - A Chrome MV3 service worker cannot create object URLs, so doing the
//     data:/blob: conversion in the background would not be portable.
//
// http(s) URLs are still handed to the background worker: it downloads them
// with the browser's ambient credentials (no CORS), and centralising that keeps
// the privileged call in one place.
async function downloadAsset(url: string, filename: string): Promise<DownloadOutcome> {
  try {
    if (/^https?:/i.test(url)) {
      return await downloadViaBackground(url, filename);
    }
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      await downloadViaObjectUrl(url, filename);
      return { ok: true };
    }
    throw new Error(`Unsupported URL scheme for "${url.slice(0, 24)}…"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PeekCSS] asset download failed:', message, url);
    return { ok: false, error: message };
  }
}

async function downloadViaBackground(url: string, filename: string): Promise<DownloadOutcome> {
  const request: DownloadRequest = { kind: 'download-request', url, filename };
  const result = (await browser.runtime.sendMessage(request)) as DownloadResult | undefined;
  if (!result) {
    throw new Error('No response from background download handler');
  }
  if (!result.ok) {
    throw new Error(result.error);
  }
  return { ok: true };
}

// Firefox's downloads.download() rejects data: and blob: URLs outright
// ("Access denied for URL data:..."). We turn them into a fresh object URL
// first, which the API accepts.
async function downloadViaObjectUrl(url: string, filename: string): Promise<void> {
  const blob = url.startsWith('data:') ? dataUrlToBlob(url) : await fetchBlobFromUrl(url);
  const finalName = applyBlobExtension(filename, blob.type);
  const objectUrl = URL.createObjectURL(blob);

  let downloadId: number;
  try {
    downloadId = await browser.downloads.download({ url: objectUrl, filename: finalName });
  } catch (error) {
    // The download never started, so the object URL is safe to free now.
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  revokeObjectUrlWhenSettled(downloadId, objectUrl);
}

async function fetchBlobFromUrl(blobUrl: string): Promise<Blob> {
  // Works for object URLs created by the extension itself. Object URLs created
  // inside the inspected page are scoped to that page and cannot be read here —
  // that failure is surfaced to the UI rather than swallowed.
  const response = await fetch(blobUrl);
  if (!response.ok) {
    throw new Error(`Could not read blob URL (HTTP ${response.status})`);
  }
  return await response.blob();
}

// Frees the object URL only AFTER the download settles. Revoking while the
// download is still in flight aborts it, so we wait for the terminal
// "complete" or "interrupted" state reported by downloads.onChanged.
function revokeObjectUrlWhenSettled(downloadId: number, objectUrl: string): void {
  const handleChange = (delta: Browser.downloads.DownloadDelta) => {
    if (delta.id !== downloadId || !delta.state) {
      return;
    }
    const state = delta.state.current;
    if (state === 'complete' || state === 'interrupted') {
      URL.revokeObjectURL(objectUrl);
      browser.downloads.onChanged.removeListener(handleChange);
    }
  };
  browser.downloads.onChanged.addListener(handleChange);
}

const theme = new ThemeController();
const inspectorView = new InspectorView(fmtColor);
const overviewView = new OverviewView(fmtColor, downloadAsset);
const nav = new NavigationController((view) => {
  if (view === 'overview') requestOverview();
});

// §7 tier gating: locked views show a lock panel instead of their content.
// Until the initial tier resolves, checks default to 'anonymous' (safest).
const gating = new GatingController();
void initUserTier((tier) => {
  gating.apply(tier);
  // A tab unlocked while open (e.g. dev override changed) needs its data.
  if (nav.currentView === 'overview' && !gating.isViewLocked('overview', tier)) {
    requestOverview();
  }
}).then((tier) => gating.apply(tier));

function setInspectorActive(value: boolean) {
  inspectorActive = value;
  toggleBtn.classList.toggle('active', inspectorActive);
  iconOn.style.display = inspectorActive ? '' : 'none';
  iconOff.style.display = inspectorActive ? 'none' : '';
  if (port) {
    const msg: SidepanelMessage = { kind: 'set-active', active: inspectorActive };
    port.postMessage(msg);
  }
}

function setPopupEnabled(value: boolean) {
  popupEnabled = value;
  popupToggleBtn.classList.toggle('active', popupEnabled);
  popupIconOn.style.display = popupEnabled ? '' : 'none';
  popupIconOff.style.display = popupEnabled ? 'none' : '';
  if (port) {
    const msg: SidepanelMessage = { kind: 'set-popup', enabled: popupEnabled };
    port.postMessage(msg);
  }
}

toggleBtn.addEventListener('click', () => setInspectorActive(!inspectorActive));
popupToggleBtn.addEventListener('click', () => setPopupEnabled(!popupEnabled));

// Color format preference (applied across the whole app)
function applyColorFormat(format: ColorFormat) {
  colorFormat = format;
  colorFormatSelect.value = format;
  inspectorView.refresh();
  overviewView.refresh();
  if (port) {
    const msg: SidepanelMessage = { kind: 'set-color-format', format };
    port.postMessage(msg);
  }
}

colorFormatSelect.addEventListener('change', () => {
  const format = colorFormatSelect.value as ColorFormat;
  applyColorFormat(format);
  browser.storage.local.set({ colorFormat: format });
});

browser.storage.local.get('colorFormat').then((res) => {
  const stored = res.colorFormat as ColorFormat | undefined;
  applyColorFormat(stored && COLOR_FORMATS.includes(stored) ? stored : 'hex');
});

// Keyboard shortcuts (q=cycle tabs, w=inspector, e=hover popup, n=theme)
function handleShortcut(action: 'toggle-theme' | 'toggle-inspector' | 'toggle-popup' | 'cycle-tab') {
  // Theme lives in Settings, which is gated behind a free account (§7).
  if (action === 'toggle-theme') {
    if (hasTier('free_account')) theme.toggle();
  } else if (action === 'toggle-inspector') setInspectorActive(!inspectorActive);
  else if (action === 'toggle-popup') setPopupEnabled(!popupEnabled);
  else if (action === 'cycle-tab') nav.cycle();
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;
  }
  switch (e.key.toLowerCase()) {
    case 'q':
      handleShortcut('cycle-tab');
      break;
    case 'w':
      handleShortcut('toggle-inspector');
      break;
    case 'e':
      handleShortcut('toggle-popup');
      break;
    case 'n':
      handleShortcut('toggle-theme');
      break;
    default:
      return;
  }
  e.preventDefault();
});

async function connect() {
  const myGen = ++generation;
  port?.disconnect();
  port = undefined;
  inspectorView.reset();

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (myGen !== generation) return;

  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    inspectorView.setStatus("Can't inspect this page.");
    return;
  }

  inspectorView.setStatus('Click an element on the page to inspect…');

  try {
    port = browser.tabs.connect(tab.id, { name: INSPECTOR_PORT });
  } catch {
    inspectorView.setStatus('Content script not available on this page.');
    return;
  }

  port.onMessage.addListener((msg: InspectorMessage) => {
    if (msg.kind === 'update') inspectorView.render(msg.data);
    else if (msg.kind === 'overview') overviewView.render(msg.data);
    else if (msg.kind === 'shortcut') handleShortcut(msg.action);
  });

  port.onDisconnect.addListener(() => {
    if (port) inspectorView.setStatus('Disconnected.');
    port = undefined;
  });

  if (!inspectorActive) {
    const msg: SidepanelMessage = { kind: 'set-active', active: false };
    port.postMessage(msg);
  }
  if (popupEnabled) {
    const msg: SidepanelMessage = { kind: 'set-popup', enabled: true };
    port.postMessage(msg);
  }
  const fmtMsg: SidepanelMessage = { kind: 'set-color-format', format: colorFormat };
  port.postMessage(fmtMsg);
  if (nav.currentView === 'overview') requestOverview();
}

function requestOverview() {
  // Overview is page-level analysis — free-account tier and up (§7). The
  // locked panel is already showing, so just skip the scan.
  if (!hasTier('free_account')) return;
  overviewView.setStatus('Scanning page…');
  if (!port) {
    overviewView.setStatus("Can't inspect this page.");
    return;
  }
  const msg: SidepanelMessage = { kind: 'scan-overview' };
  port.postMessage(msg);
}

connect();
browser.tabs.onActivated.addListener(() => connect());
browser.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) connect();
});
