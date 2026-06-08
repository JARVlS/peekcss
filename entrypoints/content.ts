// entrypoints/content.ts
import {
  INSPECTOR_PORT,
  type InspectionData,
  type InspectorMessage,
  type SidepanelMessage,
} from '@/utils/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== INSPECTOR_PORT) return;

      const highlight = createHighlight();
      const popup = createPopup();
      let hovered: Element | null = null;
      let active = true;
      let popupEnabled = false;
      let lastX = 0;
      let lastY = 0;

      const isOurs = (el: Element | null) =>
        !!el &&
        (el === highlight.host ||
          highlight.host.contains(el) ||
          el === popup.host ||
          popup.host.contains(el));

      const showPopupFor = (target: Element) => {
        popup.setContent(read(target));
        popup.show();
        popup.position(lastX, lastY);
      };

      const onMouseOver = (e: MouseEvent) => {
        if (!active) return;
        const target = e.target as Element | null;
        if (!target || isOurs(target) || target === hovered) return;
        hovered = target;
        highlight.setTarget(target);
        if (popupEnabled) showPopupFor(target);
      };

      const onMouseMove = (e: MouseEvent) => {
        lastX = e.clientX;
        lastY = e.clientY;
        if (active && popupEnabled && hovered) popup.position(lastX, lastY);
      };

      const onMouseDown = (e: MouseEvent) => {
        if (!active) return;
        if (isOurs(e.target as Element)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      const onClick = (e: MouseEvent) => {
        if (!active) return;
        const target = e.target as Element | null;
        if (!target || isOurs(target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const msg: InspectorMessage = { kind: 'update', data: read(target) };
        port.postMessage(msg);
      };

      const onScrollOrResize = () => {
        if (active && hovered) {
          highlight.setTarget(hovered);
          if (popupEnabled) popup.position(lastX, lastY);
        }
      };

      document.addEventListener('mouseover', onMouseOver, { capture: true });
      document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
      document.addEventListener('mousedown', onMouseDown, { capture: true });
      document.addEventListener('click', onClick, { capture: true });
      window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
      window.addEventListener('resize', onScrollOrResize, { passive: true });

      const prevHtmlCursor = document.documentElement.style.cursor;
      const prevBodyCursor = document.body.style.cursor;
      document.documentElement.style.cursor = 'crosshair';
      document.body.style.cursor = 'crosshair';

      port.onMessage.addListener((msg: SidepanelMessage) => {
        if (msg.kind === 'set-active') {
          active = msg.active;
          if (active) {
            document.documentElement.style.cursor = 'crosshair';
            document.body.style.cursor = 'crosshair';
          } else {
            highlight.hide();
            popup.hide();
            hovered = null;
            document.documentElement.style.cursor = prevHtmlCursor;
            document.body.style.cursor = prevBodyCursor;
          }
        } else if (msg.kind === 'set-popup') {
          popupEnabled = msg.enabled;
          if (popupEnabled && active && hovered) {
            showPopupFor(hovered);
          } else {
            popup.hide();
          }
        }
      });

      port.onDisconnect.addListener(() => {
        document.removeEventListener('mouseover', onMouseOver, { capture: true });
        document.removeEventListener('mousemove', onMouseMove, { capture: true });
        document.removeEventListener('mousedown', onMouseDown, { capture: true });
        document.removeEventListener('click', onClick, { capture: true });
        window.removeEventListener('scroll', onScrollOrResize, { capture: true });
        window.removeEventListener('resize', onScrollOrResize);
        document.documentElement.style.cursor = prevHtmlCursor;
        document.body.style.cursor = prevBodyCursor;
        highlight.destroy();
        popup.destroy();
        hovered = null;
      });
    });
  },
});

function createHighlight() {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const box = document.createElement('div');
  box.style.cssText = `
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
    border: 2px solid #8ab4ff;
    background: rgba(138, 180, 255, 0.12);
    border-radius: 2px;
    display: none;
  `;
  shadow.appendChild(box);
  document.documentElement.appendChild(host);

  return {
    host,
    setTarget(el: Element) {
      const r = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
    },
    hide() {
      box.style.display = 'none';
    },
    destroy() {
      host.remove();
    },
  };
}

function createPopup() {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .pc-popup {
      position: fixed;
      max-width: 320px;
      max-height: calc(100vh - 16px);
      overflow: hidden;
      box-sizing: border-box;
      background: #161a21;
      color: #e6e8eb;
      border: 1px solid #2a3140;
      border-radius: 6px;
      padding: 8px 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.5;
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
      display: none;
    }
    .pc-sel {
      color: #8ab4ff;
      font-weight: 600;
      margin-bottom: 5px;
      padding-bottom: 5px;
      border-bottom: 1px solid #2a3140;
      word-break: break-all;
    }
    .pc-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 1px 12px;
    }
    .pc-k { color: #8b94a7; white-space: nowrap; }
    .pc-v {
      color: #e6e8eb;
      text-align: right;
      word-break: break-all;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
    }
    .pc-swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      border: 1px solid #2a3140;
      flex: none;
    }
  `;
  shadow.appendChild(style);

  const box = document.createElement('div');
  box.className = 'pc-popup';
  shadow.appendChild(box);
  document.documentElement.appendChild(host);

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const swatch = (color: string) =>
    `<span class="pc-swatch" style="background:${esc(color)}"></span>`;

  return {
    host,
    setContent(d: InspectionData) {
      const sel =
        esc(d.selector.tag) +
        (d.selector.id ? `#${esc(d.selector.id)}` : '') +
        d.selector.classes.map((c) => `.${esc(c)}`).join('');

      const items: Array<[string, string, boolean?]> = [
        ['size', `${d.dimensions.width} \u00d7 ${d.dimensions.height}`],
        ['display', d.layout.display],
        ['position', d.layout.position],
        ['font', `${d.typography.fontSize} / ${d.typography.fontWeight}`],
        ['family', d.typography.fontFamily],
        ['line-height', d.typography.lineHeight],
        ['letter-spacing', d.typography.letterSpacing],
        ['color', d.typography.color, true],
        ['background', d.background.color, true],
      ];

      if (d.background.image && d.background.image !== 'none') {
        items.push(['bg-image', d.background.image]);
      }

      items.push(
        ['margin', `${d.box.marginTop} ${d.box.marginRight} ${d.box.marginBottom} ${d.box.marginLeft}`],
        ['padding', `${d.box.paddingTop} ${d.box.paddingRight} ${d.box.paddingBottom} ${d.box.paddingLeft}`],
        ['border', d.box.border],
        ['radius', d.box.borderRadius],
        ['shadow', d.effects.boxShadow],
        ['opacity', d.effects.opacity],
      );

      const grid = items
        .filter(([, v]) => v && v !== 'none' && v !== 'normal')
        .map(
          ([k, v, isColor]) =>
            `<span class="pc-k">${esc(k)}</span><span class="pc-v">${
              isColor ? swatch(v) : ''
            }${esc(v)}</span>`,
        )
        .join('');

      box.innerHTML = `<div class="pc-sel">${sel}</div><div class="pc-grid">${grid}</div>`;
    },
    show() {
      box.style.display = 'block';
    },
    hide() {
      box.style.display = 'none';
    },
    position(x: number, y: number) {
      if (box.style.display === 'none') return;
      const offset = 14;
      const pad = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = box.offsetWidth;
      const h = box.offsetHeight;

      let left = x + offset;
      if (left + w + pad > vw) left = x - offset - w;
      if (left < pad) left = pad;
      if (left + w + pad > vw) left = Math.max(pad, vw - w - pad);

      let top = y + offset;
      if (top + h + pad > vh) top = y - offset - h;
      if (top < pad) top = pad;
      if (top + h + pad > vh) top = Math.max(pad, vh - h - pad);

      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
    },
    destroy() {
      host.remove();
    },
  };
}

function read(el: Element): InspectionData {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    selector: {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList),
    },
    dimensions: { width: Math.round(rect.width), height: Math.round(rect.height) },
    typography: {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      color: cs.color,
    },
    box: {
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      marginTop: cs.marginTop,
      marginRight: cs.marginRight,
      marginBottom: cs.marginBottom,
      marginLeft: cs.marginLeft,
      border: cs.border,
      borderRadius: cs.borderRadius,
    },
    background: { color: cs.backgroundColor, image: cs.backgroundImage },
    layout: { display: cs.display, position: cs.position },
    effects: { boxShadow: cs.boxShadow, opacity: cs.opacity },
  };
}