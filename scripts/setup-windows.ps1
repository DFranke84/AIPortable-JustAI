<#
  setup-windows.ps1 - one-time environment setup for AIPortable-JustAI on Windows.

  Takes a brand-new machine from "just this folder" to "ready to launch":

    1. Node.js      - uses an existing Node.js 22.12+ if one is on PATH; otherwise
                      downloads a PORTABLE copy of the current Node.js LTS into
                      runtime\node\ (no admin rights, nothing added to PATH or
                      the registry). Pass -UseWinget to install Node system-wide
                      via winget instead.
    2. npm ci       - installs Electron and every other dependency from
                      package-lock.json, copies the renderer's vendor bundles
                      (marked, pdf.js) into src\renderer\vendor\, and makes
                      sure better-sqlite3 loads inside Electron.
    3. Ollama       - downloads the official portable Windows build from
                      github.com/ollama/ollama and unpacks it into
                      resources\ollama\win\ (no system-wide install).
    4. Data folders - creates the empty data\models and data\library folders.
    5. Models       - pulls 'nomic-embed-text' (needed for Library semantic
                      search) and, if you pass -Model, one chat model too.
    6. Voice input  - OPTIONAL (-WithVoice): whisper.cpp server + base.en model.
    7. Verify       - checks that everything the launcher needs is in place.

  Safe to re-run: every step skips work that is already done.

  Usage (from the project root, in a normal - not admin - PowerShell window):
    powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
  or just double-click Setup-Windows.bat in the project root.

  Flags:
    -UseWinget        Install Node.js LTS system-wide via winget instead of the
                      portable copy (you must re-run this script in a new
                      window afterwards so PATH picks it up).
    -SkipOllama       Don't download Ollama (use a system-wide install from
                      https://ollama.com/download instead - the app falls back
                      to 'ollama' on PATH automatically).
    -OllamaVersion v  Pin a specific Ollama release tag, e.g. v0.12.3
                      (default: latest).
    -Rocm             Also download Ollama's AMD ROCm GPU add-on package.
    -SkipModels       Don't pull any models during setup.
    -Model name       Also pull this chat model, e.g. -Model qwen2.5:3b
    -WithVoice        Also install the optional whisper.cpp voice-input server.
#>

param(
  [switch]$UseWinget,
  [switch]$SkipOllama,
  [string]$OllamaVersion = 'latest',
  [switch]$Rocm,
  [switch]$SkipModels,
  [string]$Model = '',
  [switch]$WithVoice
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is ~10x slower with the progress bar on
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Note($msg) { Write-Host "    NOTE: $msg" -ForegroundColor Yellow }
function Fail($msg) {
  Write-Host ""
  Write-Host "SETUP FAILED: $msg" -ForegroundColor Red
  exit 1
}

function Download($url, $dest) {
  Write-Host "    Downloading $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -Headers @{ 'User-Agent' = 'AIPortable-JustAI-setup' }
  } catch {
    Fail "Could not download $url`n       $($_.Exception.Message)`n       Check your internet connection (and any proxy/firewall) and re-run."
  }
}

# Resolve the project root (one level up from scripts\) and run from there, so
# this works no matter which directory PowerShell was started in.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "AIPortable-JustAI setup running in: $root"

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
if (-not [Environment]::Is64BitOperatingSystem) { Fail "A 64-bit version of Windows is required." }

# ---------------------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------------------
Write-Step "Checking for Node.js (22.12 or newer)"

# Electron 44 / better-sqlite3 13 need Node 22.12+ for installation.
function Test-NodeVersionOk($v) {
  $parts = $v.TrimStart('v').Split('.')
  $major = [int]$parts[0]; $minor = [int]$parts[1]
  return ($major -gt 22) -or ($major -eq 22 -and $minor -ge 12)
}

$portableNodeDir = Join-Path $root 'runtime\node'
$haveNode = $false

$portableNodeExe = Join-Path $portableNodeDir 'node.exe'
if ((Test-Path $portableNodeExe) -and (Test-NodeVersionOk (& $portableNodeExe -v))) {
  $env:Path = "$portableNodeDir;$env:Path"
  Write-Ok "Using portable Node.js already in runtime\node ($(& node -v))"
  $haveNode = $true
} else {
  $sysNode = Get-Command node -ErrorAction SilentlyContinue
  if ($sysNode) {
    $ver = (& node -v).TrimStart('v')
    if (Test-NodeVersionOk $ver) {
      Write-Ok "Using system Node.js v$ver"
      $haveNode = $true
    } else {
      Write-Note "System Node.js v$ver is too old (need 22.12+) - will use a portable copy instead."
    }
  }
}

if (-not $haveNode) {
  if ($UseWinget) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Fail "winget is not available on this machine. Re-run without -UseWinget to use a portable Node.js." }
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Write-Note "Node.js was installed system-wide. Close this window, open a NEW PowerShell window, and run this script again."
    exit 0
  }

  Write-Host "    Looking up the current Node.js LTS release..."
  try {
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  } catch {
    Fail "Could not reach nodejs.org. Install Node.js 18+ manually from https://nodejs.org/ and re-run."
  }
  $lts = $index | Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1
  if (-not $lts) { Fail "Could not find a Node.js LTS build for win-$arch." }
  $nodeName = "node-$($lts.version)-win-$arch"
  $zip = Join-Path $env:TEMP "$nodeName.zip"
  Download "https://nodejs.org/dist/$($lts.version)/$nodeName.zip" $zip

  Write-Host "    Extracting to runtime\node ..."
  $tmpExtract = Join-Path $env:TEMP "aiportable-node-extract"
  if (Test-Path $tmpExtract) { Remove-Item $tmpExtract -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmpExtract -Force
  New-Item -ItemType Directory -Force -Path (Split-Path $portableNodeDir) | Out-Null
  if (Test-Path $portableNodeDir) { Remove-Item $portableNodeDir -Recurse -Force }
  Move-Item (Join-Path $tmpExtract $nodeName) $portableNodeDir
  Remove-Item $zip, $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue

  $env:Path = "$portableNodeDir;$env:Path"
  Write-Ok "Portable Node.js $($lts.version) installed in runtime\node"
}
Write-Host "    node $(& node -v), npm $(& npm -v)"

# ---------------------------------------------------------------------------
# 2. npm dependencies (Electron, better-sqlite3 rebuild, vendor assets)
# ---------------------------------------------------------------------------
Write-Step "Installing app dependencies (Electron etc.) - needs internet, can take a few minutes"

$electronExe = Join-Path $root 'node_modules\electron\dist\electron.exe'

# Functional check rather than a file-path check: load better-sqlite3 inside
# Electron's own Node (ELECTRON_RUN_AS_NODE) and run a query. This is exactly
# what the app does at startup, and doesn't depend on where the package keeps
# its native binary (prebuilds\ vs build\Release\ has changed between versions).
function Test-SqliteLoads {
  if (-not (Test-Path $electronExe)) { return $false }
  # electron.exe is a GUI-subsystem program, so PowerShell's & operator
  # neither waits for it nor captures its output - hence Start-Process -Wait
  # with redirected output and a small script file.
  $probe = Join-Path $env:TEMP 'aiportable-sqlite-probe.js'
  $outFile = Join-Path $env:TEMP 'aiportable-sqlite-probe.out'
  $modPath = (Join-Path $root 'node_modules\better-sqlite3') -replace '\\', '/'
  Set-Content -Path $probe -Encoding ascii -Value "process.stdout.write(String(require('$modPath')(':memory:').prepare('select 41+1 as x').get().x))"
  $env:ELECTRON_RUN_AS_NODE = '1'
  try {
    $p = Start-Process -FilePath $electronExe -ArgumentList "`"$probe`"" -Wait -PassThru -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError "$outFile.err"
    $out = if (Test-Path $outFile) { (Get-Content $outFile -Raw) } else { '' }
    return ($p.ExitCode -eq 0 -and "$out".Trim() -eq '42')
  } catch { return $false }
  finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Remove-Item $probe, $outFile, "$outFile.err" -Force -ErrorAction SilentlyContinue
  }
}

if ((Test-Path $electronExe) -and (Test-Path (Join-Path $root 'src\renderer\vendor\marked.min.js')) -and (Test-SqliteLoads)) {
  Write-Ok "Dependencies already installed - skipping (delete node_modules to force a reinstall)"
} else {
  function NpmFailed {
    Write-Host ""
    Write-Host "npm failed - see the error above. Common fixes:" -ForegroundColor Red
    Write-Host "  - Check your internet connection / proxy settings, then re-run."
    Write-Host "  - If the error mentions node-gyp, MSBuild or better-sqlite3: install"
    Write-Host "    'Visual Studio Build Tools' with the 'Desktop development with C++' workload"
    Write-Host "    (https://visualstudio.microsoft.com/visual-cpp-build-tools/), then re-run."
    Write-Host "  - Antivirus sometimes locks files mid-install: delete node_modules and re-run."
    exit 1
  }
  # --ignore-scripts: skip package install scripts (npm 12+ blocks them by
  # default anyway), then run just the two steps that matter explicitly:
  # Electron's runtime download, and our postinstall (copies the renderer's
  # vendor assets). better-sqlite3 13 ships prebuilt binaries, so nothing
  # needs compiling.
  if (Test-Path (Join-Path $root 'package-lock.json')) { & npm ci --ignore-scripts --no-audit --no-fund } else { & npm install --ignore-scripts --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) { NpmFailed }
  Write-Host "    Downloading the Electron runtime..."
  & node node_modules\electron\install.js
  if ($LASTEXITCODE -ne 0) { NpmFailed }
  Write-Host "    Copying vendor assets..."
  & npm run postinstall
  if ($LASTEXITCODE -ne 0) { NpmFailed }
  Write-Ok "Electron installed, better-sqlite3 ready for Electron, vendor assets copied"
}

# ---------------------------------------------------------------------------
# 3. Portable Ollama
# ---------------------------------------------------------------------------
$ollamaDir = Join-Path $root 'resources\ollama\win'
$ollamaExe = Join-Path $ollamaDir 'ollama.exe'
$ollamaArch = if ($arch -eq 'arm64') { 'arm64' } else { 'amd64' }
$ollamaBase = if ($OllamaVersion -eq 'latest') { 'https://github.com/ollama/ollama/releases/latest/download' } else { "https://github.com/ollama/ollama/releases/download/$OllamaVersion" }

if ($SkipOllama) {
  Write-Step "Skipping Ollama download (-SkipOllama)"
  Write-Note "Install Ollama from https://ollama.com/download - the app uses 'ollama' on PATH when no portable copy is present."
} else {
  Write-Step "Setting up portable Ollama ($OllamaVersion, windows-$ollamaArch)"
  if (Test-Path $ollamaExe) {
    Write-Ok "Portable Ollama already present - skipping (delete resources\ollama\win\ollama.exe to force a re-download)"
  } else {
    New-Item -ItemType Directory -Force -Path $ollamaDir | Out-Null
    $zip = Join-Path $env:TEMP "ollama-windows-$ollamaArch.zip"
    Download "$ollamaBase/ollama-windows-$ollamaArch.zip" $zip
    Write-Host "    Extracting (this archive is large)..."
    Expand-Archive -Path $zip -DestinationPath $ollamaDir -Force
    Remove-Item $zip -Force
    if (-not (Test-Path $ollamaExe)) { Fail "Extraction finished but $ollamaExe is missing - check the contents of $ollamaDir." }
    Write-Ok "Portable Ollama installed in resources\ollama\win"
  }

  if ($Rocm) {
    if ($ollamaArch -ne 'amd64') { Fail "-Rocm is only available for x64 Windows." }
    Write-Host "    Adding the AMD ROCm GPU package..."
    $zip = Join-Path $env:TEMP 'ollama-windows-amd64-rocm.zip'
    Download "$ollamaBase/ollama-windows-amd64-rocm.zip" $zip
    Expand-Archive -Path $zip -DestinationPath $ollamaDir -Force
    Remove-Item $zip -Force
    Write-Ok "ROCm package added"
  }
}

# ---------------------------------------------------------------------------
# 4. Runtime data folders
# ---------------------------------------------------------------------------
Write-Step "Creating empty runtime data folders"
foreach ($folder in @('data\models', 'data\library')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $root $folder) | Out-Null
}
Write-Ok "data\models and data\library ready (chats.db / library.db are created on first launch)"

# ---------------------------------------------------------------------------
# 5. Models
# ---------------------------------------------------------------------------
if ($SkipModels) {
  Write-Step "Skipping model downloads (-SkipModels)"
} else {
  Write-Step "Pulling models into data\models"
  $ollamaCmd = $null
  if (Test-Path $ollamaExe) { $ollamaCmd = $ollamaExe }
  elseif (Get-Command ollama -ErrorAction SilentlyContinue) { $ollamaCmd = (Get-Command ollama).Source }

  if (-not $ollamaCmd) {
    Write-Note "No Ollama binary available - pull models later from Tools -> Models inside the app."
  } else {
    $alreadyRunning = $false
    try { Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2 | Out-Null; $alreadyRunning = $true } catch { }

    $serverProc = $null
    if ($alreadyRunning) {
      Write-Note "Another Ollama is already running on port 11434, so models will go wherever THAT instance stores them, not data\models. Quit it (tray icon -> Quit) and re-run if you want them in the portable folder."
    } else {
      # Same OLLAMA_MODELS the app sets in main.js, so the models land in the
      # portable data\models folder and travel with the app.
      $env:OLLAMA_MODELS = Join-Path $root 'data\models'
      Write-Host "    Starting a temporary Ollama server..."
      $serverProc = Start-Process -FilePath $ollamaCmd -ArgumentList 'serve' -WindowStyle Hidden -PassThru
    }
    try {
      $ready = $false
      for ($i = 0; $i -lt 30; $i++) {
        try { Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { Start-Sleep -Seconds 1 }
      }
      if (-not $ready) {
        Write-Note "Ollama didn't start in time - pull models later from Tools -> Models inside the app."
      } else {
        $toPull = @('nomic-embed-text:latest')
        if ($Model) { $toPull += $Model }
        foreach ($m in $toPull) {
          Write-Host "    ollama pull $m"
          & $ollamaCmd pull $m
          if ($LASTEXITCODE -eq 0) { Write-Ok "$m pulled" } else { Write-Note "Pulling $m failed - you can pull it later from Tools -> Models." }
        }
      }
    } finally {
      if ($serverProc -and -not $serverProc.HasExited) {
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
        # ollama.exe spawns separate runner processes; don't leave them behind.
        Get-Process -Name 'llama-server', 'ollama' -ErrorAction SilentlyContinue |
          Where-Object { $_.Path -and $_.Path.StartsWith($ollamaDir, [StringComparison]::OrdinalIgnoreCase) } |
          Stop-Process -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 6. Optional voice input (whisper.cpp)
# ---------------------------------------------------------------------------
if ($WithVoice) {
  Write-Step "Installing optional voice input (whisper.cpp server + base.en model)"
  $whisperDir = Join-Path $root 'resources\whisper\win'
  New-Item -ItemType Directory -Force -Path $whisperDir | Out-Null

  if (Test-Path (Join-Path $whisperDir 'whisper-server.exe')) {
    Write-Ok "whisper-server.exe already present - skipping"
  } else {
    # whisper.cpp's newest release is sometimes published with no binaries
    # attached, so pick the newest release that actually has the Windows zip.
    Write-Host "    Looking up the newest whisper.cpp release with Windows binaries..."
    try {
      $releases = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=30' -UseBasicParsing -Headers @{ 'User-Agent' = 'AIPortable-JustAI-setup' }
    } catch {
      Fail "Could not reach the GitHub API to find a whisper.cpp release: $($_.Exception.Message)"
    }
    $asset = $releases | Where-Object { -not $_.draft } | ForEach-Object { $_.assets } |
      Where-Object { $_.name -eq 'whisper-bin-x64.zip' } | Select-Object -First 1
    if (-not $asset) { Fail "No whisper.cpp release with whisper-bin-x64.zip was found. Get it manually from https://github.com/ggml-org/whisper.cpp/releases (see resources\whisper\win\PLACE_BINARY_HERE.txt)." }
    $zip = Join-Path $env:TEMP 'whisper-bin-x64.zip'
    Download $asset.browser_download_url $zip
    $tmpExtract = Join-Path $env:TEMP 'aiportable-whisper-extract'
    if (Test-Path $tmpExtract) { Remove-Item $tmpExtract -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmpExtract -Force
    $server = Get-ChildItem -Path $tmpExtract -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1
    if (-not $server) { Fail "whisper-server.exe was not found in the whisper.cpp release archive." }
    # Copy just the server and the DLLs it loads (the archive also carries a
    # dozen unrelated CLI tools and tests).
    Copy-Item -Path $server.FullName -Destination $whisperDir -Force
    Copy-Item -Path (Join-Path $server.DirectoryName '*.dll') -Destination $whisperDir -Force
    Remove-Item $zip, $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "whisper-server.exe installed"
  }

  $modelBin = Join-Path $whisperDir 'model.bin'
  if (Test-Path $modelBin) {
    Write-Ok "model.bin already present - skipping"
  } else {
    Download 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin' $modelBin
    Write-Ok "ggml-base.en model saved as resources\whisper\win\model.bin"
  }
}

# ---------------------------------------------------------------------------
# 7. Verify
# ---------------------------------------------------------------------------
Write-Step "Verifying installation"
$problems = 0
function Check($label, $path, [switch]$Optional) {
  if (Test-Path $path) { Write-Ok $label }
  elseif ($Optional) { Write-Note "$label - not installed (optional)" }
  else { Write-Host "    MISSING: $label ($path)" -ForegroundColor Red; $script:problems++ }
}
Check 'Electron'                         $electronExe
if (Test-SqliteLoads) { Write-Ok 'better-sqlite3 loads inside Electron' }
else { Write-Host "    MISSING: better-sqlite3 does not load inside Electron - delete node_modules and re-run" -ForegroundColor Red; $problems++ }
Check 'Renderer vendor assets'           (Join-Path $root 'src\renderer\vendor\pdf.mjs')
if ($SkipOllama) { Check 'Portable Ollama' $ollamaExe -Optional } else { Check 'Portable Ollama' $ollamaExe }
Check 'Voice input (whisper-server.exe)' (Join-Path $root 'resources\whisper\win\whisper-server.exe') -Optional

if ($problems -gt 0) { Fail "$problems required component(s) missing - see above, fix, and re-run this script." }

Write-Step "Setup complete"
Write-Host ""
Write-Host "Launch the app:" -ForegroundColor Cyan
Write-Host "  - Double-click AIPortable-JustAI.vbs (no console window), or"
Write-Host "  - Start-AIPortable-JustAI-With-Console.bat (shows log output)"
Write-Host ""
Write-Host "Then open Tools/Settings -> Models and pull a chat model (e.g. qwen2.5:3b)." -ForegroundColor Cyan
Write-Host "See SETUP.md for the full walkthrough."
