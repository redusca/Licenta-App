@echo off
:: Check if already running as Administrator
net session >nul 2>&1
if %errorlevel% == 0 goto :run

:: Not admin — re-launch this script itself with UAC elevation
echo Requesting Administrator privileges...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:run
:: Now running as Administrator — start the dev server
cd /d "%~dp0"
npm run dev
pause
