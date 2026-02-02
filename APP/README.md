# Licenta App - React + Python + Electron

## Project Structure
- **APP/UI**: Frontend (React + Vite + TypeScript)
- **APP/src**: Backend (Python Flask)
- **APP/electron**: Electron Main Process
- **APP/resources**: Build resources (icons, etc.)

## Prerequisites
1. Node.js (v18+)
2. Python (v3.9+)
3. PyInstaller (`pip install pyinstaller`)

## Setup
1. Install Node dependencies:
   ```bash
   npm install
   ```
2. Install Python dependencies:
   ```bash
   pip install -r src/requirements.txt
   ```

## Development
Run both Frontend and Electron (and Python backend via Electron):
```bash
npm run dev
```
Note: In development, Electron spawns `python src/main.py`. Ensure `python` is in your PATH.

## Build (Production)
Build the standalone installer (Setup.exe):
```bash
npm run build
```
This script will:
1. Build React frontend (`npm run build:react`) -> `dist/`
2. Build Electron main process (`npm run build:electron`) -> `dist-electron/`
3. Bundle Python backend (`npm run build:python`) -> `resources/backend/backend.exe`
4. Package everything with Electron Builder -> `release/`

The final installer will be in `release/`.
