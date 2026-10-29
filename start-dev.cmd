@echo off
chcp 65001 >nul
echo Starte MiraCommander im Entwicklungsmodus...
echo.

set "CARGO_HOME=%USERPROFILE%\.cargo"
set "CARGO_TARGET_DIR=D:\rust\target"

if not exist "D:\rust\target" mkdir "D:\rust\target"

if not exist "public" mkdir "public"
if exist "D:\MiraSystems\MiraSystem.png" (
    copy /y "D:\MiraSystems\MiraSystem.png" "public\MiraSystem.png" >nul
)

npm run tauri dev
pause
