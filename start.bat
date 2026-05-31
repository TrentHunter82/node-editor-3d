@echo off
setlocal
title Rosebud 3D Node Editor - Dev Server
cd /d "%~dp0"

REM --- Check Node / npm is available ---
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js / npm was not found on your PATH.
  echo Install Node 18+ from https://nodejs.org then double-click this again.
  echo.
  pause
  exit /b 1
)

REM --- Install dependencies on first run ---
if not exist "node_modules\" (
  echo First run detected - installing dependencies. This can take a few minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed - see the messages above.
    pause
    exit /b 1
  )
)

echo.
echo ============================================================
echo   Rosebud 3D Node Editor - starting dev server...
echo ------------------------------------------------------------
echo   Your browser will open automatically in a few seconds.
echo   The actual URL is printed below (usually http://localhost:5173/).
echo   If the page shows the wrong app, open the URL shown below instead.
echo.
echo   Keep this window open while you work.
echo   Close it (or press Ctrl+C) to stop the server.
echo ============================================================
echo.

REM --- Open the browser shortly after the server boots (non-blocking) ---
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 4; Start-Process 'http://localhost:5173/'"

REM --- Run the Vite dev server (blocks until you stop it) ---
call npm run dev

echo.
echo Dev server stopped.
pause
