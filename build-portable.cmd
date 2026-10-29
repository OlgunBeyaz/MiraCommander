@echo off
chcp 65001 >nul
echo ========================================================
echo   MiraCommander - Portable .exe erstellen
echo ========================================================
echo.

set "CARGO_HOME=%USERPROFILE%\.cargo"
set "CARGO_TARGET_DIR=D:\rust\target"
set "OUTPUT_DIR=D:\rust\MiraCommander-Portable"

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
if not exist "D:\rust\target" mkdir "D:\rust\target"

:: Splashscreen-Grafik bereitstellen
if not exist "public" mkdir "public"
if exist "D:\MiraSystems\MiraSystem.png" (
    copy /y "D:\MiraSystems\MiraSystem.png" "public\MiraSystem.png" >nul
)

echo [1/4] Baue Frontend (TypeScript & Vite)...
call npm run build
if errorlevel 1 (
    echo FEHLER beim Frontend-Build!
    pause
    exit /b 1
)

echo.
echo [2/4] Kompiliere Portable Windows Binary mit Tauri & Rust...
echo       - Crates Cache: %CARGO_HOME% (NTFS)
echo       - Build Target: %CARGO_TARGET_DIR% (D:\rust\target)
call npx tauri build --no-bundle
if errorlevel 1 (
    echo FEHLER beim Kompilieren mit Tauri!
    pause
    exit /b 1
)

echo.
echo [3/4] Exportiere fertige Portable MiraCommander.exe & WebView2Loader.dll...
set "BUILT_EXE=D:\rust\target\release\MiraCommander.exe"
if not exist "%BUILT_EXE%" (
    set "BUILT_EXE=D:\rust\target\release\mira-commander.exe"
)

if exist "%BUILT_EXE%" (
    copy /y "%BUILT_EXE%" "%OUTPUT_DIR%\MiraCommander.exe" >nul
    echo       - MiraCommander.exe kopiert nach %OUTPUT_DIR%
) else (
    echo WARNUNG: %BUILT_EXE% wurde nicht gefunden.
)

:: WebView2Loader.dll ermitteln und kopieren (fuer Standalone-Ausfuehrung noetig)
if exist "D:\rust\target\release\WebView2Loader.dll" (
    copy /y "D:\rust\target\release\WebView2Loader.dll" "%OUTPUT_DIR%\" >nul
    echo       - WebView2Loader.dll kopiert.
) else (
    for /r "D:\rust\target" %%F in (WebView2Loader.dll) do (
        if exist "%%F" (
            copy /y "%%F" "%OUTPUT_DIR%\" >nul
            echo       - WebView2Loader.dll gefunden und kopiert.
            goto :dll_copied
        )
    )
    for /r "%USERPROFILE%\.cargo" %%F in (WebView2Loader.dll) do (
        echo "%%F" | findstr /i "x64" >nul
        if not errorlevel 1 (
            if exist "%%F" (
                copy /y "%%F" "%OUTPUT_DIR%\" >nul
                echo       - WebView2Loader.dll (x64) aus Cargo-Cache kopiert.
                goto :dll_copied
            )
        )
    )
)
:dll_copied

echo.
echo [4/4] Bereinige Projektordner (nur Quellcode bleibt erhalten)...
if exist "dist" rd /s /q "dist"
if exist "src-tauri\target" rd /s /q "src-tauri\target"
echo       Projektordner ist absolut sauber.

echo.
echo ========================================================
echo   ERFOLGREICH! Deine portable MiraCommander.exe ist fertig:
echo   %OUTPUT_DIR%\MiraCommander.exe
echo ========================================================
echo.

explorer "%OUTPUT_DIR%"
pause
