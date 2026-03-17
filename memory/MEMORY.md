# Licenta-App Project Memory

## Project Overview
Electron + React/TypeScript frontend + Python Flask (local) backend + FastAPI cloud server.

## Key Paths
- **Frontend UI**: `APP/UI/` (React components/pages)
- **Local Flask backend**: `APP/src/` — runs on `http://127.0.0.1:5000`
- **Cloud FastAPI server**: `Server/src/`
- **App data**: `APP/data/` (agent_config.json, tool_drives.json)
- **Drive registry**: `APP/src/data/known_drives.json`

## Architecture
- `APP/src/API/drive_routes.py` → `/api/drive/*`
- `APP/src/API/tools_routes.py` → `/api/tools/*`
- `APP/src/API/agent_routes.py` → `/api/agent/*`
- `APP/src/tools/` → tool executors (hello.py, image_converter.py)
- `APP/src/tools/catalog.py` → UI-facing metadata for Tools page

## Adding a Tool
1. Create `APP/src/tools/your_tool.py` with `DEFINITION` dict + `execute(input: dict) -> str`
2. Register in `APP/src/API/tools_routes.py` `_TOOLS` dict
3. Add metadata to `APP/src/tools/catalog.py` `TOOLS` list
4. Add runner component to `APP/UI/pages/ToolDetail.tsx` and dispatch by `tool.id`

## Virtual Drive Format
`known_drives.json` entries: `{ path, name, type }` (type: "shortcut" | "move")
Drive folders contain hidden `.drive_config.json` with: schema_version, serial, name, type, created_at, app_version_created

## Tool Drives Registry
`APP/data/tool_drives.json` — stores drives created by tools: `[{ path, name, tool }]`
Served by `GET /api/tools/created-drives`

## Implemented Tools
- **hello** (test connectivity)
- **image_converter** — Pillow-based batch image conversion, 3 output modes

## Settings
Agent config at `APP/data/agent_config.json` via `/api/agent/config`
Fields: mode, server_url, api_key, container_url, output_path (parent dir for tool virtual drives)

## Image Converter Endpoints
- `POST /api/tools/image-converter/run` — direct frontend call
- `GET /api/tools/created-drives` — list tool-created drives

## Navigation
Routes: /, /chat, /files, /extensions, /tools, /tools/:id, /settings, /tool-drives
Sidebar: Home, My Drive, AI Agent, Extensions, Tools, Tool Drives, Settings

## Electron API (preload)
- `window.electronAPI.selectDirectory()` → folder picker
- `window.electronAPI.selectFile()` → file picker
- `window.electronAPI.getAvailableRoots()` → available drive letters
- `window.electronAPI.onDeviceChange(cb)` → device change events
