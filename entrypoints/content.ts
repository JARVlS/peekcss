// entrypoints/content.ts
import {
  INSPECTOR_PORT,
  type DownloadRequest,
  type ImageInfo,
  type InspectionData,
  type InspectorMessage,
  type OverviewData,
  type SidepanelMessage,
} from '@/utils/messages';
import {
  type ColorFormat,
  formatColor,
  formatRgba,
  parseColor,
  type RGBA,
} from '@/utils/color';

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
      let colorFormat: ColorFormat = 'hex';
      let lastX = 0;
      let lastY = 0;

      const isOurs = (el: Element | null) =>
        !!el &&
        (el === highlight.host ||
          highlight.host.contains(el) ||
          el === popup.host ||
          popup.host.contains(el));

      const showPopupFor = (target: Element) => {
        popup.setContent(read(target), colorFormat);
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

      const isEditable = (el: EventTarget | null): boolean => {
        const node = el as HTMLElement | null;
        if (!node) return false;
        const tag = node.tagName;
        return (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          node.isContentEditable
        );
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isEditable(e.target)) return;
        let action: 'toggle-theme' | 'toggle-inspector' | 'toggle-popup' | null = null;
        switch (e.key.toLowerCase()) {
          case 'q':
            action = 'toggle-theme';
            break;
          case 'i':
            action = 'toggle-inspector';
            break;
          case 'h':
            action = 'toggle-popup';
            break;
        }
        if (!action) return;
        e.preventDefault();
        const msg: InspectorMessage = { kind: 'shortcut', action };
        port.postMessage(msg);
      };

      document.addEventListener('mouseover', onMouseOver, { capture: true });
      document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
      document.addEventListener('mousedown', onMouseDown, { capture: true });
      document.addEventListener('click', onClick, { capture: true });
      document.addEventListener('keydown', onKeyDown, { capture: true });
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
        } else if (msg.kind === 'scan-overview') {
          const overview: InspectorMessage = { kind: 'overview', data: scanOverview() };
          port.postMessage(overview);
        } else if (msg.kind === 'download-image') {
          downloadImage(msg.src);
        } else if (msg.kind === 'set-color-format') {
          colorFormat = msg.format;
          if (popupEnabled && active && hovered) showPopupFor(hovered);
        }
      });

      port.onDisconnect.addListener(() => {
        document.removeEventListener('mouseover', onMouseOver, { capture: true });
        document.removeEventListener('mousemove', onMouseMove, { capture: true });
        document.removeEventListener('mousedown', onMouseDown, { capture: true });
        document.removeEventListener('click', onClick, { capture: true });
        document.removeEventListener('keydown', onKeyDown, { capture: true });
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

  const style = document.createElement('style');
  style.textContent = `
    @keyframes pc-outline-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
  `;
  shadow.appendChild(style);

  const box = document.createElement('div');
  box.style.cssText = `
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
    border: 2px solid #8ab4ff;
    background: rgba(138, 180, 255, 0.12);
    border-radius: 2px;
    display: none;
    animation: pc-outline-pulse 1.4s ease-in-out infinite;
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
    setContent(d: InspectionData, colorFormat: ColorFormat) {
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
        ['color', formatColor(d.typography.color, colorFormat), true],
        ['background', formatColor(d.background.color, colorFormat), true],
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
    contrast: computeContrast(el, cs),
    allCss: readAllCss(cs),
  };
}

function readAllCss(cs: CSSStyleDeclaration): string {
  const decls: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    const prop = cs.item(i);
    if (!prop) continue;
    decls.push(`${prop}: ${cs.getPropertyValue(prop)};`);
  }
  return decls.join('\n');
}

function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
    g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
    b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
    a,
  };
}

function relLuminance(c: RGBA): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function effectiveBackground(el: Element): RGBA {
  const white: RGBA = { r: 255, g: 255, b: 255, a: 1 };
  let node: Element | null = el;
  let result: RGBA | null = null;
  while (node) {
    const bg = parseColor(window.getComputedStyle(node).backgroundColor);
    if (bg && bg.a > 0) {
      result = result ? composite(result, bg) : bg;
      if (result.a >= 0.999) return result;
    }
    node = node.parentElement;
  }
  return result ? composite(result, white) : white;
}

function computeContrast(
  el: Element,
  cs: CSSStyleDeclaration,
): InspectionData['contrast'] {
  const text = parseColor(cs.color);
  if (!text || text.a === 0) return null;
  const bg = effectiveBackground(el);
  const fgOnBg = composite(text, bg);
  const l1 = relLuminance(fgOnBg);
  const l2 = relLuminance(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const rounded = Math.round(ratio * 100) / 100;
  const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA Large' : 'Fail';
  return { ratio: rounded, level, textColor: cs.color, bgColor: formatRgba(bg, 'rgb') };
}

function scanOverview(): OverviewData {
  const counts = new Map<string, number>();
  const addColor = (raw: string) => {
    const c = parseColor(raw);
    if (!c || c.a === 0) return;
    const key = formatRgba(c, 'rgb');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  const all = document.querySelectorAll('*');
  const limit = Math.min(all.length, 6000);
  for (let i = 0; i < limit; i++) {
    const cs = window.getComputedStyle(all[i]);
    addColor(cs.color);
    addColor(cs.backgroundColor);
    addColor(cs.borderTopColor);
    addColor(cs.borderBottomColor);
    addColor(cs.borderLeftColor);
    addColor(cs.borderRightColor);
    addColor(cs.outlineColor);
  }

  const colors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 120)
    .map(([color]) => color);

  return { colors, images: scanImages() };
}

function scanImages(): ImageInfo[] {
  const out: ImageInfo[] = [];
  const seen = new Set<string>();

  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    if (!src || seen.has(src)) continue;
    if (!img.complete || img.naturalWidth === 0) continue;
    seen.add(src);
    out.push({
      src,
      thumb: makeThumb(img) ?? src,
      width: img.naturalWidth,
      height: img.naturalHeight,
      kind: 'img',
    });
    if (out.length >= 200) break;
  }

  const urlRe = /url\((['"]?)(.*?)\1\)/g;
  const all = document.querySelectorAll('*');
  const limit = Math.min(all.length, 6000);
  for (let i = 0; i < limit && out.length < 200; i++) {
    const bg = window.getComputedStyle(all[i]).backgroundImage;
    if (!bg || bg === 'none') continue;
    let m: RegExpExecArray | null;
    urlRe.lastIndex = 0;
    while ((m = urlRe.exec(bg))) {
      let url = m[2];
      if (!url || url.startsWith('data:')) continue;
      try {
        url = new URL(url, location.href).href;
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ src: url, thumb: url, width: 0, height: 0, kind: 'background' });
      if (out.length >= 200) break;
    }
  }

  return out;
}

function makeThumb(img: HTMLImageElement): string | null {
  try {
    const max = 96;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, max / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function filenameFromUrl(url: string): string {
  let name = 'image';
  try {
    const u = new URL(url, location.href);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) name = decodeURIComponent(last);
  } catch {
    // keep default
  }
  name = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'image';
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.png`;
}

function downloadImage(src: string) {
  let url = src;
  let filename = filenameFromUrl(src);

  const match = Array.from(document.images).find((i) => (i.currentSrc || i.src) === src);
  if (match && match.complete && match.naturalWidth > 0) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = match.naturalWidth;
      canvas.height = match.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(match, 0, 0);
        url = canvas.toDataURL('image/png');
        filename = filename.replace(/\.[^.]+$/, '') + '.png';
      }
    } catch {
      url = src;
    }
  }

  const req: DownloadRequest = { kind: 'download-request', url, filename };
  browser.runtime.sendMessage(req);
}