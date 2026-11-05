# Design rules for the app

Short rules for a uniform look and feel in packages/desktop. Follow them for every new dialog, panel, list or control; when a rule and an existing screen disagree, the rule wins and the screen is fixed.

## Voice

- American English, sentence case: "Search limits", "Show in results", "Run all". Never title case in labels, headings, buttons or menus. Text the user typed is shown exactly as typed.
- Short and concrete. A label names the thing ("Tick spacing (m)"), a tooltip says what it does; neither repeats the other.
- Tooltips (`title`) at most about 200 characters; one or two sentences. Longer explanations go to the documentation, linked with a `HelpButton` ("?") next to the group heading, never written out in the UI.
- Units in parentheses in the label: "cx (m)", "q (kPa)", "Unit weight (kN/m³)".
- Errors say what is wrong and what to do, in one sentence each: "No valid slip surface was found. Check the search limits, the geometry and the material strengths."
- No product names of other programs in the UI or the code (`bun packages/website/scripts/check-names.ts --repo`).

## Colors and themes

- Only the `--color-vsc-*` tokens from `src/index.css`; never a literal color in a component. Every screen works in both themes (light, dark) without separate code.
- Selected row or item: `--color-vsc-selected-bg` (light blue), everywhere: models, drawings, dialog tables, layer and plane lists. Hover: `--color-vsc-list-hover`. `--color-vsc-list-active` is for pressed icon buttons only, never for selection.
- Accent (`--color-vsc-accent`) marks the primary button, a pressed toggle, the active mode and a canvas highlight. Nothing else is blue.
- Errors `--color-vsc-error`, warnings `--color-vsc-warning` (text in `--color-vsc-warning-text`), success `--color-vsc-success`. A colored text needs 4.5:1 contrast on its background.
- Dialog warnings in a box: a 1 px border and a 10–12 % tint of the status color, text in the normal text color.

## Type and spacing

- Body text 12 px; labels, table cells and secondary text 11 px; section headings 10 px bold uppercase with 0.08 em tracking; tiny helper text 10 px muted.
- Spacing on a 4 px grid: 2, 4, 6, 8, 12, 16. Panel padding 12 px (`p-3`), gaps between fields 8 px, between groups 12 px.
- Corners 2 px on controls, 4 px on panels and rows. No shadows except on floating things (menus, the floating toolbar, banners).
- Controls 22 px high: `.btn`, inputs, selects. Icon buttons 24 × 24 px with a 12–13 px icon.

## Controls

- Buttons use `.btn`; the default action of a dialog is the one `.btn-primary`, right-aligned in `.dialog-buttons` with "Close" (or "OK" / "Cancel" when the dialog has a pending change). Buttons never have icons in dialogs.
- Toggles are `.btn` with `aria-pressed`; a group of exclusive choices is a row of such buttons, not radio buttons.
- Numbers go in `DraftNumberInput` or `ExpressionNumericInput` (expressions allowed where the engine allows them). Commit on Enter or blur, Escape reverts.
- Checkboxes for on/off settings whose children appear only when on ("Run strength reduction (FE)" shows its settings when checked).
- Lists of records (materials, loads, boundaries, planes) are table views: one row per record, a selected row in light blue, add buttons as "+ Add …" text links under the table, remove as an "×" icon at the row's end on hover. Selecting a row selects the object on the canvas and the other way round.
- Icons from lucide-react only, `strokeWidth` 1.75, monochrome in `--color-vsc-text-muted` (current color when the row is red). Hand-drawn SVG only for the ribbon's domain icons.
- Destructive actions that cannot be undone (delete a model, remove an attachment) ask with `window.confirm` in one sentence naming the thing. Everything else is an undo step, never a confirmation.

## Dialogs and windows

- Tool dialogs are separate windows (`*DialogApp.tsx`), synced with the main window over IPC; the main window's store is the truth and each change there is an undo step. Layout: `h-screen flex flex-col p-3`; heading 12 px semibold; one muted 11 px sentence under it saying what the dialog is for; the body scrolls; `.dialog-buttons` under a top border.
- Results-related tools (Results plot, Sensitivity, Probabilistic) are windows too, with the same frame (`ToolWindowFrame`).
- The properties sidebar holds settings of the selected thing, grouped in `Section`s with the 10 px uppercase heading; a `GroupHeading` with `help` links the documentation.
- Floating things over the canvas (toolbar, pick-lines bar, error banner) use the sidebar color, a 1 px border, `rounded-xs` and `shadow-md`; never a saturated background.
- An error of a run shows at once as a banner over the canvas in both modes, with a button that leads to the cause when there is one ("Search limits…", "Use left to right").

## Lists and trees

- The Models panel is a tree: a model row (status dot, box icon, name on at most two lines), its drawings as rows under it (kind icon, name, eye, padlock), each row 24 px, indented 43 px. The selected row's settings open below it; nothing opens in a popup.
- Reorder by drag and drop with a grip shown on hover, and Alt+↑/↓ with the keyboard; a drop indicator line shows the target.
- A row's secondary line is 10 px muted: size, use ("in Model 1, Model 2"), state ("not used").
- Empty states are one muted sentence, no illustration.

## Canvas

- The model is drawn in the ink color of the theme; the paper is white in the light theme and dark grey (not black) in the dark theme. Result lines are thin (the widths are constants in `features/canvas/draw.ts`; change them there, never per call); the critical surface is the thickest line, slices the thinnest.
- Selection on the canvas: the accent color, handles as 6 px squares; locked objects show a padlock on hover. Click selects, then drag moves; nothing moves on the first click.
- Highlights from a window (a slice hovered in the Results plot, a region picked in Assign materials) are an accent fill at 35 % with a 1.5 px accent outline, and vanish when the window closes.
- The result view and the PDF draw the same layers in the same order; what is on screen is what prints.

## Accessibility and tests

- Every interactive element has an accessible name (`aria-label` when there is no text); rows that select use `role="treeitem"` / `aria-selected`; lists `role="list"` / `listitem`; toggles `aria-pressed`; banners `role="alert"` or `role="status"`.
- Keyboard: Enter commits, Escape cancels or closes, arrow keys move in a list, Tab reaches every control.
- Tests query by role and name, never by class or color; a visual rule (the selected color, the 22 px control) is checked once in a layout test, not in every component.
