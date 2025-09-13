// ======== Existing UI elements ========
const toggle = document.getElementById("toggle");
const toggleLabel = document.getElementById("toggle-label");
const timeInput = document.getElementById("timeInput");
const mainView = document.getElementById("main-view");
const fixesView = document.getElementById("fixes-view");
const fixesContainer = document.getElementById("fixes-container");
const showFixesBtn = document.getElementById("show-fixes");
const backBtn = document.getElementById("back-button");

// ======== Load saved settings ========
chrome.storage.sync.get(["fofixEnabled", "fofixTime"], (data) => {
  if (data.fofixEnabled !== undefined) {
    toggle.checked = data.fofixEnabled;
    toggleLabel.textContent = toggle.checked ? "On" : "Off";
  }
  if (data.fofixTime !== undefined) {
    timeInput.value = data.fofixTime;
  }
});

// ======== Toggle handlers ========
toggle.addEventListener("change", () => {
  const enabled = toggle.checked;
  toggleLabel.textContent = enabled ? "On" : "Off";

  // Send message to current tab to toggle the overlay immediately
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "TAB_LOCKER_TOGGLE" });
  });
});

timeInput.addEventListener("input", () => {
  const time = timeInput.value;
  chrome.storage.sync.set({ fofixTime: time });
});

// ======== Category toggles ========
document.querySelectorAll(".fix-toggle").forEach(toggle => {
  toggle.addEventListener("change", () => {
    const category = toggle.dataset.category;
    const enabled = toggle.checked;

    chrome.storage.sync.set({ [category]: enabled });

    chrome.runtime.sendMessage({
      type: "CATEGORY_TOGGLE",
      category,
      enabled
    });
  });
});

// ======== Load fixes JSON ========
let fixesData = null;

fetch(chrome.runtime.getURL('fixes.json'))
  .then(res => res.json())
  .then(fixes => {
    fixesData = fixes;
    console.log("Fixes loaded:", fixesData);
  });

// ======== Show Fixes / Back button logic ========
showFixesBtn.addEventListener("click", () => {
  mainView.style.display = "none";
  fixesView.style.display = "block";
  loadFixes();
});

backBtn.addEventListener("click", () => {
  fixesView.style.display = "none";
  mainView.style.display = "block";
});

// ======== Populate fixes in fixes-container ========
function loadFixes() {
  fixesContainer.innerHTML = ""; // clear previous

  if (!fixesData) return;

  for (const category in fixesData) {
    const catHeader = document.createElement("h3");
    catHeader.textContent = category;
    fixesContainer.appendChild(catHeader);

    fixesData[category].forEach(fixText => {
      const p = document.createElement("p");
      p.textContent = fixText;
      fixesContainer.appendChild(p);
    });
  }
}
