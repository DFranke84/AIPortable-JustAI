# AIPortable-JustAI

A portable, offline-first desktop AI assistant (Electron + [Ollama](https://ollama.com)).

Everything runs on your own machine. There's no account, no cloud calls, and
no telemetry. The whole app, including its models and data, lives in one
folder that you can move or carry on a USB drive.

## Get started

| | |
|---|---|
| **Windows** | Double-click `Setup-Windows.bat`, then `AIPortable-JustAI.vbs` |
| **Linux** | `bash scripts/setup-linux.sh`, then `./start-aiportable-justai.sh` |

**→ Full step-by-step instructions, flags, manual install and troubleshooting: [SETUP.md](SETUP.md)**

## Features

- **Chat** with any local Ollama model. Replies stream in, chats are saved
  and auto-titled, and you can rename, delete, or export a chat to `.txt`.
- **Attachments:** drop images (vision models), PDF, Word, or text files
  onto the composer.
- **Library (RAG):** upload your own documents and toggle 📚 to ground
  answers in them. Search is keyword (FTS5) plus semantic, using
  `nomic-embed-text`. **📖 Reference Library** browses everything you've
  added.
- **ZIM archives (🗃️):** tick .zim archives (Wikipedia, MedlinePlus,
  StackExchange…) from the Research library's `_sources/zim` folder and the
  AI searches them before answering, using each archive's own search index
  through a bundled `kiwix-serve` (127.0.0.1 only). **Quick** = one search,
  any model; **Thorough** = tool-calling models search and open articles
  themselves. Sources open in a small article window. Saved per chat.
- **Load model** button: load the selected model before the first question;
  a reload for a larger context is shown on screen when it happens.
- Replies display as formatted text (bold, lists, tables).
- **Analyze Image:** identify what's in a photo, cross-referenced against
  your library.
- **Translate:** typed text, or text inside an image.
- **Model catalog** by GPU VRAM tier (4/8/12/24/32 GB). These are plain JSON
  files in `data/` that you can edit.
- **Portable model storage** in `data/models`, with an optional per-PC
  folder and two-way sync.
- **Mobile sync:** chat from a phone on the same Wi-Fi network.
- **Voice input** (optional): local speech-to-text through whisper.cpp.
- Light/dark theme, adjustable context length, and a live Ollama log viewer.

## Folder layout

```
AIPortable-JustAI/
├─ Setup-Windows.bat                          Windows setup (double-click)
├─ AIPortable-JustAI.vbs                      Windows launcher (no console)
├─ Start-AIPortable-JustAI-With-Console.bat   Windows launcher (with log console)
├─ start-aiportable-justai.sh                 Linux launcher
├─ scripts/
│  ├─ setup-windows.ps1                       Windows setup logic
│  ├─ setup-linux.sh                          Linux setup logic
│  └─ copy-vendor.js                          npm postinstall helper
├─ src/main/                                  Electron main process + services
├─ src/renderer/                              UI (HTML/CSS/JS)
├─ data/                                      Model catalogs; runtime data is created here
└─ resources/{ollama,whisper,kiwix}/{win,linux}/  Binaries go here
```

Created by setup or at runtime, and not shipped: `node_modules/`,
`runtime/node/`, `src/renderer/vendor/`, `resources/*/*` binaries,
`data/models/`, `data/chats.db`, `data/library.db`, `data/library/`.

## Security notes

`contextIsolation` is on and `nodeIntegration` is off. The renderer can only
reach the explicit API in `src/main/preload.js`, and a strict
Content-Security-Policy is set in `index.html`. Ollama listens on
`127.0.0.1` only. Mobile sync opens a LAN port only while you have it
switched on.
