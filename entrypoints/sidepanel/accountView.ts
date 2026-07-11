// entrypoints/sidepanel/accountView.ts
// Wires the Account block in Settings: paste a license token, apply/remove it,
// and show the resolved tier. Applying a token writes accountStateItem, which
// the tier watchers react to — so gating updates itself; this controller only
// owns the input + status text.
import { TIER_LABELS, accountStateItem, type UserTier } from '@/utils/tier';
import { applyLicenseToken, clearLicense, licenseTokenItem } from '@/utils/license';

export class AccountController {
  private readonly input = document.getElementById('license-input') as HTMLInputElement | null;
  private readonly applyBtn = document.getElementById('license-apply') as HTMLButtonElement | null;
  private readonly removeBtn = document.getElementById('license-remove') as HTMLButtonElement | null;
  private readonly status = document.getElementById('account-status');

  async init(): Promise<void> {
    if (!this.input || !this.applyBtn || !this.removeBtn || !this.status) return;

    const token = await licenseTokenItem.getValue();
    if (token) {
      this.input.value = token;
      this.removeBtn.hidden = false;
    }
    await this.renderStatus();
    accountStateItem.watch(() => void this.renderStatus());

    this.applyBtn.addEventListener('click', () => void this.apply());
    this.removeBtn.addEventListener('click', () => void this.remove());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.apply();
      }
    });
  }

  private async apply(): Promise<void> {
    if (!this.input || !this.applyBtn || !this.removeBtn || !this.status) return;
    const token = this.input.value.trim();
    if (!token) {
      void this.remove();
      return;
    }
    this.applyBtn.disabled = true;
    this.status.textContent = 'Checking license…';
    this.status.classList.remove('is-error');
    const res = await applyLicenseToken(token);
    this.applyBtn.disabled = false;
    if (res.ok) {
      this.removeBtn.hidden = false;
      await this.renderStatus();
    } else {
      this.status.textContent = res.error ?? 'Could not validate license.';
      this.status.classList.add('is-error');
    }
  }

  private async remove(): Promise<void> {
    if (!this.input || !this.removeBtn) return;
    await clearLicense();
    this.input.value = '';
    this.removeBtn.hidden = true;
    await this.renderStatus();
  }

  private async renderStatus(): Promise<void> {
    if (!this.status) return;
    const account = await accountStateItem.getValue();
    const tier: UserTier = account?.tier ?? 'anonymous';
    this.status.classList.remove('is-error');
    this.status.textContent =
      tier === 'anonymous'
        ? 'No license applied — anonymous access.'
        : `Active: ${TIER_LABELS[tier]}.`;
  }
}
