# **PeekCSS — Implementation**

## **1\. Project context & goal**

PeekCSS is a Firefox-first (cross-browser via WXT) CSS inspector extension for web developers and designers. It lets users inspect a page's CSS, colors, fonts, and assets without opening DevTools — "hover, see, copy." It's positioned as a maintained, Firefox-native alternative to CSS Peeper, with an eventual Chrome release.

---

## **2\. Locked architecture & constraints**

These are settled decisions. Do not revisit them without an explicit discussion — flag anything that seems to require working around them instead of silently choosing a different approach.

**Stack**

* Framework: WXT (file-based entrypoints, cross-browser build)  
* Language: TypeScript throughout, no exceptions  
* Manifest: MV3

**UI surface**

* The sidebar is the primary UI — `sidebar_action` on Firefox, `sidePanel` on Chrome (these are separate, incompatible APIs; see Cross-browser notes)  
* Popups are ruled out entirely: they close on any page click, which is fatal for an inspector tool. There is no workaround. Only an on-hover popup that follows the cursor is implemented; the main UI stays inside the sidepanel.

**Communication**

* Content script ↔ sidebar communicate over a **long-lived port** (`browser.tabs.connect`)  
* One-shot `sendMessage` is *not* used for the hover/click inspection stream — hover/click is a continuous stream, not a transaction  
* `browser.*` namespace is used throughout, never `chrome.*`, for cross-browser compatibility

**Interaction model**

* Click-to-load: hovering highlights an element, clicking loads its data into the sidebar  
* Hover-to-Show: hovering shows a popup at the mouse cursor with a data overview  
* Both functionalities are toggle-able, not always active

**Persistent state**

* All persistent state goes through `browser.storage.local` — never held only in background/service-worker memory  
* Typed helpers live in `utils/storage.ts` via WXT's `storage.defineItem`

**Authored CSS values**

* Where possible, retrieve original authored values by walking `document.styleSheets` / `cssRules`, not just `getComputedStyle()` (which returns resolved values only)  
* Known caveats: cross-origin stylesheet access restrictions, CSS-in-JS, cascade resolution complexity, inaccessible UA stylesheet rules  
* Treat this as best-effort with graceful fallback to computed values — not a guarantee

---

## **3\. File / folder map**

The sidebar app is plain TypeScript + DOM (no UI framework). `components/` exists but is currently empty. Builds land in `.output/{firefox,chrome}-mv3[-dev]/`.

```
entrypoints/
├── background.ts            MV3 background: toolbar click → sidebarAction.toggle();
│                            relays http(s) download requests to the downloads API
├── content.ts               Content script — ALL overlay code lives here:
│                            createHighlight() (hover highlight), createPopup()
│                            (cursor-following hover popup with color-format +
│                            font-unit awareness), resolveHoverTarget() (walks
│                            down empty containers to nearest visible child),
│                            read() (element inspection + rootFontSize),
│                            scanOverview() / scanImages() / scanTypography();
│                            owns the content-script side of the long-lived port
└── sidepanel/               THE SIDEBAR APP
    ├── index.html           Markup: #view-inspector, #view-overview,
    │                        #view-typography, #view-settings + bottom nav
    ├── main.ts              Orchestrator: tabs.connect port lifecycle, gating
    │                        init, inspector/popup toggles, shortcuts, color-
    │                        format + font-unit prefs, download routing
    ├── inspectorView.ts     Inspector tab rendering (fmtColor + fmtLength aware)
    ├── overviewView.ts      Overview tab: palette (flat/grouped), palette export,
    │                        accessibility report, image grid + ZIP download
    ├── typographyView.ts    Typography tab: font list, role-sort, font pairing
    ├── gating.ts            GatingController — locked-panel injection, nav lock
    │                        badges, dev tier override selector (DEV builds only)
    ├── navigation.ts        Bottom-nav controller (inspector/overview/typography/
    │                        settings) + VIEW_ORDER cycle
    ├── theme.ts             Light/dark theme (persists via themeItem)
    └── style.css            All styles (base + feature-specific appended sections)

utils/
├── messages.ts              PORT-MESSAGE TYPES: INSPECTOR_PORT, InspectorMessage
│                            (content → sidebar), SidepanelMessage (sidebar →
│                            content), DownloadRequest/DownloadResult (one-shot),
│                            plus InspectionData, OverviewData, TypographyData,
│                            FontUsage, FontRole, ColorPurpose, PaletteColor,
│                            AccessibilityReport, ImageInfo
├── tier.ts                  getUserTier() gating interface: UserTier type,
│                            initUserTier() (loads + watches storage), hasTier(),
│                            accountStateItem, devTierOverrideItem
├── storage.ts               Typed storage items via WXT defineItem: themeItem,
│                            colorFormatItem, fontUnitItem
├── color.ts                 Color parsing/formatting, contrast math, ColorFormat
├── audit.ts                 Page accessibility audit (contrast/text-size/color-blind)
├── clipboard.ts             Copy helper + showCopyBadge() floating "Copied ✓" pill
├── download.ts              data-URL → Blob, filename/extension helpers,
│                            DownloadOutcome type
├── fontUnit.ts              FontUnit type (px/rem/pt), formatFontLength() with
│                            rootFontSize conversion
├── palette.ts               dominantPurpose(), exportPalette() (css/scss/json/
│                            tailwind), PaletteExportFormat
├── zipExport.ts             buildZip() via fflate (zipSync level 0),
│                            fetchImageBytes() with data:/blob: + fetch fallback
└── fontPairing.ts           loadCatalog() (Google Fonts public metadata, cached
                             7 days), requestCatalogAccess(), categorize(),
                             suggestPairings() — all matching done locally
```

---

## **4\. Current feature set**

> This section reflects what is actually built and verified as of the latest commit.

### Inspector *(anonymous — no account needed)*

* Hover highlights elements with a CSS-accurate bounding-box overlay  
* Empty-container hover resolves down to the nearest non-empty visible child (max 10 levels, rect-based so `pointer-events:none` children work)  
* Click loads full computed CSS into the sidebar  
* Contrast ratio shown as a numeric value with AA/AAA pass/fail badge  
* Spacing visualization (margin, padding, border dimensions)  
* Copy whole CSS, selected property groups, or individual values  
* Inline "Copied ✓" floating pill confirmation (deduped, 900 ms)  
* Hover popup at cursor with color + font summary (respects color-format + font-unit prefs)

### Overview *(free account)*

* Page accessibility score and contrast issue list  
* Full color palette (up to 120 colors), with per-purpose usage tallies (text / background / border)  
* **Palette grouping by purpose** *(Pro)* — segmented "All / By purpose" toggle  
* **Palette export** *(Pro)* — CSS custom properties, SCSS variables, JSON, Tailwind colors  
* Image grid with instant single-image download  
* **Download all images as ZIP** *(Pro)* — fflate-based (`~13 kB` tree-shaken); cross-origin images that can't be fetched from the sidebar fall back to sequential `downloads` API calls; no new install-time permissions needed

### Typography *(free account)*

* Lists all fonts rendered on the page with usage count, distinct weights, and distinct sizes  
* Font sizes respect the app-wide font-unit setting (px / rem / pt)  
* Sort by usage count or by dominant role (heading / body / UI / other) — heuristic based on element tag names  
* **Font pairing suggestions** *(Pro)* — per-font "Pairings" button that:  
  * Requests an optional `fonts.google.com` host permission (runtime prompt, only on first use; install-time prompts unchanged)  
  * Downloads Google Fonts' public catalog (`~2.7 MB` JSON, keyless), strips to family/category/popularity  
  * Caches the catalog in `storage.local` for 7 days  
  * Matches locally via a category-contrast rule (serif ↔ sans, display → text) — **no font names or page data are ever sent**  
  * Shows top 4 suggestions linking to Google Fonts specimen pages  
  * In-view privacy note explains what the permission is for

### Settings *(free account)*

* Light / dark theme toggle (persisted)  
* Preferred color format: HEX / RGB / HSL (applied to inspector + popup)  
* Font unit preference: px / rem / pt (applied to inspector, popup, typography tab)  
* Keyboard shortcut reference: Q cycle tabs, W inspector on/off, E popup on/off, N theme  
* Dev builds only: tier override selector (anonymous / free\_account / pro) for testing all gating states without a backend

### Tier gating (cross-cutting)

* Three-state `UserTier`: `anonymous` | `free_account` | `pro`  
* Locked views show a lock-icon panel with a tier hint instead of hiding the view  
* Locked in-view features are shown disabled with a 🔒 indicator  
* `getUserTier()` is sync from an in-memory cache; `initUserTier()` loads from storage and watches for changes  
* Default (safest) tier: `anonymous`

---

## **5\. Planned features — status**

### Overview tab

| Item | Status |
| --- | --- |
| Sort color palette by purpose | ✅ Shipped (Pro) |
| "Download all" as ZIP | ✅ Shipped (Pro) |
| Export palette in multiple formats | ✅ Shipped (Pro) |

### Typography tab

| Item | Status |
| --- | --- |
| Show all fonts on the page | ✅ Shipped (free account) |
| Sort by role | ✅ Shipped (free account) |
| Font pairing suggestions | ✅ Shipped (Pro, Google Fonts catalog, local matching) |

### UX

| Item | Status |
| --- | --- |
| Detachable sidebar | 🚫 Moved to §9 — not possible on existing sidebar surface |
| Dock position in settings | 🚫 Moved to §9 — not controllable via sidebar APIs |

### Settings

| Item | Status |
| --- | --- |
| Font unit preference | ✅ Shipped |

---

## **6\. Reworks — status**

| Item | Status |
| --- | --- |
| Contrast tab shows numeric score + AA/AAA | ✅ Done (was already in baseline; verified) |
| Hover empty containers resolves to child | ✅ Done |
| Larger base font for readability | ✅ Done (body 12→13 px, headings scaled up) |
| Inline copy confirmation | ✅ Done (floating "Copied ✓" pill) |

**Stretch goals / not yet scheduled**

* Authored (source) CSS values in the Inspector (Pro) — complex, deferred  
* Inspection history (Pro) — deferred  
* PDF / Adobe ASE palette export — deferred (non-trivial library cost)

---

## **7\. Account, free tier & Pro**

PeekCSS uses three tiers: **Free (no account)**, **Free (with account)**, and **Pro**.

* **Free (no account)** covers the core single-element inspection workflow — the "hover, see, copy" experience that works the moment someone installs the extension, with zero signup friction.  
* **Free (with account)** adds page-level analysis (Overview, Typography) and customization (Settings) — a real upgrade in capability, at no cost, in exchange for an email address.  
* **Pro** adds bulk operations, exports, source-level depth, and anything with an ongoing per-use cost (third-party APIs, storage/history).

### Inspector tab

| Feature | Free, no account | Free, with account | Pro |
| --- | --- | --- | --- |
| Hover & click inspect | ✅ | ✅ | ✅ |
| Computed CSS property viewer | ✅ | ✅ | ✅ |
| Authored (source) CSS values | ❌ | ❌ | ✅ |
| Spacing visualization | ✅ | ✅ | ✅ |
| Element contrast ratio | ✅ | ✅ | ✅ |
| Single color extraction | ✅ | ✅ | ✅ |
| Basic font info (selected element) | ✅ | ✅ | ✅ |
| Copy value / group / full CSS | ✅ | ✅ | ✅ |

### Overview tab

| Feature | Free, no account | Free, with account | Pro |
| --- | --- | --- | --- |
| Page accessibility score & contrast issues | ❌ | ✅ | ✅ |
| Full color palette extraction | ❌ | ✅ | ✅ |
| Sort palette by purpose | ❌ | ❌ | ✅ |
| Image list + single-image download | ❌ | ✅ | ✅ |
| Download all images (ZIP) | ❌ | ❌ | ✅ |
| Color palette export (CSS / SCSS / JSON / Tailwind) | ❌ | ❌ | ✅ |

### Typography tab

| Feature | Free, no account | Free, with account | Pro |
| --- | --- | --- | --- |
| Font list for the page | ❌ | ✅ | ✅ |
| Sort fonts by role (heading / body / etc.) | ❌ | ✅ | ✅ |
| Font pairing recommendations | ❌ | ❌ | ✅ |

### Settings

| Feature | Free, no account | Free, with account | Pro |
| --- | --- | --- | --- |
| Display, color format, font unit, shortcuts | ❌ | ✅ | ✅ |

### Cross-cutting

| Feature | Free, no account | Free, with account | Pro |
| --- | --- | --- | --- |
| Inspection history | ❌ | ❌ | ✅ |

### Gating interface

```ts
type UserTier = 'anonymous' | 'free_account' | 'pro';
function getUserTier(): UserTier { /* reads cached account/license state */ }
```

Every gated feature checks against this rather than a simple `isPro()` boolean. In development, the tier is overridable via the Settings dev-block selector (DEV builds only) or the `devTierOverride` storage key.

---

## **8\. Further feature proposals — process note**

Rather than having Copilot autonomously design and implement new features in the same pass as the spec'd work above, have it **propose** additions as a list with short rationales (added to this file under a new "Proposed" section) for review. This keeps scope predictable on a long autonomous run — implementation of anything in that list happens in a separate, explicitly-scoped pass after review.

---

## **9\. Open questions / resolved items**

* **Detachable / floating sidebar**: Firefox's `sidebarAction` API has no detach-to-floating-window capability. An alternative would be a separate extension surface (`browser.windows.create` loading the same app) — this is a new surface to design, not a setting on the existing one.  
* **Dock position setting**: controlled by the browser, not exposed to extensions via the sidebar APIs. At most, Settings could link to browser instructions.  
* **Account/Pro backend model** — needs an explicit decision before sign-in / license-check code can be written.  
* ~~**Third-party font API choice**~~ — **Resolved: Google Fonts** (public metadata catalog, no API key). Catalog downloaded behind a runtime-requested `fonts.google.com` host permission; all matching is local; no font names or page data are ever transmitted. Store-listing disclosure: *"The optional font-pairing feature (Pro) downloads the public Google Fonts catalog from fonts.google.com after you grant access. No information about you or the pages you visit is ever transmitted."*  
* **New manifest permissions**: `downloads` was already present; ZIP needed no new permission; font pairing adds only a runtime-optional host permission — install-time prompts unchanged on both browsers.

---

## **10\. Verification & process**

**Build/typecheck (run before each commit)**

```
npm run compile        # tsc --noEmit — must pass clean
npx wxt build -b firefox
npx wxt build          # Chrome (default)
```

**Manual QA checklist (for Leon to run)**

* Load unpacked build in Firefox (web-ext or `about:debugging`)  
* Step dev tier selector: anonymous → free\_account → pro — verify locked panels, lock badges, and feature availability at each tier  
* On a real page: inspect an element, copy values, open Overview (scan + palette + images), open Typography (fonts + pairing permission prompt + suggestions)  
* Repeat on Chrome where applicable

**Git / commit process**

* One commit per coherent task, not just at end of session  
* Clear, short commit messages  
* Update §4 after any material feature change — this doc should stay accurate as a snapshot of what's actually built

