@echo off
REM Setup-Windows.bat - double-click wrapper for scripts\setup-windows.ps1.
REM Runs the PowerShell setup with a per-process execution-policy bypass (no
REM system setting is changed). Any flags you add are passed straight through,
REM e.g.:  Setup-Windows.bat -Model qwen2.5:3b -WithVoice

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1" %*
echo.
pause
