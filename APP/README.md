# FileO — Desktop App

Electron + React + TypeScript desktop application with a bundled Flask micro-backend.

## Architecture

```
Electron (main process)
  └── spawns Flask (Python) backend  →  http://localhost:5000
  └── loads React frontend (Vite dev server in dev, static dist/ in prod)

React UI  ←→  Flask API  ←→  Server (FastAPI, port 8000)
                           ←→  NTFS MFT (native Windows, via ctypes)
```

- **Electron** (`electron/main.ts`) manages the window and spawns the Python process.
- **React** (`UI/`) is the full user interface — drives, agent chat, tool forms.
- **Flask** (`src/main.py`) is the local API: drive CRUD, tool execution, proxying SSE streams from the server.
- The bundled `backend.exe` (produced by PyInstaller) is what ships in the installer; during development Flask runs directly via `python src/main.py`.

## Prerequisites

- Node.js 18+
- Python 3.9+
- PyInstaller (`pip install pyinstaller`) — only needed for production builds

## Setup

```bash
# Install Node dependencies
npm install

# Install Python dependencies
pip install -r src/requirements.txt
```

## Development

```bash
npm run dev
```

This starts three processes concurrently:
1. Vite dev server for the React frontend (with HMR)
2. TypeScript compiler watching `electron/`
3. Electron, which spawns `python src/main.py` as the Flask backend

The app window opens automatically. Hot-reload works for both the UI and Electron main process.

> Ensure `python` (or `python3`) is on your PATH. On Windows the Python backend runs with `python src/main.py`; on first run it also writes data files to `%APPDATA%/FileO/`.

## Production Build

```bash
npm run build
```

Steps run in order:
1. `npm run build:react` — Vite compiles the React UI → `dist/`
2. `npm run build:electron` — tsc compiles Electron main + preload → `dist-electron/`
3. `npm run build:python` — PyInstaller bundles the Flask backend → `resources/backend/backend.exe`
4. Electron Builder packages everything → `release/Setup.exe` (NSIS installer)

The final installer is in `release/`.

## Project Structure

```
APP/
├── UI/                     # React frontend (Vite + TypeScript)
│   ├── pages/              # One file per page (Tools, Chat, Files, Settings, etc.)
│   ├── components/         # Shared components (sidebar, modals, progress, etc.)
│   ├── hooks/              # Custom hooks (useDrives, useTools, etc.)
│   └── contexts/           # React context providers
├── src/                    # Python Flask backend
│   ├── API/                # Blueprint route files
│   │   ├── drive_routes.py
│   │   ├── tools_routes.py
│   │   └── agent_routes.py
│   ├── tools/              # Tool modules (one per tool) + catalog.py
│   ├── utils/
│   │   ├── mft_scan.py     # NTFS MFT reader (ctypes, Windows-only)
│   │   ├── drive_manager.py
│   │   ├── drives_registry.py
│   │   ├── ai_gateway.py   # HTTP client to the FastAPI server's AI endpoints
│   │   └── paths.py        # Resolves data dirs (AppData vs. dev)
│   ├── migrations/         # Virtual drive .drive_config.json schema migrations
│   ├── config.py
│   ├── main.py             # Flask app entry point
│   └── requirements.txt
├── electron/
│   ├── main.ts             # Electron main process (window, tray, backend spawn)
│   └── preload.ts          # Context bridge for renderer ↔ main IPC
├── resources/              # Icons and other build assets
│   └── backend/            # Populated by PyInstaller (backend.exe)
├── data/                   # Runtime data (known_drives.json, etc.) — gitignored
├── package.json
├── vite.config.ts
└── backend.spec            # PyInstaller spec file
```

## Adding a Tool

1. Create `src/tools/<tool_name>.py` with `DEFINITION` (dict) and `execute(input_data)` (returns JSON string).
2. Register it in `src/tools/catalog.py` — add to the `TOOLS` list and set `category`, `icon`, etc.
3. Add a route in `src/API/tools_routes.py` (or extend the generic `/api/tools/run` handler).
4. Optionally add a dedicated page in `UI/pages/<ToolName>Page.tsx` and register it in `App.tsx`.

## Tests

```bash
cd src
python -m pytest tests/ -v
```

Tests live in `src/tests/` and cover tool modules and utility functions.
