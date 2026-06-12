// entrypoints/sidepanel/gating.ts
// Applies §7 tier gating to the sidebar UI. Locked views keep their nav entry
// (with a small lock badge) and show a locked panel instead of their content —
// features are shown disabled, not hidden.
import {
  TIER_LABELS,
  USER_TIERS,
  devTierOverrideItem,
  isUserTier,
  tierSatisfies,
  type UserTier,
} from '@/utils/tier';
import type { ViewName } from './navigation';

// Minimum tier per view (§7 tables). Pro-only features inside a view gate
// themselves individually as they are implemented.
const VIEW_TIERS: Record<ViewName, UserTier> = {
  inspector: 'anonymous',
  overview: 'free_account',
  typography: 'free_account',
  settings: 'free_account',
};

const LOCK_ICON = `<svg width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
  <path d="M5.5 7 V4.5 a2.5 2.5 0 0 1 5 0 V7" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

const NAV_LOCK_ICON = `<svg class="nav-lock" width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/>
  <path d="M5.5 7 V4.5 a2.5 2.5 0 0 1 5 0 V7" stroke="currentColor" stroke-width="2"/>
</svg>`;

function unlockHint(required: UserTier): string {
  return required === 'pro'
    ? 'Upgrade to PeekCSS Pro to unlock this tab.'
    : 'Sign up for a free account to unlock this tab.';
}

export class GatingController {
  private readonly views: Record<ViewName, HTMLElement> = {
    inspector: document.getElementById('view-inspector')!,
    overview: document.getElementById('view-overview')!,
    typography: document.getElementById('view-typography')!,
    settings: document.getElementById('view-settings')!,
  };
  private readonly navButtons =
    document.querySelectorAll<HTMLButtonElement>('.nav-btn');

  constructor() {
    if (import.meta.env.DEV) {
      this.views.settings.append(buildDevTierBlock());
    }
  }

  isViewLocked(view: ViewName, tier: UserTier): boolean {
    return !tierSatisfies(tier, VIEW_TIERS[view]);
  }

  apply(tier: UserTier) {
    for (const [name, view] of Object.entries(this.views) as [ViewName, HTMLElement][]) {
      const required = VIEW_TIERS[name];
      const locked = this.isViewLocked(name, tier);
      view.classList.toggle('is-locked', locked);
      this.lockedPanel(view, name, required).hidden = !locked;
    }
    this.navButtons.forEach((btn) => {
      const view = btn.dataset.view as ViewName;
      const locked = this.isViewLocked(view, tier);
      let badge = btn.querySelector('.nav-lock');
      if (locked && !badge) {
        btn.insertAdjacentHTML('beforeend', NAV_LOCK_ICON);
      } else if (!locked && badge) {
        badge.remove();
      }
    });
  }

  // Lazily creates the locked panel for a view.
  private lockedPanel(view: HTMLElement, name: ViewName, required: UserTier): HTMLElement {
    let panel = view.querySelector<HTMLElement>('.locked-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'locked-panel';
      panel.hidden = true;
      const title = name.charAt(0).toUpperCase() + name.slice(1);
      panel.innerHTML = `${LOCK_ICON}
        <h2>${title} is locked</h2>
        <p>${unlockHint(required)}</p>
        <span class="tier-badge">${TIER_LABELS[required]}</span>`;
      view.append(panel);
    }
    return panel;
  }
}

// Dev-build-only tier override selector (§7: "easily overridable … to test all
// three tiers without a real backend"). The storage key also works in prod
// builds via the extension console.
function buildDevTierBlock(): HTMLElement {
  const block = document.createElement('div');
  block.className = 'block dev-block';
  const options = USER_TIERS.map((t) => `<option value="${t}">${t}</option>`).join('');
  block.innerHTML = `
    <h2>Developer</h2>
    <div class="setting-row">
      <span class="setting-label">Tier override</span>
      <select id="dev-tier" class="select">
        <option value="">(off)</option>
        ${options}
      </select>
    </div>`;
  const select = block.querySelector('select')!;
  void devTierOverrideItem.getValue().then((v) => {
    select.value = v ?? '';
  });
  select.addEventListener('change', () => {
    const value = select.value;
    void devTierOverrideItem.setValue(isUserTier(value) ? value : null);
  });
  return block;
}
