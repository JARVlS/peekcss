// entrypoints/background.ts
import type { DownloadRequest, DownloadResult } from '@/utils/messages';
import { revalidateLicense } from '@/utils/license';

// sidebarAction is Firefox-only, so it is absent from WXT's cross-browser
// browser type. Typed here as optional rather than cast at the call site.
const firefoxBrowser = browser as typeof browser & {
  sidebarAction?: { toggle(): Promise<void> | void };
};

export default defineBackground(() => {
  // Re-check the stored license on install and on browser startup so a
  // revoked/upgraded plan is reflected even if the panel isn't opened.
  browser.runtime.onInstalled.addListener(() => void revalidateLicense());
  browser.runtime.onStartup.addListener(() => void revalidateLicense());

  // Toolbar icon click → open the side panel.
  // Chrome's sidePanel API opens on click via setPanelBehavior instead of an
  // onClicked listener; Firefox has no such behavior flag, so it keeps using
  // sidebarAction.toggle() from the click event.
  if (browser.sidePanel) {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } else {
    browser.action.onClicked.addListener(() => {
      firefoxBrowser.sidebarAction?.toggle();
    });
  }

  // http(s) image downloads are routed here so they use the privileged
  // downloads API, which fetches with the browser's own credentials and
  // ignores page CSP / cross-origin restrictions. data:/blob: URLs are handled
  // in the popup instead (see entrypoints/sidepanel/main.ts) because converting
  // them requires URL.createObjectURL, which is absent in a Chrome MV3 worker.
  //
  // Returning a Promise tells the WebExtensions runtime to keep the message
  // channel open and deliver the resolved value back to the popup as the
  // sendMessage response.
  browser.runtime.onMessage.addListener(
    (message: DownloadRequest): Promise<DownloadResult> | undefined => {
      if (!message || message.kind !== 'download-request') {
        return undefined;
      }
      return handleDownloadRequest(message);
    },
  );
});

async function handleDownloadRequest(message: DownloadRequest): Promise<DownloadResult> {
  try {
    const downloadId = await browser.downloads.download({
      url: message.url,
      filename: message.filename,
    });
    return { ok: true, downloadId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[PeekCSS] background download failed:', reason, message.url);
    return { ok: false, error: reason };
  }
}