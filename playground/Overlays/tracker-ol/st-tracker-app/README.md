# `"st-tracker-app" built with 'create-preact'`

<h2 align="center">

  <img height="256" width="256" src="./src/assets/preact.svg">

</h2>

<h3 align="center">Get started using Preact and Vite!</h3>

## Getting Started

- `npm run dev` - Starts a dev server at [http://localhost:5173/](http://localhost:5173/)
- `npm run build` - Builds for production, emitting to `dist/`. Prerenders app to static HTML
- `npm run preview` - Starts a server at [http://localhost:4173/](http://localhost:4173/) to test production build locally



---

# Tracker overlay/ widget with vite, preact, htm

- Configurable UI elements
  - Title
  - Tracker field and values

# Implementation of synced setup to have a global state on run

### Architecture for Shared Cross-Browser & Cross-Device State

To share global state across different browsers (Chrome, Edge, Firefox) on the same machine and across other devices on the local network (`0.0.0.0:5173`):

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Vite Server Sync Engine (0.0.0.0)                    │
│   • Persistent file: tracker-data.json                                 │
│   • Server-Sent Events (SSE): /api/tracker/events                      │
│   • HTTP REST: GET & POST /api/tracker                                 │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    │ (LAN / 0.0.0.0)               │ (Same Device)                 │ (Same Device)
    ▼                               ▼                               ▼
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│ Mobile / Secondary PC  │      │ Chrome Browser         │      │ Firefox Browser        │
│ 🔗 LINKED (Global SSE) │      │ 🔗 LINKED (Global SSE) │      │ 🔓 UNLINKED (Separate) │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

#### Multi-Tier Synchronization Engine:

1. **Server-Sent Events (SSE) & Server Persistence (`0.0.0.0`)**:
   - `vite.config.ts` runs on `0.0.0.0:5173` and exposes `/api/tracker/events` and `/api/tracker`.
   - Bypasses browser profile sandboxing: Chrome, Firefox, Edge, OBS Studio CEF, and phones/tablets on the local network all connect to the same global SSE feed.
   - Global state is persisted to `tracker-data.json` across server restarts.
2. **Client-Side Offline Engine (`localStorage` + `BroadcastChannel`)**:
   - Immediate 0ms cache rendering from `localStorage` without layout shift.
   - Sub-millisecond instant syncing across tabs within the same browser via `BroadcastChannel`.
3. **Session-Level Isolation for Unlinking**:
   - `sessionStorage` tracks each individual window's connection state (`overlay_tracker_is_linked`) and its detached local state (`overlay_tracker_session_v1`).

---

### Implementation Details

The implementation is located in [vite.config.ts](file:///D:/Dev/Projects/Orca_Workspaces/LiFERofRiFT/dev-overlay-tracker/playground/Overlays/tracker-ol/st-tracker-app/vite.config.ts), [index.tsx](file:///D:/Dev/Projects/Orca_Workspaces/LiFERofRiFT/dev-overlay-tracker/playground/Overlays/tracker-ol/st-tracker-app/src/index.tsx), and [style.css](file:///D:/Dev/Projects/Orca_Workspaces/LiFERofRiFT/dev-overlay-tracker/playground/Overlays/tracker-ol/st-tracker-app/src/style.css):

#### A. Linking & Unlinking Workflow

- **Initial Load**: Every browser and network session opens Linked (`🔗 LINKED TO GLOBAL`), automatically receiving the latest global state from the server.
- **Unlinking (`unlink()`)**:
  - Sets `isLinked = false` and writes `sessionStorage.setItem('overlay_tracker_is_linked', 'false')`.
  - Forks current state into `sessionStorage`.
  - The session ignores incoming global updates and stops broadcasting its own edits.
  - Overlay header displays `🔓 LOCAL`.
- **Linking Back**:
  - **`🔗 Link (Adopt Global)`**: Pulls the latest global state from the server `/api/tracker` (fallback to `localStorage`), discards local divergent edits, and resumes live synchronization.
  - **`⬆ Link (Push to Global)`**: Overwrites global server state and all other connected browsers with this session's current tracker values.

#### B. UI Controls Added to Config Panel

- **Status Header**: Glowing status indicator dot (`●`) and badge (`🔗 LINKED (GLOBAL)` or `🔓 UNLINKED (INDEPENDENT)`).
- **Mode Indicator Pill**: Subtle indicator badge on the top right of the overlay card for quick visual verification during streams.
- **Cyberpunk Action Buttons**: Styled buttons for Unlink, Link (Adopt Global), and Link (Push to Global).

### Network Endpoints & Ports

- **`http://localhost:5173` (Plain HTTP)**:
  - Kept as **plain HTTP** with no SSL/HTTPS.
  - Specifically designed for local streaming/gaming overlay software (OBS Studio Browser Source, CEF overlays) to prevent certificate rejections or blank screens.
- **`https://192.168.1.4:5174` (HTTPS over LAN / Wi-Fi)**:
  - Companion HTTPS server utilizing the self-signed certificate with SAN.
  - Used for mobile devices (smartphones, tablets) requiring secure contexts.
- **`https://172.27.48.1:5174` (HTTPS over vEthernet Hyper-V)**:
  - Accessible from virtual machines, WSL2, or Hyper-V network adapters.

### Firewall Configuration (Allow Inbound Ports)

Run once in PowerShell as Administrator:
```powershell
New-NetFirewallRule -DisplayName "Vite Dev Server (Port 5173-5174)" -Direction Inbound -LocalPort 5173,5174 -Protocol TCP -Action Allow
```
*(Ensure Wi-Fi connection in Windows Settings is set to **Private network**).*

