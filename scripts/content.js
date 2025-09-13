(function () {
  const OVERLAY_ID = "tab-locker-overlay";
  const STYLE_ID = "tab-locker-style";
  const ANIM_PAUSE_STYLE_ID = "tab-locker-anim-pause-style";
  const BEFORE_UNLOAD_FLAG = "tab-locker-beforeunload";

  // ---------- Global state & saved styles ----------
  let isLocked = false;
  let unlockingInProgress = false;
  const saved = {
    htmlPointer: "",
    bodyPointer: "",
    htmlOverflow: "",
    bodyOverflow: "",
    htmlFilter: ""
  };

  // ---------- Media state ----------
  const pausedState = new WeakMap();
  let mutationObserver = null;

  // ---------- Overlay ----------
  function ensureOverlay() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${OVERLAY_ID} {
          position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(0,0,0,0.88); color:#fff;
          display:none; align-items:center; justify-content:center; text-align:center;
          font: 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          pointer-events:auto;
        }
        #${OVERLAY_ID}.show { display:flex; }
        #${OVERLAY_ID} .box {
          max-width:520px; padding:24px 28px; border-radius:12px;
          background: rgba(255,255,255,0.06); backdrop-filter: blur(6px);
        }
        #${OVERLAY_ID} h1 { margin:0 0 12px; font-size:20px; }
        #${OVERLAY_ID} p { margin:8px 0; line-height:1.5; opacity:0.9; }
        #tab-locker-unlock { margin-top:12px; padding:10px 14px; border:0; border-radius:8px; font-weight:600; cursor:pointer; }
      `;
      document.documentElement.appendChild(style);
    }
    if (!document.getElementById(OVERLAY_ID)) {
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.tabIndex = -1;
      overlay.innerHTML = `
        <div class="box" role="dialog" aria-modal="true" aria-label="Screen Locked">
          <h1>Screen Locked</h1>
          <p>Interaction is disabled on this tab.</p>
          <button id="tab-locker-unlock" type="button">Unlock</button>
          <p><small>Or use the popup / Ctrl/⌘+Shift+L.</small></p>
        </div>
      `;
      document.documentElement.appendChild(overlay);

      overlay.querySelector("#tab-locker-unlock").addEventListener("click", (e) => {
        e.stopPropagation(); e.preventDefault();
        unlockSafe();
      });
    }
  }

  // ---------- Animation freeze ----------
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

  // ---------- Media pause/resume ----------
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

  // ---------- Keyboard guards ----------
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

  // ---------- Before unload ----------
  function beforeUnloadHandler(e) { e.preventDefault(); e.returnValue = ""; }

  // ---------- Lock / Unlock ----------
  function lockSafe() {
    if (isLocked) return;
    ensureOverlay();
    const overlay = document.getElementById(OVERLAY_ID);

    // Save styles
    saved.htmlPointer = document.documentElement.style.pointerEvents;
    saved.bodyPointer = document.body ? document.body.style.pointerEvents : "";
    saved.htmlOverflow = document.documentElement.style.overflow;
    saved.bodyOverflow = document.body ? document.body.style.overflow : "";
    saved.htmlFilter = document.documentElement.style.filter;

    // Block inputs
    document.documentElement.style.pointerEvents = "none";
    if (document.body) document.body.style.pointerEvents = "none";
    overlay.style.pointerEvents = "auto";
    document.documentElement.style.overflow = "hidden";
    if (document.body) document.body.style.overflow = "hidden";

    // Media + animations
    ensureAnimPauseStyle();
    pauseMediaInDocument(document);
    startObservingNewMedia();

    // Keys + unload
    addKeyGuards(overlay);
    if (!window[BEFORE_UNLOAD_FLAG]) {
      window.addEventListener("beforeunload", beforeUnloadHandler);
      window[BEFORE_UNLOAD_FLAG] = true;
    }

    overlay.classList.add("show");
    overlay.focus({ preventScroll: true });

    isLocked = true;
  }

  function unlockSafe() {
    if (!isLocked || unlockingInProgress) return;
    unlockingInProgress = true;
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) { unlockingInProgress = false; return; }

    overlay.classList.remove("show");

    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        stopObservingNewMedia();
        removeAnimPauseStyle();
        await resumeMediaInDocument(document);

        // Restore
        document.documentElement.style.pointerEvents = saved.htmlPointer;
        if (document.body) document.body.style.pointerEvents = saved.bodyPointer;
        document.documentElement.style.overflow = saved.htmlOverflow;
        if (document.body) document.body.style.overflow = saved.bodyOverflow;
        document.documentElement.style.filter = saved.htmlFilter;

        removeKeyGuards(overlay);
        if (window[BEFORE_UNLOAD_FLAG]) {
          window.removeEventListener("beforeunload", beforeUnloadHandler);
          window[BEFORE_UNLOAD_FLAG] = false;
        }

        isLocked = false;
        unlockingInProgress = false;
      });
    });
  }

  // ---------- Auto lock cycle ----------
  let lockIntervalId = null;
  let lockDuration = 5000; // 5s lock duration
  let initialCycleTime = 20 * 60 * 1000; // start at 20 minutes
  let minCycleTime = 10 * 60 * 1000;     // down to 10 minutes
  let cycleStep = 0.2 * 60 * 1000;         // decrease by 1 minute each cycle
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

  // React to future changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.fofixTime) {
      cycleTime = parseFloat(changes.fofixTime.newValue, 10) * 60 * 1000;
      console.log("[FoFix] updated cycleTime to", cycleTime, "ms");
      startAutoLockCycle();
    }
  });

  // ---------- Message bridge ----------
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

  // ---------- Ready ----------
  ensureOverlay();
})();