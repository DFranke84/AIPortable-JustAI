# AIPortable-JustAI — Setup Guide (Windows & Linux)

This folder holds **only the source code, config, and setup scripts**. It
does not include Node.js, Electron, Ollama, AI models, chat history, or
library documents. The setup script downloads the software; the models and
your data come later, from inside the app.

| Included | Not included (setup or the app fetches/creates these) |
|---|---|
| App source (`src/`) | `node_modules/` (Electron + libraries), from `npm` |
| Model catalog lists (`data/*-models-catalog.json`) | Portable Node.js (`runtime/node/`), only if you have no Node 22.12+ |
| Setup scripts and launchers | Ollama (`resources/ollama/<os>/`) |
| `package.json` / `package-lock.json` (pinned versions) | AI models (`data/models/`) |
| | Chat history (`data/chats.db`), created on first launch |
| | Library database (`data/library.db`), created empty on first launch |
| | Voice input (whisper.cpp), optional |

Everything the app writes lives **inside this folder** under `data/`. You
can move or copy the whole folder, including to a USB drive, and it keeps
working. The one exception is a small per-machine preferences file (window
size, GPU tier, custom model folder):

- Windows: `%APPDATA%\aiportable-justai\host-settings.json`
- Linux: `~/.config/aiportable-justai/host-settings.json`

---

## Contents

1. [Requirements](#1-requirements)
2. [Windows setup](#2-windows-setup)
3. [Linux setup](#3-linux-setup)
4. [First launch: get a model](#4-first-launch-get-a-model)
5. [Optional extras](#5-optional-extras)
6. [Manual install (if a script can't be used)](#6-manual-install-if-a-script-cant-be-used)
7. [Updating components](#7-updating-components)
8. [Building a standalone packaged app (optional)](#8-building-a-standalone-packaged-app-optional)
9. [Troubleshooting](#9-troubleshooting)
10. [Uninstall / reset](#10-uninstall--reset)

---

## 1. Requirements

| | Minimum | Notes |
|---|---|---|
| OS | Windows 10/11 64-bit, or a 64-bit Linux desktop (Ubuntu/Debian, Fedora, Arch, openSUSE) | x64 or ARM64 |
| RAM | 8 GB | 16 GB+ recommended for 7B–8B models |
| Disk | ~3 GB for the app + Ollama | Plus 0.3–20 GB **per model** |
| GPU | Optional | NVIDIA: a current driver is enough, since Ollama bundles CUDA. AMD: add `-Rocm` / `--rocm`. Without a GPU, models run on the CPU (slower). |
| Internet | Only during setup and while pulling models | Everything runs offline afterwards |

**Don't** run the setup scripts as Administrator or root. They use no admin
rights on Windows. On Linux they call `sudo` themselves, and only to install
distro packages and set the Electron sandbox permission.

---

## 2. Windows setup

### Step 2.1 — Put the folder where it will live

Copy `AIPortable-JustAI` to its permanent location, for example
`E:\AIPortable-JustAI` or a USB drive. Avoid OneDrive-synced folders, which
lock files during `npm` installs.

### Step 2.2 — Run the setup script

Double-click **`Setup-Windows.bat`**.

Or, from a PowerShell window opened in the folder:

```bash
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

First it asks **which chat model to download**: it detects your graphics
card's memory and lists the matching model catalog (4K/8K/12K/24K/32K). Type a
number — the first *General* model is a good choice — or press Enter to skip.
After that it runs on its own, printing a `==>` line for each step and a
green `OK:` for each success:

| # | Step | What happens |
|---|---|---|
| 1 | Node.js | Uses your Node.js 22.12+ if you have one. Otherwise it downloads a **portable** Node.js LTS into `runtime\node\`, with no admin rights and no changes to PATH or the registry. |
| 2 | App dependencies | `npm ci` installs from the lockfile, then downloads the **Electron** runtime, and copies the renderer libraries (marked, pdf.js). The **better-sqlite3** database library ships ready-made binaries, so nothing is compiled. |
| 3 | Ollama | Downloads the official portable `ollama-windows-amd64.zip` (or arm64) from GitHub into `resources\ollama\win\`. Nothing is installed system-wide. |
| 4 | Kiwix | Downloads `kiwix-serve` (~15 MB) from download.kiwix.org into `resources\kiwix\win\`. It powers the 🗃️ ZIM archive search in chat. |
| 5 | Voice input | Downloads the whisper.cpp server and the `ggml-base.en` model (~150 MB) into `resources\whisper\win\` for the 🎤 button. Skip with `-NoVoice`. |
| 6 | Data folders | Creates empty `data\models` and `data\library`. |
| 7 | Models | Starts a temporary Ollama and pulls **`nomic-embed-text`** (~274 MB), which powers Library semantic search, plus the chat model you picked. |
| 8 | Verify | Checks that every component is in place and that the database library loads inside Electron, then offers to start the app. |

Expect about 2 GB of downloads (Ollama is most of it) plus your chat model.
The script is safe to re-run: it skips any step that's already done.

**Flags.** Add them after the `.bat` or `.ps1`, for example
`Setup-Windows.bat -Model qwen2.5:3b`.

| Flag | Effect |
|---|---|
| `-Model <name>` | Pull this chat model instead of asking, e.g. `-Model qwen2.5:3b` |
| `-SkipModels` | Don't pull any models now |
| `-Rocm` | Also install Ollama's AMD ROCm GPU package |
| `-OllamaVersion v0.x.y` | Pin a specific Ollama release (default: latest) |
| `-SkipOllama` | Don't download Ollama; use one installed from ollama.com instead |
| `-UseWinget` | Install Node.js system-wide with winget instead of the portable copy |
| `-NoVoice` | Leave out voice input (installed by default) |
| `-NoLaunch` | Don't offer to start the app at the end |

### Step 2.3 — Launch

- **`AIPortable-JustAI.vbs`**: double-click. Opens with no console window.
- **`Start-AIPortable-JustAI-With-Console.bat`**: same, but keeps a console
  open with log output. Useful for troubleshooting.

The launchers run Electron directly, so Node.js isn't needed after setup.
Continue with [section 4](#4-first-launch-get-a-model).

---

## 3. Linux setup

### Step 3.1 — Put the folder where it will live

For the best result, use a **Linux filesystem** (ext4, btrfs, and so on),
e.g. `~/AIPortable-JustAI`. It also runs from exFAT/NTFS USB drives, but
Electron then has to run with `--no-sandbox`, because those filesystems
can't store the setuid permission the sandbox needs. The launcher handles
this automatically.

### Step 3.2 — Run the setup script

Open a terminal in the folder and run it **as your normal user**:

```bash
bash scripts/setup-linux.sh
```

It asks for your sudo password once, to install distro packages.

| # | Step | What happens |
|---|---|---|
| 1 | System packages | Installs Electron's GUI libraries (GTK3, NSS, ALSA, GBM, …), `curl`/`tar`/`zstd`, and a compiler toolchain (used only to build the optional voice server). Uses `apt`, `dnf`, `pacman`, or `zypper`. The full lists are below. |
| 2 | Node.js | Uses your Node.js 22.12+ if present. Otherwise it downloads a **portable** Node.js LTS into `runtime/node/`, without root. |
| 3 | App dependencies | `npm ci`, then the Electron runtime and the renderer libraries. Nothing is compiled. |
| 4 | Electron sandbox | `sudo chown root:root` + `chmod 4755` on `node_modules/electron/dist/chrome-sandbox`. Needed on distros that restrict user namespaces, such as Ubuntu 24.04+. |
| 5 | Ollama | Downloads the official `ollama-linux-amd64.tar.zst` (or arm64) from GitHub into `resources/ollama/linux/`. There is no system service and no systemd unit. |
| 5b | Kiwix | Downloads `kiwix-serve` from download.kiwix.org into `resources/kiwix/linux/` (🗃️ ZIM search). |
| 6 | Data folders | Creates empty `data/models` and `data/library`. |
| 7 | Models | Pulls **`nomic-embed-text`**, plus the `--model` model if you gave one. |
| 8 | Voice (optional) | Only with `--with-voice`. whisper.cpp is compiled from source because it publishes no Linux binaries. |
| 9 | Verify | Checks every component, and uses `ldd` to confirm that all of Electron's shared libraries resolve. |

The script is safe to re-run.

**Flags**

| Flag | Effect |
|---|---|
| `--model <name>` | Also pull a chat model, e.g. `--model qwen2.5:3b` |
| `--skip-models` | Don't pull any models now |
| `--rocm` | Also install Ollama's AMD ROCm GPU package |
| `--ollama-version v0.x.y` | Pin an Ollama release (default: latest) |
| `--skip-ollama` | Don't download Ollama; use a system install instead |
| `--no-system-deps` | Don't install distro packages; you handle them (see the lists below) |
| `--no-sandbox-fix` | Don't change chrome-sandbox permissions |
| `--with-voice` | Build and install the optional whisper.cpp voice server |
| `--desktop-entry` | Add "AIPortable-JustAI" to your desktop's application menu |

**Distro packages the script installs.** Use these if you install them
yourself with `--no-system-deps`:

- **Debian/Ubuntu:** `curl ca-certificates tar xz-utils zstd build-essential python3 libgtk-3-0 libnss3 libxss1 libasound2 (libasound2t64 on Ubuntu 24.04+) libgbm1 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libcups2 libpango-1.0-0 libcairo2 fonts-dejavu-core`
- **Fedora/RHEL:** `curl ca-certificates tar xz zstd gcc gcc-c++ make python3 gtk3 nss libXScrnSaver alsa-lib mesa-libgbm at-spi2-atk libdrm libxkbcommon libXcomposite libXdamage libXrandr cups-libs pango cairo dejavu-sans-fonts`
- **Arch:** `curl ca-certificates tar xz zstd base-devel python gtk3 nss libxss alsa-lib mesa at-spi2-core libdrm libxkbcommon libxcomposite libxdamage libxrandr libcups pango cairo ttf-dejavu`
- **openSUSE:** `curl ca-certificates tar xz zstd gcc gcc-c++ make python3 gtk3 mozilla-nss libXss1 alsa libgbm1 at-spi2-atk libdrm2 libxkbcommon0 libXcomposite1 libXdamage1 libXrandr2 cups-libs dejavu-fonts`
- `--with-voice` additionally needs `git` and `cmake`.

### Step 3.3 — Launch

```bash
./start-aiportable-justai.sh
```

If the file lost its executable bit, for example after copying from a
Windows drive, run `bash start-aiportable-justai.sh`. Anything after the
script name is passed to Electron, e.g. `--enable-logging`. To get a menu
entry, re-run setup with `--desktop-entry`.

---

## 4. First launch: get a model

On first launch the app opens to an empty chat. The status dot turns green
("Model runtime ready") once Ollama has started, which takes a few seconds.

1. Open **🛠️ Tools/Settings → Models**.
2. Under **GPU size**, pick your card's VRAM tier (4K = 4 GB, 8K, 12K, 24K,
   32K). You can select several. This only filters the catalog list; it
   doesn't limit what you can run.
3. In **Catalog**, click **Pull** on a model (skip this if you picked one
   during setup). For a fast first model, pick a small one of 1–3 GB, such
   as `qwen2.5:3b` or `llama3.2:1b`.
4. Pick the model from the dropdown at the top of the chat and start typing.

Other things to know:

- **`nomic-embed-text`** is pulled during setup. If you used `-SkipModels` /
  `--skip-models`, pull it from the catalog's *Embedding* section. Without
  it, Library search falls back to keywords only.
- **Context length** (Models tab): "Auto" is fine for plain chat. Pick
  8K–16K if you attach documents or images often.
- **Library** (Tools → Library): upload `.txt`, `.md`, `.pdf`, `.docx`, or
  `.doc` files into a category you create. Then turn on the 📚 button in
  the chat composer to have matching passages fed to the model.
  **📖 Reference Library** in the sidebar browses everything you've added.
- **Analyze Image / Translate** (sidebar): these need a *vision* model for
  images, such as `moondream` or a `qwen2.5vl` model from the Vision
  category.
- **Mobile sync** (Tools): serves a simple chat page to phones on the same
  network.
- **Model storage location** (Tools → Models): models live in the portable
  `data/models` by default. **Choose folder on this PC…** keeps them on a
  faster local disk instead, and the sync buttons copy them between the two
  locations.

The command line works too, while the app (or any `ollama serve`) is
running:

```bash
resources/ollama/linux/ollama pull qwen2.5:3b
```

On Windows, use `resources\ollama\win\ollama.exe pull qwen2.5:3b`.

---

## 5. Optional extras

### Voice input (🎤 button)

On Windows, setup installs it by default (leave it out with `-NoVoice`). On
Linux, re-run setup with `--with-voice`: whisper.cpp is compiled there, so
it stays optional. Either way it puts `whisper-server` plus the
`ggml-base.en` model (~148 MB) under `resources/whisper/<os>/`.

Click 🎤 and speak, then click it again to stop. The button pulses while the
recording is transcribed, and the text is added to the message box. The app
converts each recording to the 16 kHz WAV format Whisper expects before
sending it, so no ffmpeg is needed. Transcription runs locally, and the
model is English-only (`base.en`).

### AMD GPUs

Add `-Rocm` / `--rocm` to the setup command to include Ollama's ROCm
libraries. NVIDIA needs nothing extra beyond a current driver.

### Editing the model catalog

`data/<tier>-models-catalog.json` are plain JSON files. Add, remove, or
rename entries, and the Models tab picks up the changes the next time it
opens. No restart is needed.

---

## 6. Manual install (if a script can't be used)

These steps do exactly what the scripts do, one piece at a time. Run them
in the project root.

**1. Node.js 22.12+.** Install it from <https://nodejs.org/> (LTS), or unpack
the portable zip (Windows) or `.tar.xz` (Linux) into `runtime/node/`, and
put it on PATH for this terminal session.

**2. Dependencies:**

```bash
npm ci --ignore-scripts
```

```bash
node node_modules/electron/install.js
```

```bash
npm run postinstall
```

The last command copies the renderer's vendor assets. Nothing needs
compiling, because better-sqlite3 ships ready-made binaries for Windows and
Linux. The Electron download is a separate step because newer npm versions
may skip package install scripts.

**3. Linux only — the sandbox helper** (or launch with `--no-sandbox`):

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
```

```bash
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

**4. Ollama.** Follow `resources/ollama/win/PLACE_BINARY_HERE.txt` or
`resources/ollama/linux/PLACE_BINARY_HERE.txt`. Alternatively, install
Ollama normally from <https://ollama.com/download>; the app uses `ollama`
on PATH when no portable copy is present.

**5. Launch:** `npm start`, or the launchers described in sections 2.3 and 3.3.

---

## 7. Updating components

| Component | How |
|---|---|
| **Ollama** | Close the app. Delete `resources/ollama/win/ollama.exe` (Windows) or `resources/ollama/linux/bin` (Linux), then re-run setup. It fetches the latest release, or the one you pin with `-OllamaVersion` / `--ollama-version`. Your models are kept. |
| **Electron / npm packages** | Delete `node_modules` and re-run setup. To move to newer versions, edit `package.json`, run `npm install` once to refresh `package-lock.json`, and test. |
| **Portable Node.js** | Delete `runtime/node` and re-run setup. |
| **Models** | Tools → Models: 🗑 deletes a model and **Pull** fetches it again. |

---

## 8. Building a standalone packaged app (optional)

After setup, you can build a self-contained app folder:

```bash
npm run pack:win
```

```bash
npm run pack:linux
```

Output goes to `dist/win-unpacked/` or `dist/linux-unpacked/`. The launchers
prefer a packaged build automatically when one exists. The packaged build
keeps its data in a `data/` folder next to the executable, and the model
catalog files are copied there for you. Everything under `resources/`
(including the portable Ollama and whisper files, if you downloaded them) is
bundled automatically. On Linux, repeat the chrome-sandbox `chown`/`chmod`
from section 6 on `dist/linux-unpacked/chrome-sandbox`, or let the launcher
fall back to `--no-sandbox`.

Prefer `pack:linux` (a folder) over `dist:linux` (an AppImage). An AppImage
runs from a read-only mount, so the app can't write `data/` next to itself.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| "Setup isn't finished yet" when launching | Setup didn't complete. Re-run it and read the first red `SETUP FAILED` / `MISSING` line. |
| Status stays **"Model runtime unavailable"** | Ollama didn't start. Check Tools → System → *Ollama log*. Make sure `resources/ollama/<os>/` is populated, or that `ollama` is on PATH. |
| Red warning: "An Ollama instance was already running…" | Another Ollama (its tray app on Windows, or `systemctl` service `ollama` on Linux) owns port 11434, so models go to *its* folder. Quit it (Windows tray → Quit, or `sudo systemctl stop ollama`) and relaunch. |
| "better-sqlite3 does not load inside Electron" | Delete `node_modules` and re-run setup. The package ships ready-made binaries for Windows and Linux (x64 and ARM64), so no compiler is needed. |
| `npm` fails with EPERM / EBUSY (Windows) | Antivirus or OneDrive is locking files. Delete `node_modules`, pause sync, and re-run. |
| Antivirus quarantines `ollama.exe` | This is a known false positive. It came from `github.com/ollama/ollama/releases`; add an exclusion for `resources\ollama\win`. |
| Linux: window doesn't open, "no usable sandbox" / namespace error | Re-run setup without `--no-sandbox-fix`, or launch with `./start-aiportable-justai.sh`, which falls back to `--no-sandbox` by itself. |
| Linux: "error while loading shared libraries: libXXX.so" | A GUI library is missing. Re-run setup, which lists what's missing via `ldd`, or install it from the lists in section 3. |
| Linux: `zstd is needed` | Install `zstd` (`sudo apt install zstd`) and re-run. |
| Model pulls are slow / the USB drive fills up | Tools → Models → **Choose folder on this PC…** stores models on a local disk. |
| A reply shows "produced no reply… ran out of context" | Raise **Context length** in Tools → Models, e.g. to 16K. |
| Downloads fail behind a corporate proxy | Set `HTTPS_PROXY` (and `npm config set proxy ...`) before running setup. |

---

## 10. Uninstall / reset

- **Reset chats only:** delete `data/chats.db` while the app is closed.
- **Reset the library only:** delete `data/library.db` and `data/library/`.
- **Remove everything:** close the app, then delete the whole
  `AIPortable-JustAI` folder and the per-machine settings folder
  (`%APPDATA%\aiportable-justai` on Windows, `~/.config/aiportable-justai` on
  Linux). If you used `--desktop-entry`, also delete
  `~/.local/share/applications/aiportable-justai.desktop`. Nothing else is
  installed system-wide, apart from the Linux distro packages and Node.js if
  you installed it with `-UseWinget`.
