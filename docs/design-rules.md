# Design rules for the app

Short rules for a uniform look and feel in packages/desktop. Follow them for every new dialog, panel, list or control; when a rule and an existing screen disagree, the rule wins and the screen is fixed.

## Voice

- American English, sentence case: "Search limits", "Show in results", "Run all". Never title case in labels, headings, buttons or menus. Text the user typed is shown exactly as typed.
- Short and concrete. A label names the thing ("Tick spacing (m)"), a tooltip says what it does; neither repeats the other.
- Tooltips (`title`) at most about 200 characters; one or two sentences. Longer explanations go to the documentation, linked with a `HelpButton` ("?") next to the group heading, never written out in the UI.
- Units in parentheses in the label: "cx (m)", "q (kPa)", "Unit weight (kN/m³)".
- Errors say what is wrong and what to do, in one sentence each: "No valid slip surface was found. Check the search limits, the geometry and the material strengths."
- No product names of other programs in the UI or the code (`bun packages/website/scripts/check-names.ts --repo`).
- Results use the symbols F, Fm, Ff and λ (not "FOS", "factor of safety" in labels, or "Lambda"): "Critical – F 1.250" (en dash), "F against λ", "σ of F"; CSV headers too.

## Colors and themes

- Only the `--color-vsc-*` tokens from `src/index.css`; never a literal color in a component. Every screen works in both themes (light, dark) without separate code.
- Selected row or item: `--color-vsc-selected-bg` (light blue), everywhere: models, drawings, dialog tables, layer and plane lists; every selected row, not only the active one. The active model is also semibold (`aria-current`); while a drawing is selected, only its row is light blue. Hover: `--color-vsc-list-hover`. `--color-vsc-list-active` is for pressed icon buttons only, never for selection.
- Accent (`--color-vsc-accent`) marks the primary button, a pressed toggle, the active mode and a canvas highlight. Nothing else is blue, and it never marks a status: a running model shows a muted grey spinner.
- Text links ("+ Add …", "Show all", "Documentation") use `--color-vsc-link`, underlined on hover; a row of them is separated by a muted "·".
- Errors `--color-vsc-error`, warnings `--color-vsc-warning` (text in `--color-vsc-warning-text`), success `--color-vsc-success`. A colored text needs 4.5:1 contrast on its background.
- Dialog warnings in a box: a 1 px border and a 10–12 % tint of the status color, text in the normal text color.

## Type and spacing

- Body text 12 px (menus too); labels, table cells, menu headings and secondary text 11 px; section headings 10 px bold uppercase with 0.08 em tracking; tiny helper text 10 px muted.
- Spacing on a 4 px grid: 2, 4, 6, 8, 12, 16. Panel padding 12 px (`p-3`), gaps between fields 8 px, between groups 12 px.
- Corners 2 px on controls, 4 px on panels and rows. No shadows except on floating things (menus, the floating toolbar, banners).
- Controls 22 px high: `.btn`, inputs, selects, and the editors inside table cells (in 24 px rows, the accent border inside the cell). Icon buttons 24 × 24 px with a 12–13 px icon.

## Controls

- Buttons use `.btn`; the default action of a dialog is the one `.btn-primary`, last (rightmost) in `.dialog-buttons`, after "Close" or "Cancel". Status text and secondary actions sit at the left of the row. Buttons never have icons in dialogs.
- Toggles are `.btn` with `aria-pressed`; a group of exclusive choices is a row of such buttons, not radio buttons.
- Numbers go in `DraftNumberInput` or `ExpressionNumericInput` (expressions allowed where the engine allows them). Commit on Enter or blur, Escape reverts.
- Checkboxes for on/off settings whose children appear only when on ("Run strength reduction (FE)" shows its settings when checked). Show/hide of an item in a list is an eye toggle (`aria-pressed`), never a checkbox; "Show all" / "Hide all" are 11 px text links.
- Lists of records (materials, loads, boundaries, planes, reinforcement, custom surfaces) use `RecordTable` (`components/ui/RecordTable.tsx`): 11 px cells in 24 px rows, a selected row in light blue, "+ Add …" text links under the table (one per kind when a list holds several kinds: "+ Add anchor", "+ Add soil nail"), remove as an "×" at the row's end shown on hover, focus or selection. No Add/Delete button column, no type select beside an Add button. Simple records are edited in the cells; complex ones are read-only rows with a detail form below. Where removing is not allowed (the last material, a line's last two points) the × is hidden, not disabled. Other row actions are lucide icon buttons before the ×, shown like it. Selecting a row selects the object on the canvas and the other way round.
- Menus use `Menu` / `MenuItem` (`components/ui/Menu.tsx`) everywhere (context menus, ribbon dropdowns, the run menu, Insert variable, pickers): text only, 12 px, 22 px items, the input background, a 1 px border, 2 px corners and the float shadow; a separator before a destructive item, which is red. No icons in menus (a color swatch or a check mark is content). Disabled items are `aria-disabled` with the reason as their tooltip. Arrows, Home, End, Enter and Escape work; a press outside closes the menu.
- Commands that set up a view stay enabled before there is anything to show, with a hint in the tooltip ("Run the analysis to see the results."). Only commands that need a result (Results plot, Export) are disabled, with the reason as the tooltip.
- A results window exports with one "Export CSV ▾" split button (`CsvExportButton`): decimal point or decimal comma, the last choice remembered for every window.
- Icons from lucide-react only, `strokeWidth` 1.75, monochrome in `--color-vsc-text-muted` (current color when the row is red). Hand-drawn SVG only for the ribbon's domain icons. One icon per concept: settings are the gear (Options, Sheet settings), parameters and variables the Variable icon (x), properties and information the Info icon.
- A color the user picks for the drawing is chosen with `ColorSwatches`, with a "Default" (theme ink) choice, and is drawn as chosen in both themes.
- Destructive actions that cannot be undone (delete a model, remove an attachment) ask with `window.confirm` in one sentence naming the thing. Everything else is an undo step, never a confirmation.

## Dialogs and windows

- Tool dialogs are separate windows (`*DialogApp.tsx`), synced with the main window over IPC; the main window's store is the truth and each change there is an undo step. Layout: `h-screen flex flex-col p-3`; heading 12 px semibold; one muted 11 px sentence under it saying what the dialog is for; the body scrolls; `.dialog-buttons` under a top border.
- Results-related tools (Results plot, Sensitivity, Probabilistic) are windows too, with the same frame (`ToolWindowFrame`). Workspace windows (Place drawing, New models from drawing) use `WorkspaceWindowFrame`: the same heading and sentence, a body edge to edge and a full-width `.dialog-buttons` row.
- Window sizes: one width per family (lists 520 px, forms 760 px, analysis 620 px; workspaces keep their own), opened 760 px high and fitted to the content: lists follow their content, forms are fitted on opening only, analysis windows only grow.
- Dialogs inside the main window (Model properties, About, Save as anonymized, summaries) use `ModalFrame`: the same heading and sentence, a lucide × to close, `.dialog-buttons`, 4 px corners and the float shadow. The app's own information (Help › About) is such a dialog, never a native message box.
- A dialog shows only fields the app uses; a stored value with no function is kept in the file but not shown.
- The properties sidebar holds settings of the selected thing, grouped in `Section`s with the 10 px uppercase heading; a `GroupHeading` with `help` links the documentation. In the result view it is the "Results" panel; its last section is named after the selection ("Sheet", "Text", "Material table", "Slices", …; "Selection" for nothing or a mix) and scrolls into view when something is selected.
- Floating things over the canvas (toolbar, pick-lines bar, error banner) use the sidebar color, a 1 px border, `rounded-xs` and the float shadow (`--color-vsc-shadow-float`); never a saturated background. The result view fits the sheet above the floating toolbar's band (a screen-only reserve; exports are laid out without it).
- An error of a run shows at once as a banner over the canvas in both modes, with a button that leads to the cause when there is one ("Search limits…", "Use left to right"). The banner is the only place with the whole sentence: the status bar says "Analysis failed" (red dot) and the result summary "Analysis failed." with the same button.

## Lists and trees

- The Models panel is a tree: a model row (status dot, box icon, name on at most two lines), its drawings as rows under it (kind icon, name, eye, padlock; on hover a grip and an ×), each row 24 px, indented 43 px. The selected row's settings open below it (no order or remove buttons there); nothing opens in a popup. Delete removes the focused drawing.
- Reorder by drag and drop with a grip shown on hover, and Alt+↑/↓ with the keyboard; a drop indicator line shows the target. Drawings move only within their own model; each drop or keypress is one undo step.
- A row's secondary line is 10 px muted: size, use ("in Model 1, Model 2"), state ("not used").
- Empty states are one muted sentence, no illustration. A section with no items stays visible with its sentence and its "+ Add …" link (Attachments: "No files.").
- Read-only record lists keep one row in the tab order; ↑/↓, Home and End move the selection, Enter or Space selects.

## Canvas

- The model is drawn in the ink color of the theme; the paper is white in the light theme and dark grey (not black) in the dark theme. Result lines are thin (the widths are constants in `features/rendering/style-spec.ts`, shared with the PDF; change them there, never per call; a display layer's style in Results › Layers may override them); the critical surface is the thickest line, slices the thinnest.
- In the dark theme, lines over the soil (critical surface, slices, water, head and reference lines) are drawn in the theme ink everywhere, on a thin halo in the sheet's color (2 px wider; 1 px for slices). The light theme and the PDF have no halo.
- Placed images and PDFs are drawn inverted (with `lighten`) in the dark theme, with an "Invert in dark theme" switch per drawing, on by default. DWG and DXF drawings use the theme's drawing ink.
- Selection on the canvas: the accent color, handles as round accent dots with a ring (8–10 px); locked objects show a padlock on hover. Click selects, then drag moves; nothing moves on the first click.
- Highlights from a window (a slice hovered in the Results plot, a region picked in Assign materials) are an accent fill at 35 % with a 1.5 px accent outline, and vanish when the window closes.
- The result view and the PDF draw the same layers in the same order; what is on screen is what prints. Exceptions for reading on screen: the material table's text is at least 9 px and the color bar's at least 10 px (the PDF keeps their paper size). Tables and plates on the sheet have an opaque fill.

## Accessibility and tests

- Every interactive element has an accessible name (`aria-label` when there is no text); rows that select use `role="treeitem"` / `aria-selected`; read-only record tables `role="grid"` with an `aria-label` and `aria-selected` rows; lists `role="list"` / `listitem`; toggles `aria-pressed`; banners `role="alert"` or `role="status"`.
- Keyboard: Enter commits, Escape cancels or closes, arrow keys move in a list, Tab reaches every control.
- Tests query by role and name, never by class or color; a visual rule (the selected color, the 22 px control) is checked once in a layout test, not in every component.
