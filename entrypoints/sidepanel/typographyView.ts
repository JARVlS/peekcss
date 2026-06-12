// entrypoints/sidepanel/typographyView.ts
import type { FontRole, FontUsage, TypographyData } from '@/utils/messages';
import { formatFontLength, type FontUnit } from '@/utils/fontUnit';

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

  constructor() {
    this.sortControl.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
      btn.addEventListener('click', () => this.setSortMode(btn.dataset.sort as SortMode));
    });
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

    card.append(name, meta, roles);
    return card;
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
