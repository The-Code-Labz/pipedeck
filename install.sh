#!/usr/bin/env bash
#
# PipeDeck installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/The-Code-Labz/pipedeck/main/install.sh | bash
#   ./install.sh [--no-service] [--port PORT]
#
set -euo pipefail

REPO_URL="https://github.com/The-Code-Labz/pipedeck.git"
INSTALL_DIR="${PIPEDECK_DIR:-$HOME/pipedeck}"
PORT="${PIPEDECK_PORT:-4190}"
INSTALL_SERVICE=1
INSTALL_VBAN=1
NODE_MAJOR_MIN=20

log()  { printf '\033[1;34m[pipedeck]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[pipedeck]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[pipedeck]\033[0m %s\n' "$*" >&2; exit 1; }

# --- args -------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --no-service) INSTALL_SERVICE=0 ;;
    --no-vban)    INSTALL_VBAN=0 ;;
    --port)       PORT="$2"; shift ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

# --- must be Linux ----------------------------------------------------------
[ "$(uname -s)" = "Linux" ] || die "PipeDeck requires Linux (PipeWire). Detected: $(uname -s)"

# --- privileges: we never run the app as root --------------------------------
SUDO=""
if [ "$(id -u)" -eq 0 ]; then
  warn "running as root — system packages will install, but the app itself should run as your desktop user."
  warn "for the systemd user service, re-run as your normal user."
fi
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

# --- detect package manager --------------------------------------------------
PKG=""
for pm in apt-get dnf pacman zypper; do
  command -v "$pm" >/dev/null 2>&1 && { PKG="$pm"; break; }
done
[ -n "$PKG" ] || die "no supported package manager found (apt/dnf/pacman/zypper)"

pkg_install() {
  log "installing system packages: $*"
  case "$PKG" in
    apt-get) $SUDO apt-get update -qq && $SUDO apt-get install -y "$@" ;;
    dnf)     $SUDO dnf install -y "$@" ;;
    pacman)  $SUDO pacman -S --needed --noconfirm "$@" ;;
    zypper)  $SUDO zypper install -y "$@" ;;
  esac
}

# --- distro package names ----------------------------------------------------
case "$PKG" in
  apt-get) PKGS_NODE="nodejs npm";   PKGS_AUDIO="pipewire pipewire-pulse wireplumber" ;;
  dnf)     PKGS_NODE="nodejs npm";   PKGS_AUDIO="pipewire pipewire-pulse wireplumber" ;;
  pacman)  PKGS_NODE="nodejs npm";   PKGS_AUDIO="pipewire pipewire-pulse wireplumber" ;;
  zypper)  PKGS_NODE="nodejs npm";   PKGS_AUDIO="pipewire pipewire-pulse wireplumber" ;;
esac

# --- Node.js >= 20 ------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  cur="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$cur" -ge "$NODE_MAJOR_MIN" ]; then
    need_node=0
    log "node $(node --version) already installed"
  else
    warn "node $(node --version) is older than v$NODE_MAJOR_MIN"
  fi
fi

if [ "$need_node" -eq 1 ]; then
  # prefer the distro packages; fall back to NodeSource on apt/dnf
  pkg_install $PKGS_NODE || true
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt "$NODE_MAJOR_MIN" ]; then
    case "$PKG" in
      apt-get)
        log "installing Node.js $NODE_MAJOR_MIN via NodeSource"
        curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR_MIN}.x | $SUDO bash -
        $SUDO apt-get install -y nodejs
        ;;
      dnf)
        log "installing Node.js $NODE_MAJOR_MIN via NodeSource"
        curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR_MIN}.x | $SUDO bash -
        $SUDO dnf install -y nodejs
        ;;
      *) die "distro node too old; install Node.js >= $NODE_MAJOR_MIN manually and re-run" ;;
    esac
  fi
fi
command -v node >/dev/null 2>&1 || die "node install failed"
log "node $(node --version), npm $(npm --version)"

# --- PipeWire -----------------------------------------------------------------
audio_ok() { command -v pactl >/dev/null 2>&1 && pactl info >/dev/null 2>&1; }

audio_manual_hint() {
  case "$PKG" in
    apt-get) echo "sudo apt-get install pipewire pipewire-pulse wireplumber" ;;
    dnf)     echo "sudo dnf install pipewire pipewire-pulse wireplumber" ;;
    pacman)  echo "sudo pacman -S pipewire pipewire-pulse wireplumber" ;;
    zypper)  echo "sudo zypper install pipewire pipewire-pulse wireplumber" ;;
  esac
}

if audio_ok; then
  log "PipeWire detected: $(pactl info | awk -F': ' '/^Server Name/{print $2}')"
else
  warn "PipeWire not detected — installing audio stack"
  pkg_install $PKGS_AUDIO || warn "automatic PipeWire install failed"
  # packages may be installed but the per-user daemon not running yet
  if [ "$(id -u)" -ne 0 ] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user enable --now pipewire pipewire-pulse wireplumber 2>/dev/null || true
    sleep 2
  fi
fi

if ! audio_ok; then
  cat >&2 <<EOF

  $(printf '\033[1;31m[pipedeck]\033[0m') PipeWire is not available in this session and PipeDeck cannot route audio without it.

  1. Install the audio stack (if not already):
       $(audio_manual_hint)

  2. Start it for your user session:
       systemctl --user enable --now pipewire pipewire-pulse wireplumber
     ...or simply log out and back in.

  3. Verify, then re-run this installer:
       pactl info

  Note: PipeDeck must run as your normal desktop user (with a PipeWire
  session), not as root and not on a headless server without audio.
EOF
  exit 1
fi
log "PipeWire session active: $(pactl info | awk -F': ' '/^Server Name/{print $2}')"

# --- VBAN (network mic/audio bridge, Voicemeeter Potato style) ---------------
# Optional: build vban_emitter/vban_receptor from source. Failure here is
# non-fatal — the rest of PipeDeck works fine without it, and the "Network /
# VBAN" panel just tells the user the binaries are missing.
case "$PKG" in
  apt-get) PKGS_VBAN_BUILD="autoconf automake build-essential libasound2-dev libpulse-dev pkg-config" ;;
  dnf)     PKGS_VBAN_BUILD="autoconf automake gcc make alsa-lib-devel pulseaudio-libs-devel pkgconf-pkg-config" ;;
  pacman)  PKGS_VBAN_BUILD="autoconf automake base-devel alsa-lib libpulse" ;;
  zypper)  PKGS_VBAN_BUILD="autoconf automake gcc make alsa-devel libpulse-devel pkg-config" ;;
esac

if [ "$INSTALL_VBAN" -eq 1 ]; then
  if command -v vban_emitter >/dev/null 2>&1 && command -v vban_receptor >/dev/null 2>&1; then
    log "vban_emitter/vban_receptor already installed"
  else
    log "building vban (quiniouben/vban) for the Network/VBAN panel"
    if pkg_install $PKGS_VBAN_BUILD; then
      VBAN_SRC="$(mktemp -d)"
      if git clone --depth 1 https://github.com/quiniouben/vban.git "$VBAN_SRC/vban" >/tmp/vban-build.log 2>&1 \
        && (cd "$VBAN_SRC/vban" && ./autogen.sh && ./configure --disable-jack && make -j"$(nproc 2>/dev/null || echo 2)") >>/tmp/vban-build.log 2>&1 \
        && (cd "$VBAN_SRC/vban" && $SUDO make install) >>/tmp/vban-build.log 2>&1; then
        log "vban_emitter/vban_receptor installed"
      else
        warn "vban build failed — see /tmp/vban-build.log. Network/VBAN panel will report binaries missing until you install them manually."
      fi
      rm -rf "$VBAN_SRC"
    else
      warn "couldn't install vban build dependencies — skipping. Network/VBAN panel will report binaries missing."
    fi
  fi
else
  log "skipping vban build (--no-vban)"
fi

# --- clone or update ----------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  if [ -e "$INSTALL_DIR" ]; then
    die "$INSTALL_DIR exists and is not a git checkout — remove it or set PIPEDECK_DIR"
  fi
  log "cloning $REPO_URL → $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# --- build --------------------------------------------------------------------
log "installing dependencies"
npm run install:all
log "building"
npm run build

# --- configure ----------------------------------------------------------------
if [ ! -f backend/.env ]; then
  cat > backend/.env <<EOF
PORT=$PORT
EOF
  log "wrote backend/.env (PORT=$PORT)"
fi

# --- systemd user service ------------------------------------------------------
if [ "$INSTALL_SERVICE" -eq 1 ] && [ "$(id -u)" -ne 0 ] && command -v systemctl >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/pipedeck.service" <<EOF
[Unit]
Description=PipeDeck audio routing hub
After=pipewire-pulse.service
Wants=pipewire-pulse.service

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/backend
ExecStart=$(command -v node) dist/index.js
Restart=on-failure
RestartSec=3
Environment=PORT=$PORT

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now pipedeck.service
  log "systemd user service enabled — starts automatically on login"
  log "manage with: systemctl --user {status,restart,stop} pipedeck"
else
  if [ "$INSTALL_SERVICE" -eq 1 ]; then
    warn "skipping systemd user service (running as root or systemctl unavailable)"
  fi
  log "starting in the foreground — Ctrl-C to stop"
  trap 'log "stopped"' EXIT
  cd backend && exec node dist/index.js
fi

cat <<EOF

  PipeDeck is running.
  Web UI:  http://localhost:$PORT
  Health:  curl http://localhost:$PORT/api/health
EOF
