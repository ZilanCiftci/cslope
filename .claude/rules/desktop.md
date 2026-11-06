---
paths:
  - "packages/desktop/**"
---

# The desktop app

- Every change to a screen follows [docs/design-rules.md](../../docs/design-rules.md): theme tokens only, both themes, sentence case, American spelling, 22 px controls, `Menu` for menus, `RecordTable` for lists of records, `ModalFrame` / `ToolWindowFrame` / `WorkspaceWindowFrame` for dialogs. If a rule does not fit, change the rule in the same PR and say why.
- The main window's store (zustand with zundo) is the truth; tool windows sync over IPC. Each user change is one undo step; selection and other UI state is not undone.
- Project files: new fields are optional and read with a normalizer that drops bad values without an error (`store/persistence.ts`); old files must keep opening. A format change updates `docs/file-format.md` and the website's file-format page.
- The result view and the PDF draw the same layers in the same order (`features/canvas/draw.ts`, `features/pdf/*`); line widths and sizes are constants in `features/rendering/style-spec.ts`.
- Tests query by role and name (testing-library), never by class or color.
- Validate: `npx tsc -b --noEmit`, `npx eslint src electron`, `npx vitest run <changed folders>`; the full suite once at the end (`CSLOPE_QUICK_TESTS=1`). See the `verify` skill.
- Look at a changed screen with the design-review runner (`tools/design-review`), light and dark, before calling it done.
