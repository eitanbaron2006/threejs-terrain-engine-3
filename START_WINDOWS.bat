@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)
if not exist "node_modules\three\build\three.module.js" goto install
if not exist "node_modules\fflate\esm\browser.js" goto install
goto stopold

:install
echo Installing Three.js and Terrain Material Pack dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

:stopold
echo Stopping an older Terrain Engine server on port 3000, if present...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>nul

:run
start "Terrain Engine 3.11.6 Server" /min cmd /c "npm start"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3000/?v=3.11.6"
endlocal
