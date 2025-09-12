(function () {
  const OVERLAY_ID = "tab-locker-overlay";
  const STYLE_ID = "tab-locker-style";
  const BEFORE_UNLOAD_FLAG = "tab-locker-beforeunload";

  // Inject overlay + styles if not present
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
          cursor: none; /* hide cursor while locked */
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

  function blockAllInputs(enable) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    if (enable) {
      overlay.classList.add("show");

      // Swallow all input at the document level
      const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); return false; };
      // Store listeners on overlay element so we can remove later
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

      // Optional: blur the page behind
      document.documentElement.style.filter = "blur(1px)";

      // Optional: beforeunload confirmation
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

  function beforeUnloadHandler(e) {
    // Native confirmation dialog (cannot customize text)
    e.preventDefault();
    e.returnValue = "";
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "TAB_LOCKER_TOGGLE") {
      ensureOverlay();
      const overlay = document.getElementById(OVERLAY_ID);
      const enable = !(overlay && overlay.classList.contains("show"));
      blockAllInputs(enable);
      sendResponse({ locked: enable });
      return true;
    }
    if (msg?.type === "TAB_LOCKER_SET") {
      ensureOverlay();
      blockAllInputs(Boolean(msg.enabled));
      sendResponse({ locked: Boolean(msg.enabled) });
      return true;
    }
  });

  // Ensure overlay is present (doesn’t show until toggled)
  ensureOverlay();
})();
