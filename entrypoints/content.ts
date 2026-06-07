// entrypoints/content.ts
import {
  INSPECTOR_PORT,
  type InspectionData,
  type InspectorMessage,
} from '@/utils/messages';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== INSPECTOR_PORT) return;

      const highlight = createHighlight();
      let hovered: Element | null = null;

      const isOurs = (el: Element | null) =>
        !!el && (el === highlight.host || highlight.host.contains(el));

      const onMouseOver = (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (!target || isOurs(target) || target === hovered) return;
        hovered = target;
        highlight.setTarget(target);
      };

      const onMouseDown = (e: MouseEvent) => {
        if (isOurs(e.target as Element)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      const onClick = (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (!target || isOurs(target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const msg: InspectorMessage = { kind: 'update', data: read(target) };
        port.postMessage(msg);
      };

      const onScrollOrResize = () => {
        if (hovered) highlight.setTarget(hovered);
      };

      document.addEventListener('mouseover', onMouseOver, { capture: true });
      document.addEventListener('mousedown', onMouseDown, { capture: true });
      document.addEventListener('click', onClick, { capture: true });
      window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
      window.addEventListener('resize', onScrollOrResize, { passive: true });

      const prevHtmlCursor = document.documentElement.style.cursor;
      const prevBodyCursor = document.body.style.cursor;
      document.documentElement.style.cursor = 'crosshair';
      document.body.style.cursor = 'crosshair';

      port.onDisconnect.addListener(() => {
        document.removeEventListener('mouseover', onMouseOver, { capture: true });
        document.removeEventListener('mousedown', onMouseDown, { capture: true });
        document.removeEventListener('click', onClick, { capture: true });
        window.removeEventListener('scroll', onScrollOrResize, { capture: true });
        window.removeEventListener('resize', onScrollOrResize);
        document.documentElement.style.cursor = prevHtmlCursor;
        document.body.style.cursor = prevBodyCursor;
        highlight.destroy();
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
      padding: cs.padding,
      margin: cs.margin,
      border: cs.border,
      borderRadius: cs.borderRadius,
    },
    background: { color: cs.backgroundColor, image: cs.backgroundImage },
    layout: { display: cs.display, position: cs.position },
    effects: { boxShadow: cs.boxShadow, opacity: cs.opacity },
  };
}