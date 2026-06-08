// entrypoints/sidepanel/main.ts
import {
  INSPECTOR_PORT,
  type InspectionData,
  type InspectorMessage,
  type SidepanelMessage,
} from '@/utils/messages';

const statusEl = document.getElementById('status')!;
const panelEl = document.getElementById('panel') as HTMLElement;
const toggleBtn = document.getElementById('toggle')!;
const iconOn = document.getElementById('toggle-icon-on')!;
const iconOff = document.getElementById('toggle-icon-off')!;
const copyAllBtn = document.getElementById('copy-all')!;

let port: ReturnType<typeof browser.tabs.connect> | undefined;
let generation = 0;
let inspectorActive = true;

// Stores current CSS items per section for copy-section buttons
const sectionData: Record<string, Array<[string, string]>> = {};

toggleBtn.addEventListener('click', () => {
  inspectorActive = !inspectorActive;
  toggleBtn.classList.toggle('active', inspectorActive);
  iconOn.style.display = inspectorActive ? '' : 'none';
  iconOff.style.display = inspectorActive ? 'none' : '';
  if (port) {
    const msg: SidepanelMessage = { kind: 'set-active', active: inspectorActive };
    port.postMessage(msg);
  }
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
  const all = Object.values(sectionData).flat();
  if (all.length === 0) return;
  const css = all.map(([k, v]) => `${k}: ${v};`).join('\n');
  copyWithFeedback(copyAllBtn, css);
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
  });

  port.onDisconnect.addListener(() => {
    if (port) statusEl.textContent = 'Disconnected.';
    port = undefined;
  });

  if (!inspectorActive) {
    const msg: SidepanelMessage = { kind: 'set-active', active: false };
    port.postMessage(msg);
  }
}

connect();
browser.tabs.onActivated.addListener(() => connect());
browser.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) connect();
});

function render(d: InspectionData) {
  statusEl.textContent = 'Inspecting';
  panelEl.hidden = false;

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
    ['color', d.typography.color],
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
    ['background-color', d.background.color],
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
