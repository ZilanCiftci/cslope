# Lens: desktop app

Paths: `packages/desktop/**`. Read [.claude/rules/desktop.md](../../../rules/desktop.md).

- State: user changes are one undo step each; UI state (selection, open sections) is not undone; tool windows stay in sync over IPC.
- Project files: new fields optional and normalized on read (bad values dropped without an error); old files still open; a format change also updates docs/file-format.md.
- Canvas and PDF draw the same layers in the same order; widths from `features/rendering/style-spec.ts`.
- Electron: IPC channels validate their sender and arguments; nothing new opens arbitrary paths or URLs.
- No leftover debug code, no `any` that hides a real type, no effect that runs on every render without need.
