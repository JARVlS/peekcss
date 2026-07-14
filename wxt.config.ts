import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3, // force MV3 on BOTH browsers
  manifest: ({ browser }) => ({
    name: 'PeekCSS',
    description: 'Inspect CSS, colors, fonts, and assets on any webpage.',
    permissions: ['storage', 'activeTab', 'downloads'],
    action: {},
    // Font pairing downloads Google Fonts' public catalog on demand (no page
    // data is sent). Requested at runtime, so install prompts stay unchanged:
    // Firefox MV3 treats host_permissions as optional + runtime-requestable;
    // Chrome needs optional_host_permissions for the same behavior.
    ...(browser === 'firefox'
      ? { host_permissions: ['https://fonts.google.com/*'] }
      : { optional_host_permissions: ['https://fonts.google.com/*'] }),
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