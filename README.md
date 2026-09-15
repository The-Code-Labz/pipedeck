# PipeDeck

A **Voicemeeter-style audio routing hub for PipeWire**, with a web GUI. Self-hosted, no build tools needed on the target machine beyond Node — or use Docker.

## Why

Voicemeeter doesn't run on Linux. PipeWire can do everything Voicemeeter does — simultaneous multi-device output, combined virtual mics, per-app routing — but there's no single convenient mixer UI. PipeDeck is that UI.

It directly replaces the common Windows setup:

```
Physical mics → Voicemeeter → virtual mic → RustDesk → Windows VM
```

with:

```
Physical mics → PipeDeck virtual mic → RustDesk → Windows VM
```

and multi-output like `game → headset + TV at once` via combined sinks.

## Features

- **Outputs (A1/A2/A3 equivalent)** — combined sinks: pick any 2+ output devices, one virtual sink plays to all of them simultaneously (headset + TV).
- **Virtual mic (B1/B2 equivalent)** — merge multiple physical mics into a single microphone endpoint. RustDesk, Discord, or a Windows Proxmox VM sees one clean mic.
- **Per-app routing** — move any playback stream to any sink, any recording stream to any source, live.
- **Volumes & mute** — per-device and per-stream, 0–150%.
- **Default device** — one click.
- **Profiles** — virtual devices are saved automatically; "Apply Profile" recreates them after reboot.
- **Auto-refresh** — UI polls state every 2 seconds.

## Requirements

- Linux with **PipeWire** + the Pulse compatibility layer (`pactl` must work)
- Node.js 20+ (or Docker)

Verify first:

```bash
pactl info
```

## One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/The-Code-Labz/pipedeck/main/install.sh | bash
```

The script installs Node.js (>= 20) and PipeWire if missing, clones the repo to `~/pipedeck`, builds, and installs a **systemd user service** so PipeDeck starts on login.

Options:

```bash
PIPEDECK_DIR=/opt/pipedeck PIPEDECK_PORT=8080 bash install.sh   # custom location/port
bash install.sh --no-service                                     # run in foreground, no systemd
```

## Quick start (manual)

```bash
git clone https://github.com/The-Code-Labz/pipedeck.git
cd pipedeck
npm run install:all
npm run build
npm start
```

Open **http://localhost:4190**.

Dev mode (hot reload, Vite on 5173 proxying API):

```bash
npm run dev
```

## Docker

```bash
docker compose up -d
```

The container needs the host's PipeWire socket — `docker-compose.yml` mounts `/run/user/1000/pulse` and uses host networking so `pactl` sees your real audio graph.

## Persistence across reboots

PipeDeck saves every virtual device it creates to `data/profile.json`. To restore on login, use a **systemd user service**:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/pipedeck.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pipedeck
```

The service starts PipeDeck and applies the saved profile, so your combined outputs and virtual mics are back before you open the browser.

## Using with RustDesk / Windows VM

1. In PipeDeck, create a **Virtual Mic** from your physical mics.
2. In RustDesk's audio settings, select the virtual mic as the microphone source.
3. The Windows VM receives it as an ordinary remote mic — it never sees your physical audio setup.

For playback into the VM, create a **Combined Output** and point RustDesk's speaker at it if you want VM audio on both headset and TV.

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | PipeWire availability |
| `GET /api/state` | Full audio graph (sinks, sources, streams, modules, profile) |
| `POST /api/volume` | `{ kind, id, volume }` — kind: `sink`, `source`, `sink-input`, `source-output` |
| `POST /api/mute` | `{ kind, id, mute }` |
| `POST /api/move` | `{ kind: "sink-input" \| "source-output", id, target }` |
| `POST /api/default` | `{ kind: "sink" \| "source", name }` |
| `POST /api/combined-sink` | `{ name, slaves: string[] }` |
| `POST /api/virtual-mic` | `{ name, mics: string[] }` |
| `DELETE /api/module/:index` | Unload a virtual device |
| `POST /api/profile/apply` | Recreate saved virtual devices |

## How it works under the hood

No native modules — PipeDeck shells out to `pactl`, PipeWire's Pulse-compatible CLI:

- **Combined output** → `module-combine-sink` with N slaves
- **Virtual mic** → `module-null-sink` with `media.class=Audio/Source/Virtual` (appears as a real microphone), plus one `module-loopback` per source mic feeding it

That means anything you create in PipeDeck is a standard PipeWire device — visible to every app, persistent as long as the modules are loaded, and removable from any other tool.

## Roadmap

- [ ] WebSocket push instead of polling
- [ ] Per-app volume remember/reapply rules
- [ ] EQ/noise-gain strip (via EasyEffects preset hook)
- [ ] Dark/light theme toggle

## License

MIT
