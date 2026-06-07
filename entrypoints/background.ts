// entrypoints/background.ts
export default defineBackground(() => {
  // Toolbar icon click → toggle sidebar.
  // Chrome branch (sidePanel API) goes here when we port to Chrome.
  browser.action.onClicked.addListener(() => {
    browser.sidebarAction.toggle();
  });
});