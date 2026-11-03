# Design capture

Screenshots of the real desktop app for a design review or before a beta
test: the File menu with its Import and Export submenus, imports of .stix,
.slim, .gsz and DXF files with their summaries, exports, Define materials for
every material model (SHANSEP with an imported earlier stage and POP, the
imported-data notices, Remove and undo), Piezometric lines with the head-line
notice, Options (seismic, rapid drawdown), Distributed loads, Line loads, the
edit and result views and the PDF pages. It is not part of the build or the
tests.

```
# from the repository root; in a container as root, under a virtual display
CSLOPE_CAPTURE_NO_SANDBOX=1 xvfb-run -a -s "-screen 0 1920x1200x24" bun packages/desktop/tools/design-capture/capture.ts /tmp/design-capture
```

It builds the renderer with `VITE_CAPTURE_MODE=1` (about 20 s), starts
Electron with `CSLOPE_CAPTURE=1` and remote debugging, drives it with
Playwright over CDP and takes about 6 minutes. Open `index.html` in the
output folder: the contact sheet, by section, with notes and the log.

The output folder (default: `cslope-design-capture` in the system temp
folder) gets:

- `img/`: the screenshots (main window 1600 × 1000; dialog windows grown to
  show all their content) and the PDF pages (`pdftoppm`, from poppler-utils);
- `text/`: the summaries of the imports and exports;
- `exports/`: the exported .gsz, .stix and .slim files and the PDF, caught in
  the renderer instead of a save dialog;
- `files/`: the files it imported.

Options: `DESIGN_CAPTURE_SKIP_BUILD=1` reuses the last build in
`packages/desktop/dist`; `DESIGN_CAPTURE_PORT` sets the debugging port
(default 9334). Without a sandbox problem (not root), leave out
`CSLOPE_CAPTURE_NO_SANDBOX`.

## What it checks on the way

Besides the images it records, as notes on the contact sheet:

- each feature model of `models.ts` run on its circle in the app, its factor
  of safety against the engine's (`MISMATCH` when they differ);
- each model saved and opened again (the project file), its factor of
  safety before and after;
- whether Ctrl+Z brings back a removed earlier stage and removed head lines;
- whether the Options window shows seismic and rapid drawdown.

## Robustness

Elements are found by role, accessible name, title or label text (ribbon
buttons, menu items, the summary dialog, `role="note"` notices), dialog
windows by their URL hash. A dialog whose ribbon button is not found is
opened through the preload API (`window.cslope.open…Dialog`). A step that
fails is logged and shown in red on the contact sheet; the run goes on. A
native message box (`alert`) is captured from the X screen with ImageMagick
`import` and accepted.

## Beta checklist

`beta-checklist.ts` runs the manual beta checklist in the app: open, save
and reopen (also after a restart), every import and export through the
File menu, the dialog edits with Ctrl+Z, runs, the PDF, search, drag and
drop, the dark theme, a decimal comma in a Swedish and an English locale
and display scaling. It starts the app through Playwright's Electron
launcher so that the main process's open, save and message dialogs are
answered by the test and downloads are saved (or cancelled) in the output
folder, and checks each factor of safety as the status bar shows it.

```
CSLOPE_CAPTURE_NO_SANDBOX=1 xvfb-run -a -s "-screen 0 1920x1200x24" bun packages/desktop/tools/design-capture/beta-checklist.ts <output folder> <beta-test folder>
```

The beta-test folder holds `files/` (the projects and their exports),
`expected.json` and `variants.json`. It writes `results.md` and
`index.html`; about 10 minutes. `BETA_PARTS=A,B,C` picks parts,
`BETA_START_AT=<step id>` skips the steps before one.

## Files

- `capture.ts`: the steps.
- `lib.ts`: launch, windows, screenshots, downloads.
- `models.ts`: the prepared models (one per feature, each with a fixed circle,
  and one that combines them), also used for the beta-test files.
- `contact-sheet.ts`: `index.html`.
