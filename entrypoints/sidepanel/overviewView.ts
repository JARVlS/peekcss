import type {
  AccessibilityReport,
  ColorPurpose,
  ContrastIssue,
  ImageInfo,
  OverviewData,
  PaletteColor,
} from '@/utils/messages';
import { copyWithFeedback } from '@/utils/clipboard';
import { type DownloadOutcome, filenameForAsset } from '@/utils/download';
import { dominantPurpose, exportPalette, type PaletteExportFormat } from '@/utils/palette';
import { buildZip, fetchImageBytes, type ZipEntry } from '@/utils/zipExport';

// Renders the overview view: the page-wide accessibility audit, the list of
// contrast issues, the palette of colors, and the grid of images found on
// the page.
export class OverviewView {
  private readonly statusEl = document.getElementById('overview-status')!;
  private readonly a11yBlock = document.getElementById('a11y-block') as HTMLElement;
  private readonly a11ySummaryEl = document.getElementById('a11y-summary')!;
  private readonly a11yBreakdownEl = document.getElementById('a11y-breakdown')!;
  private readonly issuesBlock = document.getElementById('contrast-issues-block') as HTMLElement;
  private readonly issuesEl = document.getElementById('contrast-issues')!;
  private readonly issuesCountEl = document.getElementById('contrast-issues-count')!;
  private readonly colorsGridEl = document.getElementById('colors-grid')!;
  private readonly colorsGroupsEl = document.getElementById('colors-groups') as HTMLElement;
  private readonly groupButtons = document
    .getElementById('colors-group-control')!
    .querySelectorAll<HTMLButtonElement>('button');
  private readonly exportSelect = document.getElementById('palette-export') as HTMLSelectElement;
  private readonly imagesGridEl = document.getElementById('images-grid')!;
  private readonly downloadAllBtn = document.getElementById('images-download-all') as HTMLButtonElement;
  private readonly colorsCountEl = document.getElementById('colors-count')!;
  private readonly imagesCountEl = document.getElementById('images-count')!;

  private lastOverview: OverviewData | null = null;
  private groupByPurpose = false;
  private proEnabled = false;

  // One entry per rendered image card. "Download all" replays these triggers
  // sequentially, and each trigger also drives its own card's button UI.
  private imageTriggers: Array<() => Promise<DownloadOutcome>> = [];

  constructor(
    private readonly fmtColor: (c: string) => string,
    // Downloads the given asset; resolves with success or a failure reason so
    // the card can surface a per-image error instead of failing silently.
    private readonly onDownloadImage: (url: string, filename: string) => Promise<DownloadOutcome>,
    // Downloads an in-memory blob (the ZIP bundle) via the downloads API.
    private readonly onDownloadBlob: (blob: Blob, filename: string) => Promise<DownloadOutcome>,
  ) {
    this.downloadAllBtn.addEventListener('click', () => {
      void this.downloadAll();
    });

    this.groupButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.setGroupMode(btn.dataset.group === 'purpose');
      });
    });

    this.exportSelect.addEventListener('change', () => {
      const format = this.exportSelect.value as PaletteExportFormat | '';
      this.exportSelect.value = '';
      if (!format || !this.lastOverview || this.lastOverview.colors.length === 0) return;
      const text = exportPalette(this.lastOverview.colors, format, this.fmtColor);
      copyWithFeedback(this.exportSelect, text);
    });

    this.setProEnabled(false);
  }

  // §7: palette grouping and export are Pro features. The controls stay
  // visible but disabled with a tier hint when locked.
  setProEnabled(enabled: boolean) {
    this.proEnabled = enabled;
    const purposeBtn = [...this.groupButtons].find((b) => b.dataset.group === 'purpose')!;
    purposeBtn.disabled = !enabled;
    purposeBtn.title = enabled ? 'Group colors by where they are used' : 'Requires PeekCSS Pro';
    purposeBtn.classList.toggle('locked', !enabled);
    this.exportSelect.disabled = !enabled;
    this.exportSelect.title = enabled ? 'Export palette' : 'Requires PeekCSS Pro';
    this.exportSelect.classList.toggle('locked', !enabled);
    // §7: bulk image download (ZIP) is Pro; single-image download stays free.
    this.downloadAllBtn.disabled = !enabled;
    this.downloadAllBtn.title = enabled
      ? 'Download all images as a ZIP'
      : 'Requires PeekCSS Pro';
    this.downloadAllBtn.classList.toggle('locked', !enabled);
    if (!enabled && this.groupByPurpose) {
      this.setGroupMode(false);
    }
  }

  private setGroupMode(byPurpose: boolean) {
    this.groupByPurpose = byPurpose && this.proEnabled;
    this.groupButtons.forEach((b) =>
      b.classList.toggle('active', (b.dataset.group === 'purpose') === this.groupByPurpose),
    );
    if (this.lastOverview) this.renderColors(this.lastOverview.colors);
  }

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

    this.renderAccessibility(d.accessibility);
    this.renderContrastIssues(d.accessibility.contrast.issues);

    this.colorsCountEl.textContent = String(d.colors.length);
    this.renderColors(d.colors);

    this.imagesCountEl.textContent = String(d.images.length);
    this.imagesGridEl.replaceChildren();
    this.imageTriggers = [];
    d.images.forEach((img, index) => {
      this.imagesGridEl.append(this.buildImageCard(img, index));
    });

    this.downloadAllBtn.hidden = d.images.length === 0;
    this.downloadAllBtn.disabled = !this.proEnabled;
    this.downloadAllBtn.textContent = 'Download all';
  }

  private renderColors(palette: PaletteColor[]) {
    if (!this.groupByPurpose) {
      this.colorsGroupsEl.hidden = true;
      this.colorsGridEl.hidden = false;
      this.colorsGridEl.replaceChildren();
      for (const entry of palette) this.colorsGridEl.append(this.buildColorCell(entry));
      return;
    }

    this.colorsGridEl.hidden = true;
    this.colorsGroupsEl.hidden = false;
    this.colorsGroupsEl.replaceChildren();

    const groups: Record<ColorPurpose, PaletteColor[]> = { background: [], text: [], border: [] };
    for (const entry of palette) groups[dominantPurpose(entry)].push(entry);

    const titles: Record<ColorPurpose, string> = {
      background: 'Background',
      text: 'Text',
      border: 'Border',
    };
    for (const purpose of ['background', 'text', 'border'] as ColorPurpose[]) {
      const entries = groups[purpose];
      if (entries.length === 0) continue;
      const title = document.createElement('h3');
      title.className = 'palette-group-title';
      title.textContent = `${titles[purpose]} (${entries.length})`;
      const grid = document.createElement('div');
      grid.className = 'colors-grid';
      for (const entry of entries) grid.append(this.buildColorCell(entry));
      this.colorsGroupsEl.append(title, grid);
    }
  }

  private buildColorCell(entry: PaletteColor): HTMLElement {
    const formatted = this.fmtColor(entry.color);
    const cell = document.createElement('button');
    cell.className = 'color-cell';
    cell.title = `${formatted} — text ×${entry.text} · bg ×${entry.background} · border ×${entry.border} — click to copy`;
    const sw = document.createElement('span');
    sw.className = 'color-chip';
    sw.style.background = entry.color;
    const label = document.createElement('span');
    label.className = 'color-label';
    label.textContent = formatted;
    cell.append(sw, label);
    cell.addEventListener('click', () => copyWithFeedback(cell, formatted));
    return cell;
  }

  private renderAccessibility(report: AccessibilityReport) {
    this.a11yBlock.hidden = false;

    // Score ring + grade.
    this.a11ySummaryEl.replaceChildren();
    const summary = document.createElement('div');
    summary.className = 'a11y-score';

    const ring = document.createElement('div');
    ring.className = 'a11y-ring';
    ring.style.setProperty('--pct', String(report.score));
    ring.style.setProperty('--ring', scoreColor(report.score));
    const num = document.createElement('span');
    num.className = 'a11y-ring-num';
    num.textContent = String(report.score);
    ring.append(num);

    const meta = document.createElement('div');
    meta.className = 'a11y-score-meta';
    const grade = document.createElement('span');
    grade.className = 'a11y-grade';
    grade.style.color = scoreColor(report.score);
    grade.textContent = report.grade;
    const rating = document.createElement('span');
    rating.className = 'a11y-rating';
    rating.textContent = report.rating;
    const sub = document.createElement('span');
    sub.className = 'a11y-sub';
    sub.textContent = 'Accessibility score';
    meta.append(grade, rating, sub);

    summary.append(ring, meta);
    this.a11ySummaryEl.append(summary);

    // Per-category breakdown bars.
    this.a11yBreakdownEl.replaceChildren();
    const c = report.contrast;
    this.a11yBreakdownEl.append(
      bar('Contrast', c.score, c.failed > 0
        ? `${c.failed} of ${c.checked} text elements fail WCAG AA`
        : `All ${c.checked} text elements pass WCAG AA`),
    );

    const t = report.textSize;
    this.a11yBreakdownEl.append(
      bar('Text size', t.score, t.smallCount > 0
        ? `${t.smallCount} elements below 12px (smallest ${t.smallestPx}px)`
        : 'No tiny text detected'),
    );

    const cb = report.colorBlind;
    const cbRow = bar('Color-blind safety', cb.score, cb.conflicts.length > 0
      ? `${cb.conflicts.length} color pair(s) hard to tell apart`
      : 'Palette stays distinguishable');
    if (cb.conflicts.length > 0) {
      const pairs = document.createElement('div');
      pairs.className = 'a11y-cb-pairs';
      for (const conflict of cb.conflicts) {
        const pair = document.createElement('span');
        pair.className = 'a11y-cb-pair';
        pair.title = `${conflict.a} vs ${conflict.b} — ${conflict.type}`;
        pair.append(swatch(conflict.a), swatch(conflict.b));
        pairs.append(pair);
      }
      cbRow.append(pairs);
    }
    this.a11yBreakdownEl.append(cbRow);
  }

  private renderContrastIssues(issues: ContrastIssue[]) {
    this.issuesCountEl.textContent = issues.length ? String(issues.length) : '';
    this.issuesEl.replaceChildren();

    if (issues.length === 0) {
      this.issuesBlock.hidden = false;
      const ok = document.createElement('p');
      ok.className = 'a11y-empty';
      ok.textContent = 'No contrast issues found. \u2713';
      this.issuesEl.append(ok);
      return;
    }

    this.issuesBlock.hidden = false;
    for (const issue of issues) {
      this.issuesEl.append(this.buildIssue(issue));
    }
  }

  private buildIssue(issue: ContrastIssue): HTMLElement {
    const card = document.createElement('button');
    card.className = 'issue';
    card.title = `${issue.selector} — click to copy selector`;

    const preview = document.createElement('span');
    preview.className = 'issue-preview';
    preview.textContent = 'Aa';
    preview.style.color = issue.textColor;
    preview.style.background = issue.bgColor;

    const body = document.createElement('div');
    body.className = 'issue-body';
    const sel = document.createElement('span');
    sel.className = 'issue-sel';
    sel.textContent = issue.selector;
    const sampleEl = document.createElement('span');
    sampleEl.className = 'issue-sample';
    sampleEl.textContent = issue.sample;
    body.append(sel, sampleEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'issue-meta';
    const ratio = document.createElement('span');
    ratio.className = 'issue-ratio fail';
    ratio.textContent = `${issue.ratio.toFixed(2)}:1`;
    const need = document.createElement('span');
    need.className = 'issue-need';
    need.textContent = `needs ${issue.required}:1 · ${issue.fontSize}px`;
    metaEl.append(ratio, need);

    card.append(preview, body, metaEl);
    card.addEventListener('click', () => copyWithFeedback(card, issue.selector));
    return card;
  }

  private buildImageCard(img: ImageInfo, index: number): HTMLElement {
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

    const filename = filenameForAsset(img.src, index);

    const dl = document.createElement('button');
    dl.className = 'copy-btn image-dl';
    dl.textContent = 'Download';
    dl.title = img.src;

    let inFlight = false;
    const trigger = async (): Promise<DownloadOutcome> => {
      if (inFlight) return { ok: false, error: 'Download already in progress' };
      inFlight = true;
      dl.disabled = true;
      dl.classList.remove('copied', 'failed');
      dl.textContent = 'Downloading…';

      const outcome = await this.onDownloadImage(img.src, filename);

      if (outcome.ok) {
        dl.classList.add('copied');
        dl.textContent = 'Downloaded \u2713';
        dl.title = img.src;
      } else {
        dl.classList.add('failed');
        dl.textContent = 'Failed';
        dl.title = `Download failed: ${outcome.error}`;
      }

      dl.disabled = false;
      inFlight = false;
      window.setTimeout(() => {
        dl.classList.remove('copied', 'failed');
        dl.textContent = 'Download';
        dl.title = img.src;
      }, 1800);

      return outcome;
    };

    dl.addEventListener('click', () => {
      void trigger();
    });
    this.imageTriggers.push(trigger);

    card.append(thumbWrap, meta, dl);
    return card;
  }

  // Bundles every listed image into one ZIP (§5: ZIP preferred). Images whose
  // bytes can't be read from the sidebar (cross-origin fetches blocked by
  // CORS — we ship no host permissions) fall back to sequential direct
  // downloads via the downloads API, which fetches with browser privileges.
  // Sequential is deliberate for the fallback: Firefox throttles bursts of
  // programmatic downloads, and serial execution keeps object-URL revocation
  // from racing other in-flight downloads.
  private async downloadAll(): Promise<void> {
    const overview = this.lastOverview;
    if (!overview || overview.images.length === 0 || !this.proEnabled) return;

    this.downloadAllBtn.disabled = true;
    const total = overview.images.length;
    const entries: ZipEntry[] = [];
    const fallbacks: number[] = [];

    for (let i = 0; i < total; i++) {
      this.downloadAllBtn.textContent = `Fetching ${i + 1}/${total}\u2026`;
      const bytes = await fetchImageBytes(overview.images[i].src);
      if (bytes) {
        entries.push({ name: filenameForAsset(overview.images[i].src, i), data: bytes });
      } else {
        fallbacks.push(i);
      }
    }

    let failures = 0;
    if (entries.length > 0) {
      this.downloadAllBtn.textContent = 'Zipping\u2026';
      const outcome = await this.onDownloadBlob(buildZip(entries), 'peekcss-images.zip');
      if (!outcome.ok) failures += entries.length;
    }

    for (let i = 0; i < fallbacks.length; i++) {
      this.downloadAllBtn.textContent = `Downloading ${i + 1}/${fallbacks.length}\u2026`;
      const outcome = await this.imageTriggers[fallbacks[i]]();
      if (!outcome.ok) failures++;
    }

    this.downloadAllBtn.textContent =
      failures > 0 ? `Done \u2014 ${failures} failed` : 'All downloaded \u2713';
    this.downloadAllBtn.disabled = false;
    window.setTimeout(() => {
      this.downloadAllBtn.textContent = 'Download all';
    }, 1800);
  }
}

// Green → amber → red depending on how high the score is.
function scoreColor(score: number): string {
  if (score >= 80) return '#6ee7a0';
  if (score >= 60) return '#fbbf24';
  return '#f87171';
}

function swatch(color: string): HTMLElement {
  const sw = document.createElement('span');
  sw.className = 'a11y-cb-swatch';
  sw.style.background = color;
  return sw;
}

// Builds a labeled progress bar row (label, fill, value) for the breakdown.
function bar(label: string, score: number, detail: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'a11y-bar-row';

  const head = document.createElement('div');
  head.className = 'a11y-bar-head';
  const name = document.createElement('span');
  name.className = 'a11y-bar-label';
  name.textContent = label;
  const val = document.createElement('span');
  val.className = 'a11y-bar-val';
  val.textContent = String(score);
  head.append(name, val);

  const track = document.createElement('span');
  track.className = 'a11y-bar';
  const fill = document.createElement('span');
  fill.className = 'a11y-bar-fill';
  fill.style.width = `${score}%`;
  fill.style.background = scoreColor(score);
  track.append(fill);

  const detailEl = document.createElement('div');
  detailEl.className = 'a11y-bar-detail';
  detailEl.textContent = detail;

  row.append(head, track, detailEl);
  return row;
}
