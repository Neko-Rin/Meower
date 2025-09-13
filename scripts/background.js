// const OFFSCREEN_URL = 'db/offscreen.html';

// chrome.runtime.onInstalled.addListener(() => ensureOffscreen());
// chrome.runtime.onStartup.addListener(() => ensureOffscreen());

// async function ensureOffscreen() {
//   const has = await chrome.offscreen.hasDocument?.();
//   if (!has) {
//     await chrome.offscreen.createDocument({
//       url: OFFSCREEN_URL,
//       reasons: ['BLOBS'], // any valid reason is fine; we need a long-lived DOM context
//       justification: 'Keep SQLite WASM and OPFS DB open'
//     });
//   }
// }

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-lock") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TAB_LOCKER_TOGGLE" });
});

// 🔹 New listener for popup messages
chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === "CATEGORY_TOGGLE") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Forward to content script
    chrome.tabs.sendMessage(tab.id, {
      type: "CATEGORY_TOGGLE",
      category: msg.category,
      enabled: msg.enabled
    });
  }
});
