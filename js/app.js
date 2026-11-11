(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'eisenhower.v1';
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
  const DATA_VERSION = 2;
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
    async load() {
      if (hasChromeStorage) return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
    },
    async save(data) {
      if (hasChromeStorage) return chrome.storage.local.set({ [STORAGE_KEY]: data });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
  };

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  let state = null;
  let undoSnap = null;   // JSON snapshot taken before the last undoable action
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
    return { id: uid(), name, emoji, color, quadrantNames: {}, tasks: [], done: [] };
  }

  function defaultState() {
    const workspaces = [
      newWorkspace('Work', '💼', WS_COLORS[0]),
      newWorkspace('Studies', '📚', WS_COLORS[2]),
      newWorkspace('Personal', '🏡', WS_COLORS[5]),
    ];
    return { version: DATA_VERSION, theme: null, activeId: workspaces[0].id, workspaces };
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
        out.completedAt = num(t.completedAt);
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
    const list = (arr, done) => (Array.isArray(arr) ? arr : []).map((t) => task(t, done)).filter(Boolean);

    const workspaces = src.workspaces
      .filter((w) => w && typeof w === 'object')
      .map((w, i) => ({
        id: freshId(w.id),
        name: str(w.name, 40).trim() || `Workspace ${i + 1}`,
        emoji: str(w.emoji, 8).trim() || '📋',
        color: typeof w.color === 'string' && COLOR_RE.test(w.color) ? w.color : WS_COLORS[i % WS_COLORS.length],
        quadrantNames: names(w.quadrantNames),
        tasks: list(w.tasks, false),
        done: list(w.done, true),
      }));
    if (!workspaces.length) throw new Error('No workspaces found in this file.');

    return {
      version: DATA_VERSION,
      theme: src.theme === 'dark' || src.theme === 'light' ? src.theme : null,
      activeId: workspaces.some((w) => w.id === src.activeId) ? src.activeId : workspaces[0].id,
      workspaces,
    };
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
    store.save({ ...state, writer: TAB_ID, savedAt: Date.now() })
      .catch(() => toast('Could not save your changes. Storage may be full.'));
  }

  /** Call before mutating state for an action that should offer "Undo". */
  function snapshot() {
    undoSnap = JSON.stringify(state);
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
    state = JSON.parse(undoSnap);
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
    return [q.id, { el, list: $('.note-list', el), count: $('.q-count', el), title: $('.q-title', el), add: $('.q-add', el) }];
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
    $('#greeting').textContent =
      hr >= 5 && hr < 12 ? 'Good morning ☀️' : hr >= 12 && hr < 18 ? 'Good afternoon 🌤️' : 'Good evening 🌙';
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

  /* Density: notes have one fixed size per density level. Each quadrant starts
     at its own level and steps down only if its notes would not fit; if they
     still do not fit at the smallest level, the quadrant scrolls. */
  const DENSITIES = ['normal', 'small', 'compact'];
  const BASE_DENSITY = { do: 'normal', plan: 'normal', offload: 'small', review: 'compact' };
  const NOTE_VARS = ['--n-w', '--n-min-h', '--n-fs', '--n-pad', '--n-badge'];

  const overflows = (list) => list.scrollHeight > list.clientHeight + 1;
  function updateFade(list) {
    list.parentElement.classList.toggle('more', list.scrollHeight - list.scrollTop - list.clientHeight > 1);
  }
  function fitList(q) {
    const { list } = quadEls[q];
    const scroll = list.scrollTop;
    let i = DENSITIES.indexOf(BASE_DENSITY[q]);
    list.dataset.density = DENSITIES[i];
    while (i < DENSITIES.length - 1 && overflows(list)) list.dataset.density = DENSITIES[++i];
    list.scrollTop = scroll;
    updateFade(list);
  }
  const sizeLists = () => { for (const q of QUADRANTS) fitList(q.id); };
  for (const q of QUADRANTS) {
    const { list } = quadEls[q.id];
    list.addEventListener('scroll', () => updateFade(list), { passive: true });
  }

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
    const cs = getComputedStyle(note);
    const ghost = note.cloneNode(true);
    ghost.className = 'note ghost';
    ghost.removeAttribute('tabindex');
    ghost.dataset.q = note.closest('[data-q]').dataset.q;
    for (const v of NOTE_VARS) ghost.style.setProperty(v, cs.getPropertyValue(v));
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
      const tasks = ws.tasks.filter((t) => t.quadrant === q.id);
      count.textContent = String(tasks.length);
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
    if (dropped) task.dropped = true;
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
    const cs = getComputedStyle(note);
    for (const v of NOTE_VARS) note.style.setProperty(v, cs.getPropertyValue(v));
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
    const before = insertionPoint(list, x, y) || $('.empty', list);
    if (drag.placeholder.parentNode !== list || drag.placeholder.nextElementSibling !== before) {
      const was = noteCenters();
      const from = drag.placeholder.parentNode;
      list.insertBefore(drag.placeholder, before);
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

    ws.tasks.splice(ws.tasks.indexOf(task), 1);
    setQuadrant(task, quad.dataset.q);
    const idx = next ? ws.tasks.findIndex((t) => t.id === next.dataset.id) : -1;
    if (idx >= 0) ws.tasks.splice(idx, 0, task); else ws.tasks.push(task);
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
    batchIds = ws.tasks.filter((t) => t.quadrant === 'offload').map((t) => t.id);
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
    try {
      next = normalize(JSON.parse(await file.text()));
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
    next.theme = state.theme; // the theme is a device preference, keep it
    state = next;
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
      const change = area === 'local' && changes[STORAGE_KEY];
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
    });
  }

  // Roll over to the new day if the tab stays open past midnight.
  const refreshDay = () => { if (state && ui.day !== todayStr() && !drag) render(); };
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
    let stored = null;
    try { stored = await store.load(); } catch { /* start fresh below */ }
    try {
      state = stored ? normalize(stored) : defaultState();
    } catch {
      state = defaultState();
    }
    applyTheme();
    render();
    if (!stored || stored.version !== DATA_VERSION) save(); // also persists a migration right away
  })();
})();
