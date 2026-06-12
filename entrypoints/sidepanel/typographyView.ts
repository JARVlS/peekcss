// entrypoints/sidepanel/typographyView.ts
import type { FontRole, FontUsage, TypographyData } from '@/utils/messages';
import { formatFontLength, type FontUnit } from '@/utils/fontUnit';
import {
  categorize,
  loadCatalog,
  requestCatalogAccess,
  suggestPairings,
  type GoogleFontMeta,
} from '@/utils/fontPairing';

const ROLE_ORDER: FontRole[] = ['heading', 'body', 'ui', 'other'];
const ROLE_LABELS: Record<FontRole, string> = {
  heading: 'Headings',
  body: 'Body',
  ui: 'UI',
  other: 'Other',
};

type SortMode = 'usage' | 'role';

// Renders the Typography view: fonts found on the page, sortable by raw usage
// count or grouped by their dominant role (heading/body/UI heuristic).
export class TypographyView {
  private readonly status = document.getElementById('typography-status')!;
  private readonly list = document.getElementById('fonts-list')!;
  private readonly count = document.getElementById('fonts-count')!;
  private readonly sortControl = document.getElementById('fonts-sort-control')!;

  private sortMode: SortMode = 'usage';
  private fontUnit: FontUnit = 'px';
  private lastData: TypographyData | null = null;
  private proEnabled = false;
  private catalog: GoogleFontMeta[] | null = null;

  constructor() {
    this.sortControl.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      btn.addEventListener('click', () => this.setSortMode(btn.dataset.sort as SortMode));
    });
  }

  setProEnabled(enabled: boolean) {
    if (this.proEnabled === enabled) return;
    this.proEnabled = enabled;
    if (this.lastData) this.render(this.lastData);
  }

  setFontUnit(unit: FontUnit) {
    this.fontUnit = unit;
    if (this.lastData) this.render(this.lastData);
  }

  showScanning() {
    this.status.textContent = 'Scanning page\u2026';
  }

  showDisconnected() {
    this.status.textContent = 'Not connected to a page.';
    this.list.replaceChildren();
    this.count.textContent = '';
    this.lastData = null;
  }

  render(d: TypographyData) {
    this.lastData = d;
    this.status.textContent =
      d.fonts.length === 0 ? 'No rendered text found.' : 'Fonts used on this page.';
    this.count.textContent = String(d.fonts.length);
    this.list.replaceChildren();

    if (this.sortMode === 'usage') {
      // Content script already sorts by count, descending.
      for (const font of d.fonts) this.list.appendChild(this.buildFontCard(font, d.rootFontSize));
      return;
    }

    for (const role of ROLE_ORDER) {
      const fonts = d.fonts
        .filter((f) => dominantRole(f) === role)
        .sort((a, b) => b.roles[role] - a.roles[role]);
      if (fonts.length === 0) continue;
      const title = document.createElement('div');
      title.className = 'palette-group-title';
      title.textContent = ROLE_LABELS[role];
      this.list.appendChild(title);
      for (const font of fonts) this.list.appendChild(this.buildFontCard(font, d.rootFontSize));
    }
  }

  private setSortMode(mode: SortMode) {
    this.sortMode = mode;
    this.sortControl
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((b) => b.classList.toggle('active', b.dataset.sort === mode));
    if (this.lastData) this.render(this.lastData);
  }

  private buildFontCard(font: FontUsage, rootPx: number): HTMLElement {
    const card = document.createElement('div');
    card.className = 'font-card';

    const name = document.createElement('div');
    name.className = 'font-card-name';
    name.textContent = font.family;
    name.style.fontFamily = `"${font.family}", sans-serif`;
    name.title = `Used by ${font.count} element${font.count === 1 ? '' : 's'}`;

    const meta = document.createElement('div');
    meta.className = 'font-card-meta';
    const sizes = font.sizes
      .map((px) => formatFontLength(`${px}px`, this.fontUnit, rootPx))
      .join(', ');
    meta.textContent = `${font.weights.join(' / ') || '\u2014'} \u00b7 ${sizes || '\u2014'}`;

    const roles = document.createElement('div');
    roles.className = 'font-card-roles';
    for (const role of ROLE_ORDER) {
      if (font.roles[role] === 0) continue;
      const chip = document.createElement('span');
      chip.className = 'font-role-chip';
      chip.textContent = `${ROLE_LABELS[role]} ${font.roles[role]}`;
      roles.appendChild(chip);
    }

    const pairBtn = document.createElement('button');
    pairBtn.type = 'button';
    pairBtn.className = 'copy-btn font-pair-btn';
    pairBtn.textContent = 'Pairings';
    pairBtn.disabled = !this.proEnabled;
    pairBtn.title = this.proEnabled
      ? 'Suggest pairings from the Google Fonts catalog (downloaded locally; no page data is sent)'
      : 'Requires PeekCSS Pro';
    pairBtn.classList.toggle('locked', !this.proEnabled);
    const pairings = document.createElement('div');
    pairings.className = 'font-pairings';
    pairings.hidden = true;
    pairBtn.addEventListener('click', () => this.showPairings(font.family, pairBtn, pairings));

    card.append(name, meta, roles, pairBtn, pairings);
    return card;
  }

  // Pro feature (§5/§7). All matching is local — only Google's public font
  // catalog is downloaded, behind an optional host permission requested here
  // (must run inside this click handler to count as a user gesture).
  private async showPairings(
    family: string,
    btn: HTMLButtonElement,
    container: HTMLElement,
  ): Promise<void> {
    if (!this.proEnabled) return;
    if (!container.hidden) {
      container.hidden = true;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Loading\u2026';
    try {
      if (!(await requestCatalogAccess())) {
        btn.textContent = 'Permission needed';
        return;
      }
      this.catalog ??= await loadCatalog();
      if (!this.catalog) {
        btn.textContent = "Couldn't load catalog";
        return;
      }

      container.replaceChildren();
      const intro = document.createElement('div');
      intro.className = 'font-pairings-intro';
      intro.textContent = `Pairs with ${family} (${categorize(family, this.catalog)}):`;
      container.appendChild(intro);
      for (const s of suggestPairings(family, this.catalog)) {
        const row = document.createElement('a');
        row.className = 'font-pairing-row';
        row.href = s.url;
        row.target = '_blank';
        row.rel = 'noreferrer noopener';
        row.title = 'Open on Google Fonts';
        const name = document.createElement('span');
        name.textContent = s.family;
        const cat = document.createElement('span');
        cat.className = 'font-pairing-cat';
        cat.textContent = s.category;
        row.append(name, cat);
        container.appendChild(row);
      }
      container.hidden = false;
      btn.textContent = 'Pairings';
    } finally {
      btn.disabled = false;
      window.setTimeout(() => {
        btn.textContent = 'Pairings';
      }, 1800);
    }
  }
}

function dominantRole(font: FontUsage): FontRole {
  let best: FontRole = 'other';
  let max = -1;
  // Iterate in ROLE_ORDER so ties resolve heading > body > ui > other.
  for (const role of ROLE_ORDER) {
    if (font.roles[role] > max) {
      max = font.roles[role];
      best = role;
    }
  }
  return best;
}
