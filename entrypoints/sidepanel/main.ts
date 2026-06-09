// entrypoints/sidepanel/main.ts
import {
  INSPECTOR_PORT,
  type ImageInfo,
  type InspectionData,
  type InspectorMessage,
  type OverviewData,
  type SidepanelMessage,
} from '@/utils/messages';
import { type ColorFormat, COLOR_FORMATS, formatColor } from '@/utils/color';

const statusEl = document.getElementById('status')!;
const panelEl = document.getElementById('panel') as HTMLElement;
const toggleBtn = document.getElementById('toggle')!;
const iconOn = document.getElementById('toggle-icon-on')!;
const iconOff = document.getElementById('toggle-icon-off')!;
const popupToggleBtn = document.getElementById('popup-toggle')!;
const popupIconOn = document.getElementById('popup-icon-on')!;
const popupIconOff = document.getElementById('popup-icon-off')!;
const copyAllBtn = document.getElementById('copy-all')!;
const overviewStatusEl = document.getElementById('overview-status')!;
const colorsGridEl = document.getElementById('colors-grid')!;
const imagesGridEl = document.getElementById('images-grid')!;
const colorsCountEl = document.getElementById('colors-count')!;
const imagesCountEl = document.getElementById('images-count')!;
const contrastBlockEl = document.getElementById('contrast-block') as HTMLElement;
const contrastEl = document.getElementById('contrast')!;
const colorFormatSelect = document.getElementById('color-format') as HTMLSelectElement;

let port: ReturnType<typeof browser.tabs.connect> | undefined;
let generation = 0;
let inspectorActive = true;
let popupEnabled = false;
let colorFormat: ColorFormat = 'hex';
let fullCss = '';
let lastData: InspectionData | null = null;
let lastOverview: OverviewData | null = null;

// Stores current CSS items per section for copy-section buttons
const sectionData: Record<string, Array<[string, string]>> = {};

const fmtColor = (c: string) => formatColor(c, colorFormat);

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

// Bottom navigation: switch between views
const navButtons = document.querySelectorAll<HTMLButtonElement>('.nav-btn');
const views: Record<string, HTMLElement> = {
  inspector: document.getElementById('view-inspector')!,
  overview: document.getElementById('view-overview')!,
  settings: document.getElementById('view-settings')!,
};
navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view!;
    navButtons.forEach((b) => b.classList.toggle('active', b === btn));
    for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
    if (view === 'overview') requestOverview();
  });
});

// Theme (light/dark)
type Theme = 'light' | 'dark';
const themeControl = document.getElementById('theme-control')!;
const themeButtons = themeControl.querySelectorAll<HTMLButtonElement>('button');
let currentTheme: Theme = 'dark';

function applyTheme(theme: Theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  themeButtons.forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
}

function setTheme(theme: Theme) {
  applyTheme(theme);
  browser.storage.local.set({ theme });
}

themeButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTheme(btn.dataset.theme as Theme));
});

browser.storage.local.get('theme').then((res) => {
  applyTheme(res.theme === 'light' ? 'light' : 'dark');
});

// Color format preference (applied across the whole app)
function applyColorFormat(format: ColorFormat) {
  colorFormat = format;
  colorFormatSelect.value = format;
  if (lastData) render(lastData);
  if (lastOverview) renderOverview(lastOverview);
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

// Keyboard shortcuts (q=theme, i=inspector, h=hover popup)
function handleShortcut(action: 'toggle-theme' | 'toggle-inspector' | 'toggle-popup') {
  if (action === 'toggle-theme') setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  else if (action === 'toggle-inspector') setInspectorActive(!inspectorActive);
  else if (action === 'toggle-popup') setPopupEnabled(!popupEnabled);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;
  }
  switch (e.key.toLowerCase()) {
    case 'q':
      handleShortcut('toggle-theme');
      break;
    case 'i':
      handleShortcut('toggle-inspector');
      break;
    case 'h':
      handleShortcut('toggle-popup');
      break;
    default:
      return;
  }
  e.preventDefault();
});

// Section copy buttons
document.querySelectorAll<HTMLButtonElement>('.copy-section').forEach((btn) => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.section!;
    const items = sectionData[section];
    if (!items || items.length === 0) return;
    const css = items.map(([k, v]) => `${k}: ${v};`).join('\n');
    copyWithFeedback(btn, css);
  });
});

// Full export
copyAllBtn.addEventListener('click', () => {
  if (!fullCss) return;
  copyWithFeedback(copyAllBtn, fullCss);
});

async function connect() {
  const myGen = ++generation;
  port?.disconnect();
  port = undefined;
  panelEl.hidden = true;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (myGen !== generation) return;

  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    statusEl.textContent = "Can't inspect this page.";
    return;
  }

  statusEl.textContent = 'Click an element on the page to inspect…';

  try {
    port = browser.tabs.connect(tab.id, { name: INSPECTOR_PORT });
  } catch {
    statusEl.textContent = 'Content script not available on this page.';
    return;
  }

  port.onMessage.addListener((msg: InspectorMessage) => {
    if (msg.kind === 'update') render(msg.data);
    else if (msg.kind === 'overview') renderOverview(msg.data);
    else if (msg.kind === 'shortcut') handleShortcut(msg.action);
  });

  port.onDisconnect.addListener(() => {
    if (port) statusEl.textContent = 'Disconnected.';
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
  if (!views.overview.hidden) requestOverview();
}

function requestOverview() {
  overviewStatusEl.textContent = 'Scanning page…';
  if (!port) {
    overviewStatusEl.textContent = "Can't inspect this page.";
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

function render(d: InspectionData) {
  statusEl.textContent = 'Inspecting';
  panelEl.hidden = false;
  fullCss = d.allCss;
  lastData = d;

  setText('sel-tag', d.selector.tag);
  setText('sel-id', d.selector.id ? `#${d.selector.id}` : '');
  setText('sel-classes', d.selector.classes.map((c) => `.${c}`).join(''));

  const dimText = `${d.dimensions.width} \u00d7 ${d.dimensions.height}`;
  const dimEl = document.getElementById('dim')!;
  dimEl.textContent = dimText;
  dimEl.onclick = () => copyValue(dimEl, `width: ${d.dimensions.width}px;\nheight: ${d.dimensions.height}px;`);

  const typoItems: Array<[string, string]> = [
    ['font-family', d.typography.fontFamily],
    ['font-size', d.typography.fontSize],
    ['font-weight', d.typography.fontWeight],
    ['line-height', d.typography.lineHeight],
    ['letter-spacing', d.typography.letterSpacing],
    ['color', fmtColor(d.typography.color)],
  ];
  sectionData['typo'] = typoItems;
  rows('typo', typoItems.map(([k, v]) => [k, v, k === 'color'] as [string, string, boolean?]));

  const boxItems: Array<[string, string]> = [
    ['margin', `${d.box.marginTop} ${d.box.marginRight} ${d.box.marginBottom} ${d.box.marginLeft}`],
    ['padding', `${d.box.paddingTop} ${d.box.paddingRight} ${d.box.paddingBottom} ${d.box.paddingLeft}`],
    ['border', d.box.border],
    ['border-radius', d.box.borderRadius],
  ];
  sectionData['box'] = boxItems;
  renderBoxModel(d);
  rows('box', [
    ['border', d.box.border],
    ['border-radius', d.box.borderRadius],
  ]);

  const bgItems: Array<[string, string]> = [
    ['background-color', fmtColor(d.background.color)],
    ['background-image', d.background.image],
  ];
  sectionData['bg'] = bgItems;
  rows('bg', bgItems.map(([k, v]) => [k, v, k === 'background-color'] as [string, string, boolean?]));

  const layoutItems: Array<[string, string]> = [
    ['display', d.layout.display],
    ['position', d.layout.position],
  ];
  sectionData['layout'] = layoutItems;
  rows('layout', layoutItems);

  const effectsItems: Array<[string, string]> = [
    ['box-shadow', d.effects.boxShadow],
    ['opacity', d.effects.opacity],
  ];
  sectionData['effects'] = effectsItems;
  rows('effects', effectsItems);

  renderContrast(d.contrast);
}

function renderContrast(c: InspectionData['contrast']) {
  contrastEl.replaceChildren();
  if (!c) {
    contrastBlockEl.hidden = true;
    return;
  }
  contrastBlockEl.hidden = false;

  const ratio = document.createElement('div');
  ratio.className = 'contrast-ratio';

  const badge = document.createElement('span');
  badge.className = 'contrast-badge ' + (c.level === 'Fail' ? 'fail' : 'pass');
  badge.textContent = c.level;

  const value = document.createElement('span');
  value.className = 'contrast-value';
  value.textContent = `${c.ratio.toFixed(2)}:1`;

  const preview = document.createElement('span');
  preview.className = 'contrast-preview';
  preview.textContent = 'Aa';
  preview.style.color = c.textColor;
  preview.style.background = c.bgColor;

  ratio.append(preview, value, badge);
  contrastEl.append(ratio);

  rows('contrast', [
    ['text', fmtColor(c.textColor), true],
    ['background', fmtColor(c.bgColor), true],
  ]);
}

function renderOverview(d: OverviewData) {
  lastOverview = d;
  overviewStatusEl.textContent = d.colors.length || d.images.length
    ? 'Colors and images found on this page.'
    : 'Nothing found on this page.';

  colorsCountEl.textContent = String(d.colors.length);
  colorsGridEl.replaceChildren();
  for (const color of d.colors) {
    const formatted = fmtColor(color);
    const cell = document.createElement('button');
    cell.className = 'color-cell';
    cell.title = `${formatted} — click to copy`;
    const sw = document.createElement('span');
    sw.className = 'color-chip';
    sw.style.background = color;
    const label = document.createElement('span');
    label.className = 'color-label';
    label.textContent = formatted;
    cell.append(sw, label);
    cell.addEventListener('click', () => copyWithFeedback(cell, formatted));
    colorsGridEl.append(cell);
  }

  imagesCountEl.textContent = String(d.images.length);
  imagesGridEl.replaceChildren();
  for (const img of d.images) {
    imagesGridEl.append(buildImageCard(img));
  }
}

function buildImageCard(img: ImageInfo): HTMLElement {
  const card = document.createElement('div');
  card.className = 'image-card';

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'image-thumb';
  const el = document.createElement('img');
  el.loading = 'lazy';
  el.src = img.thumb;
  el.alt = '';
  thumbWrap.append(el);

  const meta = document.createElement('div');
  meta.className = 'image-meta';
  meta.textContent = img.width && img.height ? `${img.width}\u00d7${img.height}` : img.kind;

  const dl = document.createElement('button');
  dl.className = 'copy-btn image-dl';
  dl.textContent = 'Download';
  dl.title = img.src;
  dl.addEventListener('click', () => {
    if (!port) return;
    const msg: SidepanelMessage = { kind: 'download-image', src: img.src };
    port.postMessage(msg);
    dl.classList.add('copied');
    setTimeout(() => dl.classList.remove('copied'), 600);
  });

  card.append(thumbWrap, meta, dl);
  return card;
}

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderBoxModel(d: InspectionData) {
  const container = document.getElementById('box-model')!;
  container.replaceChildren();

  const strip = (v: string) => parseFloat(v) || 0;

  const margin = {
    top: strip(d.box.marginTop),
    right: strip(d.box.marginRight),
    bottom: strip(d.box.marginBottom),
    left: strip(d.box.marginLeft),
  };
  const padding = {
    top: strip(d.box.paddingTop),
    right: strip(d.box.paddingRight),
    bottom: strip(d.box.paddingBottom),
    left: strip(d.box.paddingLeft),
  };
  const w = d.dimensions.width;
  const h = d.dimensions.height;

  const marginCss = `margin: ${d.box.marginTop} ${d.box.marginRight} ${d.box.marginBottom} ${d.box.marginLeft};`;
  const paddingCss = `padding: ${d.box.paddingTop} ${d.box.paddingRight} ${d.box.paddingBottom} ${d.box.paddingLeft};`;

  container.innerHTML = `
    <div class="bm-margin" title="Click to copy margin">
      <span class="bm-label">margin</span>
      <span class="bm-top">${margin.top}</span>
      <span class="bm-right">${margin.right}</span>
      <span class="bm-bottom">${margin.bottom}</span>
      <span class="bm-left">${margin.left}</span>
      <div class="bm-padding" title="Click to copy padding">
        <span class="bm-label">padding</span>
        <span class="bm-top">${padding.top}</span>
        <span class="bm-right">${padding.right}</span>
        <span class="bm-bottom">${padding.bottom}</span>
        <span class="bm-left">${padding.left}</span>
        <div class="bm-content">${w} \u00d7 ${h}</div>
      </div>
    </div>
  `;

  const marginEl = container.querySelector<HTMLElement>('.bm-margin')!;
  const paddingEl = container.querySelector<HTMLElement>('.bm-padding')!;

  marginEl.addEventListener('click', (e) => {
    if (paddingEl.contains(e.target as Node)) return;
    copyWithFeedback(marginEl, marginCss);
  });

  paddingEl.addEventListener('click', (e) => {
    const content = paddingEl.querySelector('.bm-content');
    if (content && content.contains(e.target as Node)) return;
    e.stopPropagation();
    copyWithFeedback(paddingEl, paddingCss);
  });
}

function rows(containerId: string, items: Array<[string, string, boolean?]>) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.replaceChildren();
  for (const [key, val, isColor] of items) {
    const row = document.createElement('div');
    row.className = 'row';
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'val';
    v.textContent = val || '\u2014';
    if (val) {
      const cssDecl = `${key}: ${val};`;
      v.addEventListener('click', () => copyValue(v, cssDecl));
    }
    if (isColor && val) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = val;
      v.prepend(sw);
    }
    row.append(k, v);
    c.append(row);
  }
}

function copyValue(el: HTMLElement, text: string) {
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 600);
  });
}

function copyWithFeedback(el: HTMLElement, text: string) {
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 600);
  });
}
