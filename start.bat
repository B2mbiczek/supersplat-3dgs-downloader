@echo off
chcp 65001 > nul
title SuperSplat 3DGS Downloader
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERR] Node.js is not installed! Download LTS from: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [INFO] First run - installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERR] Dependency installation failed.
        pause
        exit /b 1
    )
)

node index.js %*
echo.
pause
