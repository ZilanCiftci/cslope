# Lens: design rules

Paths: `packages/desktop/src/**/*.tsx`, `packages/desktop/src/index.css`, `docs/design-rules.md`.

Read [docs/design-rules.md](../../../../docs/design-rules.md) first, then check the change against it:

- Colors only from `--color-vsc-*` tokens (or a user-chosen drawing color); both themes work; selection light blue; accent only where the rules allow.
- Voice: sentence case, American spelling, units in parentheses, F/Fm/Ff/λ in results, error sentences that say what to do.
- Controls: `.btn`, 22 px controls, the primary button last in `.dialog-buttons`, `Menu`/`MenuItem` for menus (no icons), `RecordTable` for lists of records, "+ Add …" links, × on hover, eye toggles for show/hide.
- Dialogs and windows: the right frame (`ToolWindowFrame`, `WorkspaceWindowFrame`, `ModalFrame`), heading and purpose sentence.
- Accessibility: names on interactive elements, roles (`treeitem`, `grid`, `menu`), `aria-pressed` on toggles, keyboard (Enter, Escape, arrows).
- A rule the change breaks on purpose must be changed in docs/design-rules.md in the same PR.
