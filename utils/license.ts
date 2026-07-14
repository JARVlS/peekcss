// utils/license.ts
// Turns a pasted PeekCSS license token into a resolved tier by calling the
// licensing API, and writes the result into accountStateItem (utils/tier.ts).
// The tier watchers in initUserTier() pick that up and refresh gating, so this
// module never touches the UI directly.
//
// Decoupling by design: the extension never logs in. The website issues a
// long-lived license token (free_account users get one too); the user pastes it
// here once. Validation is a stateless POST — no cookies, no OAuth.
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { accountStateItem, type UserTier } from './tier';

// API origin. Override for local dev with VITE_PEEKCSS_API (e.g. a wrangler dev
// URL) when running `wxt` against a local backend.
const API_BASE = (import.meta.env.VITE_PEEKCSS_API as string | undefined) ?? 'https://peekcss.com';
const VALIDATE_URL = `${API_BASE}/api/license/validate`;

// Firefox's built-in data-consent system (manifest: data_collection_permissions,
// see wxt.config.ts) declares the license token as *optional* authenticationInfo
// data collection — so, per Mozilla's spec, we gate the actual network call
// behind a runtime browser.permissions.request(), the same pattern already used
// for the Google Fonts host permission in utils/fontPairing.ts.
const AUTH_DATA_PERMISSION = { data_collection: ['authenticationInfo'] } as const;

// `promptIfMissing` should only be true when called from a user gesture
// (e.g. clicking "Apply license") — Firefox rejects permission prompts
// outright outside a transient user activation. Background/startup checks
// (revalidateLicense) pass false and just check the existing grant.
async function ensureAuthDataConsent(promptIfMissing: boolean): Promise<boolean> {
  try {
    // @wxt-dev/browser's Permissions type doesn't yet include Firefox's
    // `data_collection` field (added in Firefox 140) — cast until the
    // upstream type package catches up. The shape itself is valid per
    // Mozilla's WebExtension API for this Firefox version.
    const permissions = AUTH_DATA_PERMISSION as unknown as Parameters<
      typeof browser.permissions.contains
    >[0];
    if (await browser.permissions.contains(permissions)) return true;
    if (!promptIfMissing) return false;
    return await browser.permissions.request(permissions);
  } catch {
    // Chrome (and Firefox < 140) don't recognize the data_collection
    // permission shape and may throw — fail open so licensing keeps working
    // outside the browsers this consent system applies to.
    return true;
  }
}

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
  /** Data-collection consent not (yet) granted — distinct from "invalid token". */
  consentMissing?: boolean;
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
//
// `promptForConsent`: pass true only when called from a user gesture (see
// ensureAuthDataConsent above).
export async function validateLicense(
  token: string,
  prompt