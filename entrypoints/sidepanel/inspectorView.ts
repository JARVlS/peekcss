import type { InspectionData } from '@/utils/messages';
import { copyWithFeedback } from '@/utils/clipboard';

// Renders the inspector view: the selector, box model, and the typography,
// box, background, layout, effects, and contrast sections. Also owns the
// per-section and "copy all" export buttons.
export class InspectorView {
  private readonly statusEl = document.getElementById('status')!;
  private readonly panelEl = document.getElementById('panel') as HTMLElement;
  private readonly contrastBlockEl = document.getElementById('contrast-block') as HTMLElement;
  private readonly contrastEl = document.getElementById('contrast')!;
  private readonly copyAllBtn = document.getElementById('copy-all')!;

  // Stores current CSS items per section for the copy-section buttons.
  private readonly sectionData: Record<string, Array<[string, string]>> = {};
  private fullCss = '';
  private lastData: InspectionData | null = null;

  constructor(
    private readonly fmtColor: (c: string) => string,
    // Converts a computed px length into the preferred font unit; needs the
    // inspected page's root font size for rem.
    private readonly fmtLength: (v: string, rootPx: number) => string,
  ) {
    document.querySelectorAll<HTMLButtonElement>('.copy-section').forEach((btn) => {
      btn.addEventListener('click', () => {
        const items = this.sectionData[btn.dataset.section!];
        if (!items || items.length === 0) return;
        const css = items.map(([k, v]) => `${k}: ${v};`).join('\n');
        copyWithFeedback(btn, css);
      });
    });

    this.copyAllBtn.addEventListener('click', () => {
      if (!this.fullCss) return;
      copyWithFeedback(this.copyAllBtn, this.fullCss);
    });
  }

  setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  reset() {
    this.panelEl.hidden = true;
  }

  // Re-renders the last inspected element (e.g. after a color-format change).
  refresh() {
    if (this.lastData) this.render(this.lastData);
  }

  render(d: InspectionData) {
    this.statusEl.textContent = 'Inspecting';
    this.panelEl.hidden = false;
    this.fullCss = d.allCss;
    this.lastData = d;

    setText('sel-tag', d.selector.tag);
    setText('sel-id', d.selector.id ? `#${d.selector.id}` : '');
    setText('sel-classes', d.selector.classes.map((c) => `.${c}`).join(''));

    const dimEl = document.getElementById('dim')!;
    dimEl.textContent = `${d.dimensions.width} \u00d7 ${d.dimensions.height}`;
    dimEl.onclick = () =>
      copyWithFeedback(dimEl, `width: ${d.dimensions.width}px;\nheight: ${d.dimensions.height}px;`);

    const fmtLen = (v: string) => this.fmtLength(v, d.rootFontSize || 16);
    const typoItems: Array<[string, string]> = [
      ['font-family', d.typography.fontFamily],
      ['font-size', fmtLen(d.typography.fontSize)],
      ['font-weight', d.typography.fontWeight],
      ['line-height', fmtLen(d.typography.lineHeight)],
      ['letter-spacing', fmtLen(d.typography.letterSpacing)],
      ['color', this.fmtColor(d.typography.color)],
    ];
    this.sectionData['typo'] = typoItems;
    rows('typo', typoItems.map(([k, v]) => [k, v, k === 'color'] as [string, string, boolean?]));

    const boxItems: Array<[string, string]> = [
      ['margin', `${d.box.marginTop} ${d.box.marginRight} ${d.box.marginBottom} ${d.box.marginLeft}`],
      ['padding', `${d.box.paddingTop} ${d.box.paddingRight} ${d.box.paddingBottom} ${d.box.paddingLeft}`],
      ['border', d.box.border],
      ['border-radius', d.box.borderRadius],
    ];
    this.sectionData['box'] = boxItems;
    renderBoxModel(d);
    rows('box', [
      ['border', d.box.border],
      ['border-radius', d.box.borderRadius],
    ]);

    const bgItems: Array<[string, string]> = [
      ['background-color', this.fmtColor(d.background.color)],
      ['background-image', d.background.image],
    ];
    this.sectionData['bg'] = bgItems;
    rows('bg', bgItems.map(([k, v]) => [k, v, k === 'background-color'] as [string, string, boolean?]));

    const layoutItems: Array<[string, string]> = [
      ['display', d.layout.display],
      ['position', d.layout.position],
    ];
    this.sectionData['layout'] = layoutItems;
    rows('layout', layoutItems);

    const effectsItems: Array<[string, string]> = [
      ['box-shadow', d.effects.boxShadow],
      ['opacity', d.effects.opacity],
    ];
    this.sectionData['effects'] = effectsItems;
    rows('effects', effectsItems);

    this.renderContrast(d.contrast);
  }

  private renderContrast(c: InspectionData['contrast']) {
    this.contrastEl.replaceChildren();
    if (!c) {
      this.contrastBlockEl.hidden = true;
      return;
    }
    this.contrastBlockEl.hidden = false;

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
    this.contrastEl.append(ratio);

    const levels = document.createElement('div');
    levels.className = 'contrast-levels';
    levels.append(
      levelChip('AA', c.aa),
      levelChip('AAA', c.aaa),
      sizeTag(`${c.fontSize}px${c.isLargeText ? ' · large' : ''}`),
    );
    this.contrastEl.append(levels);

    rows('contrast', [
      ['text', this.fmtColor(c.textColor), true],
      ['background', this.fmtColor(c.bgColor), true],
    ]);
  }
}

function levelChip(label: string, pass: boolean): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'contrast-chip ' + (pass ? 'pass' : 'fail');
  chip.textContent = `${label} ${pass ? '\u2713' : '\u2717'}`;
  return chip;
}

function sizeTag(text: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'contrast-size';
  tag.textContent = text;
  return tag;
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
      v.addEventListener('click', () => copyWithFeedback(v, cssDecl));
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

function setText(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
