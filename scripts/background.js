chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-lock") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TAB_LOCKER_TOGGLE" });
});
