# Decisions

A log of the decisions behind cSlope's behavior and look, newest first, so that later work knows why something is the way it is. One entry per decision: the date, what was decided, the alternatives that were turned down, and where it is implemented. The rules that follow from them live in [docs/design-rules.md](docs/design-rules.md) and [CLAUDE.md](CLAUDE.md); this file keeps the reasons.

Add an entry when the maintainer chooses between options (an issue labeled `needs-decision`, a design review), in the same PR as the change.

## Process

### 2026-11-06: Work flows through issues and sprints

Bugs and wishes are GitHub issues; the maintainer picks a sprint's issues (`sprint: <n>` label); agents build them in groups, one PR per group, which merge on their own after the verify gate and CI. See [.claude/workflow.md](.claude/workflow.md). While in beta, fixes merge without a human review; **revisit before the first non-beta release** (then PRs wait for approval).

### 2026-11-06: The website deploys on every merge to main

Vercel builds only main; "skip deployments when there are no changes" is off, because the site reads files outside its folder (CHANGELOG.md, the app's version). Vercel does not comment on pull requests.

### 2026-11: Pull requests with auto-merge; main protected

Every change goes through a PR with auto-merge (squash); main requires the `check` and `desktop` checks and an up-to-date branch, no approvals. The repository is LF throughout (`.gitattributes`).

## Design review (2026-11-05), decisions D-01–D-22

The review is in `packages/desktop/tools/design-review`; each decision had two options with mockups. Chosen options:

| Id | Decision | Chosen | Turned down |
|---|---|---|---|
| D-01 | Selection in the Models tree | All selected rows light blue, active model semibold, running model a grey spinner | A 1 px accent frame on the active model |
| D-02 | Menus | One `Menu`/`MenuItem`, 12 px, no icons | Optional icons per menu |
| D-03 | Lists of records in windows | One `RecordTable`: editable cells (22 px editor in a 24 px row) or read-only rows with a detail form | Keep the components, shared cell style, a toolbar above |
| D-04 | Frames of the drawing windows | The standard frame: heading and sentence, workspace, full-width `.dialog-buttons` | A documented exception with buttons in the side panel |
| D-05 | The error after a failed run | The whole sentence only in the banner; "Analysis failed" in the status bar and the summary | Only the banner |
| D-06 | The "…" convention (decided 2026-11-06, issue #39) | D: "…" only on a command that asks for something before it acts (a file, a file name, a calibration, lines to pick), in menus, small ribbon buttons and tooltips; a command that shows a window has none; large ribbon buttons never (their menu items or tooltip carry it); otherwise only for truncated text | A ("…" on every command that opens a window, from menus and small buttons) and B (the same everywhere): "…" would mark most of the ribbon and stop meaning anything; C (menus only): the ribbon and the menus would follow different conventions |
| D-07 | Icons | One per concept: settings the gear, parameters Variable, properties Info | Keep the slider icon for Parameters |
| D-08 | Placed drawings in the dark theme | Inverted, with an "Invert in dark theme" switch per drawing | A multiply/darken blend |
| D-09 | Selection handles on the canvas | Keep round handles (accent dot with a ring, 8–10 px); the rule changed | 6–7 px squares |
| D-10 | Material table and color bar on the sheet | B: keep the position, opaque fill, a minimum text size on screen | Move them to free paper space, text in points |
| D-11 | The result sidebar | Panel "Results"; the last section named after the selection, scrolled into view | Keep "Properties", a "Selection · Text" section |
| D-12 | About | B: a dialog in the window (`ModalFrame`) | The system message box |
| D-13 | Window sizes | Height fitted to the content on opening, one width per family | Smaller fixed sizes, remembered by the user |
| D-14 | Wording in the result windows | F, Fm, Ff and λ throughout, "F against λ" | "Factor of safety" written out |
| D-15 | The Results tab before a run | Commands stay enabled, with a hint | Disable Display and Annotations |
| D-16 | Attachments without files | Shown, with "No files." and "+ Add drawing…" | Hidden until the first drawing |
| D-17 | The layer list of a DWG drawing | An eye per layer; Show all / Hide all as text links | Checkboxes |
| D-18 | Result lines in the dark theme | The theme ink everywhere with a thin halo | Contrast-adapted colors |
| D-19 | Order and removal of drawings | Grip and × on the row on hover, Alt+↑/↓ | Buttons in the settings box |
| D-20 | The floating toolbar over the sheet's x-axis | A screen-only band reserved below the sheet | Dock the toolbar under the canvas |
| D-21 | Canvas width/height in Model properties | Removed from the dialog (kept in the file) | Give them a function |
| D-22 | CSV export | B: one split button "Export CSV ▾", decimal point or comma, remembered | The separator chosen as a file type in the save dialog |

Implemented in PRs #28–#30, #32–#35 and #37.

## Engine

### 2026-11: A slip surface may not leave through the model's side

With "Both" directions and no search limits, a surface could exit through a vertical side of the model. `VERTICAL_SIDE_SLOPE` in `geometry_ops.rs` rejects it; the verification results did not move.
