(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'eisenhower.v1';
  const LOG_KEY = 'eisenhower.log.v1';         // completion log, kept apart from the boards
  const WEATHER_KEY = 'eisenhower.weather.v1'; // last weather reading
  const THEME_KEY = 'eisenhower.theme';
  const TAB_ID = uid();

  const QUADRANTS = [
    { id: 'do', title: 'Do first', sub: 'Urgent & important', empty: 'Nothing on fire. Enjoy the calm ☕' },
    { id: 'plan', title: 'Plan ahead', sub: 'Important, not urgent', empty: 'Nothing planned yet. What matters next? 🌱' },
    { id: 'offload', title: 'Get off the plate', sub: 'Urgent, not important · handle it quickly, in one go', empty: 'Plate is clear. Nothing to knock out 🧹' },
    { id: 'review', title: 'Review', sub: 'Neither · decide later: keep, move or drop', empty: 'Nothing waiting for a decision ✨' },
  ];
  const Q_IDS = QUADRANTS.map((q) => q.id);
  const Q_TITLE = Object.fromEntries(QUADRANTS.map((q) => [q.id, q.title]));
  /** Quadrant ids used before the rename; mapped on load and on import. */
  const LEGACY_QUADRANTS = { schedule: 'plan', delegate: 'offload', eliminate: 'review' };
  const DATA_VERSION = 3;
  // Tomorrow plus the seven days after it show their weekday ("Thu 19 Nov"); later dates show "26 Nov".
  const SOON_DAYS = 8;
  const REVIEW_STALE_DAYS = 14; // tasks sitting in Review longer than this look faded
  const QUADRANT_NAME_MAX = 28;

  const WS_COLORS = ['#7c5cff', '#2f80ed', '#12a594', '#30a46c', '#e5a000', '#f76b15', '#e93d82', '#687076'];
  const WS_EMOJIS = ['💼', '📚', '🏡', '✨', '🚀', '🎯', '💡', '🧪', '🎨', '🛠️', '💰', '🏃', '🌱', '🎓', '✈️', '❤️', '🧠', '📝', '🎵', '☕'];

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const COLOR_RE = /^#[0-9a-f]{6}$/i;
  const DAY_MS = 86400000;

  const ICONS = {
    check: '<path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    notes: '<path d="M3 4.5h10M3 8h10M3 11.5h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    dots: '<circle cx="3.2" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.8" cy="8" r="1.3" fill="currentColor"/>',
    restore: '<path d="M3 7.5h6.5a3.2 3.2 0 0 1 0 6.4H7M3 7.5l3-3M3 7.5l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  /** Tiny DOM builder. Text always goes through textContent, never innerHTML. */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.flat().filter((kid) => kid != null && kid !== false));
    return el;
  }

  /** Icons are static, trusted strings defined above. */
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name];
    return svg;
  }

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Motion timings come from the CSS tokens so the theme lives in one place. */
  const rootStyle = getComputedStyle(document.documentElement);
  const cssMs = (name, fallback) => parseFloat(rootStyle.getPropertyValue(name)) || fallback;
  const T = { fast: cssMs('--t-fast', 120), move: cssMs('--t-move', 180), slow: cssMs('--t-slow', 240) };
  const EASE = rootStyle.getPropertyValue('--ease').trim() || 'ease-out';

  /** Stable tilt of about ±1° derived from the task id, so it survives re-renders. */
  function tiltFor(id) {
    let hash = 2166136261; // FNV-1a, then a final mix so similar ids still spread out
    for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash ^= hash >>> 13;
    const t = (((hash >>> 0) % 1000) / 1000) * 2 - 1;
    return `${(Math.abs(t) < 0.3 ? (t < 0 ? -0.3 : 0.3) : t).toFixed(2)}deg`;
  }

  /* Dates ------------------------------------------------------------- */
  function dateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const todayStr = () => dateStr(new Date());
  function parseDay(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtDay(date) {
    const opts = { day: 'numeric', month: 'short' };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString('en-GB', opts);
  }
  function dueInfo(due, today) {
    const diff = Math.round((parseDay(due) - parseDay(today)) / DAY_MS);
    if (diff < 0) return { kind: 'overdue', label: `Overdue · ${fmtDay(parseDay(due))}` };
    if (diff === 0) return { kind: 'today', label: 'Today' };
    if (diff === 1) return { kind: 'soon', label: 'Tomorrow' };
    if (diff <= SOON_DAYS) return { kind: 'soon', label: fmtWeekday(parseDay(due)) };
    return { kind: 'later', label: fmtDay(parseDay(due)) };
  }
  /** "Wed 18 Nov" (with the year when it is not the current one). */
  function fmtWeekday(date) {
    const opts = { weekday: 'short', day: 'numeric', month: 'short' };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString('en-GB', opts).replace(',', '');
  }
  /** How a due date reads in the detail view. */
  function fmtDue(due) {
    const diff = Math.round((parseDay(due) - parseDay(todayStr())) / DAY_MS);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return fmtWeekday(parseDay(due));
  }
  const addDays = (n) => { const d = new Date(); return dateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
  function fmtRelative(ts) {
    const diff = Math.round((parseDay(todayStr()) - parseDay(dateStr(new Date(ts)))) / DAY_MS);
    if (diff <= 0) return 'today';
    if (diff === 1) return 'yesterday';
    return fmtDay(new Date(ts));
  }

  /* ------------------------------------------------------------------ *
   * Storage (chrome.storage.local, with a localStorage fallback so the
   * page also works when opened directly as a file during development)
   * ------------------------------------------------------------------ */
  const hasChromeStorage = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);

  const store = {
    /** One read for everything the first paint needs. */
    async load(keys) {
      if (hasChromeStorage) return chrome.storage.local.get(keys);
      const out = {};
      for (const key of keys) {
        try { const v = JSON.parse(localStorage.getItem(key)); if (v != null) out[key] = v; } catch { /* skip */ }
      }
      return out;
    },
    async save(items) {
      if (hasChromeStorage) return chrome.storage.local.set(items);
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
    },
  };

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  let state = null;
  let log = [];          // completion log: one entry per completed task, see logEntry()
  let logDirty = false;
  let undoSnap = null;   // snapshot ({ state, log }) taken before the last undoable action
  let snapFresh = false; // true between snapshot() and the commit() it belongs to
  let saveTimer = null;
  let rendering = false;
  let drag = null;

  const ui = {
    composer: null,   // quadrant id with an open inline composer
    justAdded: null,  // task id that should play the pop-in animation
    detailId: null,
    wsEditId: null,
    day: todayStr(),
  };

  function newWorkspace(name, emoji, color) {
    return { id: uid(), name, emoji, color, quadrantNames: {}, sort: {}, tasks: [], done: [] };
  }

  function defaultState() {
    const workspaces = [
      newWorkspace('Work', '💼', WS_COLORS[0]),
      newWorkspace('Studies', '📚', WS_COLORS[2]),
      newWorkspace('Personal', '🏡', WS_COLORS[5]),
    ];
    return { version: DATA_VERSION, theme: null, activeId: workspaces[0].id, weather: { enabled: false, location: null }, workspaces };
  }

  /** Timestamps may arrive as numbers, ISO strings or plain dates (a date without a time counts as noon). */
  function toTime(v) {
    if (Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      if (DATE_RE.test(v)) { const d = parseDay(v); d.setHours(12); return d.getTime(); }
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
    return Date.now();
  }

  /** Validates anything coming from storage or a backup file. Throws if unusable. */
  function normalize(raw) {
    const src = raw && raw.data && Array.isArray(raw.data.workspaces) ? raw.data : raw;
    if (!src || !Array.isArray(src.workspaces)) throw new Error('No workspaces found in this file.');

    const seen = new Set();
    const freshId = (id) => {
      const v = typeof id === 'string' && id && !seen.has(id) ? id : uid();
      seen.add(v);
      return v;
    };
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    const num = (v) => (Number.isFinite(v) ? v : Date.now());
    const task = (t, done) => {
      if (!t || typeof t !== 'object') return null;
      const title = str(t.title, 300).trim();
      if (!title) return null;
      const quadrant = LEGACY_QUADRANTS[t.quadrant] || t.quadrant;
      const out = {
        id: freshId(t.id),
        title,
        notes: str(t.notes, 20000),
        due: typeof t.due === 'string' && DATE_RE.test(t.due) ? t.due : null,
        quadrant: Q_IDS.includes(quadrant) ? quadrant : 'do',
        createdAt: num(t.createdAt),
        quadrantSince: num(t.quadrantSince), // when it entered its quadrant; "now" for older data
      };
      if (done) {
        out.completedAt = toTime(t.completedAt);
        if (t.dropped === true) out.dropped = true;
      }
      return out;
    };
    const names = (raw) => {
      const out = {};
      if (!raw || typeof raw !== 'object') return out;
      for (const [key, value] of Object.entries(raw)) {
        const id = LEGACY_QUADRANTS[key] || key;
        const name = str(value, QUADRANT_NAME_MAX).trim();
        if (Q_IDS.includes(id) && name && name !== Q_TITLE[id]) out[id] = name;
      }
      return out;
    };
    const sort = (raw) => {
      const out = {};
      if (!raw || typeof raw !== 'object') return out;
      for (const [key, value] of Object.entries(raw)) {
        const id = LEGACY_QUADRANTS[key] || key;
        if (Q_IDS.includes(id) && value === 'manual') out[id] = 'manual'; // "auto" is the default and is not stored
      }
      return out;
    };
    const weather = (raw) => {
      const loc = raw && raw.location;
      const ok = loc && typeof loc === 'object' && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) && str(loc.name, 120).trim();
      return {
        enabled: !!(raw && raw.enabled === true),
        location: ok ? { name: str(loc.name, 120).trim(), latitude: loc.latitude, longitude: loc.longitude, timezone: str(loc.timezone, 60) || 'auto' } : null,
      };
    };
    const list = (arr, done) => (Array.isArray(arr) ? arr : []).map((t) => task(t, done)).filter(Boolean);

    const workspaces = src.workspaces
      .filter((w) => w && typeof w === 'object')
      .map((w, i) => ({
        id: freshId(w.id),
        name: str(w.name, 40).trim() || `Workspace ${i + 1}`,
        emoji: str(w.emoji, 8).trim() || '📋',
        color: typeof w.color === 'string' && COLOR_RE.test(w.color) ? w.color : WS_COLORS[i % WS_COLORS.length],
        quadrantNames: names(w.quadrantNames),
        sort: sort(w.sort),
        tasks: list(w.tasks, false),
        done: list(w.done, true),
      }));
    if (!workspaces.length) throw new Error('No workspaces found in this file.');

    return {
      version: DATA_VERSION,
      theme: src.theme === 'dark' || src.theme === 'light' ? src.theme : null,
      activeId: workspaces.some((w) => w.id === src.activeId) ? src.activeId : workspaces[0].id,
      weather: weather(src.weather),
      workspaces,
    };
  }

  /* Completion log ------------------------------------------------------ *
   * One entry per completed task. It outlives the done pile: clearing or
   * deleting done tasks keeps the entries, restoring a task removes its entry. */
  const logEntry = (task, wsId) => ({
    id: task.id, title: task.title, wsId, quadrant: task.quadrant, createdAt: task.createdAt, completedAt: task.completedAt,
  });
  function normalizeLog(raw) {
    const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.entries) ? raw.entries : [];
    const out = [];
    for (const e of arr) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.title !== 'string') continue;
      const quadrant = LEGACY_QUADRANTS[e.quadrant] || e.quadrant;
      const completedAt = toTime(e.completedAt);
      out.push({
        id: e.id, title: e.title.slice(0, 300), wsId: typeof e.wsId === 'string' ? e.wsId : '',
        quadrant: Q_IDS.includes(quadrant) ? quadrant : 'do',
        createdAt: Number.isFinite(e.createdAt) ? e.createdAt : completedAt, completedAt,
      });
    }
    return out.sort((a, b) => a.completedAt - b.completedAt);
  }
  /** First run, or a backup from before the log existed: build it from the done piles. */
  function backfillLog(data) {
    const out = [];
    for (const ws of data.workspaces) {
      for (const t of ws.done) {
        if (t.dropped) continue;
        const at = new Date(t.completedAt);
        const noTime = at.getHours() + at.getMinutes() + at.getSeconds() + at.getMilliseconds() === 0;
        out.push({ ...logEntry(t, ws.id), completedAt: noTime ? at.setHours(12) : t.completedAt });
      }
    }
    return out.sort((a, b) => a.completedAt - b.completedAt);
  }
  function logAdd(task, wsId) { log.push(logEntry(task, wsId)); logDirty = true; }
  function logRemove(id) {
    const i = log.findLastIndex((e) => e.id === id);
    if (i >= 0) { log.splice(i, 1); logDirty = true; }
  }

  /* Order inside a quadrant --------------------------------------------- *
   * "auto" (the default) sorts by date; "manual" keeps the dragged order.   */
  const sortMode = (ws, q) => (ws.sort && ws.sort[q] === 'manual' ? 'manual' : 'auto');
  /** Overdue and dated tasks by due date (oldest first), then undated ones by creation time. */
  function byDate(a, b) {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : a.createdAt - b.createdAt;
    if (a.due) return -1;
    if (b.due) return 1;
    return a.createdAt - b.createdAt;
  }
  /** A quadrant's tasks in the order they are shown. */
  function quadTasks(ws, q) {
    const list = ws.tasks.filter((t) => t.quadrant === q);
    return sortMode(ws, q) === 'manual' ? list : list.sort(byDate);
  }

  const activeWs = () => state.workspaces.find((w) => w.id === state.activeId) || state.workspaces[0];

  /** A quadrant's name in a workspace: its own override, or the default. */
  const qName = (ws, id) => (ws.quadrantNames && ws.quadrantNames[id]) || Q_TITLE[id];

  /** Move a task to a quadrant and restart its age there. */
  function setQuadrant(task, quadrant) {
    if (task.quadrant === quadrant) return;
    task.quadrant = quadrant;
    task.quadrantSince = Date.now();
  }
  const daysIn = (task) => Math.floor((Date.now() - task.quadrantSince) / DAY_MS);
  const isStale = (task) => task.quadrant === 'review' && Date.now() - task.quadrantSince > REVIEW_STALE_DAYS * DAY_MS;

  function findTask(id) {
    for (const ws of state.workspaces) {
      let task = ws.tasks.find((t) => t.id === id);
      if (task) return { ws, task, done: false };
      task = ws.done.find((t) => t.id === id);
      if (task) return { ws, task, done: true };
    }
    return null;
  }

  /* Persistence -------------------------------------------------------- */
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 60);
  }
  function flush() {
    if (saveTimer == null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const items = { [STORAGE_KEY]: { ...state, writer: TAB_ID, savedAt: Date.now() } };
    if (logDirty) { items[LOG_KEY] = { version: 1, writer: TAB_ID, entries: log }; logDirty = false; }
    store.save(items)
      .catch(() => toast('Could not save your changes. Storage may be full.'));
  }

  /** Call before mutating state for an action that should offer "Undo". */
  function snapshot() {
    undoSnap = { state: JSON.stringify(state), log: log.slice() };
    snapFresh = true;
  }

  /** Persist + re-render after any state change. */
  function commit() {
    if (!snapFresh && toastHasUndo) hideToast(); // a newer edit makes the old undo unsafe
    snapFresh = false;
    save();
    render();
  }

  function undo() {
    if (!undoSnap) return;
    state = JSON.parse(undoSnap.state);
    log = undoSnap.log;
    logDirty = true;
    undoSnap = null;
    closeDialogs();
    hideToast();
    save();
    render();
    toast('Undone');
  }

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */
  const toastEl = $('#toast');
  let toastTimer = null;
  let toastHasUndo = false;

  function toast(msg, { undoable = false } = {}) {
    clearTimeout(toastTimer);
    if (!undoable) undoSnap = null;
    toastHasUndo = undoable;
    $('#toast-msg').textContent = msg;
    $('#toast-undo').hidden = !undoable;
    toastEl.hidden = true; // restart the entrance animation
    void toastEl.offsetWidth;
    toastEl.hidden = false;
    toastTimer = setTimeout(hideToast, undoable ? 8000 : 2600);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
    toastHasUndo = false;
    undoSnap = null;
  }
  $('#toast-undo').addEventListener('click', undo);

  /* ------------------------------------------------------------------ *
   * Confirm dialog
   * ------------------------------------------------------------------ */
  const confirmEl = $('#confirm');
  function confirmDialog({ title, body, ok = 'OK', danger = false }) {
    return new Promise((resolve) => {
      $('#c-title').textContent = title;
      $('#c-body').textContent = body;
      const okBtn = $('#c-ok');
      okBtn.textContent = ok;
      okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
      confirmEl.returnValue = '';
      confirmEl.addEventListener('close', () => resolve(confirmEl.returnValue === 'ok'), { once: true });
      confirmEl.showModal();
      $('#c-cancel').focus();
    });
  }

  function closeDialogs() {
    for (const d of $$('dialog[open]')) d.close();
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  const board = $('#board');
  const quadEls = Object.fromEntries(QUADRANTS.map((q) => {
    const el = $(`.quadrant[data-q="${q.id}"]`);
    return [q.id, { el, list: $('.note-list', el), count: $('.q-count', el), title: $('.q-title', el), add: $('.q-add', el), sort: $('.q-sort', el) }];
  }));

  function render() {
    const ws = activeWs();
    state.activeId = ws.id;
    document.documentElement.style.setProperty('--accent', ws.color);
    renderHeader();
    renderTabs();
    renderNames();
    renderBoard();
    renderDone();
    ui.day = todayStr();
  }

  function renderHeader() {
    const now = new Date();
    const hr = now.getHours();
    const [hello, emoji] = hr >= 5 && hr < 12 ? ['Good morning', '☀️'] : hr >= 12 && hr < 18 ? ['Good afternoon', '🌤️'] : ['Good evening', '🌙'];
    const wx = weatherNow(); // null unless weather is on, allowed and a reading for the chosen place is cached
    $('#greet-text').textContent = hello;
    $('#wx-emoji').textContent = wx ? wx.emoji : emoji;
    $('#wx-temp').textContent = wx ? `${Math.round(wx.temp) || 0}°` : '';
    const wxEl = $('#wx');
    wxEl.classList.toggle('live', !!wx);
    if (wx) {
      wxEl.tabIndex = 0;
      wxEl.setAttribute('aria-label', `${wx.text}, ${Math.round(wx.temp) || 0} degrees in ${wx.place}`);
      $('#wx-tip-place').textContent = wx.place;
      $('#wx-tip-cond').textContent = `${wx.text}, ${Math.round(wx.temp) || 0} °C`;
      $('#wx-tip-time').textContent = `Updated ${new Date(wx.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      wxEl.removeAttribute('tabindex');
      wxEl.removeAttribute('aria-label');
    }
    $('#today').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    const ws = activeWs();
    const today = todayStr();
    const first = ws.tasks.filter((t) => t.quadrant === 'do').length;
    const overdue = ws.tasks.filter((t) => t.due && t.due < today).length;
    const summary = $('#summary');
    summary.textContent = first === 0
      ? (ws.tasks.length ? `Nothing ${ws.quadrantNames.do ? `in “${ws.quadrantNames.do}”` : 'to do first'}. Nice ✨` : 'A clean board. What matters today?')
      : `${first} ${first === 1 ? 'task' : 'tasks'} ${ws.quadrantNames.do ? `in “${ws.quadrantNames.do}”` : 'to do first'} today`;
    if (overdue) summary.append(' · ', h('span', { class: 'overdue', text: `${overdue} overdue` }));
  }

  /** Quadrant names are per workspace: refresh every place that shows them. */
  function renderNames() {
    const ws = activeWs();
    for (const q of QUADRANTS) {
      const name = qName(ws, q.id);
      const { title, add } = quadEls[q.id];
      title.textContent = name;
      add.setAttribute('aria-label', `Add task to ${name}`);
      const pick = $(`.q-pick label[data-q="${q.id}"]`);
      $('.q-name', pick).textContent = name;
      pick.title = `${name} (Alt+${Q_IDS.indexOf(q.id) + 1})`;
    }
    $('#batch-open').title = `Clear ${qName(ws, 'offload')} tasks one after another`;
    $('#review-open').title = `Go through ${qName(ws, 'review')} one task at a time`;
  }

  function renderTabs() {
    const tabs = state.workspaces.map((ws) => {
      const active = ws.id === state.activeId;
      const el = h('div', { class: `ws-tab${active ? ' active' : ''}`, dataset: { id: ws.id } },
        h('button', {
          class: 'ws-tab-btn', type: 'button', role: 'tab', 'aria-selected': String(active),
          title: active ? 'Double-click to edit' : `Switch to ${ws.name}`,
        },
          h('span', { class: 'ws-emoji', text: ws.emoji }),
          h('span', { class: 'ws-name', text: ws.name }),
          ws.tasks.length > 0 && h('span', { class: 'ws-count', text: String(ws.tasks.length), title: 'Open tasks' })),
        active && h('button', {
          class: 'ws-tab-edit', type: 'button', title: 'Edit workspace', 'aria-label': `Edit workspace ${ws.name}`,
        }, icon('dots')));
      el.style.setProperty('--tab', ws.color);
      return el;
    });
    $('#ws-tabs').replaceChildren(...tabs);
  }

  function noteEl(t, today) {
    const info = t.due ? dueInfo(t.due, today) : null;
    const hasNotes = !!t.notes.trim();
    const askWhen = t.quadrant === 'plan' && !t.due; // planning needs a date
    const stale = isStale(t);
    const cls = ['note'];
    if (info || hasNotes || askWhen) cls.push('has-meta');
    if (stale) cls.push('is-stale');
    if (info && info.kind === 'overdue') cls.push('is-overdue');
    if (t.id === ui.justAdded) cls.push('pop');
    const el = h('article', {
      class: cls.join(' '), tabIndex: 0, dataset: { id: t.id },
      'aria-label': `${t.title}${info ? `, ${info.label}` : ''}${stale ? `, waiting for ${daysIn(t)} days` : ''}. Press Enter for details.`,
      title: stale ? `Here for ${daysIn(t)} days. Time to decide?` : null,
    },
      h('div', { class: 'note-title', text: t.title }),
      (info || hasNotes || askWhen) && h('div', { class: 'note-meta' },
        info && h('span', { class: `due due-${info.kind}`, text: info.label }),
        askWhen && h('button', { class: 'when-hint', type: 'button', text: 'When?', title: 'Set a date', 'aria-label': `Set a date for “${t.title}”` }),
        hasNotes && h('span', { class: 'has-notes', title: 'Has notes' }, icon('notes'))),
      h('button', { class: 'note-check', type: 'button', title: 'Mark as done', 'aria-label': `Mark “${t.title}” as done` }, icon('check')));
    el.style.setProperty('--tilt', tiltFor(t.id));
    return el;
  }

  /* Overflow: a quadrant with more notes than fit scrolls. A fade and a
     "+N more" chip show that there is more below. */
  for (const q of QUADRANTS) {
    const { el, list } = quadEls[q.id];
    const more = h('button', { class: 'q-more', type: 'button', hidden: true, title: 'Scroll down' });
    more.addEventListener('click', () => list.scrollBy({ top: list.clientHeight * 0.8, behavior: reducedMotion() ? 'auto' : 'smooth' }));
    el.append(more);
    quadEls[q.id].more = more;
    list.addEventListener('scroll', () => updateFade(list), { passive: true });
  }
  function updateFade(list) {
    const quad = list.parentElement;
    const bottom = list.scrollTop + list.clientHeight;
    const hidden = list.scrollHeight - bottom > 1
      ? $$('.note', list).filter((n) => n.offsetTop + n.offsetHeight / 2 > bottom).length : 0;
    quad.classList.toggle('more', list.scrollHeight - bottom > 1);
    const more = quadEls[quad.dataset.q].more;
    more.hidden = !hidden;
    more.textContent = `+${hidden} more`;
  }
  const sizeLists = () => { for (const q of QUADRANTS) updateFade(quadEls[q.id].list); };

  /* FLIP: remember where notes are, change the DOM, then glide them into place. */
  function noteCenters() {
    const map = new Map();
    for (const n of $$('.note', board)) {
      const r = n.getBoundingClientRect();
      map.set(n.dataset.id, [r.left + r.width / 2, r.top + r.height / 2]);
    }
    return map;
  }
  function glideFrom(before) {
    if (reducedMotion()) return;
    const notes = $$('.note', board);
    for (const n of notes) for (const a of n.getAnimations()) if (a.constructor === Animation) a.cancel(); // script-driven glides only
    for (const n of notes) {
      const was = before.get(n.dataset.id);
      if (!was || n.classList.contains('pop')) continue;
      const r = n.getBoundingClientRect();
      const dx = was[0] - (r.left + r.width / 2);
      const dy = was[1] - (r.top + r.height / 2);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: T.move, easing: EASE });
    }
  }

  /** A fixed-position copy of a note, used for exit animations after the real one is gone. */
  function ghostOf(note) {
    const r = note.getBoundingClientRect();
    const ghost = note.cloneNode(true);
    ghost.className = 'note ghost';
    ghost.removeAttribute('tabindex');
    ghost.dataset.q = note.closest('[data-q]').dataset.q;
    Object.assign(ghost.style, {
      left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    });
    document.body.append(ghost);
    return { ghost, rect: r };
  }

  function composerEl(q) {
    const input = h('textarea', {
      class: 'composer-input', rows: 2, maxLength: 300,
      placeholder: 'Type a task, press Enter', 'aria-label': `New task in ${qName(activeWs(), q)}`,
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim()) addTask(q, input.value); // composer stays open for the next one
      } else if (e.key === 'Escape') {
        e.preventDefault();
        ui.composer = null;
        renderBoard();
        $('.q-add', quadEls[q].el).focus();
      }
    });
    input.addEventListener('blur', () => {
      if (rendering || ui.composer !== q) return;
      ui.composer = null;
      if (input.value.trim()) addTask(q, input.value); else renderBoard();
    });
    return h('div', { class: 'composer' }, input);
  }

  function renderBoard() {
    const ws = activeWs();
    const today = todayStr();
    const focused = document.activeElement && document.activeElement.closest('.note');
    const focusId = focused && !focused.classList.contains('dragging') ? focused.dataset.id : null;

    const before = noteCenters();
    rendering = true;
    for (const q of QUADRANTS) {
      const { list, count } = quadEls[q.id];
      const tasks = quadTasks(ws, q.id);
      count.textContent = String(tasks.length);
      quadEls[q.id].sort.hidden = sortMode(ws, q.id) !== 'manual';
      if (q.id === 'offload') $('#batch-open').hidden = !tasks.length;
      if (q.id === 'review') {
        const staleCount = tasks.filter(isStale).length;
        $('#review-open').hidden = !tasks.length;
        $('#review-stale').hidden = !staleCount;
        $('#review-stale').textContent = String(staleCount);
        $('#review-stale').title = `${staleCount} waiting more than ${REVIEW_STALE_DAYS} days`;
      }
      const nodes = tasks.map((t) => noteEl(t, today));
      nodes.push(h('p', { class: 'empty', text: q.empty }));
      if (ui.composer === q.id) nodes.push(composerEl(q.id));
      list.replaceChildren(...nodes);
    }
    rendering = false;
    sizeLists();
    glideFrom(before);

    if (ui.composer) {
      const input = $('.composer-input', quadEls[ui.composer].el);
      input.focus();
      input.scrollIntoView({ block: 'nearest' });
    } else if (ui.justAdded) {
      const el = noteById(ui.justAdded);
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (focusId) {
      const el = noteById(focusId);
      if (el) el.focus({ preventScroll: true });
    }
    ui.justAdded = null;
  }

  const noteById = (id) => $(`.note[data-id="${CSS.escape(id)}"]`, board);

  function renderDone() {
    const ws = activeWs();
    const items = [...ws.done].sort((a, b) => b.completedAt - a.completedAt);
    $('#done-count').textContent = String(items.length);
    $('#drawer-sub').textContent = `${ws.emoji} ${ws.name} · ${items.length} completed`;
    $('#done-clear').disabled = !items.length;
    const list = $('#done-list');
    if (!items.length) {
      list.replaceChildren(h('li', { class: 'done-empty', text: 'Nothing here yet. Finished and dropped tasks land in this pile 🎉' }));
      return;
    }
    list.replaceChildren(...items.map((t) =>
      h('li', { class: `done-item${t.dropped ? ' dropped' : ''}`, dataset: { id: t.id, q: t.quadrant } },
        h('button', { class: 'done-main', type: 'button', title: 'Open details' },
          h('span', { class: 'done-title', text: t.title }),
          h('span', { class: 'done-date', text: `${t.dropped ? 'Dropped' : 'Done'} ${fmtRelative(t.completedAt)} · ${qName(ws, t.quadrant)}` })),
        h('button', { class: 'done-act restore', type: 'button', title: 'Restore to board', 'aria-label': `Restore “${t.title}”` }, icon('restore')),
        h('button', { class: 'done-act del', type: 'button', title: 'Delete permanently', 'aria-label': `Delete “${t.title}” permanently` }, icon('trash')))));
  }

  /* ------------------------------------------------------------------ *
   * Task actions
   * ------------------------------------------------------------------ */
  function addTask(quadrant, title) {
    title = title.trim().slice(0, 300);
    if (!title) return;
    const now = Date.now();
    const task = { id: uid(), title, notes: '', due: null, quadrant, createdAt: now, quadrantSince: now };
    activeWs().tasks.push(task);
    ui.justAdded = task.id;
    commit();
  }

  /** quiet: no fly animation, toast or undo snapshot (used inside the Batch and Review modes). */
  function completeTask(id, { quiet = false, dropped = false } = {}) {
    const found = findTask(id);
    if (!found || found.done) return;
    if (!quiet) {
      flyToDone(found.ws.id === state.activeId ? noteById(id) : null);
      snapshot();
    }
    const { ws, task } = found;
    ws.tasks.splice(ws.tasks.indexOf(task), 1);
    task.completedAt = Date.now();
    if (dropped) task.dropped = true; else logAdd(task, ws.id); // dropping is a decision, not a completion
    ws.done.push(task);
    commit();
    if (quiet) bumpDone(); else toast('Nice one! Task done 🎉', { undoable: true });
  }

  function restoreTask(id, { quiet = false } = {}) {
    const found = findTask(id);
    if (!found || !found.done) return;
    if (!quiet) snapshot();
    const { ws, task } = found;
    ws.done.splice(ws.done.indexOf(task), 1);
    delete task.completedAt;
    delete task.dropped;
    logRemove(task.id);
    task.quadrantSince = Date.now(); // it re-enters its quadrant
    ws.tasks.push(task);
    ui.justAdded = task.id;
    commit();
    if (!quiet) toast(`Restored to ${qName(ws, task.quadrant)}`, { undoable: true });
  }

  function deleteTask(id) {
    const found = findTask(id);
    if (!found) return;
    if (!found.done && found.ws.id === state.activeId) fadeOut(noteById(id));
    snapshot();
    const arr = found.done ? found.ws.done : found.ws.tasks;
    arr.splice(arr.indexOf(found.task), 1);
    commit();
    toast('Task deleted', { undoable: true });
  }

  function moveTaskToWorkspace(id, wsId) {
    const found = findTask(id);
    const target = state.workspaces.find((w) => w.id === wsId);
    if (!found || !target || target === found.ws) return;
    snapshot();
    const key = found.done ? 'done' : 'tasks';
    found.ws[key].splice(found.ws[key].indexOf(found.task), 1);
    target[key].push(found.task);
    commit();
    toast(`Moved to ${target.emoji} ${target.name}`, { undoable: true });
  }

  async function clearDone() {
    const ws = activeWs();
    if (!ws.done.length) return;
    const n = ws.done.length;
    const ok = await confirmDialog({
      title: 'Clear the done pile?',
      body: `This permanently removes ${n} completed ${n === 1 ? 'task' : 'tasks'} from ${ws.name}.`,
      ok: 'Clear pile', danger: true,
    });
    if (!ok) return;
    snapshot();
    ws.done = [];
    commit();
    toast('Done pile cleared', { undoable: true });
  }

  /* Completion: the note flies into the Done button and the counter bumps. */
  const doneToggle = $('#done-toggle');
  const doneCount = $('#done-count');
  function bumpDone() {
    doneCount.classList.remove('bump');
    void doneCount.offsetWidth;
    doneCount.classList.add('bump');
  }
  function flyToDone(note) {
    if (!note || reducedMotion()) { bumpDone(); return; }
    const { ghost, rect: from } = ghostOf(note);
    ghost.classList.add('checked');
    const to = doneCount.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const anim = ghost.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.08}px, ${dy * 0.08 - 6}px) scale(1.08)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0.3 },
    ], { duration: T.slow, easing: 'cubic-bezier(0.5, 0, 0.6, 1)' });
    const finish = () => { ghost.remove(); bumpDone(); };
    anim.onfinish = finish;
    anim.oncancel = finish;
  }
  /* Delete: quick fade and shrink. */
  function fadeOut(note) {
    if (!note || reducedMotion()) return;
    const { ghost } = ghostOf(note);
    const anim = ghost.animate([
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(0.82)', opacity: 0 },
    ], { duration: T.move, easing: EASE });
    anim.onfinish = anim.oncancel = () => ghost.remove();
  }

  /* ------------------------------------------------------------------ *
   * Board interactions: click, keyboard, drag & drop
   * ------------------------------------------------------------------ */
  board.addEventListener('click', (e) => {
    const check = e.target.closest('.note-check');
    if (check) { completeTask(check.closest('.note').dataset.id); return; }
    const when = e.target.closest('.when-hint');
    if (when) { openDetail(when.closest('.note').dataset.id, { focusDue: true }); return; }
    const chip = e.target.closest('.q-sort');
    if (chip) { // back to date order; renderBoard glides the notes into place
      delete activeWs().sort[chip.closest('.quadrant').dataset.q];
      commit();
      return;
    }
    const add = e.target.closest('.q-add');
    if (add) {
      ui.composer = add.closest('.quadrant').dataset.q;
      renderBoard();
    }
  });

  board.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('note')) return;
    const id = e.target.dataset.id;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(id); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteTask(id); }
  });

  board.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const note = e.target.closest('.note');
    if (!note || e.target.closest('.note-check, .when-hint')) return;
    drag = { id: note.dataset.id, note, x0: e.clientX, y0: e.clientY, active: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', cancelDrag);
  });

  function startDrag() {
    let { note } = drag;
    if (!note.isConnected) note = drag.note = noteById(drag.id); // board re-rendered since pointerdown
    if (!note) { cancelDrag(); return false; }
    for (const a of note.getAnimations()) a.cancel();
    const list = note.parentElement;
    const left = list.getBoundingClientRect().left + note.offsetLeft - list.scrollLeft;
    const top = list.getBoundingClientRect().top + note.offsetTop - list.scrollTop;
    const ws = activeWs();
    drag.tasks = new Map(ws.tasks.map((t) => [t.id, t]));
    drag.task = drag.tasks.get(drag.id);
    if (!drag.task) { cancelDrag(); return false; }
    drag.placeholder = h('div', { class: 'note-placeholder' });
    drag.placeholder.style.height = `${note.offsetHeight}px`;
    note.before(drag.placeholder);
    note.dataset.q = note.closest('.quadrant').dataset.q; // keep its colour once it leaves the quadrant
    Object.assign(note.style, { left: `${left}px`, top: `${top}px`, width: `${note.offsetWidth}px`, height: `${note.offsetHeight}px` });
    note.classList.add('dragging');
    document.body.append(note);
    document.body.classList.add('is-dragging');
    drag.active = true;
    drag.raf = requestAnimationFrame(autoScrollTick);
    return true;
  }

  /** Which note should the placeholder be inserted before? (null = end) */
  function insertionPoint(list, x, y) {
    const lr = list.getBoundingClientRect();
    for (const n of $$('.note', list)) {
      const left = lr.left + n.offsetLeft - list.scrollLeft;
      const top = lr.top + n.offsetTop - list.scrollTop;
      if (y < top - 7) return n;
      if (y <= top + n.offsetHeight + 7 && x < left + n.offsetWidth / 2) return n;
    }
    return null;
  }

  function onDragMove(e) {
    if (!drag) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 6 || !startDrag()) return;
    }
    drag.note.style.transform = `translate(${drag.x - drag.x0}px, ${drag.y - drag.y0}px)`;
    updateDropTarget();
  }

  /** Work out what is under the pointer and move the placeholder there. */
  function updateDropTarget() {
    const { x, y } = drag;
    const under = document.elementFromPoint(x, y);
    const tab = under && under.closest('.ws-tab');
    const quad = under && under.closest('.quadrant');

    for (const el of $$('.ws-tab.drop')) el.classList.remove('drop');
    for (const el of $$('.quadrant.drop-target')) el.classList.remove('drop-target');
    drag.tabId = null;
    drag.overList = null;

    if (tab && tab.dataset.id !== state.activeId) {
      tab.classList.add('drop');
      drag.tabId = tab.dataset.id;
      drag.placeholder.classList.add('off');
      return;
    }
    drag.placeholder.classList.remove('off');
    if (!quad) return;

    quad.classList.add('drop-target');
    const list = drag.overList = $('.note-list', quad);
    const q = quad.dataset.q;
    // Another quadrant that sorts by date: show where the note will land, not where the pointer is.
    const byItsDate = q !== drag.task.quadrant && sortMode(activeWs(), q) === 'auto';
    const before = (byItsDate
      ? $$('.note', list).find((n) => drag.tasks.has(n.dataset.id) && byDate(drag.task, drag.tasks.get(n.dataset.id)) < 0)
      : insertionPoint(list, x, y)) || $('.empty', list);
    if (drag.placeholder.parentNode !== list || drag.placeholder.nextElementSibling !== before) {
      const was = noteCenters();
      const from = drag.placeholder.parentNode;
      list.insertBefore(drag.placeholder, before);
      if (byItsDate) drag.placeholder.scrollIntoView({ block: 'nearest' });
      glideFrom(was); // neighbours move aside smoothly
      updateFade(list);
      if (from !== list) updateFade(from);
    }
  }

  /** While dragging, keep scrolling a quadrant when the pointer rests near its top or bottom edge. */
  const EDGE = 48;
  function autoScrollTick() {
    if (!drag || !drag.active) return;
    const list = drag.overList;
    if (list) {
      const r = list.getBoundingClientRect();
      let speed = 0;
      if (drag.y < r.top + EDGE) speed = -Math.min(1, (r.top + EDGE - drag.y) / EDGE);
      else if (drag.y > r.bottom - EDGE) speed = Math.min(1, (drag.y - (r.bottom - EDGE)) / EDGE);
      if (speed) {
        const was = list.scrollTop;
        list.scrollTop += speed * 16;
        if (list.scrollTop !== was) updateDropTarget();
      }
    }
    drag.raf = requestAnimationFrame(autoScrollTick);
  }

  function endDragListeners() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', cancelDrag);
    document.body.classList.remove('is-dragging');
    for (const el of $$('.ws-tab.drop')) el.classList.remove('drop');
    for (const el of $$('.quadrant.drop-target')) el.classList.remove('drop-target');
  }

  function cancelDrag() {
    if (!drag) return;
    const wasActive = drag.active;
    if (wasActive) drag.note.remove();
    drag = null;
    endDragListeners();
    if (wasActive) renderBoard();
  }

  function onDragEnd() {
    if (!drag) return;
    const d = drag;
    drag = null;
    endDragListeners();

    if (!d.active) { openDetail(d.id); return; } // it was a click

    const from = d.note.getBoundingClientRect();
    d.note.remove();

    if (d.tabId) { moveTaskToWorkspace(d.id, d.tabId); return; }

    const ws = activeWs();
    const task = ws.tasks.find((t) => t.id === d.id);
    const quad = d.placeholder.closest('.quadrant');
    if (!task || !quad) { renderBoard(); return; }

    let next = d.placeholder.nextElementSibling;
    while (next && !next.classList.contains('note')) next = next.nextElementSibling;

    const q = quad.dataset.q;
    const shown = quadTasks(ws, q);
    const order = shown.filter((t) => t !== task);
    const idx = next ? order.findIndex((t) => t.id === next.dataset.id) : -1;
    order.splice(idx >= 0 ? idx : order.length, 0, task);
    // A new position inside its own quadrant means "keep my order" from now on.
    if (q === task.quadrant && order.some((t, i) => t !== shown[i])) ws.sort[q] = 'manual';
    setQuadrant(task, q);
    ws.tasks = ws.tasks.filter((t) => t !== task && t.quadrant !== q).concat(order);
    commit();

    // Settle the note into its new slot.
    const el = noteById(d.id);
    if (el && !reducedMotion()) {
      for (const a of el.getAnimations()) a.cancel();
      const to = el.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      el.animate([
        { transform: `translate(${dx}px, ${dy}px)`, rotate: '2.5deg', scale: '1.03' },
        { transform: 'none', rotate: el.style.getPropertyValue('--tilt'), scale: '1' },
      ], { duration: T.move, easing: EASE });
    }
  }

  /* ------------------------------------------------------------------ *
   * Quick add
   * ------------------------------------------------------------------ */
  const quickInput = $('#quick-input');
  $('#quick-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('input[name="quick-q"]:checked').value;
    if (!quickInput.value.trim()) return;
    addTask(q, quickInput.value);
    quickInput.value = '';
  });
  $('#quick-add').addEventListener('change', (e) => {
    if (e.target.name === 'quick-q') quickInput.focus();
  });
  function setQuickQuadrant(id) {
    $(`input[name="quick-q"][value="${id}"]`).checked = true;
  }
  // While typing: Tab / Shift+Tab cycles the target quadrant, Alt+1–4 picks one directly.
  quickInput.addEventListener('keydown', (e) => {
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (e.altKey && !e.ctrlKey && !e.metaKey && digit) {
      e.preventDefault();
      setQuickQuadrant(Q_IDS[Number(digit[1]) - 1]);
    } else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && quickInput.value.trim()) {
      e.preventDefault();
      const i = Q_IDS.indexOf($('input[name="quick-q"]:checked').value);
      setQuickQuadrant(Q_IDS[(i + (e.shiftKey ? -1 : 1) + Q_IDS.length) % Q_IDS.length]);
    }
  });

  /* ------------------------------------------------------------------ *
   * Task detail dialog
   * ------------------------------------------------------------------ */
  const detail = $('#detail');
  const dTitle = $('#d-title');
  const dNotes = $('#d-notes');
  const dDone = $('#d-done');
  const dueBtn = $('#d-due-btn');
  const wsBtn = $('#d-ws-btn');
  const dp = $('#dp');
  const wsMenu = $('#ws-menu');

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`; // CSS max-height caps the notes field, then it scrolls
  }

  function syncDueField() {
    const found = ui.detailId && findTask(ui.detailId);
    const due = found && found.task.due;
    $('#d-due-text').textContent = due ? fmtDue(due) : 'No date';
    dueBtn.classList.toggle('empty', !due);
    dueBtn.classList.toggle('overdue', !!due && !found.done && due < todayStr());
  }

  function openDetail(id, { focusDue = false } = {}) {
    const found = findTask(id);
    if (!found) return;
    const { ws, task, done } = found;
    ui.detailId = id;
    detail.dataset.q = task.quadrant;
    dTitle.value = task.title;
    dNotes.value = task.notes;
    dDone.checked = done;
    syncDueField();
    for (const r of $$('input[name="d-q"]', detail)) {
      r.checked = r.value === task.quadrant;
      $('.q-opt-name', r.nextElementSibling).textContent = qName(ws, r.value);
    }
    $('#d-ws-text').textContent = `${ws.emoji} ${ws.name}`;
    $('#d-ws-field').hidden = state.workspaces.length < 2;
    $('#d-meta').textContent = done
      ? `${task.dropped ? 'Dropped' : 'Completed'} ${fmtRelative(task.completedAt)}`
      : `Added ${fmtRelative(task.createdAt)}`;
    if (!detail.open) detail.showModal();
    autoGrow(dTitle);
    autoGrow(dNotes);
    if (focusDue) openDatePicker(); else $('#d-close').focus();
  }

  /** Apply an edit to the task currently open in the detail dialog. */
  function editDetail(fn) {
    const found = ui.detailId && findTask(ui.detailId);
    if (!found) return;
    fn(found.task);
    commit();
  }

  dTitle.addEventListener('input', () => {
    autoGrow(dTitle);
    const title = dTitle.value.replace(/\s+/g, ' ').trim();
    if (title) editDetail((t) => { t.title = title; }); // never store an empty title
  });
  dTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); detail.close(); }
  });
  dNotes.addEventListener('input', () => { autoGrow(dNotes); editDetail((t) => { t.notes = dNotes.value; }); });
  /* Popovers ---------------------------------------------------------- *
   * The date picker and workspace menu are [popover] elements: the browser
   * closes them on Esc and on an outside click. They are placed beside the
   * dialog when there is room, so they never sit on top of its controls.   */
  let popClosedAt = 0;
  function placePopover(pop, anchor) {
    const a = anchor.getBoundingClientRect();
    const d = detail.getBoundingClientRect();
    pop.style.maxHeight = '';
    const w = pop.offsetWidth;
    const gap = 10;
    const edge = 8;
    let left;
    let top;
    if (d.right + gap + w <= window.innerWidth - edge) { left = d.right + gap; top = a.top - 8; }        // right of the dialog
    else if (d.left - gap - w >= edge) { left = d.left - gap - w; top = a.top - 8; }                     // left of it
    else if (a.top - gap - edge >= 240) {                                                                // above the field,
      pop.style.maxHeight = `${a.top - gap - edge}px`;                                                   // scrolling inside if it is tall
      left = a.left; top = a.top - gap - pop.offsetHeight;
    } else { left = a.left; top = a.bottom + gap; }                                                      // last resort: below
    pop.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - w - edge))}px`;
    pop.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - pop.offsetHeight - edge))}px`;
  }
  function watchPopover(pop, button) {
    pop.addEventListener('toggle', (e) => {
      const open = e.newState === 'open';
      button.setAttribute('aria-expanded', String(open));
      if (!open) popClosedAt = performance.now();
    });
  }
  watchPopover(dp, dueBtn);
  watchPopover(wsMenu, wsBtn);
  const closePopovers = () => { for (const pop of [dp, wsMenu]) if (pop.matches(':popover-open')) pop.hidePopover(); };
  window.addEventListener('resize', closePopovers);

  /* Date picker --------------------------------------------------------- */
  let dpMonth = null; // first day of the month on show

  function currentDue() {
    const found = ui.detailId && findTask(ui.detailId);
    return found ? found.task.due : null;
  }
  function pickDue(value) {
    editDetail((t) => { t.due = value; });
    syncDueField();
    dp.hidePopover();
    dueBtn.focus();
  }
  function renderDatePicker(focusDate) {
    const today = todayStr();
    const due = currentDue();
    const weekday = new Date().getDay(); // 0 = Sunday
    const quick = [
      ['Today', today], ['Tomorrow', addDays(1)],
      ['Next Monday', addDays(((8 - weekday) % 7) || 7)], ['In a week', addDays(7)], ['No date', null],
    ];
    $('#dp-quick').replaceChildren(...quick.map(([label, value]) =>
      h('button', { type: 'button', class: 'dp-opt', dataset: { value: value || '' }, 'aria-pressed': String(value === due || (!value && !due)) },
        h('span', { text: label }),
        value && h('span', { class: 'hint', text: fmtWeekday(parseDay(value)) }))));

    const y = dpMonth.getFullYear();
    const m = dpMonth.getMonth();
    $('#dp-month').textContent = dpMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // weeks start on Monday
    const cells = [];
    for (let i = 0; i < 42; i++) cells.push(new Date(y, m, 1 - lead + i));
    const inView = (v) => !!v && cells.some((c) => dateStr(c) === v);
    // exactly one day is in the tab order: the focused one, else the selected one, else today, else the 1st
    const tabStop = focusDate || (inView(due) && parseDay(due).getMonth() === m ? due : (parseDay(today).getMonth() === m && parseDay(today).getFullYear() === y ? today : dateStr(new Date(y, m, 1))));
    $('#dp-grid').replaceChildren(...cells.map((c) => {
      const value = dateStr(c);
      const cls = ['dp-day'];
      if (c.getMonth() !== m) cls.push('out');
      if (value === today) cls.push('today');
      if (value === due) cls.push('selected');
      return h('button', {
        type: 'button', class: cls.join(' '), text: String(c.getDate()), dataset: { value },
        tabIndex: value === tabStop ? 0 : -1, 'aria-pressed': String(value === due),
        'aria-label': `${c.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${value === today ? ', today' : ''}`,
      });
    }));
    if (focusDate) { const el = $(`.dp-day[data-value="${focusDate}"]`, dp); if (el) el.focus(); }
  }
  function openDatePicker() {
    const base = parseDay(currentDue() || todayStr());
    dpMonth = new Date(base.getFullYear(), base.getMonth(), 1);
    renderDatePicker();
    dp.showPopover();
    placePopover(dp, dueBtn);
    $('.dp-opt', dp).focus();
  }
  dueBtn.addEventListener('click', () => { if (dp.matches(':popover-open')) dp.hidePopover(); else openDatePicker(); });
  dueBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openDatePicker(); } });
  dp.addEventListener('click', (e) => {
    const opt = e.target.closest('.dp-opt, .dp-day');
    if (opt) pickDue(opt.dataset.value || null);
  });
  const shiftMonth = (step, focusDate) => { dpMonth = new Date(dpMonth.getFullYear(), dpMonth.getMonth() + step, 1); renderDatePicker(focusDate); };
  $('#dp-prev').addEventListener('click', () => shiftMonth(-1));
  $('#dp-next').addEventListener('click', () => shiftMonth(1));
  dp.addEventListener('keydown', (e) => {
    const day = e.target.closest('.dp-day');
    if (day) {
      const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      const from = parseDay(day.dataset.value);
      let to = null;
      if (e.key in steps) to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + steps[e.key]);
      else if (e.key === 'PageUp' || e.key === 'PageDown') to = new Date(from.getFullYear(), from.getMonth() + (e.key === 'PageUp' ? -1 : 1), from.getDate());
      else if (e.key === 'Home') to = new Date(from.getFullYear(), from.getMonth(), from.getDate() - ((from.getDay() + 6) % 7));
      else if (e.key === 'End') to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6 - ((from.getDay() + 6) % 7));
      if (to) {
        e.preventDefault();
        dpMonth = new Date(to.getFullYear(), to.getMonth(), 1);
        renderDatePicker(dateStr(to));
        return;
      }
    }
    if (e.key === 'Tab') { // keep Tab inside the picker
      const stops = $$('.dp-opt, .dp-nav, .dp-day[tabindex="0"]', dp);
      const i = stops.indexOf(document.activeElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    }
  });

  /* Workspace menu ------------------------------------------------------- */
  function openWsMenu() {
    const found = ui.detailId && findTask(ui.detailId);
    if (!found) return;
    wsMenu.replaceChildren(...state.workspaces.map((w) => {
      const tick = icon('check');
      tick.classList.add('tick');
      return h('button', { type: 'button', class: 'ws-opt', role: 'option', dataset: { id: w.id }, 'aria-selected': String(w.id === found.ws.id) },
        h('span', { text: w.emoji, 'aria-hidden': 'true' }), h('span', { class: 'grow', text: w.name }), tick);
    }));
    wsMenu.showPopover();
    placePopover(wsMenu, wsBtn);
    $('.ws-opt[aria-selected="true"]', wsMenu).focus();
  }
  wsBtn.addEventListener('click', () => { if (wsMenu.matches(':popover-open')) wsMenu.hidePopover(); else openWsMenu(); });
  wsBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openWsMenu(); } });
  wsMenu.addEventListener('keydown', (e) => {
    const opts = $$('.ws-opt', wsMenu);
    const i = opts.indexOf(document.activeElement);
    let to = null;
    if (e.key === 'ArrowDown') to = opts[(i + 1) % opts.length];
    else if (e.key === 'ArrowUp') to = opts[(i - 1 + opts.length) % opts.length];
    else if (e.key === 'Home') to = opts[0];
    else if (e.key === 'End') to = opts[opts.length - 1];
    else if (e.key === 'Tab') { e.preventDefault(); wsMenu.hidePopover(); wsBtn.focus(); return; }
    else if (e.key.length === 1 && /\S/.test(e.key)) { // jump to a workspace by its first letter
      to = opts.find((o, n) => n > i && $('.grow', o).textContent.toLowerCase().startsWith(e.key.toLowerCase()))
        || opts.find((o) => $('.grow', o).textContent.toLowerCase().startsWith(e.key.toLowerCase()));
    }
    if (to) { e.preventDefault(); to.focus(); }
  });
  wsMenu.addEventListener('click', (e) => {
    const opt = e.target.closest('.ws-opt');
    if (!opt) return;
    const id = ui.detailId;
    wsMenu.hidePopover();
    if (opt.getAttribute('aria-selected') === 'true') { wsBtn.focus(); return; }
    detail.close();
    moveTaskToWorkspace(id, opt.dataset.id);
  });

  detail.addEventListener('change', (e) => {
    if (e.target.name !== 'd-q') return;
    detail.dataset.q = e.target.value;
    editDetail((t) => setQuadrant(t, e.target.value));
  });
  dDone.addEventListener('change', () => {
    const id = ui.detailId;
    const checked = dDone.checked;
    detail.close();
    if (checked) completeTask(id); else restoreTask(id);
  });
  $('#d-delete').addEventListener('click', () => {
    const id = ui.detailId;
    detail.close();
    deleteTask(id);
  });
  detail.addEventListener('click', (e) => {
    // backdrop click closes the sheet, unless that same click just dismissed an open picker
    if (e.target === detail && performance.now() - popClosedAt > 250) detail.close();
  });
  detail.addEventListener('close', () => {
    if (detail.open) return; // the close event arrives late; the sheet may already show another task
    const id = ui.detailId;
    ui.detailId = null;
    flush();
    const el = id && noteById(id);
    if (el) el.focus({ preventScroll: true });
  });

  /* ------------------------------------------------------------------ *
   * Batch mode: clear "Get off the plate" tasks one after another
   * ------------------------------------------------------------------ */
  const batch = $('#batch');
  let batchIds = [];

  function openBatch() {
    const ws = activeWs();
    batchIds = quadTasks(ws, 'offload').map((t) => t.id);
    if (!batchIds.length) return;
    $('#batch-title').textContent = qName(ws, 'offload');
    renderBatch();
    batch.showModal();
    const first = $('input:not(:checked)', batch);
    if (first) first.focus();
  }

  function renderBatch() {
    const today = todayStr();
    let left = 0;
    const rows = batchIds.map((id) => {
      const found = findTask(id);
      if (!found) return null;
      const { task, done } = found;
      if (!done) left++;
      const info = task.due && !done ? dueInfo(task.due, today) : null;
      return h('li', null,
        h('label', { class: `batch-row${done ? ' checked' : ''}` },
          h('input', { type: 'checkbox', checked: done, dataset: { id } }),
          h('span', { class: 'box', 'aria-hidden': 'true' }, icon('check')),
          h('span', { class: 'batch-text', text: task.title }),
          info && h('span', { class: `due due-${info.kind}`, text: info.label })));
    }).filter(Boolean);
    $('#batch-list').replaceChildren(...rows);
    $('#batch-progress').textContent = left === 0 ? 'All clear. Nicely done 🎉' : `${left} of ${rows.length} left`;
  }

  $('#batch-list').addEventListener('change', (e) => {
    const { id } = e.target.dataset;
    if (!id) return;
    if (e.target.checked) completeTask(id, { quiet: true }); else restoreTask(id, { quiet: true });
    renderBatch();
    // keep the keyboard flow going: land on the next open task
    const next = $('input:not(:checked)', batch) || $('.btn.primary', batch);
    next.focus();
  });
  $('#batch-open').addEventListener('click', openBatch);
  batch.addEventListener('click', (e) => { if (e.target === batch) batch.close(); });
  batch.addEventListener('close', flush);

  /* ------------------------------------------------------------------ *
   * Review mode: one task at a time. Keep, move or drop.
   * ------------------------------------------------------------------ */
  const review = $('#review-mode');
  let reviewQueue = [];
  let reviewAt = 0;

  function openReview() {
    const ws = activeWs();
    reviewQueue = ws.tasks.filter((t) => t.quadrant === 'review')
      .sort((a, b) => a.quadrantSince - b.quadrantSince) // longest-waiting first
      .map((t) => t.id);
    if (!reviewQueue.length) return;
    reviewAt = 0;
    $('#rv-heading').textContent = qName(ws, 'review');
    $('#rv-targets').replaceChildren(...Q_IDS.filter((q) => q !== 'review').map((q) =>
      h('button', { type: 'button', class: 'rv-target', dataset: { q }, text: qName(ws, q) })));
    review.showModal();
    renderReview();
  }

  function reviewTask() {
    // skip anything that changed elsewhere since the session started
    while (reviewAt < reviewQueue.length) {
      const found = findTask(reviewQueue[reviewAt]);
      if (found && !found.done && found.task.quadrant === 'review') return found.task;
      reviewAt++;
    }
    return null;
  }

  function renderReview() {
    const task = reviewTask();
    $('#rv-card').hidden = !task;
    $('#rv-actions').hidden = !task;
    $('#rv-empty').hidden = !!task;
    if (!task) {
      $('#rv-progress').textContent = 'Nothing left to decide';
      $('.btn.primary', review).focus();
      return;
    }
    const days = daysIn(task);
    $('#rv-progress').textContent = `${reviewAt + 1} of ${reviewQueue.length}`;
    $('#rv-age').textContent = days < 1 ? 'Added to this quadrant today' : `Waiting here for ${days} ${days === 1 ? 'day' : 'days'}`;
    $('#rv-age').classList.toggle('stale', isStale(task));
    $('#rv-title').textContent = task.title;
    $('#rv-notes').textContent = task.notes.trim();
    $('#rv-notes').hidden = !task.notes.trim();
    const info = task.due ? dueInfo(task.due, todayStr()) : null;
    $('#rv-due').hidden = !info;
    if (info) { $('#rv-due').className = `due due-${info.kind}`; $('#rv-due').textContent = info.label; }
    const card = $('#rv-card');
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
    $('#rv-keep').focus();
  }

  function reviewDecide(fn) {
    const task = reviewTask();
    if (!task) return;
    fn(task);
    reviewAt++;
    renderReview();
  }
  $('#rv-keep').addEventListener('click', () => reviewDecide((task) => {
    task.quadrantSince = Date.now(); // a fresh decision resets its age
    commit();
  }));
  $('#rv-targets').addEventListener('click', (e) => {
    const btn = e.target.closest('.rv-target');
    if (btn) reviewDecide((task) => { setQuadrant(task, btn.dataset.q); commit(); });
  });
  $('#rv-drop').addEventListener('click', () => reviewDecide((task) => completeTask(task.id, { quiet: true, dropped: true })));
  $('#review-open').addEventListener('click', openReview);
  review.addEventListener('click', (e) => { if (e.target === review) review.close(); });
  review.addEventListener('close', flush);

  /* ------------------------------------------------------------------ *
   * Done drawer
   * ------------------------------------------------------------------ */
  const drawer = $('#drawer');
  function setDrawer(open) {
    drawer.classList.toggle('open', open);
    document.body.classList.toggle('drawer-open', open);
    drawer.inert = !open;
    doneToggle.setAttribute('aria-expanded', String(open));
    if (open) $('#drawer-close').focus({ preventScroll: true });
    else if (drawer.contains(document.activeElement)) doneToggle.focus();
  }
  const drawerOpen = () => drawer.classList.contains('open');
  doneToggle.addEventListener('click', () => setDrawer(!drawerOpen()));
  $('#drawer-close').addEventListener('click', () => setDrawer(false));
  $('#done-clear').addEventListener('click', clearDone);
  $('#done-list').addEventListener('click', (e) => {
    const item = e.target.closest('.done-item');
    if (!item) return;
    const { id } = item.dataset;
    if (e.target.closest('.restore')) restoreTask(id);
    else if (e.target.closest('.del')) deleteTask(id);
    else if (e.target.closest('.done-main')) openDetail(id);
  });

  /* ------------------------------------------------------------------ *
   * Workspaces
   * ------------------------------------------------------------------ */
  const wsTabs = $('#ws-tabs');
  const wsDialog = $('#ws-dialog');
  let tabDrag = null;
  let suppressTabClick = false;

  function switchWorkspace(id) {
    if (id === state.activeId || !state.workspaces.some((w) => w.id === id)) return;
    state.activeId = id;
    ui.composer = null;
    commit();
  }
  function switchRelative(step) {
    const n = state.workspaces.length;
    const i = state.workspaces.findIndex((w) => w.id === state.activeId);
    switchWorkspace(state.workspaces[(i + step + n) % n].id);
  }

  wsTabs.addEventListener('click', (e) => {
    if (suppressTabClick) { suppressTabClick = false; return; }
    const tab = e.target.closest('.ws-tab');
    if (!tab) return;
    if (e.target.closest('.ws-tab-edit')) openWsDialog(tab.dataset.id);
    else switchWorkspace(tab.dataset.id);
  });
  wsTabs.addEventListener('dblclick', (e) => {
    const tab = e.target.closest('.ws-tab');
    if (tab) openWsDialog(tab.dataset.id);
  });

  // Drag a tab sideways to reorder workspaces.
  wsTabs.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.ws-tab-btn');
    if (e.button !== 0 || !btn || state.workspaces.length < 2) return;
    tabDrag = { el: btn.parentElement, x0: e.clientX, active: false };
    window.addEventListener('pointermove', onTabMove);
    window.addEventListener('pointerup', onTabUp);
    window.addEventListener('pointercancel', onTabUp);
  });
  function onTabMove(e) {
    if (!tabDrag) return;
    if (!tabDrag.active) {
      if (Math.abs(e.clientX - tabDrag.x0) < 6) return;
      tabDrag.active = true;
      tabDrag.el.classList.add('dragging');
    }
    let before = null;
    for (const sib of wsTabs.children) {
      if (sib === tabDrag.el) continue;
      const r = sib.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { before = sib; break; }
    }
    if (before !== tabDrag.el.nextElementSibling) wsTabs.insertBefore(tabDrag.el, before);
  }
  function onTabUp() {
    window.removeEventListener('pointermove', onTabMove);
    window.removeEventListener('pointerup', onTabUp);
    window.removeEventListener('pointercancel', onTabUp);
    const d = tabDrag;
    tabDrag = null;
    if (!d || !d.active) return;
    suppressTabClick = true;
    setTimeout(() => { suppressTabClick = false; }, 0);
    const order = [...wsTabs.children].map((el) => el.dataset.id);
    state.workspaces.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    commit();
  }

  $('#ws-add').addEventListener('click', () => {
    const used = new Set(state.workspaces.map((w) => w.color));
    const color = WS_COLORS.find((c) => !used.has(c)) || WS_COLORS[state.workspaces.length % WS_COLORS.length];
    const ws = newWorkspace('New workspace', '✨', color);
    state.workspaces.push(ws);
    state.activeId = ws.id;
    ui.composer = null;
    commit();
    openWsDialog(ws.id, true);
  });

  function openWsDialog(id, isNew = false) {
    const ws = state.workspaces.find((w) => w.id === id);
    if (!ws) return;
    ui.wsEditId = id;
    $('#ws-dialog-title').textContent = isNew ? 'New workspace' : 'Edit workspace';
    $('#w-name').value = ws.name;
    $('#w-emoji-custom').value = WS_EMOJIS.includes(ws.emoji) ? '' : ws.emoji;
    for (const input of $$('.w-qname', wsDialog)) {
      input.value = ws.quadrantNames[input.dataset.q] || '';
      input.placeholder = Q_TITLE[input.dataset.q];
    }
    syncWsDialog();
    wsDialog.showModal();
    $('#w-name').focus();
    $('#w-name').select();
  }

  function syncWsDialog() {
    const ws = state.workspaces.find((w) => w.id === ui.wsEditId);
    if (!ws) return;
    const i = state.workspaces.indexOf(ws);
    $('#w-emojis').replaceChildren(...WS_EMOJIS.map((em) =>
      h('button', { type: 'button', text: em, dataset: { emoji: em }, 'aria-pressed': String(em === ws.emoji), 'aria-label': `Emoji ${em}` })));
    $('#w-colors').replaceChildren(...WS_COLORS.map((c) => {
      const b = h('button', { type: 'button', dataset: { color: c }, 'aria-pressed': String(c === ws.color), 'aria-label': `Colour ${c}` });
      b.style.setProperty('--c', c);
      return b;
    }));
    $('#w-left').disabled = i === 0;
    $('#w-right').disabled = i === state.workspaces.length - 1;
    $('#w-delete').disabled = state.workspaces.length < 2;
    $('#w-delete').title = state.workspaces.length < 2 ? 'You need at least one workspace' : '';
    $('#w-qreset').disabled = !Object.keys(ws.quadrantNames).length;
  }

  function editWs(fn) {
    const ws = state.workspaces.find((w) => w.id === ui.wsEditId);
    if (!ws) return;
    fn(ws);
    commit();
    syncWsDialog();
  }

  $('#w-name').addEventListener('input', (e) => {
    const name = e.target.value.trim();
    if (name) editWs((ws) => { ws.name = name; });
  });
  $('#w-emojis').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $('#w-emoji-custom').value = '';
    editWs((ws) => { ws.emoji = b.dataset.emoji; });
  });
  $('#w-emoji-custom').addEventListener('input', (e) => {
    const em = e.target.value.trim();
    if (em) editWs((ws) => { ws.emoji = em; });
  });
  $('#w-colors').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) editWs((ws) => { ws.color = b.dataset.color; });
  });
  function moveWs(step) {
    const i = state.workspaces.findIndex((w) => w.id === ui.wsEditId);
    const j = i + step;
    if (i < 0 || j < 0 || j >= state.workspaces.length) return;
    const [ws] = state.workspaces.splice(i, 1);
    state.workspaces.splice(j, 0, ws);
    commit();
    syncWsDialog();
  }
  $('#w-left').addEventListener('click', () => moveWs(-1));
  $('#w-right').addEventListener('click', () => moveWs(1));
  wsDialog.addEventListener('click', (e) => { if (e.target === wsDialog) wsDialog.close(); });
  wsDialog.addEventListener('close', () => { if (!wsDialog.open) ui.wsEditId = null; flush(); });

  // Quadrant names for this workspace only. An empty field means "use the default".
  $('#w-qnames').addEventListener('input', (e) => {
    const input = e.target.closest('.w-qname');
    if (!input) return;
    const name = input.value.trim().slice(0, QUADRANT_NAME_MAX);
    editWs((ws) => {
      if (name && name !== Q_TITLE[input.dataset.q]) ws.quadrantNames[input.dataset.q] = name;
      else delete ws.quadrantNames[input.dataset.q];
    });
  });
  $('#w-qreset').addEventListener('click', () => {
    for (const input of $$('.w-qname', wsDialog)) input.value = '';
    editWs((ws) => { ws.quadrantNames = {}; });
  });

  $('#w-delete').addEventListener('click', async () => {
    const ws = state.workspaces.find((w) => w.id === ui.wsEditId);
    if (!ws || state.workspaces.length < 2) return;
    const open = ws.tasks.length;
    const done = ws.done.length;
    if (open + done > 0) {
      const parts = [];
      if (open) parts.push(`${open} open ${open === 1 ? 'task' : 'tasks'}`);
      if (done) parts.push(`${done} completed`);
      const ok = await confirmDialog({
        title: `Delete “${ws.name}”?`,
        body: `This workspace still has ${parts.join(' and ')}. Deleting it removes them too.`,
        ok: 'Delete workspace', danger: true,
      });
      if (!ok) return;
    }
    wsDialog.close();
    snapshot();
    const i = state.workspaces.indexOf(ws);
    state.workspaces.splice(i, 1);
    if (state.activeId === ws.id) state.activeId = state.workspaces[Math.max(0, i - 1)].id;
    commit();
    toast(`Deleted ${ws.emoji} ${ws.name}`, { undoable: true });
  });

  /* ------------------------------------------------------------------ *
   * Weather (optional, off by default). The only network use in the app:
   * Open-Meteo, for a place picked in Settings. Never browser geolocation.
   * ------------------------------------------------------------------ */
  const WX_ORIGINS = ['https://geocoding-api.open-meteo.com/*', 'https://api.open-meteo.com/*'];
  const WX_MAX_AGE = 30 * 60000;
  const hasPermissions = typeof chrome !== 'undefined' && !!chrome.permissions;
  let wxCache = null;    // { temp, code, isDay, at, lat, lon }
  let wxAllowed = false; // host permission for the two Open-Meteo hosts
  let wxBusy = false;

  /** request = true asks the user (needs a click); false only checks. */
  async function wxPermission(request) {
    if (!hasPermissions) return true; // opened as a plain page during development
    try { return await chrome.permissions[request ? 'request' : 'contains']({ origins: WX_ORIGINS }); } catch { return false; }
  }

  /** WMO weather interpretation codes, as used by Open-Meteo. */
  function wxLook(code, isDay) {
    const pick = (day, night, text) => ({ emoji: isDay ? day : night, text });
    if (code === 0) return pick('☀️', '🌙', isDay ? 'Clear sky' : 'Clear night');
    if (code === 1) return pick('🌤️', '🌙', 'Mostly clear');
    if (code === 2) return pick('⛅', '☁️', 'Partly cloudy');
    if (code === 3) return pick('☁️', '☁️', 'Cloudy');
    if (code === 45 || code === 48) return pick('🌫️', '🌫️', 'Fog');
    if (code >= 51 && code <= 57) return pick('🌦️', '🌧️', 'Drizzle');
    if (code >= 61 && code <= 67) return pick('🌧️', '🌧️', 'Rain');
    if (code >= 71 && code <= 77) return pick('❄️', '❄️', 'Snow');
    if (code >= 80 && code <= 82) return pick('☔', '☔', 'Showers');
    if (code === 85 || code === 86) return pick('🌨️', '🌨️', 'Snow showers');
    if (code >= 95 && code <= 99) return pick('⛈️', '⛈️', 'Thunderstorm');
    return pick('🌤️', '🌙', 'Weather');
  }
  function readWxCache(raw) {
    return raw && Number.isFinite(raw.temp) && Number.isFinite(raw.code) && Number.isFinite(raw.at) ? raw : null;
  }
  const wxMatches = (loc) => !!wxCache && !!loc && wxCache.lat === loc.latitude && wxCache.lon === loc.longitude;

  function weatherNow() {
    const w = state.weather;
    if (!w.enabled || !wxAllowed || !wxMatches(w.location)) return null;
    return { ...wxLook(wxCache.code, wxCache.isDay), temp: wxCache.temp, at: wxCache.at, place: w.location.name };
  }

  /** Background refresh. Never throws and never blocks: on any failure the cached reading stays. */
  async function refreshWeather(force = false) {
    const loc = state && state.weather.enabled && state.weather.location;
    if (!loc || !wxAllowed || wxBusy) return;
    if (!force && wxMatches(loc) && Date.now() - wxCache.at < WX_MAX_AGE) return;
    wxBusy = true;
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({
        latitude: loc.latitude, longitude: loc.longitude, current: 'temperature_2m,weather_code,is_day',
        temperature_unit: 'celsius', timezone: loc.timezone || 'auto',
      });
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), credentials: 'omit' });
      if (!res.ok) throw new Error('weather');
      const cur = (await res.json()).current;
      if (!cur || !Number.isFinite(cur.temperature_2m) || !Number.isFinite(cur.weather_code)) throw new Error('weather');
      if (state.weather.location !== loc || !state.weather.enabled) return; // changed while we waited
      wxCache = { temp: cur.temperature_2m, code: cur.weather_code, isDay: cur.is_day !== 0, at: Date.now(), lat: loc.latitude, lon: loc.longitude };
      store.save({ [WEATHER_KEY]: wxCache }).catch(() => {});
      renderHeader();
      if (settings.open) syncSettings();
    } catch { /* offline or blocked: keep what we have */ } finally { wxBusy = false; }
  }

  /* ------------------------------------------------------------------ *
   * Settings
   * ------------------------------------------------------------------ */
  const settings = $('#settings');
  const wxToggle = $('#wx-toggle');
  const wxQuery = $('#wx-query');
  let wxSearchTimer = null;
  let wxSearchSeq = 0;

  function syncSettings() {
    const w = state.weather;
    const on = w.enabled && wxAllowed;
    wxToggle.checked = on;
    $('#wx-settings').hidden = !on;
    const wx = weatherNow();
    $('#wx-current').textContent = !w.location ? 'No place chosen yet. Search below and pick one.'
      : `${w.location.name}${wx ? ` · ${wx.emoji} ${Math.round(wx.temp) || 0}°` : ''}`;
    const n = log.length;
    $('#stats-info').textContent = n
      ? `${n} completed ${n === 1 ? 'task' : 'tasks'} recorded since ${fmtDay(new Date(log[0].completedAt))}. Resetting clears Insights; your boards and done piles stay as they are.`
      : 'No completions recorded yet.';
    $('#stats-reset').disabled = !n;
  }
  function openSettings() {
    setMenu(false);
    $('#wx-status').textContent = '';
    $('#wx-results').replaceChildren();
    wxQuery.value = '';
    syncSettings();
    settings.showModal();
  }
  $('#settings-open').addEventListener('click', openSettings);
  settings.addEventListener('click', (e) => { if (e.target === settings) settings.close(); });
  settings.addEventListener('close', flush);

  wxToggle.addEventListener('change', async () => {
    const status = $('#wx-status');
    status.textContent = '';
    if (wxToggle.checked) {
      const ok = await wxPermission(true); // Chrome asks for the two Open-Meteo hosts here
      if (!ok) {
        wxToggle.checked = false;
        status.textContent = 'Permission was not granted, so the weather stays off.';
        return;
      }
      wxAllowed = true;
      state.weather.enabled = true;
      commit();
      syncSettings();
      refreshWeather();
      if (!state.weather.location) wxQuery.focus();
    } else {
      state.weather.enabled = false;
      wxAllowed = false;
      commit();
      syncSettings();
      if (hasPermissions) chrome.permissions.remove({ origins: WX_ORIGINS }).catch(() => {}); // hand the permission back
    }
  });

  async function searchPlaces() {
    const q = wxQuery.value.trim();
    const results = $('#wx-results');
    const status = $('#wx-status');
    const seq = ++wxSearchSeq;
    if (q.length < 2) { results.replaceChildren(); status.textContent = ''; return; }
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({ name: q, count: 6, language: 'en', format: 'json' });
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), credentials: 'omit' });
      if (!res.ok) throw new Error('search');
      const found = ((await res.json()).results || []).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.name);
      if (seq !== wxSearchSeq) return; // a newer search is on its way
      status.textContent = found.length ? '' : `No place found for “${q}”.`;
      results.replaceChildren(...found.map((r) => {
        const where = [r.admin1, r.country].filter((part) => part && part !== r.name).join(', ');
        const btn = h('button', { type: 'button', class: 'wx-result' },
          h('span', { class: 'grow', text: r.name }), where && h('span', { class: 'hint', text: where }));
        btn.addEventListener('click', () => {
          state.weather.location = {
            name: where ? `${r.name}, ${r.country || r.admin1}` : r.name,
            latitude: r.latitude, longitude: r.longitude, timezone: r.timezone || 'auto',
          };
          commit();
          results.replaceChildren();
          wxQuery.value = '';
          syncSettings();
          refreshWeather(true);
        });
        return h('li', null, btn);
      }));
    } catch {
      if (seq === wxSearchSeq) status.textContent = 'The place search could not be reached. Check your connection and try again.';
    }
  }
  wxQuery.addEventListener('input', () => { clearTimeout(wxSearchTimer); wxSearchTimer = setTimeout(searchPlaces, 350); });
  wxQuery.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // Enter searches; it must not close the dialog
    clearTimeout(wxSearchTimer);
    searchPlaces();
  });

  $('#stats-reset').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset statistics?',
      body: `This clears the record of ${log.length} completed ${log.length === 1 ? 'task' : 'tasks'} that Insights is built from. Your boards and done piles are not touched.`,
      ok: 'Reset statistics', danger: true,
    });
    if (!ok) return;
    snapshot();
    log = [];
    logDirty = true;
    commit();
    syncSettings();
    toast('Statistics reset', { undoable: true });
  });

  /* ------------------------------------------------------------------ *
   * Insights: what got done, and when. Built from the completion log.
   * Charts are plain SVG drawn here; colours come from the CSS tokens.
   * ------------------------------------------------------------------ */
  const insights = $('#insights');
  const vizTip = $('#viz-tip');
  const ins = { ws: 'all', range: '30d', tab: 'overview', day: null, shown: 150 };
  const RANGES = [['7d', '7 days', 'the last 7 days'], ['30d', '30 days', 'the last 30 days'], ['6m', '6 months', 'the last 6 months'], ['1y', '1 year', 'the last year']];
  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v; else el.setAttribute(k, v);
    }
    el.append(...kids.flat().filter(Boolean));
    return el;
  }
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayKey = (ts) => dateStr(new Date(ts));
  const mondayIndex = (d) => (d.getDay() + 6) % 7; // 0 = Monday
  function rangeStart(key) {
    const t = new Date();
    const [y, m, d] = [t.getFullYear(), t.getMonth(), t.getDate()];
    if (key === '7d') return new Date(y, m, d - 6);
    if (key === '30d') return new Date(y, m, d - 29);
    if (key === '6m') return new Date(y, m - 6, d + 1);
    return new Date(y - 1, m, d + 1);
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  function fmtSpan(ms) {
    const hours = ms / 3600000;
    if (hours < 1) return plural(Math.max(1, Math.round(ms / 60000)), 'minute');
    if (hours < 48) return plural(Math.round(hours), 'hour');
    const days = hours / 24;
    return `${days < 10 ? days.toFixed(1).replace(/\.0$/, '') : Math.round(days)} days`;
  }
  const fmtLongDay = (d) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

  function openInsights() {
    setMenu(false);
    ins.day = null;
    ins.shown = 150;
    renderInsights();
    if (!insights.open) insights.showModal();
    insights.scrollTop = 0;
    $('#ins-back').focus();
  }
  $('#insights-open').addEventListener('click', openInsights);
  $('#ins-back').addEventListener('click', () => insights.close());
  insights.addEventListener('close', () => { hideTip(); $('#insights-open').focus(); });

  function renderInsights() {
    if (ins.ws !== 'all' && !state.workspaces.some((w) => w.id === ins.ws)) ins.ws = 'all';
    const chip = (id, label, on) => h('button', { type: 'button', class: 'chip', dataset: { ws: id }, 'aria-pressed': String(on), text: label });
    $('#ins-ws').replaceChildren(chip('all', 'All workspaces', ins.ws === 'all'),
      ...state.workspaces.map((w) => chip(w.id, `${w.emoji} ${w.name}`, ins.ws === w.id)));
    $('#ins-range').replaceChildren(...RANGES.map(([id, label]) =>
      h('button', { type: 'button', dataset: { range: id }, 'aria-pressed': String(ins.range === id), text: label })));
    for (const tab of $$('[role="tab"]', insights)) tab.setAttribute('aria-selected', String(tab.dataset.tab === ins.tab));

    const entries = ins.ws === 'all' ? log : log.filter((e) => e.wsId === ins.ws);
    const from = rangeStart(ins.range);
    const to = dayStart(new Date());
    const inRange = entries.filter((e) => e.completedAt >= from.getTime() && e.completedAt < to.getTime() + DAY_MS + 3600000);
    const body = $('#ins-body');
    hideTip();
    body.replaceChildren(...(ins.tab === 'history' ? historyView(inRange) : overviewView(entries, inRange, from, to)));
  }

  $('#ins-ws').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) { ins.ws = b.dataset.ws; ins.day = null; ins.shown = 150; renderInsights(); $(`#ins-ws [data-ws="${CSS.escape(ins.ws)}"]`).focus(); }
  });
  $('#ins-range').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { ins.range = b.dataset.range; ins.day = null; ins.shown = 150; renderInsights(); $(`#ins-range [data-range="${ins.range}"]`).focus(); }
  });
  $('#ins-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { ins.tab = b.dataset.tab; renderInsights(); b.focus(); }
  });

  /* Overview ----------------------------------------------------------- */
  function overviewView(entries, inRange, from, to) {
    const rangeText = RANGES.find((r) => r[0] === ins.range)[2];
    const perDay = new Map();
    for (const e of entries) perDay.set(dayKey(e.completedAt), (perDay.get(dayKey(e.completedAt)) || 0) + 1);

    // this week and last week (weeks start on Monday)
    const monday = new Date(to.getFullYear(), to.getMonth(), to.getDate() - mondayIndex(to));
    const lastMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
    const thisWeek = entries.filter((e) => e.completedAt >= monday.getTime()).length;
    const lastWeek = entries.filter((e) => e.completedAt >= lastMonday.getTime() && e.completedAt < monday.getTime()).length;

    // streak: consecutive days with a completion, counted back from today (or from yesterday if today is still open)
    const doneToday = perDay.has(dateStr(to));
    let streak = 0;
    for (let i = doneToday ? 0 : 1; perDay.has(dateStr(new Date(to.getFullYear(), to.getMonth(), to.getDate() - i))); i++) streak++;

    const byWeekday = Array(7).fill(0);
    const byHour = Array(24).fill(0);
    const byQuadrant = Object.fromEntries(Q_IDS.map((q) => [q, 0]));
    let spanSum = 0;
    let spanN = 0;
    for (const e of inRange) {
      const d = new Date(e.completedAt);
      byWeekday[mondayIndex(d)]++;
      byHour[d.getHours()]++;
      byQuadrant[e.quadrant]++;
      if (e.completedAt >= e.createdAt) { spanSum += e.completedAt - e.createdAt; spanN++; }
    }
    const total = inRange.length;
    const bestDay = byWeekday.indexOf(Math.max(...byWeekday));
    const bestHour = byHour.indexOf(Math.max(...byHour));

    const card = (label, value, sub) => h('div', { class: 'ins-card stat' },
      h('span', { class: 'stat-label', text: label }), h('span', { class: 'stat-value', text: value }), h('span', { class: 'stat-sub', text: sub }));
    const cards = h('div', { class: 'ins-stats' },
      card('This week', String(thisWeek), lastWeek ? `Last week: ${lastWeek}${thisWeek > lastWeek ? ` · ${thisWeek - lastWeek} more so far` : ''}` : 'completed since Monday'),
      card('Current streak', plural(streak, 'day'), streak ? (doneToday ? 'in a row, including today' : 'in a row, up to yesterday') : 'Your next completion starts one'),
      card('Most productive day', total ? WEEKDAY_NAME(bestDay) : '–', total ? `${plural(byWeekday[bestDay], 'task')} in ${rangeText}` : `Nothing in ${rangeText} yet`),
      card('From added to done', spanN ? fmtSpan(spanSum / spanN) : '–', spanN ? `on average, ${rangeText}` : `Nothing in ${rangeText} yet`));

    const panel = (title, sub, ...kids) => h('section', { class: 'ins-card' },
      h('h3', { text: title }), sub && h('p', { class: 'ins-sub', text: sub }), ...kids);

    const heat = panel('Completions per day', `${plural(total, 'task')} completed in ${rangeText}. Select a day to see them.`,
      h('div', { class: 'heat-row' }, h('div', { class: 'heat-main' }, heatmap(perDay, from, to), heatLegend()), dayPanel(inRange)));
    heat.classList.add('wide');
    if (!total) {
      return [cards, heat, h('section', { class: 'ins-card wide ins-empty' },
        h('p', { text: log.length ? `Nothing completed in ${rangeText} here. Try a longer range or another workspace.` : 'Finish a task and it will show up here. Every tick on the board adds to these charts.' }))];
    }

    const ws = ins.ws === 'all' ? null : state.workspaces.find((w) => w.id === ins.ws);
    const nameOf = (q) => (ws ? qName(ws, q) : Q_TITLE[q]);
    const top = Q_IDS.reduce((a, b) => (byQuadrant[b] > byQuadrant[a] ? b : a));
    const share = byQuadrant[top] / total;
    return [cards, heat,
      panel('By weekday', null, barChart(byWeekday, WEEKDAYS.map((d) => d.slice(0, 3)), {
        width: 380, tip: (i) => `${WEEKDAYS[i]}: ${plural(byWeekday[i], 'task')}`, label: 'Completions by weekday',
      })),
      panel('By hour of day', `You finish most tasks between ${pad2(bestHour)}:00 and ${pad2((bestHour + 1) % 24)}:00.`, barChart(byHour, byHour.map((_, i) => (i % 3 === 0 ? `${pad2(i)}` : '')), {
        width: 620, tip: (i) => `${pad2(i)}:00–${pad2((i + 1) % 24)}:00: ${plural(byHour[i], 'task')}`, label: 'Completions by hour of day',
      })),
      Object.assign(panel('By quadrant',
        share > 0.5 ? `Most of your completed work came from ${nameOf(top)}.` : `The largest share of your completed work came from ${nameOf(top)}.`,
        quadrantShare(byQuadrant, total, nameOf)), { className: 'ins-card wide' })];
  }
  const WEEKDAY_NAME = (i) => WEEKDAYS[i];
  const pad2 = (n) => String(n).padStart(2, '0');

  /** GitHub-style calendar: one column per week (Monday on top), one cell per day. */
  function heatmap(perDay, from, to) {
    const days = Math.round((to - from) / DAY_MS) + 1;
    const big = days <= 31;
    const cell = big ? 26 : 13;
    const step = cell + (big ? 4 : 3);
    const left = 34;
    const top = 20;
    const offset = mondayIndex(from);
    const weeks = Math.ceil((days + offset) / 7);
    let max = 0;
    for (let i = 0; i < days; i++) max = Math.max(max, perDay.get(dateStr(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i))) || 0);

    const out = svg('svg', {
      class: 'heatmap', width: left + weeks * step, height: top + 7 * step, viewBox: `0 0 ${left + weeks * step} ${top + 7 * step}`,
      role: 'grid', 'aria-label': 'Completions per day',
    });
    for (const [row, name] of [[0, 'Mon'], [2, 'Wed'], [4, 'Fri'], [6, 'Sun']]) {
      out.append(svg('text', { class: 'viz-label', x: left - 8, y: top + row * step + cell / 2, 'text-anchor': 'end', 'dominant-baseline': 'central', text: name }));
    }
    let lastLabelCol = -9;
    const focusKey = ins.day && ins.day >= dateStr(from) && ins.day <= dateStr(to) ? ins.day : dateStr(to);
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      const key = dateStr(d);
      const col = Math.floor((i + offset) / 7);
      const row = (i + offset) % 7;
      const n = perDay.get(key) || 0;
      const level = n ? Math.min(4, Math.ceil((n / max) * 4)) : 0;
      if ((d.getDate() === 1 || i === 0) && col - lastLabelCol >= (big ? 2 : 3)) {
        out.append(svg('text', { class: 'viz-label', x: left + col * step, y: 9, text: d.toLocaleDateString('en-GB', { month: 'short' }) }));
        lastLabelCol = col;
      }
      const label = `${fmtLongDay(d)}: ${n ? plural(n, 'task') : 'nothing'} completed`;
      out.append(svg('rect', {
        class: `hm-cell hm-l${level}${key === ins.day ? ' selected' : ''}`, x: left + col * step, y: top + row * step, width: cell, height: cell, rx: big ? 6 : 3,
        tabindex: key === focusKey ? 0 : -1, role: 'gridcell', 'aria-label': label, 'aria-selected': String(key === ins.day),
        'data-day': key, 'data-tip': label,
      }));
    }
    return h('div', { class: 'heat-scroll' }, out);
  }
  function heatLegend() {
    return h('div', { class: 'heat-legend', 'aria-hidden': 'true' }, h('span', { text: 'Fewer' }),
      ...[0, 1, 2, 3, 4].map((l) => h('i', { class: `hm-l${l}` })), h('span', { text: 'More' }));
  }
  function selectDay(key, focus) {
    ins.day = key;
    renderInsights();
    const cellEl = $(`.hm-cell[data-day="${key}"]`, insights);
    if (cellEl && focus) cellEl.focus();
  }
  $('#ins-body').addEventListener('click', (e) => {
    const cellEl = e.target.closest('.hm-cell');
    if (cellEl) { selectDay(cellEl.dataset.day === ins.day ? null : cellEl.dataset.day, false); return; }
    if (e.target.closest('#ins-more')) { ins.shown += 150; renderInsights(); }
  });
  $('#ins-body').addEventListener('keydown', (e) => {
    const cellEl = e.target.closest('.hm-cell');
    if (!cellEl) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDay(cellEl.dataset.day === ins.day ? null : cellEl.dataset.day, true); return; }
    const move = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (!move) return;
    e.preventDefault();
    const d = parseDay(cellEl.dataset.day);
    const next = $(`.hm-cell[data-day="${dateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + move))}"]`, insights);
    if (next) { cellEl.tabIndex = -1; next.tabIndex = 0; next.focus(); }
  });

  function entryRow(e) {
    const ws = state.workspaces.find((w) => w.id === e.wsId);
    return h('li', { class: 'hist-row', dataset: { q: e.quadrant } },
      h('span', { class: 'q-dot', title: ws ? qName(ws, e.quadrant) : Q_TITLE[e.quadrant] }),
      h('span', { class: 'hist-title', text: e.title }),
      ws && h('span', { class: 'hist-ws', text: ws.emoji, title: ws.name }),
      h('time', { class: 'hist-time', text: new Date(e.completedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }));
  }
  function dayGroup(key, list) {
    return h('section', { class: 'hist-day' },
      h('h4', null, fmtLongDay(parseDay(key)), h('span', { class: 'hist-count', text: plural(list.length, 'task') })),
      h('ul', { class: 'hist-list' }, ...list.map(entryRow)));
  }
  function dayPanel(inRange) {
    if (!ins.day) return null;
    const list = inRange.filter((e) => dayKey(e.completedAt) === ins.day).sort((a, b) => b.completedAt - a.completedAt);
    return h('div', { class: 'day-panel', id: 'day-panel' },
      list.length ? dayGroup(ins.day, list) : h('p', { class: 'ins-sub', text: `${fmtLongDay(parseDay(ins.day))}: nothing completed. A quiet day.` }));
  }

  /* History: every completion in the range, grouped by day, newest first. */
  function historyView(inRange) {
    const rangeText = RANGES.find((r) => r[0] === ins.range)[2];
    if (!inRange.length) {
      return [h('section', { class: 'ins-card wide ins-empty' }, h('p', { text: log.length ? `Nothing completed in ${rangeText} here.` : 'Finish a task and it will show up here.' }))];
    }
    const sorted = [...inRange].sort((a, b) => b.completedAt - a.completedAt);
    const groups = new Map();
    for (const e of sorted.slice(0, ins.shown)) {
      const key = dayKey(e.completedAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    return [h('section', { class: 'ins-card wide' },
      h('h3', { text: 'History' }), h('p', { class: 'ins-sub', text: `${plural(sorted.length, 'task')} completed in ${rangeText}.` }),
      ...[...groups].map(([key, list]) => dayGroup(key, list)),
      sorted.length > ins.shown && h('button', { type: 'button', id: 'ins-more', class: 'btn', text: `Show ${Math.min(150, sorted.length - ins.shown)} more` }))];
  }

  /** Vertical bars from a shared baseline. The tallest bar is emphasised and carries its value. */
  function barChart(values, labels, { width, tip, label }) {
    const height = 170;
    const padTop = 22;
    const padBottom = 22;
    const plotH = height - padTop - padBottom;
    const band = width / values.length;
    const barW = Math.min(30, band - 2 - Math.max(0, band * 0.22)); // at least a 2px gap between neighbours
    const max = Math.max(...values, 1);
    const peak = values.indexOf(Math.max(...values));
    const out = svg('svg', { class: 'bars', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${label}. ${values.map((v, i) => tip(i)).filter((_, i) => values[i]).join('; ')}` });
    out.append(svg('line', { class: 'viz-axis', x1: 0, x2: width, y1: padTop + plotH + 0.5, y2: padTop + plotH + 0.5 }));
    values.forEach((v, i) => {
      const x = i * band + (band - barW) / 2;
      const hgt = v ? Math.max(3, (v / max) * plotH) : 0;
      const y = padTop + plotH - hgt;
      const r = Math.min(4, hgt, barW / 2);
      const g = svg('g', { class: `bar-g${i === peak && v ? ' peak' : ''}`, 'data-tip': tip(i) },
        svg('rect', { class: 'bar-hit', x: i * band, y: 0, width: band, height }),
        v ? svg('path', { class: 'bar', d: `M${x},${y + hgt}V${y + r}a${r},${r} 0 0 1 ${r},-${r}h${barW - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + hgt}z` }) : null,
        i === peak && v ? svg('text', { class: 'viz-value', x: x + barW / 2, y: y - 6, 'text-anchor': 'middle', text: String(v) }) : null,
        labels[i] ? svg('text', { class: 'viz-label', x: i * band + band / 2, y: height - 6, 'text-anchor': 'middle', text: labels[i] }) : null);
      out.append(g);
    });
    return out;
  }

  /** One stacked bar plus a legend that carries names and numbers, so colour is never the only cue. */
  function quadrantShare(counts, total, nameOf) {
    // Percent geometry, so the bar fills its card at any width without stretching the corners.
    const out = svg('svg', { class: 'share', width: '100%', height: 24, role: 'img', 'aria-label': 'Share of completions per quadrant' });
    let x = 0;
    for (const q of Q_IDS.filter((id) => counts[id])) {
      const w = (counts[q] / total) * 100;
      const pct = Math.round(w);
      out.append(svg('rect', { class: 'share-seg', 'data-q': q, x: `${x}%`, y: 1, width: `${w}%`, height: 22, rx: 5, 'data-tip': `${nameOf(q)}: ${plural(counts[q], 'task')} (${pct}%)` }));
      x += w;
    }
    const legend = h('ul', { class: 'share-legend' }, ...Q_IDS.map((q) =>
      h('li', { dataset: { q } }, h('span', { class: 'q-dot' }), h('span', { class: 'grow', text: nameOf(q) }),
        h('span', { class: 'num', text: String(counts[q]) }), h('span', { class: 'pct', text: `${Math.round((counts[q] / total) * 100)}%` }))));
    return h('div', { class: 'share-wrap' }, out, legend);
  }

  /* One shared tooltip for every mark that has data-tip. */
  function showTip(target) {
    vizTip.textContent = target.getAttribute('data-tip');
    vizTip.hidden = false;
    const r = target.getBoundingClientRect();
    const w = vizTip.offsetWidth;
    const top = r.top - vizTip.offsetHeight - 8;
    vizTip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
    vizTip.style.top = `${top < 8 ? r.bottom + 8 : top}px`;
  }
  function hideTip() { vizTip.hidden = true; }
  insights.addEventListener('pointerover', (e) => {
    const t = e.target instanceof Element && e.target.closest('[data-tip]');
    if (t) showTip(t.classList.contains('bar-g') ? ($('.bar', t) || t) : t); else hideTip();
  });
  insights.addEventListener('pointerleave', hideTip);
  insights.addEventListener('focusin', (e) => { if (e.target instanceof Element && e.target.matches('[data-tip]')) showTip(e.target); });
  insights.addEventListener('focusout', hideTip);
  insights.addEventListener('scroll', hideTip, { passive: true });

  /* ------------------------------------------------------------------ *
   * Theme
   * ------------------------------------------------------------------ */
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const theme = state.theme || (darkQuery.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    try {
      if (state.theme) localStorage.setItem(THEME_KEY, state.theme); else localStorage.removeItem(THEME_KEY);
    } catch { /* ignore */ }
  }
  darkQuery.addEventListener('change', () => { if (!state.theme) applyTheme(); });
  $('#theme-toggle').addEventListener('click', () => {
    state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
  });

  /* ------------------------------------------------------------------ *
   * Menu, export & import
   * ------------------------------------------------------------------ */
  const menu = $('#menu');
  const menuToggle = $('#menu-toggle');
  function setMenu(open) {
    menu.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
  }
  menuToggle.addEventListener('click', () => setMenu(menu.hidden));
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !e.target.closest('.menu-wrap')) setMenu(false);
  });

  $('#export-btn').addEventListener('click', () => {
    setMenu(false);
    const { version, theme, activeId, workspaces } = state;
    const payload = {
      app: 'eisenhower-tabs',
      format: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      data: { version, theme, activeId, workspaces },
      log, // completion log behind Insights
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `eisenhower-backup-${todayStr()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup downloaded');
  });

  const importFile = $('#import-file');
  $('#import-btn').addEventListener('click', () => {
    setMenu(false);
    importFile.value = '';
    importFile.click();
  });
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;
    let next;
    let nextLog;
    try {
      const raw = JSON.parse(await file.text());
      next = normalize(raw);
      // backups from before the log existed get one built from their done piles
      nextLog = raw && raw.log !== undefined ? normalizeLog(raw.log) : backfillLog(next);
    } catch {
      toast('That file is not a valid Eisenhower Tabs backup.');
      return;
    }
    const count = (key) => next.workspaces.reduce((n, w) => n + w[key].length, 0);
    const nWs = next.workspaces.length;
    const ok = await confirmDialog({
      title: 'Replace your current boards?',
      body: `“${file.name}” contains ${nWs} ${nWs === 1 ? 'workspace' : 'workspaces'}, ${count('tasks')} open and ${count('done')} completed tasks. Importing replaces everything currently on your boards.`,
      ok: 'Replace and import', danger: true,
    });
    if (!ok) return;
    snapshot();
    next.theme = state.theme; // theme and weather belong to this device, keep them
    next.weather = state.weather;
    state = next;
    log = nextLog;
    logDirty = true;
    ui.composer = null;
    commit();
    toast('Backup imported', { undoable: true });
  });

  /* ------------------------------------------------------------------ *
   * Keyboard shortcuts
   * ------------------------------------------------------------------ */
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const target = e.target instanceof Element ? e.target : document.body;
    const typing = !!target.closest('input, textarea, select');
    const modal = !!$('dialog[open]');

    if (e.key === 'Escape') {
      if (modal) return; // the dialog closes itself
      if (drag && drag.active) cancelDrag();
      else if (!menu.hidden) setMenu(false);
      else if (target === quickInput) quickInput.blur();
      else if (drawerOpen()) setDrawer(false);
      return;
    }
    if (modal || typing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (undoSnap) { e.preventDefault(); undo(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key.toLowerCase()) {
      case 'n': e.preventDefault(); quickInput.focus(); break;
      case 'd': e.preventDefault(); setDrawer(!drawerOpen()); break;
      case 'i': e.preventDefault(); openInsights(); break;
      case '[': switchRelative(-1); break;
      case ']': switchRelative(1); break;
      default:
    }
  });

  /* ------------------------------------------------------------------ *
   * Keeping things fresh
   * ------------------------------------------------------------------ */
  // Another tab changed the data: pick it up so tabs never overwrite each other.
  if (hasChromeStorage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const logChange = changes[LOG_KEY];
      if (logChange && logChange.newValue && logChange.newValue.writer !== TAB_ID) {
        log = normalizeLog(logChange.newValue);
        logDirty = false;
        if (insights.open) renderInsights();
        if (settings.open) syncSettings();
      }
      if (changes[WEATHER_KEY]) { wxCache = readWxCache(changes[WEATHER_KEY].newValue); if (state) renderHeader(); }
      const change = changes[STORAGE_KEY];
      if (!change || !change.newValue || change.newValue.writer === TAB_ID) return;
      let next;
      try { next = normalize(change.newValue); } catch { return; }
      if (next.workspaces.some((w) => w.id === state.activeId)) next.activeId = state.activeId;
      cancelDrag();
      state = next;
      hideToast();
      applyTheme();
      if (ui.detailId && !findTask(ui.detailId)) detail.close();
      if (ui.wsEditId && !state.workspaces.some((w) => w.id === ui.wsEditId)) wsDialog.close();
      render();
      if (insights.open) renderInsights();
      if (settings.open) syncSettings();
      wxPermission(false).then((ok) => { wxAllowed = state.weather.enabled && ok; renderHeader(); refreshWeather(); });
    });
  }

  // Roll over to the new day if the tab stays open past midnight.
  const refreshDay = () => {
    if (!state) return;
    if (ui.day !== todayStr() && !drag) render(); else renderHeader(); // keeps the greeting in step with the clock
    refreshWeather();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshDay(); else flush();
  });
  setInterval(refreshDay, 60000);
  window.addEventListener('pagehide', flush);
  new ResizeObserver(() => { if (state && !drag) sizeLists(); }).observe(board);

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  (async function init() {
    // Boards, completion log and the last weather reading arrive in one read, so the first paint has everything.
    const allowed = wxPermission(false);
    let got = {};
    try { got = (await store.load([STORAGE_KEY, LOG_KEY, WEATHER_KEY])) || {}; } catch { /* start fresh below */ }
    const stored = got[STORAGE_KEY];
    try {
      state = stored ? normalize(stored) : defaultState();
    } catch {
      state = defaultState();
    }
    if (got[LOG_KEY]) log = normalizeLog(got[LOG_KEY]);
    else { log = backfillLog(state); logDirty = true; } // first run with the log: fill it from the done piles
    wxCache = readWxCache(got[WEATHER_KEY]);
    wxAllowed = state.weather.enabled && await allowed;
    applyTheme();
    render();
    if (!stored || stored.version !== DATA_VERSION || logDirty) save(); // also persists a migration right away
    refreshWeather();
  })();
})();
