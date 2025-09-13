(function () {
  const OVERLAY_ID = "tab-locker-overlay";
  const STYLE_ID = "tab-locker-style";
  const ANIM_PAUSE_STYLE_ID = "tab-locker-anim-pause-style";
  const BEFORE_UNLOAD_FLAG = "tab-locker-beforeunload";

  // ---------- Overlay + input swallow ----------
  function ensureOverlay() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${OVERLAY_ID} {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.88);
          color: #fff;
          display: none;
          align-items: center;
          justify-content: center;
          text-align: center;
          font: 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          z-index: 2147483647;
          cursor: none;
        }
        #${OVERLAY_ID}.show { display: flex; }
        #${OVERLAY_ID} .box {
          max-width: 520px;
          padding: 24px 28px;
          border-radius: 12px;
          background: rgba(255,255,255,0.06);
          backdrop-filter: blur(6px);
        }
        #${OVERLAY_ID} h1 { margin: 0 0 12px; font-size: 20px; }
        #${OVERLAY_ID} p { margin: 8px 0; line-height: 1.5; opacity: 0.9; }
      `;
      document.documentElement.appendChild(style);
    }
    if (!document.getElementById(OVERLAY_ID)) {
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.innerHTML = `
        <div class="box" role="dialog" aria-modal="true" aria-label="Screen Locked">
          <h1>Screen Locked</h1>
          <p>Interaction is disabled on this tab.</p>
          <p><small>Use the extension popup or <kbd>Ctrl/⌘+Shift+L</kbd> to unlock.</small></p>
        </div>
      `;
      document.documentElement.appendChild(overlay);
    }
  }

  function beforeUnloadHandler(e) {
    e.preventDefault();
    e.returnValue = "";
  }

  function baseBlockAllInputs(enable) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    if (enable) {
      overlay.classList.add("show");

      const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); return false; };
      overlay._listeners = [
        ["keydown", eat, true],
        ["keyup", eat, true],
        ["keypress", eat, true],
        ["mousedown", eat, true],
        ["mouseup", eat, true],
        ["click", eat, true],
        ["dblclick", eat, true],
        ["contextmenu", eat, true],
        ["wheel", eat, { capture: true, passive: false }],
        ["touchstart", eat, { capture: true, passive: false }],
        ["touchmove", eat, { capture: true, passive: false }],
        ["touchend", eat, true],
        ["pointerdown", eat, true],
        ["pointerup", eat, true],
        ["scroll", eat, true]
      ];
      overlay._listeners.forEach(([type, handler, opts]) => {
        window.addEventListener(type, handler, opts);
        document.addEventListener(type, handler, opts);
      });

      document.documentElement.style.filter = "blur(1px)";

      if (!window[BEFORE_UNLOAD_FLAG]) {
        window.addEventListener("beforeunload", beforeUnloadHandler);
        window[BEFORE_UNLOAD_FLAG] = true;
      }
    } else {
      overlay.classList.remove("show");
      if (overlay._listeners) {
        overlay._listeners.forEach(([type, handler, opts]) => {
          window.removeEventListener(type, handler, opts);
          document.removeEventListener(type, handler, opts);
        });
        overlay._listeners = null;
      }
      document.documentElement.style.filter = "";
      if (window[BEFORE_UNLOAD_FLAG]) {
        window.removeEventListener("beforeunload", beforeUnloadHandler);
        window[BEFORE_UNLOAD_FLAG] = false;
      }
    }
  }

  // ---------- Media pause/resume + animation freeze ----------
  const pausedState = new WeakMap(); // mediaEl -> { wasPlaying, time, playbackRate, muted }
  let mutationObserver = null;
  let isLocked = false;

  function ensureAnimPauseStyle() {
    if (!document.getElementById(ANIM_PAUSE_STYLE_ID)) {
      const s = document.createElement("style");
      s.id = ANIM_PAUSE_STYLE_ID;
      s.textContent = `
        * { 
          animation-play-state: paused !important;
          transition-property: none !important;
        }
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

  // ---------- Enhanced blocker that also pauses/resumes ----------
  function enhancedBlockAllInputs(enable) {
    if (enable) {
      isLocked = true;
      ensureAnimPauseStyle();
      pauseMediaInDocument(document);
      startObservingNewMedia();
    } else {
      isLocked = false;
      stopObservingNewMedia();
      removeAnimPauseStyle();
      setTimeout(() => { resumeMediaInDocument(document); }, 0);
    }
    baseBlockAllInputs(enable);
  }

  // ---------- Message wiring (defined AFTER functions exist) ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "TAB_LOCKER_TOGGLE" || msg?.type === "TAB_LOCKER_SET") {
      ensureOverlay();
      const overlay = document.getElementById(OVERLAY_ID);
      const currentlyLocked = overlay?.classList.contains("show");
      const target = msg.type === "TAB_LOCKER_TOGGLE" ? !currentlyLocked : Boolean(msg.enabled);
      enhancedBlockAllInputs(target);
      sendResponse?.({ locked: target });
      return true;
    }
  });

  // ======== JOHN CODE STARTS HERE =========

  // --- Auto lock cycle controlled by fofixTime ---
  let lockIntervalId = null;
  let lockDuration = 5000; // always 5s lock
  let cycleTime = 10000;   // default = 10s

  function startAutoLockCycle() {
    if (lockIntervalId) clearInterval(lockIntervalId);

    lockIntervalId = setInterval(() => {
      ensureOverlay();
      enhancedBlockAllInputs(true); // lock
      console.log("[Tab Locker] locked for", lockDuration, "ms");
      setTimeout(() => {
        enhancedBlockAllInputs(false); // unlock
        console.log("[Tab Locker] unlocked");
      }, lockDuration);
    }, cycleTime);
  }

  // Load saved time
  chrome.storage.sync.get(["fofixTime"], (data) => {
    if (data.fofixTime) {
      cycleTime = parseFloat(data.fofixTime, 10) * 60 * 1000; // seconds → ms
    }
    startAutoLockCycle();
  });

  // React to future changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.fofixTime) {
      cycleTime = parseFloat(changes.fofixTime.newValue, 10) * 60 * 1000;
      console.log("[Tab Locker] updated cycleTime to", cycleTime, "ms");
      startAutoLockCycle();
    }
  });


  // Load-time setup
  ensureOverlay();
  console.log("[Tab Locker] content script ready on:", location.href);
})();