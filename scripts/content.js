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
function waitForFadeOut(overlay, timeoutMs = 1100) {
  return new Promise((resolve) => {
    let done = false;
    const onEnd = (e) => {
      if (e.target === overlay && e.propertyName === "opacity") {
        if (!done) { done = true; overlay.removeEventListener("transitionend", onEnd); resolve(); }
      }
    };
    overlay.addEventListener("transitionend", onEnd);
    setTimeout(() => {
      if (!done) {
        done = true;
        overlay.removeEventListener("transitionend", onEnd);
        resolve();
      }
    }, timeoutMs);
  });
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
    return { name, steps: data.steps, source: data.source };
  }

  function ensureOverlay() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${OVERLAY_ID} {
  position: fixed; inset: 0; z-index: 2147483647;
  background: radial-gradient(circle at center, #B3E5FC, #1A237E);
  display: flex; align-items: left; justify-content: center; text-align: left;
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
    <p id="academic"><small>source: you're mother</small></p>
  </div>`;
      document.documentElement.appendChild(overlay);

      overlay.querySelector("#tab-locker-unlock").addEventListener("click", (e) => {
        e.stopPropagation(); 
        e.preventDefault();
        unlockSafe();
      });
    }
  }

  let timing = 5

async function showRandomExercise() {
  const ex = await getRandomExercise();
  if (!ex) {
    document.getElementById("tab-locker-message").textContent = "couldn't find exercise";
    return;
  }

  // Example: ex = { name: "breathing", steps: ["Inhale", "Hold", "Exhale"] }
  document.getElementById("tab-locker-message").innerHTML = ex.steps
    .map((s, i) => `<div>${i + 1}. ${s}</div>`)
    .join("");
  document.getElementById("academic").innerHTML=ex.source

    timing = ex.time
}

function ensureAnimPauseStyle() {
  let s = document.getElementById(ANIM_PAUSE_STYLE_ID);
  if (!s) {
    s = document.createElement("style");
    s.id = ANIM_PAUSE_STYLE_ID;
    s.textContent = `
      /* While locked, pause animations/transitions everywhere EXCEPT the overlay */
      html.tab-locker-locked *:not(#${OVERLAY_ID}):not(#${OVERLAY_ID} *) {
        animation-play-state: paused !important;
        /* disable transitions on page content; keep overlay's transitions alive */
        transition-duration: 0s !important;
      }
    `;
    document.head.appendChild(s);
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


  async function lockSafe() {
  if (isLocked) return;
  ensureOverlay();              // your overlay builder
  showRandomExercise?.();       // optional: populate text if you have this
  await showRandomExercise();              // updates `timing`
  const lockDuration = getLockDurationMs(); // <-- compute NOW
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  // Save current inline styles to restore precisely
  saved.htmlPointer  = document.documentElement.style.pointerEvents;
  saved.bodyPointer  = document.body ? document.body.style.pointerEvents : "";
  saved.htmlOverflow = document.documentElement.style.overflow;
  saved.bodyOverflow = document.body ? document.body.style.overflow : "";
  saved.htmlFilter   = document.documentElement.style.filter;

  // Block interaction with the page; keep overlay interactive
  document.documentElement.style.pointerEvents = "none";
  if (document.body) document.body.style.pointerEvents = "none";
  overlay.style.pointerEvents = "auto";
  document.documentElement.style.overflow = "hidden";
  if (document.body) document.body.style.overflow = "hidden";

  // --- Media & animations ---
  document.documentElement.classList.add("tab-locker-locked");
  ensureAnimPauseStyle();               // freeze CSS animations/transitions
  pauseMediaInDocument(document);        // pause existing <video>/<audio>
  startObservingNewMedia();              // pause newly added media while locked

  // --- Keys & unload guards ---
  addKeyGuards(overlay);
  if (!window[BEFORE_UNLOAD_FLAG]) {
    window.addEventListener("beforeunload", beforeUnloadHandler);
    window[BEFORE_UNLOAD_FLAG] = true;
  }

  // Show overlay with fade-in (you already have CSS: opacity 0 -> 1 on .show)
  overlay.style.display = "flex";        // ensure it's renderable before adding class
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add("show");     // triggers transition: opacity 1
    });
  });
  overlay.focus({ preventScroll: true });

  isLocked = true;
}

async function unlockSafe() {
  if (!isLocked || unlockingInProgress) return;
  unlockingInProgress = true;

  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) { unlockingInProgress = false; return; }

  // Start fade-out
  overlay.classList.remove("show");  // CSS opacity goes 1 -> 0

  // Wait for the 1s transition (or fallback)
  await waitForFadeOut(overlay, 1100);
  overlay.style.display = "none";    // remove from the flow after fade

  // --- stop watching & unfreeze animations first ---
  stopObservingNewMedia();
  document.documentElement.classList.remove("tab-locker-locked");
  removeAnimPauseStyle();

  // --- resume media ---
  await resumeMediaInDocument(document);

  // --- restore input/scroll/visuals EXACTLY to what they were ---
  document.documentElement.style.pointerEvents = saved.htmlPointer;
  if (document.body) document.body.style.pointerEvents = saved.bodyPointer;
  document.documentElement.style.overflow = saved.htmlOverflow;
  if (document.body) document.body.style.overflow = saved.bodyOverflow;
  document.documentElement.style.filter = saved.htmlFilter;

  // --- remove guards ---
  removeKeyGuards(overlay);
  if (window[BEFORE_UNLOAD_FLAG]) {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    window[BEFORE_UNLOAD_FLAG] = false;
  }

  isLocked = false;
  unlockingInProgress = false;
}


  // ---------- Auto lock cycle ----------
  let lockIntervalId = null;

  let lockDuration = timing * 1000;
  let initialCycleTime = 0.5 * 60 * 1000;
  let minCycleTime = 5 * 1000;
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
