import type { ImageInfo, OverviewData } from '@/utils/messages';
import { copyWithFeedback } from '@/utils/clipboard';

// Renders the overview view: the palette of colors and the grid of images
// found on the page.
export class OverviewView {
  private readonly statusEl = document.getElementById('overview-status')!;
  private readonly colorsGridEl = document.getElementById('colors-grid')!;
  private readonly imagesGridEl = document.getElementById('images-grid')!;
  private readonly colorsCountEl = document.getElementById('colors-count')!;
  private readonly imagesCountEl = document.getElementById('images-count')!;

  private lastOverview: OverviewData | null = null;

  constructor(
    private readonly fmtColor: (c: string) => string,
    // Triggers a download of the given image; returns whether it was sent.
    private readonly onDownloadImage: (src: string) => boolean,
  ) {}

  setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  // Re-renders the last overview (e.g. after a color-format change).
  refresh() {
    if (this.lastOverview) this.render(this.lastOverview);
  }

  render(d: OverviewData) {
    this.lastOverview = d;
    this.statusEl.textContent =
      d.colors.length || d.images.length
        ? 'Colors and images found on this page.'
        : 'Nothing found on this page.';

    this.colorsCountEl.textContent = String(d.colors.length);
    this.colorsGridEl.replaceChildren();
    for (const color of d.colors) {
      const formatted = this.fmtColor(color);
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
      this.colorsGridEl.append(cell);
    }

    this.imagesCountEl.textContent = String(d.images.length);
    this.imagesGridEl.replaceChildren();
    for (const img of d.images) {
      this.imagesGridEl.append(this.buildImageCard(img));
    }
  }

  private buildImageCard(img: ImageInfo): HTMLElement {
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
      if (!this.onDownloadImage(img.src)) return;
      dl.classList.add('copied');
      setTimeout(() => dl.classList.remove('copied'), 600);
    });

    card.append(thumbWrap, meta, dl);
    return card;
  }
}
