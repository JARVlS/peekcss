// entrypoints/background.ts
import type { DownloadRequest, DownloadResult } from '@/utils/messages';

// sidebarAction is Firefox-only, so it is absent from WXT's cross-browser
// browser type. Typed here as optional rather than cast at the call site.
const firefoxBrowser = browser as typeof browser & {
  sidebarAction?: { toggle(): Promise<void> | void };
};

export default defineBackground(() => {
  // Toolbar icon click → toggle sidebar.
  // Chrome branch (sidePanel API) goes here when we port to Chrome.
  browser.action.onClicked.addListener(() => {
    firefoxBrowser.sidebarAction?.toggle();
  });

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