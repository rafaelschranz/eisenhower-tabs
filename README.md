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

**The four quadrants**

| | Urgent | Not urgent |
| --- | --- | --- |
| **Important** | **Do first** | **Plan ahead**: notes without a date show a "When?" hint; click it to pick one |
| **Not important** | **Get off the plate**: handle it quickly, in one go. **Batch them** opens just these tasks with large checkboxes | **Review**: decide later. Notes fade after 14 days; **Review** walks through them one at a time: keep, move or drop |

Dropped tasks go to the done pile marked "Dropped" and can be restored. You can rename the quadrants per workspace in the workspace menu ("Reset to defaults" brings the names back).

**Tasks**

- Type in the quick-add field and press Enter. The picker next to it chooses the quadrant; while typing, `Tab` cycles through the quadrants and `Alt`+`1`–`4` picks one directly. Focus stays in the field for the next task.
- Or click **+** in a quadrant and type; Enter adds the note and keeps the composer open for the next one.
- Drag notes to reorder them or to move them to another quadrant. Drop a note on a workspace tab to move it there.
- Click a note for details: title, notes, due date, quadrant, workspace, done.
- Hover a note (or focus it with the keyboard) and tick the circle to complete it. It flies into the **Done** pile.
- Overdue notes show a red "Overdue" badge, notes due today a tinted "Today" badge.
- Deleting, completing, moving and clearing all offer **Undo** for a few seconds.

**Done pile**

Click **Done** in the header. Completed tasks are listed newest first, and can be restored, deleted permanently, or cleared all at once. Each workspace has its own pile.

**Workspaces**

- Click a tab to switch; a new tab always opens the workspace you used last.
- **+** creates a workspace. The **⋯** on the active tab (or a double-click) opens its name, emoji, accent colour, quadrant names, position and delete.
- Drag tabs sideways to reorder them.

**Backup**

The **⋯** menu in the header has **Export backup** (downloads all workspaces, tasks and done piles as one JSON file) and **Import backup** (replaces current data after a confirmation).

**Keyboard shortcuts**

| Key | Action |
| --- | --- |
| `N` | New task (focus quick add) |
| `Tab` / `Alt`+`1`–`4` while typing a task | Change the target quadrant |
| `D` | Open or close the done pile |
| `[` / `]` | Previous / next workspace |
| `Enter` on a focused note | Open details |
| `Delete` on a focused note | Delete it |
| `Ctrl`/`Cmd` + `Z` | Undo the last delete, completion or move |
| `Esc` | Close the detail view, Batch or Review mode, menu or done pile |

Chrome puts the cursor in the address bar on a new tab, so click the page (or press Tab) once before using single-key shortcuts.

## Where the data lives

All data is stored in `chrome.storage.local` under the key `eisenhower.v1` and saved on every change. It stays in your Chrome profile on this machine and is not synced.

Data saved by earlier versions (with the Schedule, Delegate and Eliminate quadrants) is converted when it is loaded, and older JSON backups can still be imported.

Removing the extension deletes its data, so export a backup first. Chrome also ties an unpacked extension's data to its folder path: if you move the folder and load it again, it starts empty, and you can bring your tasks back with Import.

## Files

```
manifest.json     Manifest V3, new tab override, storage permission
newtab.html       Page markup
css/styles.css    Styles, light and dark themes
js/theme.js       Applies the theme before first paint
js/app.js         App logic (state, rendering, drag and drop, storage)
icons/            Extension icons
fonts/            Bundled fonts and their licences
```

No build step and no dependencies.

## Fonts

The extension bundles the latin subsets of two variable fonts, both under the SIL Open Font License 1.1 (licence texts in `fonts/`):

- Bricolage Grotesque, © The Bricolage Grotesque Project Authors
- DM Sans, © The DM Sans Project Authors

The files come from the `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/dm-sans` npm packages (version 5.3.0). To swap fonts, replace the files and edit `--font-display` and `--font-body` at the top of `css/styles.css`.
