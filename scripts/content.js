(function () {
  const OVERLAY_ID = "tab-locker-overlay";
  const STYLE_ID = "tab-locker-style";
  const ANIM_PAUSE_STYLE_ID = "tab-locker-anim-pause-style";
  const BEFORE_UNLOAD_FLAG = "tab-locker-beforeunload";

  
  let isLocked = false;
  let unlockingInProgress = false;
  const saved = {
    htmlPointer: "",
    bodyPointer: "",
    htmlOverflow: "",
    bodyOverflow: "",
    htmlFilter: ""
  };


  const pausedState = new WeakMap();
  let mutationObserver = null;

  let exercises = {};

  async function loadExercises() {
    const url = chrome.runtime.getURL("scripts/exercises.json");
    const res = await fetch(url);
    exercises = await res.json();
  }

  async function getRandomExercise() {
    if (Object.keys(exercises).length === 0){ 
      await loadExercises()
      console.log("no exercise")
    }
    console.log("past exercize check", exercises)
    const enabled = Object.entries(exercises);
    if (enabled.length === 0) return null;
    const [name, data] = enabled[Math.floor(Math.random() * enabled.length)];
    return { name, steps: data.steps };
  }

  function ensureOverlay() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${OVERLAY_ID} {
  position: fixed; inset: 0; z-index: 2147483647;
  background: radial-gradient(circle at center, #B3E5FC, #1A237E);
  display: flex; align-items: center; justify-content: center; text-align: center;
  font: 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  pointer-events: none; opacity: 0; transition: opacity 1s ease-in-out;
}
#${OVERLAY_ID}.show {
  opacity: 1; pointer-events: auto;
}
#${OVERLAY_ID} .box {
  max-width: 640px;
  padding: 48px 56px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
#${OVERLAY_ID} h1 {
  margin: 0 0 16px;
  font-size: 2em;
  color: #6e4f32;
}
#${OVERLAY_ID} p {
  margin: 12px 0;
  line-height: 1.6;
  opacity: 0.95;
  color: #6e4f32;
}
#tab-locker-unlock {
  margin-top: 20px;
  padding: 12px 20px;
  border: 0;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  background: #FFEB3B;
  color: #333;
  transition: background 0.3s;
}
#tab-locker-unlock:hover {
  background: #FDD835;
}

      `;
      document.documentElement.appendChild(style);
    }

    if (!document.getElementById(OVERLAY_ID)) {
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.tabIndex = -1;
      overlay.innerHTML = `
  <div class="box" role="dialog" aria-modal="true" aria-label="Screen Locked">
    <h1 id="tab-locker-title">Pause for a Breath</h1>
    <p id="tab-locker-message">Interaction is disabled on this tab.</p>
    <button id="tab-locker-unlock" type="button">Unlock</button>
    <p><small>Or use the popup / Ctrl/⌘+Shift+L.</small></p>
  </div>`;
      document.documentElement.appendChild(overlay);

      overlay.querySelector("#tab-locker-unlock").addEventListener("click", (e) => {
        e.stopPropagation(); 
        e.preventDefault();
        unlockSafe();
      });
    }
  }

async function showRandomExercise() {
  const ex = await getRandomExercise();
  if (!ex) {
    document.getElementById("tab-locker-message").textContent = "couldn't fine exercise";
    return;
  }

  // Example: ex = { name: "breathing", steps: ["Inhale", "Hold", "Exhale"] }
  document.getElementById("tab-locker-message").innerHTML = ex.steps
    .map((s, i) => `<div>${i + 1}. ${s}</div>`)
    .join("");
}

  function ensureAnimPauseStyle() {
    if (!document.getElementById(ANIM_PAUSE_STYLE_ID)) {
      const s = document.createElement("style");
      s.id = ANIM_PAUSE_STYLE_ID;
      s.textContent = `
        * { animation-play-state: paused !important; transition-property: none !important; }
        img { image-rendering: auto; }
      `;
      document.documentElement.appendChild(s);
    }
  }

  function removeAnimPauseStyle() {
    const s = document.getElementById(ANIM_PAUSE_STYLE_ID);
    if (s) s.remove();
  }


  function pauseMediaInDocument(root = document) {
    const media = root.querySelectorAll?.("video, audio") || [];
    media.forEach((el) => {
      try {
        const wasPlaying = !el.paused && !el.ended && el.readyState > 2;
        if (!pausedState.has(el)) {
          pausedState.set(el, {
            wasPlaying,
            time: el.currentTime || 0,
            playbackRate: el.playbackRate || 1,
            muted: el.muted
          });
        }
        el.muted = true;
        try { el.playbackRate = 0; } catch (_) {}
        if (wasPlaying) el.pause();
      } catch (_) {}
    });
  }

  async function resumeMediaInDocument(root = document) {
    const media = root.querySelectorAll?.("video, audio") || [];
    for (const el of media) {
      try {
        const state = pausedState.get(el);
        if (!state) continue;
        try { el.playbackRate = state.playbackRate || 1; } catch (_) {}
        el.muted = state.muted;
        if (!Number.isNaN(state.time)) {
          try { el.currentTime = state.time; } catch (_) {}
        }
        if (state.wasPlaying) {
          try { await el.play(); } catch (_) {}
        }
        pausedState.delete(el);
      } catch (_) {}
    }
  }

  function startObservingNewMedia() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
      if (!isLocked) return;
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n instanceof HTMLVideoElement || n instanceof HTMLAudioElement) {
            pauseMediaInDocument(n.ownerDocument || document);
          } else if (n.querySelectorAll) {
            const found = n.querySelectorAll("video, audio");
            if (found.length) pauseMediaInDocument(n);
          }
        });
      }
    });
    mutationObserver.observe(document, { childList: true, subtree: true });
  }
  function stopObservingNewMedia() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }


  function addKeyGuards(overlay) {
    const eatKeysIfOutside = (e) => {
      if (overlay.contains(e.target)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      return false;
    };
    overlay._keyGuards = [
      ["keydown", eatKeysIfOutside, true],
      ["keyup", eatKeysIfOutside, true],
      ["keypress", eatKeysIfOutside, true],
    ];
    overlay._keyGuards.forEach(([t,h,o]) => {
      window.addEventListener(t,h,o);
      document.addEventListener(t,h,o);
    });
  }
  function removeKeyGuards(overlay) {
    if (!overlay._keyGuards) return;
    overlay._keyGuards.forEach(([t,h,o]) => {
      window.removeEventListener(t,h,o);
      document.removeEventListener(t,h,o);
    });
    overlay._keyGuards = null;
  }


  function beforeUnloadHandler(e) { e.preventDefault(); e.returnValue = ""; }


  function lockSafe() {
  if (isLocked) return;
  ensureOverlay();
  showRandomExercise();
  const overlay = document.getElementById(OVERLAY_ID);

  // ... (save styles, pause media, block input, etc.)

  overlay.style.display = "flex";  // make sure element is visible
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add("show"); // now the transition triggers
    });
  });

  overlay.focus({ preventScroll: true });
  isLocked = true;
}

function unlockSafe() {
  if (!isLocked || unlockingInProgress) return;
  unlockingInProgress = true;
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) { unlockingInProgress = false; return; }

  overlay.classList.remove("show"); // fade-out starts

  // wait for CSS transition to finish (matches 1s transition)
  setTimeout(async () => {
    overlay.style.display = "none"; // hide completely after fade-out

    // ... (resume media, restore input, etc.)
    unlockingInProgress = false;
    isLocked = false;
  }, 1000);
}


  // ---------- Auto lock cycle ----------
  let lockIntervalId = null;

  let lockDuration = 10000;
  let initialCycleTime = 20 * 60 * 1000;
  let minCycleTime = 10 * 60 * 1000;
  let cycleStep = 0.2 * 60 * 1000;
  
  let currentCycleTime = initialCycleTime;


  function startAutoLockCycle() {
  if (lockIntervalId) clearInterval(lockIntervalId);

  lockIntervalId = setInterval(() => {
    ensureOverlay();
    lockSafe();
    console.log("[FoFix] auto-locked for", lockDuration, "ms");
    setTimeout(() => {
      unlockSafe();
      console.log("[FoFix] auto-unlocked");
    }, lockDuration);

    // Gradually decrease interval
    if (currentCycleTime > minCycleTime) {
      currentCycleTime = Math.max(currentCycleTime - cycleStep, minCycleTime);
      console.log("[FoFix] next lock in", currentCycleTime / 60000, "minutes");
      restartInterval();
    }
  }, currentCycleTime);
}

  function restartInterval() {
    if (lockIntervalId) clearInterval(lockIntervalId);
    lockIntervalId = setInterval(() => {
      ensureOverlay();
      lockSafe();

      console.log("[FoFix] auto-locked for", lockDuration, "ms");
      setTimeout(() => {
        unlockSafe();
        console.log("[FoFix] auto-unlocked");
      }, lockDuration);

      if (currentCycleTime > minCycleTime) {
        currentCycleTime = Math.max(currentCycleTime - cycleStep, minCycleTime);
        console.log("[FoFix] next lock in", currentCycleTime / 60000, "minutes");

        restartInterval();
      }
    }, currentCycleTime);
  }


currentCycleTime = initialCycleTime;
startAutoLockCycle();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.fofixTime) {
      cycleTime = parseFloat(changes.fofixTime.newValue, 10) * 60 * 1000;
      
      startAutoLockCycle();
    }
  });


  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "TAB_LOCKER_TOGGLE") {
      if (isLocked) { unlockSafe(); sendResponse?.({ locked:false }); }
      else { lockSafe(); sendResponse?.({ locked:true }); }
      return true;
    }
    if (msg?.type === "TAB_LOCKER_SET") {
      if (msg.enabled) { lockSafe(); sendResponse?.({ locked:true }); }
      else { unlockSafe(); sendResponse?.({ locked:false }); }
      return true;
    }
  });


  ensureOverlay();
})();
