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

let port: ReturnType<typeof browser.tabs.connect> | undefined;
let generation = 0;
let inspectorActive = true;

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

async function connect() {
  const myGen = ++generation;
  port?.disconnect();
  port = undefined;
  panelEl.hidden = true;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (myGen !== generation) return; // a newer connect() superseded us

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

  // Sync the current toggle state to the newly connected content script
  if (!inspectorActive) {
    const msg: SidepanelMessage = { kind: 'set-active', active: false };
    port.postMessage(msg);
  }
}

// Initial connection + react to tab switches and full page loads
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

  const dimText = `${d.dimensions.width} × ${d.dimensions.height}`;
  const dimEl = document.getElementById('dim')!;
  dimEl.textContent = dimText;
  dimEl.onclick = () => copyValue(dimEl, dimText);

  rows('typo', [
    ['font-family', d.typography.fontFamily],
    ['font-size', d.typography.fontSize],
    ['font-weight', d.typography.fontWeight],
    ['line-height', d.typography.lineHeight],
    ['letter-spacing', d.typography.letterSpacing],
    ['color', d.typography.color, true],
  ]);
  rows('box', [
    ['padding', d.box.padding],
    ['margin', d.box.margin],
    ['border', d.box.border],
    ['border-radius', d.box.borderRadius],
  ]);
  rows('bg', [
    ['background-color', d.background.color, true],
    ['background-image', d.background.image],
  ]);
  rows('layout', [
    ['display', d.layout.display],
    ['position', d.layout.position],
  ]);
  rows('effects', [
    ['box-shadow', d.effects.boxShadow],
    ['opacity', d.effects.opacity],
  ]);
}

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
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
    v.textContent = val || '—';
    if (val) {
      v.addEventListener('click', () => copyValue(v, val));
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