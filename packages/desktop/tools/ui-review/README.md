# UI review captures

Playwright scripts that open every ribbon tab, dialog window, popup panel and
context menu of the built app and save screenshots, for a manual UI/UX review.
They are not part of the build or the tests.

```
# from the repository root; build once in capture mode
cd packages/desktop && VITE_CAPTURE_MODE=1 bunx vite build && cd ../..
# in a container, under a virtual display
xvfb-run -a -s "-screen 0 1920x1200x24" bun packages/desktop/tools/ui-review/capture1.ts
```

- `capture1.ts`: ribbon tabs, the 14 dialog windows (empty), results popups, run menu, explorer menu.
- `capture2.ts`: dialogs filled through their own add buttons, every material model, long names, canvas clicks, results view.
- `capture3.ts`: context menus on a clean model, model properties, new project, failed and running analyses.
- `capture4.ts`: Escape on modals, rename, the error message, 1024 and 1920 px windows, dark theme, keyboard focus, tooltips.

Images go to `$UI_OUT` (default: `cslope-ui-review` in the system temp folder).
`helpers.ts` also reports inputs and selects whose text is wider than the box.
