// utils/license.ts
// Turns a pasted PeekCSS license token into a resolved tier by calling the
// licensing API, and writes the result into accountStateItem (utils/tier.ts).
// The tier watchers in initUserTier() pick that up and refresh gating, so this
// module never touches the UI directly.
//
// Decoupling by design: the extension never logs in. The website issues a
// long-lived license token (free_account users get one too); the user pastes it
// here once. Validation is a stateless POST — no cookies, no OAuth.
import { storage } from 'wxt/utils/storage';
import { accountStateItem, type UserTier } from './tier';

// API origin. Override for local dev with VITE_PEEKCSS_API (e.g. a wrangler dev
// URL) when running `wxt` against a local backend.
const API_BASE = (import.meta.env.VITE_PEEKCSS_API as string | undefined) ?? 'https://peekcss.com';
const VALIDATE_URL = `${API_BASE}/api/license/validate`;

export const licenseTokenItem = storage.defineItem<string | null>('local:licenseToken', {
  fallback: null,
});
export const licenseCheckedAtItem = storage.defineItem<number>('local:licenseCheckedAt', {
  fallback: 0,
});

interface ValidateResponse {
  valid: boolean;
  tier?: string;
  status?: string;
}

export interface LicenseResult {
  ok: boolean;
  tier?: UserTier;
  offline?: boolean;
  error?: string;
}

// Map the API tier to the extension's UserTier. Ultimate folds into Pro until
// the AI (Ultimate) features ship — Ultimate is a superset of Pro.
function apiTierToUserTier(tier: string | undefined): UserTier {
  return tier === 'pro' || tier === 'ultimate' ? 'pro' : 'free_account';
}

// Validate a token against the server. Sends no custom headers so it stays a
// "simple" CORS request (no preflight); the endpoint allows any origin, so the
// extension needs no host permission for peekcss.com.
export async function validateLicense(token: string): Promise<LicenseResult> {
  try {
    const res = await fetch(VALIDATE_URL, { method: 'POST', body: JSON.stringify({ token }) });
    if (!res.ok) {
      if (res.status === 429) return { ok: false, error: 'Too many checks — try again shortly.' };
      return { ok: false, error: `Server error (${res.status}).` };
    }
    const data = (await res.json()) as ValidateResponse;
    if (!data.valid) return { ok: false, error: 'This license is not valid or has been revoked.' };
    return { ok: true, tier: apiTierToUserTier(data.tier) };
  } catch {
    return { ok: false, offline: true, error: 'Could not reach the licensing server.' };
  }
}

// Validate a freshly pasted token; if valid, persist it and update the tier.
export async function applyLicenseToken(token: string): Promise<LicenseResult> {
  const trimmed = token.trim();
  if (!trimmed) {
    await clearLicense();
    return { ok: true, tier: 'anonymous' };
  }
  const res = await validateLicense(trimmed);
  if (!res.ok) return res;
  await licenseTokenItem.setValue(trimmed);
  await licenseCheckedAtItem.setValue(Date.now());
  await accountStateItem.setValue({ tier: res.tier! });
  return res;
}

export async function clearLicense(): Promise<void> {
  await licenseTokenItem.setValue(null);
  await licenseCheckedAtItem.setValue(0);
  await accountStateItem.setValue(null);
}

// Re-check the stored token (on startup / when the panel opens). Offline-safe:
// a network failure keeps the last known tier; only an explicit "invalid"
// answer downgrades the account (handles revocation / cancellation).
export async function revalidateLicense(): Promise<void> {
  const token = await licenseTokenItem.getValue();
  if (!token) return;
  const res = await validateLicense(token);
  if (res.ok) {
    await licenseCheckedAtItem.setValue(Date.now());
    await accountStateItem.setValue({ tier: res.tier! });
  } else if (!res.offline) {
    await clearLicense();
  }
}
