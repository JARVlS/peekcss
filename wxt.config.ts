import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3, // force MV3 on BOTH browsers
  manifest: {
    name: 'PeekCSS',
    description: 'Inspect CSS, colors, fonts, and assets on any webpage.',
    permissions: ['storage', 'activeTab', 'downloads'],
    action: {}
  },
});