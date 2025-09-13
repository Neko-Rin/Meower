// ======== Existing UI elements ========
const toggle = document.getElementById("toggle");
const toggleLabel = document.getElementById("toggle-label");
const timeInput = document.getElementById("timeInput");
const mainView = document.getElementById("main-view");
const fixesView = document.getElementById("fixes-view");
const fixesContainer = document.getElementById("fixes-container");
const showFixesBtn = document.getElementById("show-fixes");
const backBtn = document.getElementById("back-button");

// ======== Load saved settings (basic stuff only) ========
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


(function () {
  const ms = document.querySelector('.ms');
  const nativeSelect = document.getElementById(ms.dataset.for);
  const trigger = ms.querySelector('.ms-trigger');
  const panel = ms.querySelector('.ms-panel');
  const listbox = ms.querySelector('.ms-listbox');
  const tagsWrap = ms.querySelector('.ms-tags');
  const placeholder = ms.querySelector('.ms-placeholder');
  const search = ms.querySelector('.ms-search');
  const btnSelectAll = ms.querySelector('.ms-select-all');
  const btnClear = ms.querySelector('.ms-clear');

  let lastIndex = null; // shift-range support
  let activeIndex = 0;
  let items = [];

  // Build items from native options
  function rebuild() {
    listbox.innerHTML = '';
    items = Array.from(nativeSelect.options).map((opt, i) => {
      const li = document.createElement('li');
      li.className = 'ms-option';
      li.setAttribute('role', 'option');
      li.dataset.index = i;
      li.dataset.label = opt.text.toLowerCase();
      li.setAttribute('aria-selected', opt.selected ? 'true' : 'false');

      const box = document.createElement('span');
      box.className = 'ms-checkbox'; box.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'ms-label';
      label.textContent = opt.text;

      li.append(box, label);
      listbox.appendChild(li);
      return li;
    });
    renderTags();
    filterList(''); // reset filter
  }
  rebuild();

  function open() {
  ms.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  panel.removeAttribute('hidden');          // <— show panel

  search.value = '';
  filterList('');
  search.focus();
  setActiveIndex(visibleIndices()[0] ?? 0);
}

function close() {
  ms.classList.remove('open');
  trigger.setAttribute('aria-expanded', 'false');
  panel.setAttribute('hidden', '');         // <— hide panel
  trigger.focus();
}

  function visibleIndices() {
    return items.reduce((acc, el, i) => {
      if (el.style.display !== 'none') acc.push(i);
      return acc;
    }, []);
  }

  function setActiveIndex(i) {
    i = Math.max(0, Math.min(items.length - 1, i));
    items.forEach(el => el.removeAttribute('data-active'));
    items[i].setAttribute('data-active', 'true');
    items[i].scrollIntoView({ block: 'nearest' });
    activeIndex = i;
  }

  function setSelected(i, value) {
  const opt = nativeSelect.options[i];
  opt.selected = !!value;
  items[i].setAttribute('aria-selected', value ? 'true' : 'false');
  renderTags();

  // ✅ Save selected values
  const selectedValues = Array.from(nativeSelect.selectedOptions).map(o => o.value);
  chrome.storage.sync.set({ fofixDropdown: selectedValues });
}


  function toggleSelected(i) {
    setSelected(i, !nativeSelect.options[i].selected);
  }

  function selectRange(from, to, value) {
    const [start, end] = from < to ? [from, to] : [to, from];
    for (let i = start; i <= end; i++) setSelected(i, value);
  }

  function renderTags() {
    const selected = Array.from(nativeSelect.selectedOptions);
    tagsWrap.innerHTML = '';
    if (!selected.length) {
      placeholder.style.display = '';
      return;
    }
    placeholder.style.display = 'none';

    // Summarize if too many tags
    const MAX_VISIBLE = 3;
    selected.slice(0, MAX_VISIBLE).forEach(o => {
      const tag = document.createElement('span');
      tag.className = 'ms-tag';
      tag.title = o.text; // tooltip shows full label
      tag.textContent = o.text;
      tagsWrap.appendChild(tag);
    });
    if (selected.length > MAX_VISIBLE) {
      const more = document.createElement('span');
      more.className = 'ms-tag';
      more.textContent = `+${selected.length - MAX_VISIBLE} more`;
      tagsWrap.appendChild(more);
    }
  }

  function filterList(q) {
    const needle = q.trim().toLowerCase();
    items.forEach((li) => {
      const match = !needle || li.dataset.label.includes(needle);
      li.style.display = match ? '' : 'none';
    });
  }

  // Events
  trigger.addEventListener('click', () => {
    ms.classList.contains('open') ? close() : open();
  });
  trigger.addEventListener('keydown', (e) => {
    if (['ArrowDown','ArrowUp',' ','Enter'].includes(e.key)) {
      e.preventDefault(); open();
    }
  });

  // Keep focus without flicker
  listbox.addEventListener('mousedown', (e) => e.preventDefault());

  listbox.addEventListener('click', (e) => {
    const li = e.target.closest('.ms-option');
    if (!li) return;
    const idx = +li.dataset.index;

    if (e.shiftKey && lastIndex !== null) {
      const targetWillBe = !(nativeSelect.options[idx].selected);
      selectRange(lastIndex, idx, targetWillBe);
    } else {
      toggleSelected(idx);
    }
    lastIndex = idx;
  });

  listbox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {
      e.preventDefault();
      const vis = visibleIndices();
      const pos = vis.indexOf(activeIndex);
      if (e.key === 'ArrowDown' && pos < vis.length - 1) setActiveIndex(vis[pos + 1]);
      if (e.key === 'ArrowUp'   && pos > 0)             setActiveIndex(vis[pos - 1]);
      if (e.key === 'Home') setActiveIndex(vis[0] ?? 0);
      if (e.key === 'End')  setActiveIndex(vis[vis.length - 1] ?? items.length - 1);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleSelected(activeIndex);
      lastIndex = activeIndex;
    }
  });

  document.addEventListener('click', (e) => { if (!ms.contains(e.target)) close(); });

  // Toolbar actions
  search.addEventListener('input', () => {
    filterList(search.value);
    const vis = visibleIndices();
    setActiveIndex(vis[0] ?? activeIndex);
  });

  btnSelectAll.addEventListener('click', () => {
    items.forEach((_, i) => setSelected(i, true));
  });

  btnClear.addEventListener('click', () => {
    items.forEach((_, i) => setSelected(i, false));
  });

  // Public helper (optional)
  ms.selectValues = (values) => {
    Array.from(nativeSelect.options).forEach((o, i) => setSelected(i, values.includes(o.value)));
  };
})();

// ======== Restore dropdown values after IIFE ========
chrome.storage.sync.get(["fofixDropdown"], (data) => {
  if (data.fofixDropdown !== undefined) {
    const ms = document.querySelector('.ms');
    if (ms && typeof ms.selectValues === "function") {
      ms.selectValues(data.fofixDropdown);
    }
  }
});