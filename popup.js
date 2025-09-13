async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

document.getElementById("toggle").addEventListener("click", async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { type: "TAB_LOCKER_TOGGLE" }, (res) => {
    const s = document.getElementById("status");
    if (chrome.runtime.lastError) {
      s.textContent = "Status: content script not ready on this page.";
      return;
    }
    s.textContent = `Current tab: ${res?.locked ? "LOCKED" : "UNLOCKED"}`;
  });
});

// Show current state best-effort (we don’t persist per-tab state here)
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("status").textContent = "Current tab: click to toggle";
});
