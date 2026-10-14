#!/usr/bin/env bash
# setup-linux.sh — one-time environment setup for AIPortable-JustAI on Linux.
#
# Takes a brand-new machine from "just this folder" to "ready to launch":
#
#   1. System packages — the shared libraries Electron needs to open a window,
#                        plus curl/tar/zstd and a C/C++ toolchain (only used to
#                        build the optional voice server). Uses sudo with
#                        apt, dnf or pacman. Skip with --no-system-deps.
#   2. Node.js         — uses an existing Node.js 22.12+ if one is on PATH;
#                        otherwise downloads a PORTABLE copy of the current
#                        Node.js LTS into runtime/node/ (no root needed).
#   3. npm ci          — installs Electron and every other dependency from
#                        package-lock.json, copies the renderer's vendor bundles
#                        and makes sure better-sqlite3 loads inside Electron.
#   4. Electron sandbox— makes node_modules/electron/dist/chrome-sandbox
#                        setuid-root (sudo) so Electron's sandbox works on
#                        distros that restrict unprivileged user namespaces
#                        (e.g. Ubuntu 24.04+). If that isn't possible, the
#                        launcher falls back to --no-sandbox automatically.
#   5. Ollama          — downloads the official portable Linux build from
#                        github.com/ollama/ollama into resources/ollama/linux/
#                        (no system-wide install, no systemd service).
#   6. Data folders    — creates empty data/models and data/library.
#   7. Models          — pulls nomic-embed-text (Library semantic search) and,
#                        with --model, one chat model too.
#   8. Voice input     — OPTIONAL (--with-voice): builds whisper.cpp's server
#                        from source and downloads the base.en model.
#   9. Verify          — checks that everything the launcher needs is present.
#
# Safe to re-run: every step skips work that is already done.
#
# Usage (from anywhere, as your normal user — NOT with sudo):
#   bash scripts/setup-linux.sh [flags]
#
# Flags:
#   --no-system-deps     Don't install distro packages (you handle them).
#   --no-sandbox-fix     Don't touch chrome-sandbox permissions.
#   --skip-ollama        Don't download Ollama (use a system install from
#                        https://ollama.com/download; the app falls back to
#                        'ollama' on PATH automatically).
#   --ollama-version v   Pin an Ollama release tag, e.g. v0.12.3 (default latest).
#   --rocm               Also download Ollama's AMD ROCm GPU add-on package.
#   --skip-models        Don't pull any models during setup.
#   --model NAME         Also pull this chat model, e.g. --model qwen2.5:3b
#   --with-voice         Also build/install the optional whisper.cpp server.
#   --desktop-entry      Add an "AIPortable-JustAI" entry to your app menu.
#   -h, --help           Show this help.

set -euo pipefail

# ---------------------------------------------------------------- options
SYSTEM_DEPS=1
SANDBOX_FIX=1
SKIP_OLLAMA=0
OLLAMA_VERSION=latest
ROCM=0
SKIP_MODELS=0
MODEL=""
WITH_VOICE=0
DESKTOP_ENTRY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-system-deps) SYSTEM_DEPS=0 ;;
    --no-sandbox-fix) SANDBOX_FIX=0 ;;
    --skip-ollama)    SKIP_OLLAMA=1 ;;
    --ollama-version) OLLAMA_VERSION="${2:?--ollama-version needs a value}"; shift ;;
    --rocm)           ROCM=1 ;;
    --skip-models)    SKIP_MODELS=1 ;;
    --model)          MODEL="${2:?--model needs a value}"; shift ;;
    --with-voice)     WITH_VOICE=1 ;;
    --desktop-entry)  DESKTOP_ENTRY=1 ;;
    -h|--help)        sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
  shift
done

# ---------------------------------------------------------------- helpers
c_cyan=$'\e[36m'; c_green=$'\e[32m'; c_yellow=$'\e[33m'; c_red=$'\e[31m'; c_off=$'\e[0m'
step() { echo; echo "${c_cyan}==> $*${c_off}"; }
ok()   { echo "    ${c_green}OK:${c_off} $*"; }
note() { echo "    ${c_yellow}NOTE:${c_off} $*"; }
fail() { echo; echo "${c_red}SETUP FAILED:${c_off} $*"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

download() { # url dest
  echo "    Downloading $1"
  curl -fL --retry 3 --progress-bar -o "$2" "$1" || return 1
}

if [[ $EUID -eq 0 ]]; then
  fail "Don't run this script as root / with sudo. Run it as your normal user — it calls sudo itself only for the steps that need it."
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "AIPortable-JustAI setup running in: $ROOT"

case "$(uname -m)" in
  x86_64|amd64)  NODE_ARCH=x64;   OLLAMA_ARCH=amd64 ;;
  aarch64|arm64) NODE_ARCH=arm64; OLLAMA_ARCH=arm64 ;;
  *) fail "Unsupported CPU architecture: $(uname -m) (need x86_64 or arm64)." ;;
esac

SUDO=""
if have sudo; then SUDO="sudo"; fi

TMPDIR_SETUP="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SETUP"' EXIT

# ---------------------------------------------------------------- 1. system packages
step "System packages"
if [[ $SYSTEM_DEPS -eq 0 ]]; then
  note "Skipped (--no-system-deps). See SETUP.md for the package list if Electron fails to start."
elif [[ -z "$SUDO" ]]; then
  note "sudo not available — skipping. Install the packages listed in SETUP.md yourself if Electron fails to start."
else
  VOICE_PKGS=()
  if have apt-get; then
    # Ubuntu 24.04+/Debian 13 renamed libasound2 to libasound2t64.
    ASOUND=libasound2
    if apt-cache show libasound2t64 >/dev/null 2>&1; then ASOUND=libasound2t64; fi
    [[ $WITH_VOICE -eq 1 ]] && VOICE_PKGS=(cmake git)
    $SUDO apt-get update
    $SUDO apt-get install -y curl ca-certificates tar xz-utils zstd build-essential python3 \
      libgtk-3-0 libnss3 libxss1 "$ASOUND" libgbm1 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxrandr2 libcups2 libpango-1.0-0 libcairo2 fonts-dejavu-core ${VOICE_PKGS[@]+"${VOICE_PKGS[@]}"}
  elif have dnf; then
    [[ $WITH_VOICE -eq 1 ]] && VOICE_PKGS=(cmake git)
    $SUDO dnf install -y curl ca-certificates tar xz zstd gcc gcc-c++ make python3 \
      gtk3 nss libXScrnSaver alsa-lib mesa-libgbm at-spi2-atk libdrm libxkbcommon \
      libXcomposite libXdamage libXrandr cups-libs pango cairo dejavu-sans-fonts ${VOICE_PKGS[@]+"${VOICE_PKGS[@]}"}
  elif have pacman; then
    [[ $WITH_VOICE -eq 1 ]] && VOICE_PKGS=(cmake git)
    $SUDO pacman -S --needed --noconfirm curl ca-certificates tar xz zstd base-devel python \
      gtk3 nss libxss alsa-lib mesa at-spi2-core libdrm libxkbcommon \
      libxcomposite libxdamage libxrandr libcups pango cairo ttf-dejavu ${VOICE_PKGS[@]+"${VOICE_PKGS[@]}"}
  elif have zypper; then
    [[ $WITH_VOICE -eq 1 ]] && VOICE_PKGS=(cmake git)
    $SUDO zypper --non-interactive install curl ca-certificates tar xz zstd gcc gcc-c++ make python3 \
      gtk3 mozilla-nss libXss1 alsa libgbm1 at-spi2-atk libdrm2 libxkbcommon0 \
      libXcomposite1 libXdamage1 libXrandr2 cups-libs dejavu-fonts ${VOICE_PKGS[@]+"${VOICE_PKGS[@]}"}
  else
    note "Unrecognised package manager — install the packages listed in SETUP.md yourself."
  fi
  ok "System packages installed"
fi
for tool in curl tar; do have "$tool" || fail "'$tool' is required but not installed."; done

# ---------------------------------------------------------------- 2. Node.js
step "Checking for Node.js (22.12 or newer)"
# Electron 44 / better-sqlite3 13 need Node 22.12+ for installation.
node_ok() { # node-binary
  local v major minor
  v="$("$1" -v 2>/dev/null)" || return 1
  v="${v#v}"; major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  (( major > 22 || (major == 22 && minor >= 12) ))
}
PORTABLE_NODE="$ROOT/runtime/node"
if [[ -x "$PORTABLE_NODE/bin/node" ]] && node_ok "$PORTABLE_NODE/bin/node"; then
  export PATH="$PORTABLE_NODE/bin:$PATH"
  ok "Using portable Node.js already in runtime/node ($(node -v))"
elif have node && node_ok node; then
  ok "Using system Node.js $(node -v)"
else
  have node && note "System Node.js $(node -v) is too old (need 22.12+) — using a portable copy instead."
  echo "    Looking up the current Node.js LTS release..."
  NODE_VER="$(curl -fsSL https://nodejs.org/dist/index.json 2>/dev/null | tr '{' '\n' \
    | grep -v '"lts":false' | grep "\"linux-$NODE_ARCH\"" | head -n1 \
    | sed -E 's/.*"version":"([^"]+)".*/\1/')" || true
  [[ "$NODE_VER" =~ ^v[0-9]+ ]] || fail "Could not look up the Node.js LTS version (no internet?). Install Node.js 22.12+ yourself and re-run."
  NODE_TAR="node-$NODE_VER-linux-$NODE_ARCH.tar.xz"
  download "https://nodejs.org/dist/$NODE_VER/$NODE_TAR" "$TMPDIR_SETUP/$NODE_TAR" || fail "Node.js download failed."
  rm -rf "$PORTABLE_NODE"; mkdir -p "$PORTABLE_NODE"
  tar -xJf "$TMPDIR_SETUP/$NODE_TAR" -C "$PORTABLE_NODE" --strip-components=1
  export PATH="$PORTABLE_NODE/bin:$PATH"
  ok "Portable Node.js $NODE_VER installed in runtime/node"
fi
echo "    node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------- 3. npm dependencies
step "Installing app dependencies (Electron etc.) — needs internet, can take a few minutes"
ELECTRON_BIN="$ROOT/node_modules/electron/dist/electron"
SANDBOX_BIN="$ROOT/node_modules/electron/dist/chrome-sandbox"
# Functional check rather than a file-path check: load better-sqlite3 inside
# Electron's own Node (ELECTRON_RUN_AS_NODE) and run a query — exactly what the
# app does at startup, independent of where the package keeps its binary.
sqlite_loads() {
  [[ -x "$ELECTRON_BIN" ]] || return 1
  [[ "$(ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e "process.stdout.write(String(require('better-sqlite3')(':memory:').prepare('select 41+1 as x').get().x))" 2>/dev/null)" == 42 ]]
}
if [[ -x "$ELECTRON_BIN" && -f "$ROOT/src/renderer/vendor/marked.min.js" ]] && sqlite_loads; then
  ok "Dependencies already installed — skipping (delete node_modules to force a reinstall)"
else
  # --ignore-scripts: skip package install scripts (npm 12+ blocks them by
  # default anyway), then run just the two steps that matter explicitly:
  # Electron's runtime download, and our postinstall (copies the renderer's
  # vendor assets). better-sqlite3 13 ships prebuilt binaries, so nothing
  # needs compiling.
  npm_failed() {
    echo
    echo "${c_red}npm failed — see the error above.${c_off} Common fixes:"
    echo "  - Check your internet connection / proxy, then re-run."
    echo "  - If it mentions node-gyp / make / better-sqlite3: install a compiler toolchain"
    echo "    (build-essential + python3 on Debian/Ubuntu) and re-run."
    exit 1
  }
  if [[ -f package-lock.json ]]; then npm ci --ignore-scripts --no-audit --no-fund || npm_failed
  else npm install --ignore-scripts --no-audit --no-fund || npm_failed; fi
  echo "    Downloading the Electron runtime..."
  node node_modules/electron/install.js || npm_failed
  echo "    Copying vendor assets..."
  npm run postinstall || npm_failed
  ok "Electron installed, better-sqlite3 ready for Electron, vendor assets copied"
fi

# ---------------------------------------------------------------- 4. Electron sandbox
step "Electron sandbox helper"
sandbox_ok() { [[ -f "$SANDBOX_BIN" && "$(stat -c '%u' "$SANDBOX_BIN")" == "0" && -u "$SANDBOX_BIN" ]]; }
if sandbox_ok; then
  ok "chrome-sandbox is already setuid root"
elif [[ $SANDBOX_FIX -eq 1 && -n "$SUDO" && -f "$SANDBOX_BIN" ]]; then
  if $SUDO chown root:root "$SANDBOX_BIN" && $SUDO chmod 4755 "$SANDBOX_BIN" && sandbox_ok; then
    ok "chrome-sandbox set to root:root 4755"
  else
    note "Couldn't set chrome-sandbox permissions (e.g. the folder is on a FAT/exFAT/NTFS or 'nosuid' drive). The launcher will use --no-sandbox instead."
  fi
else
  note "Skipped. The launcher uses --no-sandbox automatically when chrome-sandbox isn't setuid root."
fi

# ---------------------------------------------------------------- 5. Ollama
OLLAMA_DIR="$ROOT/resources/ollama/linux"
if [[ "$OLLAMA_VERSION" == latest ]]; then
  OLLAMA_BASE="https://github.com/ollama/ollama/releases/latest/download"
else
  OLLAMA_BASE="https://github.com/ollama/ollama/releases/download/$OLLAMA_VERSION"
fi

# Ollama has shipped its Linux bundle as both .tgz and .tar.zst over time —
# try the newer name first, then the older one.
fetch_ollama_bundle() { # base-name (e.g. ollama-linux-amd64)
  local name="$1" f
  for ext in tar.zst tgz; do
    f="$TMPDIR_SETUP/$name.$ext"
    # Probe quietly first, so a variant that doesn't exist doesn't print a 404,
    # while the real download still shows its progress bar.
    curl -fsIL --max-time 30 "$OLLAMA_BASE/$name.$ext" >/dev/null 2>&1 || continue
    if download "$OLLAMA_BASE/$name.$ext" "$f"; then
      case "$ext" in
        tar.zst) have zstd || fail "zstd is needed to unpack $name.$ext — install it and re-run."
                 zstd -dc "$f" | tar -x -C "$OLLAMA_DIR" ;;
        tgz)     tar -xzf "$f" -C "$OLLAMA_DIR" ;;
      esac
      rm -f "$f"
      return 0
    fi
  done
  return 1
}

if [[ $SKIP_OLLAMA -eq 1 ]]; then
  step "Skipping Ollama download (--skip-ollama)"
  note "Install Ollama from https://ollama.com/download — the app uses 'ollama' on PATH when no portable copy is present."
else
  step "Setting up portable Ollama ($OLLAMA_VERSION, linux-$OLLAMA_ARCH)"
  mkdir -p "$OLLAMA_DIR"
  if [[ -x "$OLLAMA_DIR/bin/ollama" ]]; then
    ok "Portable Ollama already present — skipping (delete resources/ollama/linux/bin to force a re-download)"
  else
    fetch_ollama_bundle "ollama-linux-$OLLAMA_ARCH" || fail "Could not download Ollama from $OLLAMA_BASE (tried .tar.zst and .tgz)."
    [[ -x "$OLLAMA_DIR/bin/ollama" ]] || fail "Ollama unpacked, but bin/ollama is missing — check $OLLAMA_DIR."
    ok "Portable Ollama installed in resources/ollama/linux"
  fi
  if [[ $ROCM -eq 1 ]]; then
    [[ $OLLAMA_ARCH == amd64 ]] || fail "--rocm is only available on x86_64."
    echo "    Adding the AMD ROCm GPU package..."
    fetch_ollama_bundle "ollama-linux-amd64-rocm" || fail "Could not download the Ollama ROCm package."
    ok "ROCm package added"
  fi
  # The app looks for resources/ollama/linux/ollama (see findBundledOllama in
  # src/main/main.js). The release bundle keeps the real binary in bin/ with
  # its GPU runner libraries in lib/ollama/, and Ollama finds those relative
  # to its own location — so rather than moving the binary, a tiny wrapper
  # execs it in place ('exec' keeps the same PID, so the app can still stop it).
  cat > "$OLLAMA_DIR/ollama" <<'EOF'
#!/bin/sh
exec "$(dirname "$0")/bin/ollama" "$@"
EOF
  chmod +x "$OLLAMA_DIR/ollama" "$OLLAMA_DIR/bin/ollama"
  ok "Launcher wrapper resources/ollama/linux/ollama in place"
fi

# ---------------------------------------------------------------- 6. data folders
step "Creating empty runtime data folders"
mkdir -p "$ROOT/data/models" "$ROOT/data/library"
ok "data/models and data/library ready (chats.db / library.db are created on first launch)"

# ---------------------------------------------------------------- 7. models
if [[ $SKIP_MODELS -eq 1 ]]; then
  step "Skipping model downloads (--skip-models)"
else
  step "Pulling models into data/models"
  OLLAMA_CMD=""
  if [[ -x "$OLLAMA_DIR/ollama" && -x "$OLLAMA_DIR/bin/ollama" ]]; then OLLAMA_CMD="$OLLAMA_DIR/ollama"
  elif have ollama; then OLLAMA_CMD="$(command -v ollama)"; fi

  if [[ -z "$OLLAMA_CMD" ]]; then
    note "No Ollama binary available — pull models later from Tools -> Models inside the app."
  else
    SERVER_PID=""
    if curl -fs --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      note "Another Ollama is already running on port 11434 (maybe a systemd 'ollama' service), so models go wherever THAT instance stores them, not data/models. Stop it ('sudo systemctl stop ollama') and re-run if you want them in the portable folder."
    else
      # Same OLLAMA_MODELS the app sets in main.js, so models land in the
      # portable data/models folder and travel with the app.
      echo "    Starting a temporary Ollama server..."
      OLLAMA_MODELS="$ROOT/data/models" "$OLLAMA_CMD" serve >"$TMPDIR_SETUP/ollama.log" 2>&1 &
      SERVER_PID=$!
    fi
    READY=0
    for _ in $(seq 1 30); do
      if curl -fs --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then READY=1; break; fi
      sleep 1
    done
    if [[ $READY -eq 0 ]]; then
      note "Ollama didn't start in time — pull models later from Tools -> Models. Server log:"
      tail -n 20 "$TMPDIR_SETUP/ollama.log" 2>/dev/null || true
    else
      PULL=("nomic-embed-text:latest")
      [[ -n "$MODEL" ]] && PULL+=("$MODEL")
      for m in "${PULL[@]}"; do
        echo "    ollama pull $m"
        if "$OLLAMA_CMD" pull "$m"; then ok "$m pulled"; else note "Pulling $m failed — you can pull it later from Tools -> Models."; fi
      done
    fi
    if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  fi
fi

# ---------------------------------------------------------------- 8. optional voice input
if [[ $WITH_VOICE -eq 1 ]]; then
  step "Installing optional voice input (whisper.cpp server + base.en model)"
  WHISPER_DIR="$ROOT/resources/whisper/linux"
  mkdir -p "$WHISPER_DIR"
  if [[ -x "$WHISPER_DIR/whisper-server" ]]; then
    ok "whisper-server already present — skipping"
  else
    for tool in git cmake c++; do have "$tool" || fail "'$tool' is needed to build whisper.cpp — install it (or drop --with-voice) and re-run."; done
    echo "    Building whisper.cpp (whisper.cpp publishes no Linux binaries, so it's compiled here — a few minutes)..."
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$TMPDIR_SETUP/whisper.cpp"
    cmake -S "$TMPDIR_SETUP/whisper.cpp" -B "$TMPDIR_SETUP/whisper.cpp/build" \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF
    cmake --build "$TMPDIR_SETUP/whisper.cpp/build" --config Release -j"$(nproc)" --target whisper-server
    SERVER_BUILT="$(find "$TMPDIR_SETUP/whisper.cpp/build" -type f -name whisper-server -perm -u+x | head -n1)"
    [[ -n "$SERVER_BUILT" ]] || fail "whisper.cpp built, but no whisper-server binary was produced."
    install -m 755 "$SERVER_BUILT" "$WHISPER_DIR/whisper-server"
    ok "whisper-server built and installed"
  fi
  if [[ -f "$WHISPER_DIR/model.bin" ]]; then
    ok "model.bin already present — skipping"
  else
    download "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" "$WHISPER_DIR/model.bin" \
      || { rm -f "$WHISPER_DIR/model.bin"; fail "whisper model download failed."; }
    ok "ggml-base.en model saved as resources/whisper/linux/model.bin"
  fi
fi

# ---------------------------------------------------------------- launcher + desktop entry
chmod +x "$ROOT/start-aiportable-justai.sh" 2>/dev/null || true
if [[ $DESKTOP_ENTRY -eq 1 ]]; then
  APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$APPS_DIR"
  cat > "$APPS_DIR/aiportable-justai.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=AIPortable-JustAI
Comment=Local, offline AI assistant (Ollama)
Exec="$ROOT/start-aiportable-justai.sh"
Path=$ROOT
Terminal=false
Categories=Utility;
EOF
  ok "Desktop entry written to $APPS_DIR/aiportable-justai.desktop"
fi

# ---------------------------------------------------------------- 9. verify
step "Verifying installation"
PROBLEMS=0
check() { # label path [optional]
  if [[ -e "$2" ]]; then ok "$1"
  elif [[ "${3:-}" == optional ]]; then note "$1 — not installed (optional)"
  else echo "    ${c_red}MISSING:${c_off} $1 ($2)"; PROBLEMS=$((PROBLEMS + 1)); fi
}
check "Electron"                     "$ELECTRON_BIN"
if sqlite_loads; then ok "better-sqlite3 loads inside Electron"
else echo "    ${c_red}MISSING:${c_off} better-sqlite3 does not load inside Electron — delete node_modules and re-run"; PROBLEMS=$((PROBLEMS + 1)); fi
check "Renderer vendor assets"       "$ROOT/src/renderer/vendor/pdf.mjs"
if [[ $SKIP_OLLAMA -eq 1 ]]; then check "Portable Ollama" "$OLLAMA_DIR/bin/ollama" optional
else check "Portable Ollama" "$OLLAMA_DIR/bin/ollama"; fi
check "Voice input (whisper-server)" "$ROOT/resources/whisper/linux/whisper-server" optional

# Electron needs these shared libraries at runtime; report any the loader can't find.
if [[ -x "$ELECTRON_BIN" ]] && have ldd; then
  MISSING_LIBS="$(ldd "$ELECTRON_BIN" 2>/dev/null | awk '/not found/ {print $1}' | sort -u | tr '\n' ' ')"
  if [[ -n "$MISSING_LIBS" ]]; then
    echo "    ${c_red}MISSING shared libraries for Electron:${c_off} $MISSING_LIBS"
    echo "    Install the packages that provide them (see SETUP.md) and re-run."
    PROBLEMS=$((PROBLEMS + 1))
  else
    ok "Electron's shared libraries all resolve"
  fi
fi

[[ $PROBLEMS -eq 0 ]] || fail "$PROBLEMS problem(s) found — see above, fix, and re-run this script."

step "Setup complete"
echo
echo "${c_cyan}Launch the app:${c_off}  ./start-aiportable-justai.sh"
echo "Then open Tools/Settings -> Models and pull a chat model (e.g. qwen2.5:3b)."
echo "See SETUP.md for the full walkthrough."
