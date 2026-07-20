import { defineConfig } from 'wxt';

const faviconSvg = '/icon/favicon.svg';
const firefoxIcons = {
  16: faviconSvg,
  32: faviconSvg,
  48: faviconSvg,
  96: faviconSvg,
  128: faviconSvg,
} as const;

export default defineConfig({
  manifestVersion: 3, // force MV3 on BOTH browsers
  manifest: ({ browser }) => ({
    name: 'PeekCSS',
    description: 'Inspect CSS, colors, fonts, and assets on any webpage.',
    ...(browser === 'firefox' ? { icons: firefoxIcons } : {}),
    permissions: ['storage', 'activeTab', 'downloads'],
    ...(browser === 'firefox' ? { action: { default_icon: faviconSvg } } : { action: {} }),
    // Font pairing downloads Google Fonts' public catalog on demand (no page
    // data is sent). Requested at runtime, so install prompts stay unchanged:
    // Firefox MV3 treats host_permissions as optional + runtime-requestable;
    // Chrome needs optional_host_permissions for the same behavior.
    //
    // Chrome/Edge also need an explicit host_permissions grant for <all_urls>
    // here. content_scripts.matches already injects the content script
    // everywhere, but per Chrome's docs that alone does not reliably expose
    // tabs.Tab.url to chrome.tabs.query() — only "tabs" or host_permissions
    // do. Without this, the side panel's tab.url check in main.ts comes back
    // undefined on tabs where activeTab wasn't just (re-)granted (e.g. after
    // switching tabs or navigating), and the sidebar shows "Can't inspect
    // this page" even on ordinary http(s) pages. This adds no new capability
    // beyond what content_scripts.matches already grants, just makes it
    // explicit so tab.url resolves reliably. WXT's dev builds already add
    // this (plus "tabs"/"scripting") automatically, which is why this only
    // showed up in the shipped production build, not local testing.
    ...(browser === 'firefox'
      ? { host_permissions: ['https://fonts.google.com/*'] }
      : {
          host_permissions: ['<all_urls>'],
          optional_host_permissions: ['https://fonts.google.com/*'],
        }),
    // Firefox requires new extensions (from Nov 3, 2025) to declare what
    // personal data they collect/transmit. PeekCSS never sends page data or
    // CSS anywhere; the only thing that ever leaves the browser is the
    // license token, POSTed to peekcss.com/api/license/validate, and only if
    // the user pastes one (see utils/license.ts). That's declared optional,
    // not required — anonymous/free-tier use never triggers it — and the
    // extension requests runtime consent (browser.permissions.request) at
    // the point of first use, same pattern as the Google Fonts host
    // permission above.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              // Permanent once first published — AMO locks this in on signing.
              id: 'peekcss@peekcss.com',
              data_collection_permissions: {
                required: ['none'],
                optional: ['authenticationInfo'],
              },
            },
          },
        }
      : {}),
  }),
});