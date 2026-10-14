#!/usr/bin/env bash
# start-aiportable-justai.sh — Linux launcher for AIPortable-JustAI.
#
# Resolves its own folder, so it works from any location (fixed folder, USB
# drive, a different mount point on another machine). Prefers a packaged
# build (dist/linux-unpacked/aiportable-justai) if one exists, otherwise runs
# from source using Electron's own binary from node_modules — Node.js itself
# is NOT needed at launch time, only during setup.
#
# Electron's sandbox needs node_modules/electron/dist/chrome-sandbox to be
# owned by root with mode 4755 (scripts/setup-linux.sh does that). When it
# isn't — e.g. the folder lives on an exFAT/NTFS USB drive, where setuid bits
# can't exist — this falls back to --no-sandbox so the app still starts.
#
# Any extra arguments are passed through to Electron (e.g. --enable-logging).

set -euo pipefail
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
cd "$ROOT"

PACKAGED="$ROOT/dist/linux-unpacked/aiportable-justai"
ELECTRON="$ROOT/node_modules/electron/dist/electron"

if [[ -x "$PACKAGED" ]]; then
  BIN="$PACKAGED"; APP_ARGS=()
  SANDBOX="$ROOT/dist/linux-unpacked/chrome-sandbox"
elif [[ -x "$ELECTRON" ]]; then
  BIN="$ELECTRON"; APP_ARGS=("$ROOT")
  SANDBOX="$ROOT/node_modules/electron/dist/chrome-sandbox"
else
  echo "Setup isn't finished yet."
  echo
  echo "Run this first (needs an internet connection once):"
  echo "    bash scripts/setup-linux.sh"
  exit 1
fi

EXTRA=()
if ! [[ -f "$SANDBOX" && "$(stat -c '%u' "$SANDBOX")" == "0" && -u "$SANDBOX" ]]; then
  EXTRA+=(--no-sandbox)
fi

exec "$BIN" ${APP_ARGS[@]+"${APP_ARGS[@]}"} ${EXTRA[@]+"${EXTRA[@]}"} "$@"
