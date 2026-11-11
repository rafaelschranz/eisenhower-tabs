# Eisenhower Tabs

A Chrome extension that replaces the new tab page with a personal priority whiteboard, laid out as an Eisenhower matrix. Every new tab shows what you should be working on.

Everything runs locally: no backend, no network requests, no tracking. The only permission is `storage`.

## Install (unpacked)

1. Download or clone this folder to a permanent location on your laptop.
2. Open `chrome://extensions` in Chrome.
3. Switch on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
5. Open a new tab. If Chrome asks whether to keep the new tab page changed by the extension, choose **Keep it**.

To update after changing files, click the reload icon on the extension's card in `chrome://extensions`.

## Using it

**Tasks**

- Type in the quick-add field and press Enter. The coloured squares next to it choose the quadrant.
- Or click **+** in a quadrant and type; Enter adds the note and keeps the composer open for the next one.
- Drag notes to reorder them or to move them to another quadrant. Drop a note on a workspace tab to move it there.
- Click a note for details: title, notes, due date, quadrant, workspace, done.
- Tick the circle on a note to complete it. It flies into the **Done** pile.
- Overdue notes get a red outline, notes due today get a "Today" badge.
- Deleting, completing, moving and clearing all offer **Undo** for a few seconds.

**Done pile**

Click **Done** in the header. Completed tasks are listed newest first, and can be restored, deleted permanently, or cleared all at once. Each workspace has its own pile.

**Workspaces**

- Click a tab to switch; a new tab always opens the workspace you used last.
- **+** creates a workspace. The **⋯** on the active tab (or a double-click) opens its name, emoji, accent colour, position and delete.
- Drag tabs sideways to reorder them.

**Backup**

The **⋯** menu in the header has **Export backup** (downloads all workspaces, tasks and done piles as one JSON file) and **Import backup** (replaces current data after a confirmation).

**Keyboard shortcuts**

| Key | Action |
| --- | --- |
| `N` | New task (focus quick add) |
| `D` | Open or close the done pile |
| `[` / `]` | Previous / next workspace |
| `Enter` on a focused note | Open details |
| `Delete` on a focused note | Delete it |
| `Ctrl`/`Cmd` + `Z` | Undo the last delete, completion or move |
| `Esc` | Close the detail view, menu or done pile |

Chrome puts the cursor in the address bar on a new tab, so click the page (or press Tab) once before using single-key shortcuts.

## Where the data lives

All data is stored in `chrome.storage.local` under the key `eisenhower.v1` and saved on every change. It stays in your Chrome profile on this machine and is not synced.

Removing the extension deletes its data, so export a backup first. Chrome also ties an unpacked extension's data to its folder path: if you move the folder and load it again, it starts empty, and you can bring your tasks back with Import.

## Files

```
manifest.json     Manifest V3, new tab override, storage permission
newtab.html       Page markup
css/styles.css    Styles, light and dark themes
js/theme.js       Applies the theme before first paint
js/app.js         App logic (state, rendering, drag and drop, storage)
icons/            Extension icons
```

No build step and no dependencies.
