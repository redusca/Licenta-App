# FileO

**FileO** is a desktop file-management platform with built-in AI tools and a natural-language planning agent. It runs entirely on your own machine — no cloud uploads, no subscriptions.

It consists of two components that work together:

- **Server** — a FastAPI + PostgreSQL backend that hosts AI models (image super-resolution via Swin2SR, audio transcription via Whisper Large V3, vision via Llama 4 Scout on Groq) and a custom Groq-backed planning agent. Comes with a React web interface for account and API-key management.
- **Desktop app** — an Electron + React + TypeScript application with a Flask micro-backend bundled inside, providing virtual drives, a tool catalogue, and a chat interface to the planning agent.

---

## Table of Contents

- [Getting Started](#getting-started)
  - [1. Run the server](#1-run-the-server)
  - [2. Install the desktop app](#2-install-the-desktop-app)
  - [3. Connect the app to the server](#3-connect-the-app-to-the-server)
- [Initial Settings](#initial-settings)
- [Using the App](#using-the-app)
  - [My Drives](#my-drives)
  - [Agent](#agent)
  - [Tools](#tools)
- [Tool Catalogue](#tool-catalogue)
  - [Image](#image)
  - [Audio](#audio)
  - [Video](#video)
  - [Documents](#documents)
  - [3D & Modeling](#3d--modeling)
  - [Computer Tools](#computer-tools)
- [Server Setup (Docker)](#server-setup-docker)
- [Developer Setup](#developer-setup)
- [Project Structure](#project-structure)

---

## Getting Started

### 1. Run the server

The server hosts AI models, the planning agent, and the account web interface.

**Option A — Docker (recommended for production):**

```bash
# Copy and fill in the environment file
cp Server/src/.env.example Server/src/.env
# Edit Server/src/.env and set at minimum:
#   JWT_SECRET=<strong random string>
#   GROQ_API_KEY=<your key from https://console.groq.com>

# Build the React web interface
cd Server/Interface && npm install && npm run build && cd ../..

# Start PostgreSQL + server
docker compose -f Server/docker/docker-compose.yml up --build
```

**Option B — locally (development):**

```bash
cd Server/src
pip install -r requirements.txt
python main.py        # starts on http://localhost:8000
```

### 2. Install the desktop app

1. In the server web interface navigate to **Downloads** and download the application archive.
2. Extract the contents to any folder (e.g. `C:\FileO`).
3. Run **FileO.exe**. On first launch Windows SmartScreen may warn you — choose *Run anyway*.
4. The main window opens; the bundled Python backend starts in the background automatically.

### 3. Connect the app to the server

1. In the server web interface go to **Account → API Key** and press **Generate API Key**. Copy the key immediately — it is shown only once.
2. In the FileO desktop app open **Settings** (gear icon in the sidebar).
3. Paste the key into the *API Key* field and set *Server URL* to the server address (e.g. `http://localhost:8000`), then press **Save**.
4. The status indicator in the Agent section turns green when the connection is confirmed.

---

## Initial Settings

On first use, configure these options in **Settings** (gear icon in the sidebar):

| Setting | What to do |
|---|---|
| **Output Path** | Default folder where tools save processed files. Press *Browse* and select a folder (e.g. `D:\FileOOutput`). |
| **Server URL** | Full address of the server, including port (e.g. `http://localhost:8000`). |
| **API Key** | Key generated from the server web interface — see step 3 above. |
| **Theme** | The moon/sun toggle in the sidebar switches between light and dark mode. |

---

## Using the App

The app has three main sections accessible from the left sidebar: **My Drives**, **Agent**, and **Tools**. You can also use the keyboard shortcuts `Ctrl+1`, `Ctrl+2`, and `Ctrl+3` to switch between them.

### My Drives

Organise files on your disk into named virtual drives grouped by file category — without necessarily moving anything.

1. Click **New Drive** and give it a descriptive name (e.g. *Project Images*).
2. Select the source folder the app will scan and the file types to include (e.g. `.jpg`, `.png`).
3. Pick an action:
   - **Shortcuts** — creates Windows shortcuts inside the drive folder; original files stay in place.
   - **Move** — physically relocates matching files into the drive folder.
4. Press **Create**. The drive appears in the list with the number of files found.
5. Click any drive to browse its contents and open individual files.

> The MFT (Master File Table) scanner is used for fast, low-overhead indexing on NTFS drives — similar to WizTree. Even large drives are scanned in seconds.

### Agent

Describe complex, multi-step tasks in plain language and let the planning agent execute them autonomously — with your approval at each step.

1. Make sure the server is running and the status indicator in the Agent tab is green.
2. Type your request in the message field and press *Enter*.
   - Example: *"Convert all images in my Downloads folder to WebP, remove the backgrounds, and move the results to the Project Images drive."*
3. The agent streams its reasoning in real time and lists each tool it intends to call before executing.
4. When a tool requires human input a dialog appears. You can edit any parameter, then press **Approve** or **Reject**.
5. When finished the agent displays a summary of all actions taken and their results.

The agent uses a **Plan-and-Execute** architecture backed by Groq: it first produces a step-by-step plan, then executes each step (calling tools or reasoning with the LLM), and synthesizes a final answer from all results.

### Tools

Run any available tool manually, without involving the agent.

1. Go to **Tools** in the sidebar. Tools are shown in a grid organised by category (Image, Audio, Video, Documents, etc.). Use the pill filters at the top to narrow the list.
2. Click a tool card to read its full description, supported file formats, and recommended usage steps.
3. Press **Run Tool** to open the execution form.
4. Select input files (*Browse Files*, *Browse Folder*, or *From Virtual Drive*), set the options, and choose a save mode:
   - **Copy** — saves output alongside the originals.
   - **Replace** — overwrites the originals with the processed files.
   - **Virtual Drive** — sends results to the folder configured as Output Path.
5. Press **Run** and wait. AI-powered tools stream progress in real time. The results panel shows each file's status and any errors.

---

## Tool Catalogue

### Image

#### Image Converter
> Formats: `.jpg` `.jpeg` `.png` `.webp` `.bmp` `.tiff` `.gif` · No AI

Batch-convert raster image files between all common formats. Preserves EXIF metadata, handles transparency (e.g. PNG → WebP), and lets you set a quality/compression level for lossy targets. All processing is local.

| Option | Details |
|---|---|
| Output Format | JPEG, PNG, WebP, BMP, TIFF |
| Quality (1–100) | Applies to JPEG and WebP outputs only |
| Preserve EXIF | Copies camera info, GPS, and other metadata to the output |

---

#### Remove Background
> Formats: `.jpg` `.jpeg` `.png` `.webp` · **AI (rembg, on-device)**

Automatically detects the main subject in each image and removes the background, outputting a transparent PNG. Uses the `rembg` library with on-device models — no data leaves your machine. Supports batch processing.

---

#### Image to SVG Vectorizer
> Formats: `.jpg` `.jpeg` `.png` `.webp` `.bmp` · No AI

Converts raster images to clean, scalable SVG vector files using `vtracer`. Choose between full-colour tracing or binary (black-and-white) mode. After conversion each result shows an inline SVG preview with a *Copy SVG Code* button for direct use in web pages, Figma, or Illustrator.

| Option | Details |
|---|---|
| Color Mode | `color` for full-colour SVG, `binary` for black-and-white |
| Layering Mode | `stacked` layers shapes on top; `cutout` punches holes |
| Speckle Filter | Ignore noise pixels smaller than N pixels |
| Color Precision | Significant bits for colour quantisation (1–8) |

---

#### AI Image Enhancer
> Formats: `.jpg` `.jpeg` `.png` `.webp` · **AI (Swin2SR super-resolution, server-side)**

Upscales images ×2 using Swin2SR running on the server, simultaneously reducing noise and compression artefacts. Progress streams in real time while the model processes.

---

### Audio

#### Audio Converter
> Formats: `.mp3` `.wav` `.m4a` `.aac` `.flac` `.ogg` `.wma` `.mka` · No AI

Batch-convert audio files between all common formats using FFmpeg. Supports Replace, Copy, and Virtual Drive output modes.

| Output formats | MP3, WAV, M4A, AAC, FLAC, OGG |
|---|---|

---

#### Audio Transcriber
> Formats: `.mp3` `.wav` `.ogg` `.flac` `.m4a` `.aac` · **AI (Whisper Large V3, server-side)**

Converts spoken audio into accurate text transcripts using Whisper Large V3 running on the server. Auto-detects language and exports transcripts as plain text or SRT.

| Option | Details |
|---|---|
| Language | Auto-detect or specify: EN, RO, FR, DE, ES, IT, PT, and more |
| Output Format | TXT or SRT |

---

### Video

#### Subtitle Generator
> Formats: `.mp4` `.mkv` `.avi` `.mov` `.webm` `.flv` `.wmv` `.m4v` · **AI (Whisper Large V3, server-side)**

Extracts audio from any video, transcribes it with Whisper Large V3 using word-level timestamps, and produces a ready-to-use SRT file compatible with VLC, MPC-HC, and other media players.

| Option | Details |
|---|---|
| Video Language | Auto-detect or specify (16 languages supported) |

---

#### Video Compressor
> Formats: `.mp4` `.mkv` `.mov` `.avi` `.webm` · No AI

Re-encodes video files using FFmpeg-backed H.264 or H.265 with a configurable Constant Rate Factor (CRF). Also lets you cap resolution and frame rate, and strip audio tracks. All processing is local.

| Option | Details |
|---|---|
| Codec | H.264 (better compatibility) or H.265 (smaller files) |
| CRF (0–51) | Quality vs. size trade-off. 18 = near-lossless, 28 = good balance, 23 = default |
| Max Resolution | Original, 1080p, 720p, 480p, or 360p |
| Strip Audio | Remove the audio track from the output |

---

#### Video Converter
> Formats: `.mp4` `.avi` `.mkv` `.mov` `.wmv` `.flv` `.webm` `.m4v` `.mpeg` `.mpg` · No AI

Batch-convert video files between all major container formats using FFmpeg.

| Output formats | MP4, AVI, MKV, MOV, WMV, FLV, WebM |
|---|---|

---

### Documents

#### PDF Toolkit
> Formats: `.pdf` `.docx` · No AI

All-in-one PDF manipulation. Merge multiple PDFs into one with drag-and-drop reordering, extract specific page ranges, and convert between PDF and Word (`.docx`) — all processed locally.

| Action | Details |
|---|---|
| **Merge** | Combine multiple PDFs; optional per-document bookmarks |
| **Split** | Extract specific pages using range notation (e.g. `1-3,5,7-9`) |
| **Convert** | PDF → DOCX or DOCX → PDF |

---

#### Document Analytics
> Formats: `.pdf` `.docx` `.txt` `.md` `.html` `.htm` · **AI (Groq LLM, optional)**

Extracts text from a document and computes statistics: word count, sentence and paragraph count, unique words, reading time, estimated page count, average sentence length, top keywords, and Flesch-Kincaid readability score. Optionally uses the Groq LLM to generate a concise summary, identify main topics, classify writing tone, and extract named entities.

| Option | Details |
|---|---|
| AI Insights | Toggle on/off — requires the server to be running |

---

#### Document Converter
> Formats: `.pdf` `.docx` `.doc` `.txt` `.html` `.htm` `.md` · No AI

Versatile, fully local document format conversion. Convert PDFs to editable Word documents, extract plain text from any document, render PDFs as PNG images, turn Markdown into styled HTML or PDF, and more. Supports batch conversion.

| Output formats | PDF, DOCX, TXT, HTML, PNG |
|---|---|

---

### 3D & Modeling

#### 3D Model Converter
> Formats: `.obj` `.fbx` `.glb` `.gltf` `.stl` `.ply` `.dae` · No AI

Converts 3D model files between widely-used formats using the Open Asset Import Library (Assimp). Preserves materials, UV maps, and skeletal rigs where the target format supports them.

| Option | Details |
|---|---|
| Output Format | OBJ, FBX, GLB, GLTF, STL, PLY, DAE |
| Embed Textures | Embed texture images into the file (GLB/GLTF only) |

---

#### 3D Visualizer
> Formats: `.obj` `.fbx` `.glb` `.gltf` `.stl` · No AI

An interactive in-app 3D model previewer with rotate, pan, and zoom camera controls. Load a 3D object file and optionally apply a custom image texture to its surface.

---

### Computer Tools

#### Drive Creator
> No AI

Quickly scans any folder by file category (Images, Audio, Video, 3D Objects, Documents, etc.) using the NTFS MFT for near-instant results, then creates a Virtual Drive containing shortcuts to those files — or optionally moves them. Ideal for organising large, messy folders in seconds.

---

#### Space Analyzer
> No AI

Scans a selected drive using the NTFS Master File Table, calculates recursive folder sizes, and displays disk usage in an interactive squarified treemap (similar to WizTree). Click into blocks to drill down through the folder hierarchy and identify what is using the most space.

---

#### Hello Agent
> No AI

A connectivity diagnostic tool. Sends a fixed test prompt to the configured server and displays the full response. Use this to verify that your API key, Server URL, and server are correctly wired up before running production tools.

---

## Server Setup (Docker)

The server can be run locally (see [Getting Started](#1-run-the-server)) or deployed via Docker Compose.

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

```bash
# 1. Configure environment
cp Server/src/.env.example Server/src/.env
# Required keys in .env:
#   JWT_SECRET=<strong random string, e.g. openssl rand -hex 32>
#   GROQ_API_KEY=<from https://console.groq.com>
#   GITHUB_TOKEN=<personal access token with Contents:Read, for /api/releases>

# 2. Build the web interface
cd Server/Interface && npm install && npm run build && cd ../..

# 3. Start
docker compose -f Server/docker/docker-compose.yml up --build -d
```

The server exposes port **8000**. The web interface is served at `http://localhost:8000`.

Useful commands:

```bash
docker compose -f Server/docker/docker-compose.yml logs -f    # tail logs
docker compose -f Server/docker/docker-compose.yml down       # stop
docker compose -f Server/docker/docker-compose.yml restart    # restart
```

---

## Developer Setup

**Prerequisites:** Node.js 18+, Python 3.9+

### Desktop app (APP/)

```bash
cd APP

# Install dependencies
npm install
pip install -r src/requirements.txt

# Development mode — Electron, React (Vite HMR), and Flask all start together
npm run dev

# Production build → release/Setup.exe
npm run build
```

The build pipeline:
1. Compiles the React frontend with Vite → `dist/`
2. Bundles the Electron main process → `dist-electron/`
3. Packages the Flask backend with PyInstaller → `resources/backend/backend.exe`
4. Packages everything with Electron Builder → `release/Setup.exe`

### Server (Server/)

```bash
cd Server/src
pip install -r requirements.txt

# Copy and fill in the environment file
cp .env.example .env

# Run database migrations (first time)
alembic upgrade head

# Start the server
python main.py       # http://localhost:8000

# Build the web interface (optional, served by FastAPI)
cd ../Interface && npm install && npm run build
```

**Running tests (desktop app):**

```bash
cd APP/src
python -m pytest tests/ -v
```

---

## Project Structure

```
Licenta-App/
├── APP/                        # Desktop application
│   ├── UI/                     # React + Vite + TypeScript frontend
│   │   ├── pages/              # Page components (Tools, Chat, Files, etc.)
│   │   ├── components/         # Shared UI components
│   │   ├── hooks/              # Custom React hooks
│   │   └── contexts/           # React context providers
│   ├── src/                    # Python Flask backend
│   │   ├── API/                # Blueprint routes (drive, tools, agent)
│   │   ├── tools/              # Tool modules + catalog.py
│   │   ├── utils/              # MFT scanner, drive manager, AI gateway client
│   │   ├── migrations/         # Virtual drive config schema migrations
│   │   └── tests/              # PyTest suites
│   ├── electron/               # Electron main process + preload
│   └── resources/              # Build assets (icons, backend.exe)
├── Server/                     # FastAPI server
│   ├── src/                    # Server source
│   │   ├── API/                # FastAPI routers (auth, agent, releases, ai_gateway)
│   │   │   └── ai_gateway/     # Swin2SR, Whisper, Groq LLM/vision endpoints
│   │   └── utils/              # Planning agent, chat manager, auth helpers
│   ├── Interface/              # React web interface (served by FastAPI)
│   ├── Database/               # SQLAlchemy models + session
│   ├── migrations/             # Alembic database migrations
│   └── docker/                 # Docker Compose configs + Dockerfiles
└── README.md
```
