@echo off
REM ── Same bridge launcher, FAST mode ───────────────────────────────────────
REM   Brain runs with LLM_PROVIDER=off -> instant rule/templated replies
REM   (no Claude latency). Use start.bat for the full dynamic conversation.
setlocal
set "ROOT=%~dp0"

for /f "tokens=5" %%p in ('netstat -ano ^| findstr :7801 ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :7765 ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1

start "Comforce Engine FAST (brain :7801)" cmd /k "set LLM_PROVIDER=off&& %ROOT%engine\run-engine.bat"

set "ENGINE_URL=http://127.0.0.1:7801"
cd /d "%ROOT%platform\apps\api"
echo.
echo  Brain (FAST) -^> http://127.0.0.1:7801   (separate window)
echo  Open         -^> http://localhost:7765
echo.
node dist\index.js
