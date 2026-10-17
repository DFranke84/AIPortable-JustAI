# AIPortable-JustAI

An AI assistant that runs entirely on your own computer: chat with local AI models, ask questions about your own
documents, and let the AI search offline Wikipedia and other reference archives while it answers.

No account, no cloud, no telemetry. The whole app, including its models, chats and data, lives in **one folder**
that you can move to another drive or carry on a USB stick. Runs on Windows and Linux.

---

## How the apps fit together

There are four separate downloads. They work on their own, and better together when they sit side by side in
one folder.

| App | What it is | Do you need it? |
|---|---|---|
| **AIPortable** | Offline AI chat with your library, Wikipedia viewer and offline maps | Pick **one** of the two AI apps |
| **AIPortable-JustAI** (this one) | The same AI chat without the maps and Wikipedia viewer (smaller) | Pick **one** of the two AI apps |
| **Research** | A large offline reference library and Library Manager, the window for building it | Optional - adds a big searchable library to the AI |
| **LibraryViewer** | A read-only copy of the Research library for an Android tablet | Optional |

Most people use **either** AIPortable **or** JustAI, not both. Choose JustAI if you only want the AI chat;
choose AIPortable if you also want offline maps and the built-in Wikipedia reader. Research and LibraryViewer
are add-ons.

Put the ones you use in **one folder**, side by side:

```
AI-Research\
    AIPortable-JustAI\   this app
    Research\            optional library
    LibraryViewer\       optional tablet viewer
```

The apps find each other by that layout. The folder can be anywhere (another drive, a USB drive). Avoid
OneDrive-synced folders.

---

## Setting up from scratch

**You need:** Windows 10/11 64-bit or a 64-bit Linux desktop, and an internet connection for setup. Disk space:
about 3 GB for the app and Ollama, plus the AI models you choose (0.3 - 20 GB each).

1. **Get the folder.** Download this repository (green **Code** button → *Download ZIP*, then unzip), or with git:
   `git clone https://github.com/DFranke84/AIPortable-JustAI`.
2. **Run setup.**
   - **Windows:** double-click `Setup-Windows.bat`. It asks which AI model to download (it detects your graphics
     card's memory and shows the models that fit), then downloads everything else into this folder - no admin
     rights, nothing installed on the rest of the PC.
   - **Linux:** `bash scripts/setup-linux.sh` (asks for your password once, to install system libraries).
3. **Start the app:** `AIPortable-JustAI.vbs` on Windows, `./start-aiportable-justai.sh` on Linux.

Step by step, all options, manual install and troubleshooting: **[SETUP.md](SETUP.md)**.

---

## What you can do

**In the chat**

- **Chat** with the AI model you picked. Chats are saved and titled automatically; rename, delete, or export
  one to a text file (↓). **Load model** gets the model ready before your first question.
- **📁 Attach** a picture (for models that can see images), a PDF, Word or text file to one message.
- **📚 Use your library**: the AI looks through your documents first and answers from them, showing which ones
  it used.
- **🗃️ Search archives**: the AI searches offline archives (Wikipedia, MedlinePlus, Stack Exchange…) before
  answering. *Quick* does one search with any model; *Thorough* lets models that can use tools search and open
  articles themselves. Sources open in a small article window.
- **🎤 Voice input**: speak instead of typing (runs locally).

**In the sidebar**

- **📖 Reference Library**: your own documents. Add files in 🛠️ Tools/Settings → Library; read them here.
- **🔍 Analyze Image**: identify what is in a photo, checked against your library.
- **🌐 Translate**: typed text, or the text in a picture.
- **🛠️ Tools/Settings**: models, library, phone access, system.
- **🚪 Exit**: closes the app and frees the memory the AI models were using (or keeps them loaded, if you tick
  that).

**From your phone**: Tools/Settings → Mobile sync starts a small page your phone can open on the same Wi-Fi to
chat with the app. Only use it on a home network you trust; it has no password.

---

## Your documents: two kinds of library

- **The app's own Reference Library** - documents you add inside the app (Tools/Settings → Library). Good for a
  handful of your own files.
- **The Research library** - a separate, much larger library built with Library Manager (the Research download).
  When a `Research` folder sits next to the app, the app offers to **Sync** it; or use Tools/Settings → Library →
  **Sync Research Library** (and **Change folder…** if it is somewhere else). The app reads it where it is -
  nothing is copied - and 📚 then answers from both. Sync again after adding things in Library Manager.

Archives for 🗃️ (`.zim` files) are found in the Research library's `_sources\zim` folder automatically; add
other folders in Tools/Settings → Library → *ZIM archive folders*. Free archives: https://library.kiwix.org.

---

## Choosing AI models

Tools/Settings → Models lists models that fit your graphics card (pick your card's memory size: 4, 8, 12, 24 or
32 GB) with a download button for each. Bigger models know more but need more memory and answer more slowly.
The lists are plain files in `data/` (`4K-models-catalog.json` … `32K-models-catalog.json`) that you can edit;
they include a **Survival** category chosen for practical, preparedness-style questions.

Models are kept in `data/models`. On a slow USB drive you can move them to a folder on the PC (Tools/Settings →
Models → *Choose folder on this PC*) and copy them back and forth with the Sync buttons.

Ollama runs the models and is built in. If you prefer **LM Studio**, Tools/Settings → Models lets the app use
LM Studio's local server for chat instead.

---

## Where things are kept

```
AIPortable-JustAI/
├─ Setup-Windows.bat                          Windows setup (double-click)
├─ AIPortable-JustAI.vbs                      Windows launcher (no console)
├─ Start-AIPortable-JustAI-With-Console.bat   Windows launcher (with log console)
├─ start-aiportable-justai.sh                 Linux launcher
├─ scripts/                                   setup logic (Windows, Linux)
├─ src/main/                                  the app's main process and services
├─ src/renderer/                              the app's window (HTML/CSS/JS)
├─ data/                                      your chats, documents and models; the editable model lists
└─ resources/{ollama,whisper,kiwix}/          Ollama, voice input and Kiwix (downloaded by setup)
```

Created by setup or while you use the app (not part of the download): `node_modules/`, `runtime/node/`,
`resources/*/*` programs, `data/models/`, `data/chats.db`, `data/library.db`, `data/library/`.

A few per-PC choices (window size, graphics-card size, where models are kept on this PC, the Research folder) are
remembered on each computer separately, so the same USB drive works on several PCs. Copy the whole folder to
move or back up the app; SETUP.md section 10 explains how to reset or remove it.

## Security notes

The app's window can only reach the explicit functions in `src/main/preload.js` (`contextIsolation` on,
`nodeIntegration` off), and a strict Content-Security-Policy is set in `index.html`. Ollama and Kiwix listen on
`127.0.0.1` only. Mobile sync opens a network port only while you have it switched on, and has no password.
