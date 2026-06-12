// utils/tier.ts
// §7 gating interface: a three-state tier check, not a boolean.
// Every gated feature checks against getUserTier()/hasTier().
import { storage } from 'wxt/utils/storage';

export type UserTier = 'anonymous' | 'free_account' | 'pro';

export const USER_TIERS: readonly UserTier[] = ['anonymous', 'free_account', 'pro'];

// Tiers are strictly ordered: each tier includes everything below it.
const TIER_RANK: Record<UserTier, number> = {
  anonymous: 0,
  free_account: 1,
  pro: 2,
};

export const TIER_LABELS: Record<UserTier, string> = {
  anonymous: 'Free',
  free_account: 'Free account',
  pro: 'Pro',
};

// Cached account/license state. Written by the (future) auth flow; until that
// exists this stays null and the tier resolves to 'anonymous'.
export interface AccountState {
  tier: UserTier;
  email?: string;
}

export const accountStateItem = storage.defineItem<AccountState | null>('local:accountState', {
  fallback: null,
});

// Dev override to test all three tiers without a real backend (§7).
// Set via the Developer block in Settings (dev builds only), or from any
// extension console: browser.storage.local.set({ devTierOverride: 'pro' })
export const devTierOverrideItem = storage.defineItem<UserTier | null>('local:devTierOverride', {
  fallback: null,
});

export function isUserTier(value: unknown): value is UserTier {
  return typeof value === 'string' && (USER_TIERS as readonly string[]).includes(value);
}

export function tierSatisfies(current: UserTier, required: UserTier): boolean {
  return TIER_RANK[current] >= TIER_RANK[required];
}

async function resolveTier(): Promise<UserTier> {
  const override = await devTierOverrideItem.getValue();
  if (isUserTier(override)) return override;
  const account = await accountStateItem.getValue();
  if (account && isUserTier(account.tier)) return account.tier;
  return 'anonymous';
}

// In-memory cache so gating checks can be synchronous in render code.
// storage.local stays the source of truth (§2); the watchers below keep the
// cache fresh. Before initUserTier() resolves, checks fall back to the safest
// tier ('anonymous').
let cachedTier: UserTier = 'anonymous';

// Loads the cached tier and watches storage for changes (e.g. the dev
// override changing, or a future sign-in writing accountState).
export async function initUserTier(onChange?: (tier: UserTier) => void): Promise<UserTier> {
  cachedTier = await resolveTier();

  const recompute = async () => {
    const next = await resolveTier();
    if (next === cachedTier) return;
    cachedTier = next;
    onChange?.(next);
  };
  devTierOverrideItem.watch(() => void recompute());
  accountStateItem.watch(() => void recompute());

  return cachedTier;
}

// §7: synchronous tier check against cached account/license state.
export function getUserTier(): UserTier {
  return cachedTier;
}

// Convenience: does the current user meet the required tier?
export function hasTier(required: UserTier): boolean {
  return tierSatisfies(cachedTier, required);
}
