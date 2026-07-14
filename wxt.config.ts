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
    // Fir