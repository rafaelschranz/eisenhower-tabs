(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */
  const STORAGE_KEY = 'eisenhower.v1';
  const THEME_KEY = 'eisenhower.theme';
  const TAB_ID = uid();

  const QUADRANTS = [
    { id: 'do', title: 'Do first', empty: 'Nothing on fire. Enjoy the calm ☕' },
    { id: 'schedule', title: 'Schedule', empty: 'Plant something for future you 🌱' },
    { id: 'delegate', title: 'Delegate', empty: 'Nothing to hand off. All clear 🤝' },
    { id: 'eliminate', title: 'Eliminate', empty: 'No distractions parked here ✨' },
  ];
  const Q_IDS = QUADRANTS.map((q) => q.id);
  const Q_TITLE = Object.fromEntries(QUADRANTS.map((q) => [q.id, q.title]));

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
    return { kind: 'later', label: fmtDay(parseDay(due)) };
  }
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
    return { id: uid(), name, emoji, color, tasks: [], done: [] };
  }

  function defaultState() {
    const workspaces = [
      newWorkspace('Work', '💼', WS_COLORS[0]),
      newWorkspace('Studies', '📚', WS_COLORS[2]),
      newWorkspace('Personal', '🏡', WS_COLORS[5]),
    ];
    return { version: 1, theme: null, activeId: workspaces[0].id, workspaces };
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
      const out = {
        id: freshId(t.id),
        title,
        notes: str(t.notes, 20000),
        due: typeof t.due === 'string' && DATE_RE.test(t.due) ? t.due : null,
        quadrant: Q_IDS.includes(t.quadrant) ? t.quadrant : 'do',
        createdAt: num(t.createdAt),
      };
      if (done) out.completedAt = num(t.completedAt);
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
        tasks: list(w.tasks, false),
        done: list(w.done, true),
      }));
    if (!workspaces.length) throw new Error('No workspaces found in this file.');

    return {
      version: 1,
      theme: src.theme === 'dark' || src.theme === 'light' ? src.theme : null,
      activeId: workspaces.some((w) => w.id === src.activeId) ? src.activeId : workspaces[0].id,
      workspaces,
    };
  }

  const activeWs = () => state.workspaces.find((w) => w.id === state.activeId) || state.workspaces[0];

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
    return [q.id, { el, list: $('.note-list', el), count: $('.q-count', el) }];
  }));

  function render() {
    const ws = activeWs();
    state.activeId = ws.id;
    document.documentElement.style.setProperty('--accent', ws.color);
    renderHeader();
    renderTabs();
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
      ? (ws.tasks.length ? 'Nothing to do first. Nice ✨' : 'A clean board. What matters today?')
      : `${first} ${first === 1 ? 'task' : 'tasks'} to do first today`;
    if (overdue) summary.append(h('span', { class: 'overdue', text: ` · ${overdue} overdue` }));
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
    const cls = ['note'];
    if (info && info.kind === 'overdue') cls.push('is-overdue');
    if (t.id === ui.justAdded) cls.push('pop');
    return h('article', {
      class: cls.join(' '), tabIndex: 0, dataset: { id: t.id },
      'aria-label': `${t.title}${info ? `, ${info.label}` : ''}. Press Enter for details.`,
    },
      h('button', { class: 'note-check', type: 'button', title: 'Mark as done', 'aria-label': `Mark “${t.title}” as done` }, icon('check')),
      h('div', { class: 'note-body' },
        h('div', { class: 'note-title', text: t.title }),
        (info || t.notes.trim()) && h('div', { class: 'note-meta' },
          info && h('span', { class: `due due-${info.kind}`, text: info.label }),
          t.notes.trim() && h('span', { class: 'has-notes', title: 'Has notes' }, icon('notes')))));
  }

  function composerEl(q) {
    const input = h('textarea', {
      class: 'composer-input', rows: 2, maxLength: 300,
      placeholder: 'Type a task, press Enter', 'aria-label': `New task in ${Q_TITLE[q]}`,
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

    rendering = true;
    for (const q of QUADRANTS) {
      const { list, count } = quadEls[q.id];
      const tasks = ws.tasks.filter((t) => t.quadrant === q.id);
      count.textContent = String(tasks.length);
      const nodes = tasks.map((t) => noteEl(t, today));
      nodes.push(h('p', { class: 'empty', text: q.empty }));
      if (ui.composer === q.id) nodes.push(composerEl(q.id));
      list.replaceChildren(...nodes);
    }
    rendering = false;

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
      list.replaceChildren(h('li', { class: 'done-empty', text: 'Nothing here yet. Tick off a task and it lands in this pile 🎉' }));
      return;
    }
    list.replaceChildren(...items.map((t) =>
      h('li', { class: 'done-item', dataset: { id: t.id, q: t.quadrant } },
        h('button', { class: 'done-main', type: 'button', title: 'Open details' },
          h('span', { class: 'done-title', text: t.title }),
          h('span', { class: 'done-date', text: `Done ${fmtRelative(t.completedAt)} · ${Q_TITLE[t.quadrant]}` })),
        h('button', { class: 'done-act restore', type: 'button', title: 'Restore to board', 'aria-label': `Restore “${t.title}”` }, icon('restore')),
        h('button', { class: 'done-act del', type: 'button', title: 'Delete permanently', 'aria-label': `Delete “${t.title}” permanently` }, icon('trash')))));
  }

  /* ------------------------------------------------------------------ *
   * Task actions
   * ------------------------------------------------------------------ */
  function addTask(quadrant, title) {
    title = title.trim().slice(0, 300);
    if (!title) return;
    const task = { id: uid(), title, notes: '', due: null, quadrant, createdAt: Date.now() };
    activeWs().tasks.push(task);
    ui.justAdded = task.id;
    commit();
  }

  function completeTask(id) {
    const found = findTask(id);
    if (!found || found.done) return;
    flyToDone(found.ws.id === state.activeId ? noteById(id) : null);
    snapshot();
    const { ws, task } = found;
    ws.tasks.splice(ws.tasks.indexOf(task), 1);
    task.completedAt = Date.now();
    ws.done.push(task);
    commit();
    toast('Nice one! Task done 🎉', { undoable: true });
  }

  function restoreTask(id) {
    const found = findTask(id);
    if (!found || !found.done) return;
    snapshot();
    const { ws, task } = found;
    ws.done.splice(ws.done.indexOf(task), 1);
    delete task.completedAt;
    ws.tasks.push(task);
    ui.justAdded = task.id;
    commit();
    toast(`Restored to ${Q_TITLE[task.quadrant]}`, { undoable: true });
  }

  function deleteTask(id) {
    const found = findTask(id);
    if (!found) return;
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

  /* Completion animation: the note flies into the Done button. */
  const doneToggle = $('#done-toggle');
  function bumpDone() {
    doneToggle.classList.remove('bump');
    void doneToggle.offsetWidth;
    doneToggle.classList.add('bump');
  }
  function flyToDone(note) {
    if (!note || reducedMotion()) { bumpDone(); return; }
    const from = note.getBoundingClientRect();
    const to = doneToggle.getBoundingClientRect();
    const fly = note.cloneNode(true);
    fly.className = 'note flyer';
    fly.removeAttribute('tabindex');
    fly.dataset.q = note.closest('.quadrant').dataset.q;
    Object.assign(fly.style, {
      left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    });
    document.body.append(fly);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const anim = fly.animate([
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'translate(0, -8px) scale(1.1) rotate(-4deg)', opacity: 1, offset: 0.3 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.1) rotate(16deg)`, opacity: 0.2 },
    ], { duration: 640, easing: 'cubic-bezier(0.5, 0, 0.2, 1)' });
    const finish = () => { fly.remove(); bumpDone(); };
    anim.onfinish = finish;
    anim.oncancel = finish;
  }

  /* ------------------------------------------------------------------ *
   * Board interactions: click, keyboard, drag & drop
   * ------------------------------------------------------------------ */
  board.addEventListener('click', (e) => {
    const check = e.target.closest('.note-check');
    if (check) { completeTask(check.closest('.note').dataset.id); return; }
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
    if (!note || e.target.closest('.note-check')) return;
    drag = { id: note.dataset.id, note, x0: e.clientX, y0: e.clientY, active: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', cancelDrag);
  });

  function startDrag() {
    let { note } = drag;
    if (!note.isConnected) note = drag.note = noteById(drag.id); // board re-rendered since pointerdown
    if (!note) { cancelDrag(); return false; }
    const r = note.getBoundingClientRect();
    drag.placeholder = h('div', { class: 'note-placeholder' });
    drag.placeholder.style.height = `${r.height}px`;
    note.before(drag.placeholder);
    note.dataset.q = note.closest('.quadrant').dataset.q; // keep its colour once it leaves the quadrant
    Object.assign(note.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    note.classList.add('dragging');
    document.body.append(note);
    document.body.classList.add('is-dragging');
    drag.active = true;
    return true;
  }

  /** Which note should the placeholder be inserted before? (null = end) */
  function insertionPoint(list, x, y) {
    for (const n of $$('.note', list)) {
      const r = n.getBoundingClientRect();
      if (y < r.top - 5) return n;
      if (y <= r.bottom + 5 && x < r.left + r.width / 2) return n;
    }
    return null;
  }

  function onDragMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 6 || !startDrag()) return;
    }
    drag.note.style.transform = `translate(${dx}px, ${dy}px) rotate(2.5deg) scale(1.05)`;

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const tab = under && under.closest('.ws-tab');
    const quad = under && under.closest('.quadrant');

    for (const el of $$('.ws-tab.drop')) el.classList.remove('drop');
    for (const el of $$('.quadrant.drop-target')) el.classList.remove('drop-target');
    drag.tabId = null;

    if (tab && tab.dataset.id !== state.activeId) {
      tab.classList.add('drop');
      drag.tabId = tab.dataset.id;
      drag.placeholder.classList.add('off');
      return;
    }
    drag.placeholder.classList.remove('off');
    if (!quad) return;

    quad.classList.add('drop-target');
    const list = $('.note-list', quad);
    const lr = list.getBoundingClientRect();
    if (e.clientY < lr.top + 30) list.scrollTop -= 14;
    else if (e.clientY > lr.bottom - 30) list.scrollTop += 14;

    const before = insertionPoint(list, e.clientX, e.clientY) || $('.empty', list);
    if (drag.placeholder.parentNode !== list || drag.placeholder.nextElementSibling !== before) {
      list.insertBefore(drag.placeholder, before);
    }
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
    task.quadrant = quad.dataset.q;
    const idx = next ? ws.tasks.findIndex((t) => t.id === next.dataset.id) : -1;
    if (idx >= 0) ws.tasks.splice(idx, 0, task); else ws.tasks.push(task);
    commit();

    // Settle the note into its new slot.
    const el = noteById(d.id);
    if (el && !reducedMotion()) {
      const to = el.getBoundingClientRect();
      el.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) rotate(2.5deg) scale(1.05)` },
        { transform: 'none' },
      ], { duration: 200, easing: 'cubic-bezier(0.3, 1.2, 0.5, 1)' });
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
    if (e.target.name !== 'quick-q') return;
    $('#q-pick-label').textContent = Q_TITLE[e.target.value];
    quickInput.focus();
  });

  /* ------------------------------------------------------------------ *
   * Task detail dialog
   * ------------------------------------------------------------------ */
  const detail = $('#detail');
  const dTitle = $('#d-title');
  const dNotes = $('#d-notes');
  const dDue = $('#d-due');
  const dDone = $('#d-done');
  const dWs = $('#d-ws');

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  function openDetail(id) {
    const found = findTask(id);
    if (!found) return;
    const { ws, task, done } = found;
    ui.detailId = id;
    detail.dataset.q = task.quadrant;
    dTitle.value = task.title;
    dNotes.value = task.notes;
    dDue.value = task.due || '';
    dDone.checked = done;
    $('#d-due-clear').hidden = !task.due;
    for (const r of $$('input[name="d-q"]', detail)) r.checked = r.value === task.quadrant;
    dWs.replaceChildren(...state.workspaces.map((w) => h('option', { value: w.id, text: `${w.emoji} ${w.name}`, selected: w.id === ws.id })));
    $('#d-ws-field').hidden = state.workspaces.length < 2;
    $('#d-meta').textContent = done
      ? `Completed ${fmtRelative(task.completedAt)}`
      : `Added ${fmtRelative(task.createdAt)}`;
    if (!detail.open) detail.showModal();
    autoGrow(dTitle);
    (task.title ? $('.btn.primary', detail) : dTitle).focus();
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
  dNotes.addEventListener('input', () => editDetail((t) => { t.notes = dNotes.value; }));
  dDue.addEventListener('input', () => {
    const v = DATE_RE.test(dDue.value) ? dDue.value : null;
    $('#d-due-clear').hidden = !v;
    editDetail((t) => { t.due = v; });
  });
  $('#d-due-clear').addEventListener('click', () => {
    dDue.value = '';
    $('#d-due-clear').hidden = true;
    editDetail((t) => { t.due = null; });
  });
  detail.addEventListener('change', (e) => {
    if (e.target.name !== 'd-q') return;
    detail.dataset.q = e.target.value;
    editDetail((t) => { t.quadrant = e.target.value; });
  });
  dWs.addEventListener('change', () => {
    const id = ui.detailId;
    detail.close();
    moveTaskToWorkspace(id, dWs.value);
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
  detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); }); // backdrop
  detail.addEventListener('close', () => {
    const id = ui.detailId;
    ui.detailId = null;
    flush();
    const el = id && noteById(id);
    if (el) el.focus({ preventScroll: true });
  });

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
  wsDialog.addEventListener('close', () => { ui.wsEditId = null; flush(); });

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
      format: 1,
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
    if (!stored) save();
  })();
})();
