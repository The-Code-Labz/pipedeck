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
- **Network / VBAN (Voicemeeter Potato equivalent)** — stream a mic or any audio to a *separate* PC (Linux **or Windows**) over the network, and receive audio back, via the [VBAN](https://www.vb-audio.com/Voicemeeter/vban.htm) protocol. Built for the streaming-PC / gaming-PC split setup: mic plugged into one box, needs to reach the other.
- **Profiles** — virtual devices *and* VBAN streams are saved automatically; "Apply Profile" (and every restart) recreates them.
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

The script also builds and installs `vban_emitter`/`vban_receptor` (from
[quiniouben/vban](https://github.com/quiniouben/vban)) so the Network/VBAN
panel works out of the box — this step is best-effort and never fails the
rest of the install.

Options:

```bash
PIPEDECK_DIR=/opt/pipedeck PIPEDECK_PORT=8080 bash install.sh   # custom location/port
bash install.sh --no-service                                     # run in foreground, no systemd
bash install.sh --no-vban                                        # skip building the VBAN CLI tools
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
export UID
docker compose up -d
```

The container needs the host's PipeWire socket — `docker-compose.yml` mounts `/run/user/$UID/pulse` and `/run/user/$UID/pipewire-0`, sets `XDG_RUNTIME_DIR` to match so `pactl` inside the container actually finds them, and uses host networking so `pactl` sees your real audio graph (also required for VBAN's raw UDP traffic).

`export UID` is required because Compose doesn't auto-export bash's built-in `$UID` — without it the mounts silently fall back to `1000`. If your host user isn't UID 1000, `export UID` picks up the correct value automatically.

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

## Network / VBAN — Linux to Windows (or another Linux box)

This is the piece RustDesk doesn't give you: a dedicated, low-latency audio
link between two *separate* physical machines — no remote-desktop software
in the loop. Same idea as Voicemeeter Potato's VBAN tab, built on
[VBAN](https://www.vb-audio.com/Voicemeeter/vban.htm) (plain PCM-over-UDP,
codec-free, OS-agnostic).

**Headset on the Linux box, need it as a mic on a Windows box:**

1. In PipeDeck's Network/VBAN panel, "Start emitter" — name it, destination
   IP = the Windows box, port `6980`, device = your physical mic. PipeDeck
   spawns `vban_emitter` and routes your mic into it automatically.
2. On Windows: install [VB-CABLE](https://vb-audio.com/Cable/) (free), then
   run [VBAN Receptor](https://vb-audio.com/Voicemeeter/vban.htm) (or
   Voicemeeter's VBAN tab if you already run it) with stream name matching,
   port `6980`, output device = CABLE Input.
3. Select **CABLE Output** as the mic in Discord/the game/whatever needs it.

**Streamer split-PC setup (mic → game PC, game/Discord audio → stream PC for OBS):**

- Leg 1 (mic → game PC): emitter on the mic PC as above, port `6980`.
- Leg 2 (game audio → stream PC): on the game PC (Windows), run VBAN Sender
  pointed at the stream PC, port `6981`; on the stream PC, "Start receptor"
  in PipeDeck with the game PC's IP, port `6981`, device = a null-sink OBS
  is already capturing.

Both legs are independent VBAN streams — PipeDeck tracks each as a child
process, rebinds it onto the PipeWire device you picked, and restarts it
automatically on reboot (saved in the same profile as combined sinks and
virtual mics).

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
| `POST /api/profile/apply` | Recreate saved virtual devices and VBAN streams |
| `GET /api/vban` | VBAN binary availability + running streams |
| `POST /api/vban/emitter` | `{ name, ip, port, device, streamName?, rate?, channels? }` — capture `device` (a source) and send to `ip:port` |
| `POST /api/vban/receptor` | `{ name, ip, port, device, streamName?, quality? }` — receive from `ip:port` and play into `device` (a sink) |
| `POST /api/vban/:id/restart` | Restart a stream (e.g. after the binary crashed) |
| `DELETE /api/vban/:id` | Stop a stream and remove it from the profile |

## How it works under the hood

No native modules — PipeDeck shells out to `pactl`, PipeWire's Pulse-compatible CLI:

- **Combined output** → `module-combine-sink` with N slaves
- **Virtual mic** → `module-null-sink` with `media.class=Audio/Source/Virtual` (appears as a real microphone), plus one `module-loopback` per source mic feeding it
- **Network / VBAN** → spawns `vban_emitter`/`vban_receptor` as tracked child processes; since those tools' pulseaudio backend opens a stream without letting you pick the device up front, PipeDeck finds the new source-output/sink-input by its stream name and `pactl move-source-output`/`move-sink-input`s it onto the PipeWire device you chose

That means anything you create in PipeDeck is a standard PipeWire device — visible to every app, persistent as long as the modules (or VBAN processes) are running, and removable from any other tool.

## Roadmap

- [ ] WebSocket push instead of polling
- [ ] Per-app volume remember/reapply rules
- [ ] EQ/noise-gain strip (via EasyEffects preset hook)
- [ ] Dark/light theme toggle

## License

MIT
