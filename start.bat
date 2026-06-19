@echo off
REM ── Comforce V2 — one-click launcher (bridge: TS face + Python brain) ──────
REM   Brain : engine\  (port 7801) — YOUR Python engine, the single source of truth
REM   Face  : platform\apps\api + Chetan's UI (port 7765) — proxies screening
REM           to the brain over HTTP.  Open http://localhost:7765 once both are up.
setlocal
set "ROOT=%~dp0"

REM free the ports if a previous run is still holding them
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :7801 ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :7765 ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1

REM 1) brain in its own window (full dynamic conversation via local Claude)
start "Comforce Engine (brain :7801)" cmd /k "%ROOT%engine\run-engine.bat"

REM 2) face in this window; tell it where the brain lives
set "ENGINE_URL=http://127.0.0.1:7801"
cd /d "%ROOT%platform\apps\api"
echo.
echo  Brain -^> http://127.0.0.1:7801   (separate window)
echo  Open  -^> http://localhost:7765
echo.
node dist\index.js
