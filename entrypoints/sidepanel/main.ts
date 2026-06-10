// entrypoints/sidepanel/main.ts
// Orchestrates the side panel: manages the connection to the inspected tab,
// the shared color-format preference, the header toggles, and keyboard
// shortcuts, delegating rendering to the view modules.
import {
  INSPECTOR_PORT,
  type InspectorMessage,
  type SidepanelMessage,
} from '@/utils/messages';
import { type ColorFormat, COLOR_FORMATS, formatColor } from '@/utils/color';
import { ThemeController } from './theme';
import { NavigationController } from './navigation';
import { InspectorView } from './inspectorView';
import { OverviewView } from './overviewView';

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

const theme = new ThemeController();
const inspectorView = new InspectorView(fmtColor);
const overviewView = new OverviewView(fmtColor, (src) => {
  if (!port) return false;
  const msg: SidepanelMessage = { kind: 'download-image', src };
  port.postMessage(msg);
  return true;
});
const nav = new NavigationController((view) => {
  if (view === 'overview') requestOverview();
});

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
  if (action === 'toggle-theme') theme.toggle();
  else if (action === 'toggle-inspector') setInspectorActive(!inspectorActive);
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
