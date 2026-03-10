@echo off
rem =============================================================================
rem  Licenta Container -- run script (Windows)
rem =============================================================================
rem
rem  EDIT THE PORT HERE TO CHANGE THE HOST PORT
set PORT=8001
rem
rem  Everything below this line runs automatically -- no edits needed.
rem =============================================================================

setlocal EnableDelayedExpansion

set IMAGE_FILE=licenta-container.tar
set IMAGE_NAME=licenta-container:latest
set CONTAINER_NAME=licenta-agent
set INTERNAL_PORT=8001
set SCRIPT_DIR=%~dp0
set TAR_PATH=%SCRIPT_DIR%%IMAGE_FILE%

if not exist "%TAR_PATH%" (
    echo [ERROR] Image archive not found: %TAR_PATH%
    echo         Make sure %IMAGE_FILE% is in the same directory as this script.
    pause
    exit /b 1
)

rem Create .env from .env.example if it does not exist
if not exist "%SCRIPT_DIR%.env" (
    if exist "%SCRIPT_DIR%.env.example" (
        copy "%SCRIPT_DIR%.env.example" "%SCRIPT_DIR%.env" >nul
        echo >>> Created .env from .env.example -- please edit it and set your GOOGLE_API_KEY.
        echo     Then run this script again.
        pause
        exit /b 0
    ) else (
        echo [ERROR] No .env file found. Create one with at least GOOGLE_API_KEY and CONTAINER_API_KEY.
        pause
        exit /b 1
    )
)

echo >>> Loading Docker image from %IMAGE_FILE% ...
docker load -i "%TAR_PATH%"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to load Docker image. Is Docker Desktop running?
    pause
    exit /b 1
)

rem Stop and remove any previously running instance
for /f %%i in ('docker ps -a --format "{{.Names}}" 2^>nul') do (
    if "%%i"=="%CONTAINER_NAME%" (
        echo >>> Stopping existing container '%CONTAINER_NAME%' ...
        docker rm -f %CONTAINER_NAME% >nul
    )
)

echo >>> Starting container '%CONTAINER_NAME%' on host port %PORT% ...
docker run -d ^
    --name %CONTAINER_NAME% ^
    -p %PORT%:%INTERNAL_PORT% ^
    --restart unless-stopped ^
    --env-file "%SCRIPT_DIR%.env" ^
    %IMAGE_NAME%

if %errorlevel% neq 0 (
    echo [ERROR] Failed to start the container.
    pause
    exit /b 1
)

echo.
echo [OK] Container started successfully.
echo      Access it at: http://localhost:%PORT%
echo.
echo      To stop it:   docker stop %CONTAINER_NAME%
echo      To remove it: docker rm   %CONTAINER_NAME%
echo.
pause