# Migration Plan — Fresh Repository for cSlope

> **How to use this plan:** Each phase is written so an AI coding agent (GitHub Copilot, etc.) can execute the steps directly. Tell the agent _"Execute Phase N from `migration-plan.md`"_ and it will know exactly what to do. Phases are sequential — complete each one before moving to the next. Steps that require the GitHub/Vercel UI are marked with 🧑 **MANUAL**.

## Goal

Create a **new GitHub repository** (`cslope`) from scratch containing only the TypeScript/React codebase. The old `pySlope` repo (Python + TS) stays archived as-is.

---

## 1. Target Repository Layout

```
cslope/
├── LICENSE
├── README.md
├── CHANGELOG.md
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── packages/
│   ├── engine/                # (future) Pure-TS slope stability engine
│   │   └── ...
│   │
│   ├── webapp/                # Vite + React SPA (current webapp)
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── vitest.config.ts
│   │   ├── eslint.config.js
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   ├── store/
│   │   │   ├── worker/
│   │   │   └── ...
│   │   └── tests/
│   │
│   ├── desktop/               # (future) Electron wrapper
│   │   └── ...
│   │
│   └── website/               # (future) Landing page (Vite + React + shadcn/ui + Tailwind)
│       ├── package.json
│       ├── vite.config.ts
│       ├── components.json    # shadcn/ui config
│       ├── src/
│       └── public/
│
├── data/                      # Validation CSV files, example projects
│   ├── validation/
│   └── projects/
│
├── package.json               # Workspace root (Bun workspaces)
├── bun.lock
└── tsconfig.base.json         # Shared compiler options
```

### Why a monorepo?

| Concern                 | Benefit                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| **Shared engine**       | `@cslope/engine` is imported by webapp, desktop, and tests without duplication |
| **Independent deploys** | Website on Vercel; webapp builds a static SPA; desktop produces an installer   |
| **Single CI**           | One repo, one set of workflows                                                 |
| **Future flexibility**  | Add `packages/cli` or `packages/api` later without restructuring               |

> **Note — start simple.** Only `packages/webapp` is created on day 1. The other packages are scaffolded later when needed.

---

## 2. Step-by-Step Migration

### Phase 1 — Create the GitHub repository

🧑 **MANUAL** — Do this in the browser:

1. Go to <https://github.com/new>.
2. Repository name: **`cslope`**, Owner: **`ZilanCiftci`**.
3. Visibility: Public (or Private).
4. **Do NOT** tick "Add a README file" or ".gitignore" — we push our own.
5. Click **Create repository**.

Then tell the agent: _"The repo `ZilanCiftci/cslope` is created. Execute Phase 2 from `migration-plan.md`."_

---

### Phase 2 — Clone and scaffold the root

**Agent instructions:** Run these commands, then create each file with the exact content shown.

**Step 2.1 — Clone the empty repo:**

```powershell
cd "C:\Users\zilan\repos"
git clone https://github.com/ZilanCiftci/cslope.git
cd cslope
```

**Step 2.2 — Create `LICENSE`:**
Copy the file verbatim from `C:\Users\zilan\Google Drive\Shared\pySlope\LICENSE`. It is MIT, Copyright 2025 Zilan Ciftci.

**Step 2.3 — Create `package.json`** in the repo root with this exact content:

```json
{
  "name": "cslope",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter @cslope/webapp dev",
    "build": "bun run --filter @cslope/webapp build",
    "test": "bun run --filter '*' test",
    "lint": "bun run --filter '*' lint",
    "typecheck": "bun run --filter '*' typecheck"
  }
}
```

**Step 2.4 — Create `tsconfig.base.json`** in the repo root:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

**Step 2.5 — Create `.gitignore`** in the repo root:

```gitignore
node_modules/
dist/
.vscode/
.env
*.tsbuildinfo
.venv/
*.prof
```

**Step 2.6 — Create `CHANGELOG.md`** in the repo root:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- Initial migration from pySlope to cSlope (TypeScript monorepo).
```

**Step 2.7 — Create `README.md`** in the repo root:

```markdown
# cSlope

Slope stability analysis software. Built with TypeScript, React, and Vite.

## Quick Start

\`\`\`bash
bun install
bun run dev
\`\`\`

## Project Structure

- `packages/webapp` — Web application (Vite + React)
- `packages/engine` — (future) Standalone analysis engine
- `packages/desktop` — (future) Electron desktop app
- `packages/website` — (future) Project landing page
- `data/` — Validation data and example projects

## License

MIT
```

**Verification:** Confirm these 6 files exist in the repo root: `LICENSE`, `package.json`, `tsconfig.base.json`, `.gitignore`, `CHANGELOG.md`, `README.md`.

---

### Phase 3 — Copy the webapp

**Agent instructions:** Copy the webapp source, excluding build artefacts, then patch the package name.

**Step 3.1 — Copy webapp files:**

```powershell
# From inside the new repo root (C:\Users\zilan\repos\cslope)
mkdir -p packages\webapp
robocopy "C:\Users\zilan\Google Drive\Shared\pySlope\webapp" "packages\webapp" /E /XD node_modules dist .git __pycache__
```

**Step 3.2 — Patch `packages/webapp/package.json`:**
Change the `"name"` field from `"webapp"` to `"@cslope/webapp"`. Do not change anything else.

**Step 3.3 — Delete stale files inside `packages/webapp/`:**
Delete these files if they exist:

- `packages/webapp/debug_fos.ts`

**Step 3.4 — Install dependencies from the repo root:**

```powershell
cd "C:\Users\zilan\repos\cslope"
bun install
```

**Step 3.5 — Verify the webapp works.** Run each command from `packages/webapp/` and confirm it passes:

```powershell
cd packages\webapp
bun run lint       # expect: no errors
bun run typecheck  # expect: no errors
bun run test       # expect: all 208 tests pass
bun run build      # expect: successful production build
cd ..\..
```

If any command fails, diagnose and fix before proceeding. Do not move to Phase 4 until all four commands pass.

---

### Phase 4 — Copy data files

**Agent instructions:**

**Step 4.1 — Copy validation and project data:**

```powershell
cd "C:\Users\zilan\repos\cslope"
mkdir -p data\validation
mkdir -p data\projects
robocopy "C:\Users\zilan\Google Drive\Shared\pySlope\data\validation" "data\validation" /E /XF *.pyc
robocopy "C:\Users\zilan\Google Drive\Shared\pySlope\data\projects" "data\projects" /E /XF *.pyc
```

**Step 4.2 — Create `data/README.md`:**

```markdown
# Data

Validation datasets and example project files for cSlope.

- `validation/` — Reference results from published analyses
- `projects/` — Example project files
```

---

### Phase 5 — CI workflow

**Agent instructions:** Create the directory and file.

**Step 5.1 — Create `.github/workflows/ci.yml`:**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: cd packages/webapp && bun run lint
      - run: cd packages/webapp && bun run typecheck
      - run: cd packages/webapp && bun run test
      - run: cd packages/webapp && bun run build
```

---

### Phase 6 — Commit and push

**Agent instructions:**

```powershell
cd "C:\Users\zilan\repos\cslope"
git add -A
git status   # Review staged files — should only contain the expected files, no node_modules or dist
git commit -m "Initial commit: cSlope monorepo with webapp"
git push -u origin main
```

**Verification:** After pushing, check `https://github.com/ZilanCiftci/cslope/actions` — the CI workflow should trigger and pass.

---

### Phase 7 — Archive the old repo

🧑 **MANUAL** — Do this in the browser:

1. Go to `https://github.com/ZilanCiftci/pySlope`.
2. Edit the `README.md` to say:

   ```markdown
   # pySlope (Archived)

   This repository is archived. The project has been rewritten in TypeScript and lives at:
   **https://github.com/ZilanCiftci/cslope**
   ```

3. Go to **Settings → Danger Zone → Archive this repository**.

---

## 3. Future Packages

> Each section below is a self-contained phase. Tell the agent: _"Execute Phase FN from `migration-plan.md`."_

### Phase F1 — Extract `packages/engine`

**When:** When you start the desktop app or need the analysis engine in a second consumer.

**Agent instructions:**

**Step F1.1 — Create `packages/engine/package.json`:**

```json
{
  "name": "@cslope/engine",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  }
}
```

**Step F1.2 — Create `packages/engine/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

**Step F1.3 — Move engine source files.**
Move these directories from `packages/webapp/src/engine/` to `packages/engine/src/`:

- `types/`
- `model/`
- Any `math_utils` or equivalent files.

Do NOT move UI-dependent files (no React imports).

**Step F1.4 — Create `packages/engine/src/index.ts`:**
Barrel-export all public types and classes. For example:

```typescript
export * from "./types";
export * from "./model/slope";
export * from "./model/solvers";
export * from "./model/search";
// ... etc
```

**Step F1.5 — Add workspace dependency.**
In `packages/webapp/package.json`, add to `"dependencies"`:

```json
"@cslope/engine": "workspace:*"
```

**Step F1.6 — Update imports in the webapp.**
Find-and-replace all imports in `packages/webapp/src/` that reference `../engine/`, `../../engine/`, etc. Replace them with `@cslope/engine`. For example:

```typescript
// Before:
import { Slope } from "../../engine/model/slope";
// After:
import { Slope } from "@cslope/engine";
```

**Step F1.7 — Install and verify:**

```powershell
cd "C:\Users\zilan\repos\cslope"
bun install
bun run test
bun run build
```

**Step F1.8 — Commit:**

```powershell
git add -A
git commit -m "feat: extract @cslope/engine package"
git push
```

---

### Phase F2 — Scaffold `packages/desktop` (Electron)

**When:** When you want a native desktop version.

**Agent instructions:**

**Step F2.1 — Scaffold with electron-vite:**

```powershell
cd "C:\Users\zilan\repos\cslope\packages"
bun create electron-vite desktop
```

Or create manually:

**Step F2.2 — Create `packages/desktop/package.json`:**

```json
{
  "name": "@cslope/desktop",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "package": "electron-builder"
  }
}
```

**Step F2.3 — Configuration.**
The Electron main process should load the webapp's Vite build output in a `BrowserWindow`. Add `"@cslope/engine": "workspace:*"` as a dependency for any main-process analysis.

**Step F2.4 — Desktop-specific features to implement:**

- Native file open/save dialogs (replace browser-based file API).
- OS menu bar integration.
- Auto-update via electron-updater.

**Step F2.5 — Install and verify:**

```powershell
cd "C:\Users\zilan\repos\cslope"
bun install
bun run --filter @cslope/desktop dev
```

**Step F2.6 — Commit:**

```powershell
git add -A
git commit -m "feat: scaffold @cslope/desktop Electron app"
git push
```

---

### Phase F3 — Scaffold `packages/website` (Vite + React + shadcn/ui)

**When:** When you want the public-facing project landing page.

**Agent instructions:**

**Step F3.1 — Scaffold the Vite project:**

```powershell
cd "C:\Users\zilan\repos\cslope\packages"
bun create vite website --template react-ts
cd website
```

**Step F3.2 — Install shadcn/ui and dependencies:**

```powershell
bunx --bun shadcn@latest init
bunx --bun shadcn@latest add button card navigation-menu separator
bun add react-router lucide-react framer-motion
```

**Step F3.3 — Patch `packages/website/package.json`:**
Change `"name"` to `"@cslope/website"`.

**Step F3.4 — Create the route structure.** Set up React Router in `src/main.tsx` with a `<BrowserRouter>` and these routes:

| Route       | File                     | Content                                                               |
| ----------- | ------------------------ | --------------------------------------------------------------------- |
| `/`         | `src/pages/Home.tsx`     | Hero section, feature highlights, screenshots, CTA to webapp/download |
| `/features` | `src/pages/Features.tsx` | Detailed feature cards (methods, plotting, import/export, etc.)       |
| `/docs`     | `src/pages/Docs.tsx`     | Quick-start guide, user manual (embed Markdown via `react-markdown`)  |
| `/about`    | `src/pages/About.tsx`    | Project background, license, credits                                  |

**Step F3.5 — Create `src/components/Layout.tsx`** with:

- A shadcn `NavigationMenu` header with links to all pages.
- Dark/light mode toggle using shadcn's theme provider.
- Responsive design — mobile hamburger menu, desktop horizontal nav.
- Footer with GitHub link and license.

**Step F3.6 — Create the Home page hero section** (`src/pages/Home.tsx`):

- Large heading: **"cSlope — Slope Stability Analysis"**.
- Subtitle: "Fast, modern, open-source software for geotechnical engineers."
- Animated entrance using Framer Motion `motion.div` (fade-in + slide-up).
- Screenshot/GIF of the webapp below the CTA button.
- CTA button linking to the webapp or download.

**Step F3.7 — Verify:**

```powershell
cd "C:\Users\zilan\repos\cslope\packages\website"
bun run dev    # open browser, confirm pages render
bun run build  # confirm production build succeeds
```

**Step F3.8 — Commit:**

```powershell
cd "C:\Users\zilan\repos\cslope"
git add -A
git commit -m "feat: scaffold @cslope/website with shadcn/ui"
git push
```

**Deploy on Vercel:**

🧑 **MANUAL:**

1. Go to <https://vercel.com/new>.
2. Import the `ZilanCiftci/cslope` repo.
3. Set **Root Directory** to `packages/website`.
4. Build command: `bun run build`. Output directory: `dist`.
5. Vercel auto-deploys on push to `main`. Preview deploys on PRs are automatic.

---

## 4. Naming

The new project is called **cSlope** (repository: `cslope`). The npm scope for internal packages is `@cslope/*` (e.g. `@cslope/engine`, `@cslope/webapp`, `@cslope/website`, `@cslope/desktop`).

---

## 5. Checklist

> Tell the agent to mark these off as each phase completes.

- [ ] 🧑 Phase 1: Create new GitHub repository (`ZilanCiftci/cslope`)
- [ ] Phase 2: Clone and scaffold root (LICENSE, package.json, tsconfig, .gitignore, README, CHANGELOG)
- [ ] Phase 3: Copy webapp into `packages/webapp/`, patch name, install, verify (lint + typecheck + test + build)
- [ ] Phase 4: Copy validation data into `data/`
- [ ] Phase 5: Create CI workflow (`.github/workflows/ci.yml`)
- [ ] Phase 6: Commit and push — verify CI is green
- [ ] 🧑 Phase 7: Archive old `pySlope` repository
- [ ] (Later) Phase F1: Extract `packages/engine`
- [ ] (Later) Phase F2: Scaffold `packages/desktop`
- [ ] (Later) Phase F3: Scaffold `packages/website` + 🧑 connect Vercel
