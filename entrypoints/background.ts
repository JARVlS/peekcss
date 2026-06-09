// entrypoints/background.ts
import type { DownloadRequest } from '@/utils/messages';

export default defineBackground(() => {
  // Toolbar icon click → toggle sidebar.
  // Chrome branch (sidePanel API) goes here when we port to Chrome.
  browser.action.onClicked.addListener(() => {
    browser.sidebarAction.toggle();
  });

  // Image downloads are routed here so they use the privileged downloads API,
  // which works regardless of page CSP or cross-origin restrictions.
  browser.runtime.onMessage.addListener((msg: DownloadRequest) => {
    if (msg?.kind !== 'download-request' || !msg.url) return;
    browser.downloads.download({ url: msg.url, filename: msg.filename }).catch(() => {
      // Fall back to opening the resource if the download is rejected.
      browser.tabs.create({ url: msg.url });
    });
  });
});