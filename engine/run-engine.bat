@echo off
REM ── Starts the Comforce brain (Python engine) on port 7801 ────────────────
REM   Run by ..\start.bat in its own window. Uses the engine-local .venv.
REM   First time on a new machine:
REM     python -m venv .venv
REM     .venv\Scripts\pip install -r requirements.txt
cd /d %~dp0

if exist .venv\Scripts\activate.bat (
  call .venv\Scripts\activate.bat
) else (
  echo [warn] no engine\.venv found - using system python.
  echo        create it once with:  python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
)

REM default the studies folder to the shared ..\studies (one source for UI + engine)
if not defined STUDIES_DIR set "STUDIES_DIR=%~dp0..\studies"
if not defined ENGINE_PORT set ENGINE_PORT=7801

python engine_service.py
