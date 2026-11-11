# Eisenhower Tabs

A Chrome extension that replaces the new tab page with a personal priority whiteboard, laid out as an Eisenhower matrix. Every new tab shows what you should be working on.

Your tasks stay on this device: no backend, no tracking, and the only required permission is `storage`. The one optional network feature is the weather in the greeting, which is off until you switch it on (see below).

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
- Each quadrant sorts its notes by date: overdue first (oldest first), then by due date, then notes without a date in the order they were added.
- Drag a note to a new place inside its quadrant and that quadrant keeps your order instead. A **Manual order ✕** chip appears in its header; click it to sort by date again.
- Drag a note to another quadrant to move it. If that quadrant sorts by date, the note lands in its date position (the placeholder shows where); if it is in manual order, it lands where you drop it. Drop a note on a workspace tab to move it there.
- All notes have the same size. A quadrant with more notes than fit scrolls, with a fade and a "+N more" chip at the bottom.
- Click a note for details: title, notes, due date, quadrant, workspace, done. The due date opens a picker with quick options (Today, Tomorrow, Next Monday, In a week, No date) and a calendar; arrow keys move through the days.
- Hover a note (or focus it with the keyboard) and tick the circle to complete it. It flies into the **Done** pile.
- Date badges: overdue is a soft red pill, today a tinted pill, tomorrow and the week after it show the weekday ("Thu 19 Nov"), later dates show just the date.
- Deleting, completing, moving and clearing all offer **Undo** for a few seconds.

**Done pile**

Click **Done** in the header. Completed tasks are listed newest first, and can be restored, deleted permanently, or cleared all at once. Each workspace has its own pile.

**Insights**

Click **Insights** in the header (or press `I`) for a full-screen view of what you completed: this week against last week, your current streak, your most productive weekday, the average time from adding a task to finishing it, a calendar of completions per day, completions by weekday and by hour, and the share per quadrant. Filter by workspace and by range (7 days, 30 days, 6 months, 1 year). Click a day in the calendar to see what you finished that day, or open the **History** tab for the full list. `Esc` or **Board** takes you back.

Insights is built from a completion log that is kept separately from the done piles: clearing a done pile or deleting done tasks does not change your statistics, restoring a task removes its entry, and tasks dropped in Review are not counted. **Settings → Reset statistics** clears the log.

**Weather in the greeting (optional)**

Open the **⋯** menu, choose **Settings…** and switch on **Show the weather in the greeting**. Chrome then asks for permission to contact two hosts, `geocoding-api.open-meteo.com` (place search) and `api.open-meteo.com` (weather). Search for a town and pick it; the greeting then shows the current weather and temperature there ("Good afternoon 🌧️ 8°"). Hover it for the place, the condition, the time of the last update and the attribution.

- Your browser location is never used; only the place you pick is sent to Open-Meteo.
- The last reading is stored and shown immediately on every new tab, and refreshed in the background when it is older than 30 minutes. Without a connection the last reading stays.
- If you decline the permission or switch the weather off, the greeting shows its usual time-of-day emoji and nothing is requested. Switching it off also hands the permission back.
- Weather data by [Open-Meteo.com](https://open-meteo.com/).

**Workspaces**

- Click a tab to switch; a new tab always opens the workspace you used last.
- **+** creates a workspace. The **⋯** on the active tab (or a double-click) opens its name, emoji, accent colour, quadrant names, position and delete.
- Drag tabs sideways to reorder them.

**Backup**

The **⋯** menu in the header has **Export backup** (downloads all workspaces, tasks, done piles, sort orders and the completion log as one JSON file) and **Import backup** (replaces current data after a confirmation).

**Keyboard shortcuts**

| Key | Action |
| --- | --- |
| `N` | New task (focus quick add) |
| `Tab` / `Alt`+`1`–`4` while typing a task | Change the target quadrant |
| `D` | Open or close the done pile |
| `I` | Open Insights |
| `[` / `]` | Previous / next workspace |
| `Enter` on a focused note | Open details |
| `Delete` on a focused note | Delete it |
| `Ctrl`/`Cmd` + `Z` | Undo the last delete, completion or move |
| `Esc` | Close the detail view, Insights, Batch or Review mode, menu or done pile |

Chrome puts the cursor in the address bar on a new tab, so click the page (or press Tab) once before using single-key shortcuts.

## Where the data lives

All data is stored in `chrome.storage.local` and saved on every change: boards and settings under `eisenhower.v1`, the completion log under `eisenhower.log.v1`, and the last weather reading under `eisenhower.weather.v1`. It stays in your Chrome profile on this machine and is not synced.

Data saved by earlier versions is converted when it is loaded, and older JSON backups can still be imported. The first time this version runs, the completion log is filled from the tasks already in your done piles; a backup without a log gets one the same way.

Removing the extension deletes its data, so export a backup first. Chrome also ties an unpacked extension's data to its folder path: if you move the folder and load it again, it starts empty, and you can bring your tasks back with Import.

## Files

```
manifest.json     Manifest V3, new tab override, storage permission, optional Open-Meteo hosts
newtab.html       Page markup
css/styles.css    Styles, light and dark themes
js/theme.js       Applies the theme before first paint
js/app.js         App logic (state, rendering, drag and drop, storage, Insights charts, weather)
icons/            Extension icons
fonts/            Bundled fonts and their licences
```

No build step and no dependencies.

## Fonts

The extension bundles the latin subsets of two variable fonts, both under the SIL Open Font License 1.1 (licence texts in `fonts/`):

- Bricolage Grotesque, © The Bricolage Grotesque Project Authors
- DM Sans, © The DM Sans Project Authors

The files come from the `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/dm-sans` npm packages (version 5.3.0). To swap fonts, replace the files and edit `--font-display` and `--font-body` at the top of `css/styles.css`.
