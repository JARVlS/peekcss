// entrypoints/content.ts
import {
  INSPECTOR_PORT,
  type ColorPurpose,
  type FontRole,
  type FontUsage,
  type ImageInfo,
  type InspectionData,
  type InspectorMessage,
  type OverviewData,
  type SidepanelMessage,
  type TypographyData,
} from '@/utils/messages';
import {
  type ColorFormat,
  composite,
  contrastRatio,
  formatColor,
  formatRgba,
  isLargeText,
  parseColor,
  wcagLevels,
} from '@/utils/color';
import { auditAccessibility, effectiveBackground } from '@/utils/audit';
import { formatFontLength, type FontUnit } from '@/utils/fontUnit';

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
      let fontUnit: FontUnit = 'px';
      let lastX = 0;
      let lastY = 0;

      const isOurs = (el: Element | null) =>
        !!el &&
        (el === highlight.host ||
          highlight.host.contains(el) ||
          el === popup.host ||
          popup.host.contains(el));

      const showPopupFor = (target: Element) => {
        popup.setContent(read(target), colorFormat, fontUnit);
        popup.show();
        popup.position(lastX, lastY);
      };

      const onMouseOver = (e: MouseEvent) => {
        if (!active) return;
        const raw = e.target as Element | null;
        if (!raw || isOurs(raw)) return;
        const target = resolveHoverTarget(raw, e.clientX, e.clientY, isOurs);
        if (target === hovered) return;
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
        const raw = e.target as Element | null;
        if (!raw || isOurs(raw)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        // Resolve the same way as hover so the inspected element matches the
        // highlighted one.
        const target = resolveHoverTarget(raw, e.clientX, e.clientY, isOurs);
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
        let action: 'toggle-theme' | 'toggle-inspector' | 'toggle-popup' | 'cycle-tab' | null = null;
        switch (e.key.toLowerCase()) {
          case 'n':
            action = 'toggle-theme';
            break;
          case 'q':
            action = 'cycle-tab';
            break;
          case 'w':
            action = 'toggle-inspector';
            break;
          case 'e':
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
        } else if (msg.kind === 'scan-typography') {
          const typography: InspectorMessage = { kind: 'typography', data: scanTypography() };
          port.postMessage(typography);
        } else if (msg.kind === 'set-color-format') {
          colorFormat = msg.format;
          if (popupEnabled && active && hovered) showPopupFor(hovered);
        } else if (msg.kind === 'set-font-unit') {
          fontUnit = msg.unit;
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
    setContent(d: InspectionData, colorFormat: ColorFormat, fontUnit: FontUnit) {
      const fmtLen = (v: string) => formatFontLength(v, fontUnit, d.rootFontSize);
      const sel =
        esc(d.selector.tag) +
        (d.selector.id ? `#${esc(d.selector.id)}` : '') +
        d.selector.classes.map((c) => `.${esc(c)}`).join('');

      const items: Array<[string, string, boolean?]> = [
        ['size', `${d.dimensions.width} \u00d7 ${d.dimensions.height}`],
        ['display', d.layout.display],
        ['position', d.layout.position],
        ['font', `${fmtLen(d.typography.fontSize)} / ${d.typography.fontWeight}`],
        ['family', d.typography.fontFamily],
        ['line-height', fmtLen(d.typography.lineHeight)],
        ['letter-spacing', fmtLen(d.typography.letterSpacing)],
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

// Elements that always count as content, even with no text inside.
const VISUAL_TAGS = new Set([
  'IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE', 'INPUT', 'TEXTAREA', 'SELECT',
  'BUTTON', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'HR',
]);

// §6 rework: hovering sometimes lands on an empty wrapper that covers its
// children. When the hovered element has no content of its own, walk down —
// one level at a time — to the nearest child under the cursor that does.
// Children are matched by bounding rect, so pointer-events:none children are
// reachable too. Blank areas (no child under the cursor) keep the wrapper.
function resolveHoverTarget(
  el: Element,
  x: number,
  y: number,
  exclude: (el: Element | null) => boolean,
): Element {
  let current = el;
  for (let depth = 0; depth < 10 && isEmptyContainer(current); depth++) {
    const next = childAtPoint(current, x, y, exclude);
    if (!next) break;
    current = next;
  }
  return current;
}

function childAtPoint(
  parent: Element,
  x: number,
  y: number,
  exclude: (el: Element | null) => boolean,
): Element | null {
  let best: Element | null = null;
  for (const child of Array.from(parent.children)) {
    if (exclude(child)) continue;
    const r = child.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      best = child; // later siblings paint on top, so last match wins
    }
  }
  return best;
}

// "Empty" = no direct text nodes and nothing visually its own (background,
// border, shadow, or a replaced/visual element).
function isEmptyContainer(el: Element): boolean {
  if (VISUAL_TAGS.has(el.tagName.toUpperCase())) return false;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false;
  }
  const cs = window.getComputedStyle(el);
  if (cs.backgroundImage !== 'none') return false;
  const bg = parseColor(cs.backgroundColor);
  if (bg && bg.a > 0) return false;
  if (cs.boxShadow !== 'none') return false;
  if (
    parseFloat(cs.borderTopWidth) > 0 ||
    parseFloat(cs.borderRightWidth) > 0 ||
    parseFloat(cs.borderBottomWidth) > 0 ||
    parseFloat(cs.borderLeftWidth) > 0
  ) {
    return false;
  }
  return true;
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
    rootFontSize:
      parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16,
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

function computeContrast(el: Element, cs: CSSStyleDeclaration): InspectionData['contrast'] {
  const text = parseColor(cs.color);
  if (!text || text.a === 0) return null;
  const bg = effectiveBackground(el);
  const fgOnBg = composite(text, bg);
  const ratio = contrastRatio(fgOnBg, bg);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const fontWeight = parseInt(cs.fontWeight, 10) || 400;
  const large = isLargeText(fontSize, fontWeight);
  const { aa, aaa, label } = wcagLevels(ratio, large);
  return {
    ratio: Math.round(ratio * 100) / 100,
    level: label,
    textColor: cs.color,
    bgColor: formatRgba(bg, 'rgb'),
    fontSize: Math.round(fontSize),
    isLargeText: large,
    aa,
    aaa,
  };
}

function scanOverview(): OverviewData {
  type Tally = { count: number; text: number; background: number; border: number };
  const counts = new Map<string, Tally>();
  const addColor = (raw: string, purpose: ColorPurpose) => {
    const c = parseColor(raw);
    if (!c || c.a === 0) return;
    const key = formatRgba(c, 'rgb');
    let entry = counts.get(key);
    if (!entry) {
      entry = { count: 0, text: 0, background: 0, border: 0 };
      counts.set(key, entry);
    }
    entry.count++;
    entry[purpose]++;
  };

  const all = document.querySelectorAll('*');
  const limit = Math.min(all.length, 6000);
  for (let i = 0; i < limit; i++) {
    const cs = window.getComputedStyle(all[i]);
    addColor(cs.color, 'text');
    addColor(cs.backgroundColor, 'background');
    addColor(cs.borderTopColor, 'border');
    addColor(cs.borderBottomColor, 'border');
    addColor(cs.borderLeftColor, 'border');
    addColor(cs.borderRightColor, 'border');
    addColor(cs.outlineColor, 'border');
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  const colors = sorted.slice(0, 120).map(([color, tally]) => ({ color, ...tally }));
  const prominent = sorted.slice(0, 14).map(([color]) => color);

  return { colors, images: scanImages(), accessibility: auditAccessibility(prominent) };
}

// Tag-based role heuristic for the Typography tab. Computed style alone can't
// recover semantic intent, so we map tags: h1–h6 → heading, form controls and
// nav/buttons → ui, text-flow tags → body, everything else → other.
function fontRoleFor(el: Element): FontRole {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (['button', 'input', 'select', 'textarea', 'label', 'option'].includes(tag)) return 'ui';
  if (['p', 'li', 'td', 'th', 'dd', 'dt', 'blockquote', 'figcaption', 'span', 'a', 'em', 'strong', 'small'].includes(tag)) return 'body';
  return 'other';
}

function scanTypography(): TypographyData {
  type Agg = {
    count: number;
    roles: Record<FontRole, number>;
    sizes: Set<number>;
    weights: Set<number>;
  };
  const families = new Map<string, Agg>();

  const all = document.querySelectorAll('*');
  const limit = Math.min(all.length, 6000);
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    // Only count elements that directly render text.
    if (!Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) {
      continue;
    }
    const cs = window.getComputedStyle(el);
    // First family in the stack is what the browser tried first; good enough
    // without expensive per-glyph fallback detection.
    const family = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (!family) continue;

    let agg = families.get(family);
    if (!agg) {
      agg = {
        count: 0,
        roles: { heading: 0, body: 0, ui: 0, other: 0 },
        sizes: new Set(),
        weights: new Set(),
      };
      families.set(family, agg);
    }
    agg.count++;
    agg.roles[fontRoleFor(el)]++;
    const size = parseFloat(cs.fontSize);
    if (Number.isFinite(size)) agg.sizes.add(Math.round(size * 100) / 100);
    const weight = parseInt(cs.fontWeight, 10);
    if (Number.isFinite(weight)) agg.weights.add(weight);
  }

  const fonts: FontUsage[] = [...families.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 40)
    .map(([family, agg]) => ({
      family,
      count: agg.count,
      roles: agg.roles,
      sizes: [...agg.sizes].sort((a, b) => a - b),
      weights: [...agg.weights].sort((a, b) => a - b),
    }));

  const rootFontSize = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  return { fonts, rootFontSize };
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
      thumb: thumbFor(img, src),
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

// Preview source for an <img>. http(s)/data URLs load directly in the panel
// at full native quality and near-zero cost — the browser already cached them
// while rendering the page, and the grid lazy-loads them so only on-screen
// previews ever fetch. blob:/filesystem URLs are scoped to the page document
// and won't resolve in the panel, so those fall back to a self-contained
// canvas thumbnail (which, being a re-encode, is capped at HD).
function thumbFor(img: HTMLImageElement, src: string): string {
  if (/^(https?:|data:)/i.test(src)) return src;
  return makeThumb(img) ?? src;
}

function makeThumb(img: HTMLImageElement): string | null {
  try {
    // Full native resolution up to an HD ceiling on the longest side: crisp
    // previews without ballooning the inlined data-URL message payload.
    const max = 1280;
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