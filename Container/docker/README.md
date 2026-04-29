# Licenta Agent Container

Run a personal AI agent on your own machine with Docker.

---

## What's in this ZIP

| File | Description |
|---|---|
| `licenta-container.tar` | Pre-built Docker image |
| `.env.example` | Environment variable template |
| `run.sh` | Start script — Linux / macOS |
| `run.bat` | Start script — Windows |
| `README.md` | This file |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

---

## Quick start

### 1. Set up your environment

Copy `.env.example` to `.env` in the same folder:

```bash
# Linux / macOS
cp .env.example .env

# Windows
copy .env.example .env
```

Edit `.env` and fill in your values:

```env
GOOGLE_API_KEY=your-google-api-key      # from https://aistudio.google.com/app/apikey
CONTAINER_API_KEY=pick-any-secret       # you will use this as the API key when calling the container
```

### 2. Run

**Linux / macOS**
```bash
chmod +x run.sh
./run.sh
```

**Windows** — double-click `run.bat`, or from a terminal:
```cmd
run.bat
```

The script loads the Docker image and starts the container. On first run it will prompt you to fill in `.env` if you have not done so yet.

### 3. Change the port (optional)

Default port is **8001**. To change it, open the script in a text editor before running it:

- `run.sh` — edit the `PORT=8001` line near the top
- `run.bat` — edit the `set PORT=8001` line near the top

---

## Connecting to the Licenta App

1. Go to the Licenta App in your browser
2. Open **Containers** and select the **Run locally** tab
3. Enter your container URL: `http://<your-machine-ip>:<PORT>`
4. Use the `CONTAINER_API_KEY` value from your `.env` as the API key

If running on the same machine as the browser use `http://localhost:8001`.

---

## Useful commands

```bash
docker logs licenta-agent       # view logs
docker stop licenta-agent       # stop the container
docker start licenta-agent      # start it again (no reload needed)
docker rm licenta-agent         # remove the container
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | Open Docker Desktop and wait for it to start |
| `Port already allocated` | Change `PORT` in the script to a free port |
| `.env` not found | Create `.env` from `.env.example` (step 1 above) |
| `GOOGLE_API_KEY` errors | Check the key is correct and has Gemini API access |
| Container exits immediately | Run `docker logs licenta-agent` for the error |