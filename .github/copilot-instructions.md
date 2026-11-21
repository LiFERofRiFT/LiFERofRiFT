# Copilot Instructions

## Repository layout

This repository is a personal monorepo-style workspace:

- `projects/` contains production applications.
- `packages/` contains shared or publishable code.
- `playground/` contains experiments and prototypes.
- The tracker overlay is a Preact/Vite app under `playground/`.
- `QnA_Monorepo.md` documents the intended repository organization. These directories are organizational only; there is no root workspace package manager configuration.

The current implemented application is `playground/Overlays/tracker-ol/st-tracker-app`.

## Tracker app commands

Run npm commands from the app directory:

```powershell
cd playground\Overlays\tracker-ol\st-tracker-app
npm ci
npm run dev
npm run build
npm run lint
npm run preview
npm run gen:cert
```

- `npm run dev` starts Vite on `0.0.0.0:5173`.
- `npm run build` produces a prerendered production build in `dist/`.
- `npm run preview` serves the production build on port `5173`.
- `npm run lint` runs Oxlint against `src/` using `.oxlintrc.json`.
- `npm run gen:cert` generates a Windows-compatible self-signed HTTPS certificate in `certs/` from available local IPv4 addresses.
- `npx tsc --noEmit -p tsconfig.json` performs a TypeScript check. No test runner or test script is currently configured, so there is no single-test command.

Do not add a test command unless a test framework is introduced as part of the change.

## High-level architecture

The tracker app is a Preact application with server behavior embedded in the Vite configuration:

- `src/index.tsx` contains the `App`, state model, synchronization logic, and interface markup.
- `src/style.css` contains the overlay and configuration-panel styling.
- `vite.config.ts` defines the Vite/Preact build, prerendering, HTTP middleware, SSE endpoint, and companion HTTPS server.
- `index.html` provides the `#app` mount point and prerender entry.
- `scripts/generate-cert.js` creates SAN self-signed certificates for localhost and local network addresses.

The application maintains one shared `TrackerState` shape: a title and an array of tracker objects with `id`, `label`, `value`, `max`, and optional `failed`.

Vite middleware exposes `/api/tracker` and `/api/tracker/events`:

- `GET /api/tracker` returns the server's current state.
- `POST /api/tracker` validates and publishes a state update.
- `/api/tracker/events` sends Server-Sent Events.
- The server persists published state to `tracker-data.json`, which is runtime data and is gitignored.

The browser has three synchronization layers:

1. Server-Sent Events for cross-browser and network-device updates.
2. `BroadcastChannel` for instant same-origin tab synchronization.
3. `localStorage` and `storage` events as persistent fallback and cross-tab complement.

A session can be linked or unlinked. Linked sessions publish changes globally. Unlinked sessions fork state into `sessionStorage`; their edits do not broadcast. Relinking can adopt server state or push the local state to the server.

The primary server intentionally uses plain HTTP on port `5173` for OBS and other local browser sources. When certificates exist, `vite.config.ts` also starts a self-signed HTTPS companion on port `5174`.

## Code conventions

- Most UI markup in `src/index.tsx` uses `htm` tagged templates (`html\``), not JSX. Keep new component markup in that style unless the file is meaningfully converted to JSX as a separate change.
- Keep the `TrackerState` and `Tracker` interfaces aligned with both browser and server state validation.
- State changes should go through `commitState` so linked sessions broadcast and unlinked sessions persist only in `sessionStorage`.
- Preserve the three sync transports when changing synchronization: EventSource, BroadcastChannel, and `storage` events. Sender IDs prevent a tab from applying its own echo.
- SSR/prerender safety is important. Browser-only APIs must be guarded for `window`, `localStorage`, `sessionStorage`, `BroadcastChannel`, `EventSource`, and `fetch`.
- Runtime certificates and `tracker-data.json` are gitignored and should not be committed.
- Oxlint configuration warns rather than errors for unused variables, console use, equality, and explicit `any`; `no-debugger` is an error.

## Browser automation

- `.vscode/mcp.json` configures the Playwright MCP server for VS Code-compatible MCP clients. It uses `npx` and requires Node.js 20 or newer.
- In Orca sessions, use Orca's embedded browser through the installed `orca-cli` skill (`orca tab`, `orca goto`, `orca snapshot`, and related commands) rather than starting a duplicate browser through MCP.
