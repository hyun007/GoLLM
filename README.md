# minecraft-rcon-llm

Connect a local LLM (llama.cpp or any OpenAI-compatible endpoint) to a Minecraft server. Three modes:

- **admin** — interactive REPL: type natural language, the LLM executes RCON commands
- **chatbot** — watches server chat and responds to every player message in-game
- **autonomous** — periodic agent that checks the server and takes small helpful actions on its own

## Connection options

**Option A — GoTTY** (recommended for [binhex/arch-minecraftserver](https://hub.docker.com/r/binhex/arch-minecraftserver)): a single WebSocket handles both sending commands and reading logs. No RCON or SSH needed.

**Option B — RCON + log**: set RCON credentials and point the log watcher at a Docker container (via SSH) or a local log file.

## Setup

```bash
cp .env.example .env
# edit .env with your LLM endpoint and server credentials
npm install
```

## Usage

```bash
npm run admin       # interactive admin REPL
npm run chatbot     # respond to player chat
npm run autonomous  # periodic background agent
```

## Docker

```bash
# build
docker build -t minecraft-rcon-llm .

# run (edit env vars in docker-compose.yml first)
docker compose up -d
```

A pre-built image is published to GHCR via `.github/workflows/docker.yml` on every push to `master`.

## Configuration

Copy `.env.example` to `.env` and fill in the values. All settings:

| Variable | Description |
|---|---|
| `LLM_BASE_URL` | OpenAI-compatible API base URL (e.g. `http://localhost:8080/v1`) |
| `LLM_MODEL` | Model name sent in requests |
| `LLM_API_KEY` | API key (`none` for local servers) |
| `GOTTY_HOST` | GoTTY host — if set, RCON/SSH settings are ignored |
| `GOTTY_PORT` | GoTTY port (default `8222`) |
| `GOTTY_USER` | GoTTY username |
| `GOTTY_PASSWORD` | GoTTY password |
| `RCON_HOST` | Minecraft RCON host (default `localhost`) |
| `RCON_PORT` | RCON port (default `25575`) |
| `RCON_PASSWORD` | RCON password |
| `LOG_MODE` | `docker` or `local` (chatbot mode, RCON path only) |
| `DOCKER_CONTAINER` | Container name for `docker logs` (docker log mode) |
| `SSH_HOST` / `SSH_USER` | SSH credentials to reach the Docker host |
| `SSH_KEY_PATH` / `SSH_PASSWORD` | SSH auth |
| `LOG_PATH` | Log file path (local log mode, default `/opt/minecraft/logs/latest.log`) |
| `AUTONOMOUS_INTERVAL` | Tick interval in ms for autonomous mode (default `60000`) |
