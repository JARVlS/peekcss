# PeekCSS — Feature Overview

Developer reference for all implemented features: what they do, which tier gates them, and which files to look at.

---

## Tabs at a glance

| Tab | Min. tier | Key capability |
| --- | --- | --- |
| Inspector | Anonymous | Hover + click to inspect any element's CSS |
| Overview | Free account | Page-wide palette, accessibility, images |
| Typography | Free account | All fonts on the page, pairing suggestions |
| Settings | Free account | Preferences and keyboard shortcuts |

---

## Inspector

**Tier:** Anonymous (no account needed)

### Features

| Feature | Description |
| --- | --- |
| Hover highlight | CSS-accurate bounding-box overlay follows the cursor |
| Smart hover target | Empty containers (no text, no background, no border) resolve down to the nearest non-empty visible child — max 10 DOM levels, rect-based so `pointer-events:none` children are reached |
| Click to inspect | Loads full computed CSS into the sidebar panel |
| Property groups | CSS properties grouped into Typography, Colors, Spacing, Effects, Layout |
| Contrast ratio | Numeric ratio with AA / AAA pass-fail badge, shown in the Colors group |
| Spacing diagram | Margin, padding, and border values at a glance |
| Copy CSS | Copy all CSS, a single property group, or a single value to the clipboard |
| Inline copy feedback | Floating "Copied ✓" pill appears for 900 ms after any copy action |
| Hover popup | Cursor-following mini-panel with color swatches and key font info |
| Color format | HEX / RGB / HSL — set in Settings, applied to inspector + popup |
| Font unit | px / rem / pt — set in Settings, applied to all length values (font-size, line-height, letter-spacing) |

### Key files

- `entrypoints/content.ts` — `createHighlight`, `createPopup`, `read`, `resolveHoverTarget`
- `entrypoints/sidepanel/inspectorView.ts` — rendering
- `utils/color.ts` — color parsing, contrast
- `utils/fontUnit.ts` — unit conversion

---

## Overview

**Tier:** Free account (full tab); some features are Pro

### Features

| Feature | Tier | Description |
| --- | --- | --- |
| Accessibility score | Free account | Counts pass/fail pairs, estimates the proportion of text at AA/AAA |
| Contrast issue list | Free account | Pairs that fail WCAG AA, with element preview |
| Color palette | Free account | Up to 120 colors extracted from the page via `getComputedStyle`, deduplicated to RGB |
| Per-purpose tallies | Free account | Each palette entry shows how often it appears as a text / background / border color |
| Palette grouping | **Pro** | Segmented "All / By purpose" toggle; groups palette swatches by dominant purpose |
| Palette export | **Pro** | Select exports to clipboard: CSS custom properties, SCSS variables, JSON object, Tailwind `colors` config |
| Image grid | Free account | All `<img>` tags and CSS `background-image` URLs, with a preview thumbnail and metadata; landscape images span a full-width row, portrait/square/unknown sit two-up |
| Full-resolution previews | Free account | http(s)/data URLs load directly in the panel (already cached by the page render, lazy-loaded in the grid); blob:/filesystem URLs — scoped to the page document and unreachable from the panel — fall back to a canvas re-encode capped at an HD ceiling (1280px longest side) |
| Single-image download | Free account | Per-image download button; http(s) via `downloads` API, data:/blob: via sidebar object URL |
| Download all (ZIP) | **Pro** | Bundles readable images with fflate (`~13 kB` tree-shaken, level-0 compression for already-compressed formats); cross-origin images that can't be fetched from the sidebar fall back to sequential `downloads` API calls; no extra install-time permissions |

### Key files

- `entrypoints/content.ts` — `scanOverview`, `scanImages`, `thumbFor`, `makeThumb`
- `entrypoints/sidepanel/overviewView.ts` — rendering, palette controls, ZIP download
- `utils/palette.ts` — `dominantPurpose`, `exportPalette`
- `utils/zipExport.ts` — `buildZip`, `fetchImageBytes`
- `utils/audit.ts` — accessibility scoring

---

## Typography

**Tier:** Free account (full tab); pairing is Pro

### Features

| Feature | Tier | Description |
| --- | --- | --- |
| Font list | Free account | All font families rendered on the page (up to 40), sorted by usage count |
| Live font preview | Free account | Each family's name is shown set in that very font — the content script pre-renders the label using the page's own loaded font, so it works for any font on the page (including proprietary/webfonts), not just ones installed locally |
| Usage count | Free account | Number of elements using each family |
| Weights & sizes | Free account | Distinct computed font-weights and font-sizes per family; sizes respect the app-wide font-unit setting |
| Role chips | Free account | Per-family breakdown: how many elements fall under Headings / Body / UI / Other |
| Sort by role | Free account | Segmented "By usage / By role" toggle; groups fonts under their dominant role |
| Font pairing | **Pro** | Per-font "Pairings" button (see below) |

### Font pairing (Pro) — privacy-first design

1. On first click, requests an **optional** `fonts.google.com` host permission — a browser prompt appears once and is remembered. Install-time permissions are unchanged.
2. Downloads Google Fonts' **public** metadata catalog (`~2.7 MB` JSON, no API key) and caches it in `storage.local` for 7 days.
3. Detects the font's category (Serif / Sans Serif / Display / Handwriting / Monospace) via exact catalog match, falling back to name heuristics for non-Google fonts (Helvetica, Georgia, etc.).
4. Applies a classic category-contrast pairing rule (serif ↔ sans, display/handwriting → text faces) and returns the top 4 matches by popularity.
5. Each suggestion links to the Google Fonts specimen page (opened in a new tab).
6. **No font names or page data are ever sent anywhere.** The catalog is fetched from a public, keyless endpoint. The in-view privacy note reads: *"Pairing suggestions (Pro) download Google Fonts' public catalog after you grant access. Detected fonts and page data are never sent anywhere."*

**Store-listing disclosure:** *"The optional font-pairing feature (Pro) downloads the public Google Fonts catalog from fonts.google.com after you grant access. No information about you or the pages you visit is ever transmitted."*

### Key files

- `entrypoints/content.ts` — `scanTypography`, `fontRoleFor`
- `entrypoints/sidepanel/typographyView.ts` — rendering, pairing UI
- `utils/fontPairing.ts` — `loadCatalog`, `requestCatalogAccess`, `categorize`, `suggestPairings`
- `utils/messages.ts` — `TypographyData`, `FontUsage`, `FontRole`

---

## Settings

**Tier:** Free account

### Features

| Feature | Description |
| --- | --- |
| Theme | Light / dark toggle, persisted to `storage.local` |
| Color format | HEX / RGB / HSL; applied to inspector property values and hover popup |
| Font unit | px / rem / pt; applied to all length values across inspector, popup, and Typography tab |
| Account & licensing | Paste a license token from a peekcss.com account to unlock free_account / Pro — see below |
| Keyboard shortcuts | Reference table: Q cycle tabs, W inspector on/off, E popup on/off, N theme |
| Dev tier override | (DEV builds only) Dropdown to switch between anonymous / free_account / pro without a backend — useful for testing all gating states |

### Account & licensing — no login, one pasted token

The extension never signs in. peekcss.com issues a long-lived license token per account (free accounts get one too); the user pastes it into Settings → Account once.

1. **Apply.** `applyLicenseToken` validates the token with a stateless `POST` to `peekcss.com/api/license/validate` — a "simple" CORS request (no custom headers, so no preflight, no host permission needed). On success the token is persisted (`local:licenseToken`) and the resolved tier is written to `accountStateItem`; the existing tier watchers (`utils/tier.ts`) pick that up and refresh gating everywhere automatically. `Remove` clears both.
2. **Revalidate.** The stored token is re-checked on extension install, browser startup (`entrypoints/background.ts`), and panel open. Offline-safe: a network error keeps the last known tier; only an explicit invalid/revoked response downgrades the account.
3. **Firefox data-collection consent.** Firefox requires new extensions to declare what personal data they collect (`data_collection_permissions` in `wxt.config.ts`). The license token is the only thing PeekCSS ever transmits, declared as *optional* `authenticationInfo` data collection — never required, since anonymous/free-tier use never triggers it. The actual network call is gated behind a runtime `browser.permissions.request()`, triggered only from the "Apply license" click (a user gesture, which Firefox requires for this prompt) — the same pattern as the Google Fonts host permission. Chrome and pre-140 Firefox don't recognize this permission shape and fail open.
4. **Stays reachable when locked.** The Account block remains visible and interactive even when the Settings tab itself is shown locked (anonymous users), so pasting a license is how you unlock the tab in the first place — see the CSS exception in Tier gating below.
5. Ultimate folds into Pro for now (Ultimate/AI features haven't shipped).

### Key files

- `entrypoints/sidepanel/main.ts` — settings wiring
- `entrypoints/sidepanel/theme.ts` — theme controller
- `entrypoints/sidepanel/accountView.ts` — `AccountController` (license input, apply/remove, status)
- `utils/license.ts` — `applyLicenseToken`, `clearLicense`, `revalidateLicense`, `validateLicense`
- `utils/storage.ts` — `themeItem`, `colorFormatItem`, `fontUnitItem`

---

## Tier gating

All tier logic is centralised so adding a new feature only requires one check.

```ts
// utils/tier.ts
type UserTier = 'anonymous' | 'free_account' | 'pro';
getUserTier(): UserTier     // sync, reads from in-memory cache
hasTier(required): boolean  // true if current tier ≥ required
initUserTier(onChange)      // loads from storage, sets up watcher
```

**UX rule:** locked views and locked in-view features are shown *disabled with a lock icon + tier hint* — never hidden. Users can see what they're missing and why. Exception: the Settings Account block (`.account-block`) stays visible and interactive even inside an otherwise-locked view, since applying a license there is how an anonymous user unlocks the tab.

**Nav lock badges:** each locked tab in the bottom nav shows a small lock icon overlay. Pro-only *in-view* controls (e.g. the palette "By purpose" toggle, locked export/copy buttons) instead show a small gold crown — visually distinct from the tab-level lock, since a Pro-gated control can sit inside a tab that's already unlocked at free_account.

**Tier resolution order:** `devTierOverride` (dev builds only) → `accountStateItem` (tier resolved from a validated license, see Account & licensing above) → `'anonymous'`.

**Dev override:** in DEV builds, a "Dev tier" selector appears at the bottom of Settings. It writes to the `devTierOverride` storage key; the gating watcher picks it up immediately without a reload. It takes priority over any applied license so all three tiers stay testable without a backend.

### Key files

- `utils/tier.ts` — full gating interface, `accountStateItem`, `devTierOverrideItem`
- `utils/license.ts` — resolves `accountStateItem` from a pasted license token
- `entrypoints/sidepanel/gating.ts` — `GatingController` (locked panels, nav badges, dev selector)

---

## Port message protocol

The content script and sidebar communicate over one long-lived port per tab (`INSPECTOR_PORT = 'peekcss:inspector'`).

### Sidebar → content

| Message | Payload | Effect |
| --- | --- | --- |
| `set-active` | `{ active: boolean }` | Start / stop inspector mode |
| `set-popup` | `{ enabled: boolean }` | Show / hide hover popup |
| `set-color-format` | `{ format: ColorFormat }` | Update color format for popup + inspector |
| `set-font-unit` | `{ unit: FontUnit }` | Update font unit for popup + inspector |
| `scan-overview` | — | Trigger `scanOverview()` → responds with `overview` |
| `scan-typography` | — | Trigger `scanTypography()` → responds with `typography` |

### Content → sidebar

| Message | Payload | Trigger |
| --- | --- | --- |
| `update` | `InspectionData` | Element clicked |
| `overview` | `OverviewData` | After `scan-overview` |
| `typography` | `TypographyData` | After `scan-typography` |
| `shortcut` | `{ action }` | Keyboard shortcut on page |
| `cleared` | — | Inspector deactivated |

### Key file

- `utils/messages.ts` — all types

---

## Toolbar behavior

| Browser | Click on toolbar icon |
| --- | --- |
| Chrome (has `sidePanel`) | Opens automatically — `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` is set once in the background script |
| Firefox (no `sidePanel`) | `browser.action.onClicked` toggles `sidebarAction` |

### Key file

- `entrypoints/background.ts`

---

## Download routing

| Asset type | Route | Reason |
| --- | --- | --- |
| `http(s)://` URL | Background → `browser.downloads.download()` | Downloads API requires background; no CORS issues |
| `data:` / `blob:` URL | Sidebar → `URL.createObjectURL` → `browser.downloads.download()` | Background (service worker) can't call `createObjectURL` in MV3 |
| ZIP blob | Sidebar → `URL.createObjectURL` → `browser.downloads.download()` | Same as above |

Object URLs are revoked when `downloads.onChanged` reports `complete` or `interrupted`.

---

## Bundle size reference

As of the last build:

| Target | JS bundle | CSS | Total |
| --- | --- | --- | --- |
| Firefox MV3 (sidepanel) | ~48.7 kB | ~12.2 kB | ~102.7 kB |

Notable additions from baseline: fflate `~13 kB`, font pairing `~4.5 kB`.

---

## Keyboard shortcuts

Handled both in the sidepanel (`keydown` listener) and forwarded from the content script via `shortcut` port messages, so shortcuts work whether focus is on the page or the sidebar.

| Key | Action | Min. tier |
| --- | --- | --- |
| `Q` | Cycle tabs (inspector → overview → typography → settings → …) | Anonymous |
| `W` | Toggle inspector on / off | Anonymous |
| `E` | Toggle hover popup on / off | Anonymous |
| `N` | Toggle light / dark theme | Free account |
