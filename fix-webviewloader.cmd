@echo off
chcp 65001 >nul
echo Kopiere WebView2Loader.dll nach D:\rust\MiraCommander-Portable...
echo.

set "OUTPUT_DIR=D:\rust\MiraCommander-Portable"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

set "FOUND="

:: 1. Pruefe D:\rust\target
if exist "D:\rust\target\release\WebView2Loader.dll" (
    copy /y "D:\rust\target\release\WebView2Loader.dll" "%OUTPUT_DIR%\" >nul
    set "FOUND=1"
    echo [OK] WebView2Loader.dll aus D:\rust\target\release kopiert.
    goto :done
)

:: 2. Suche rekursiv in D:\rust\target
echo Suche in D:\rust\target...
for /r "D:\rust\target" %%F in (WebView2Loader.dll) do (
    if exist "%%F" (
        copy /y "%%F" "%OUTPUT_DIR%\" >nul
        set "FOUND=1"
        echo [OK] WebView2Loader.dll gefunden: %%F
        goto :done
    )
)

:: 3. Suche rekursiv in Cargo Cache (%USERPROFILE%\.cargo)
echo Suche im Cargo-Cache...
for /r "%USERPROFILE%\.cargo" %%F in (WebView2Loader.dll) do (
    echo "%%F" | findstr /i "x64" >nul
    if not errorlevel 1 (
        if exist "%%F" (
            copy /y "%%F" "%OUTPUT_DIR%\" >nul
            set "FOUND=1"
            echo [OK] 64-Bit WebView2Loader.dll gefunden: %%F
            goto :done
        )
    )
)

:: Fallback beliebige gefundene Datei
for /r "%USERPROFILE%\.cargo" %%F in (WebView2Loader.dll) do (
    if exist "%%F" (
        copy /y "%%F" "%OUTPUT_DIR%\" >nul
        set "FOUND=1"
        echo [OK] WebView2Loader.dll gefunden: %%F
        goto :done
    )
)

:done
if defined FOUND (
    echo.
    echo ========================================================
    echo   ERFOLGREICH! WebView2Loader.dll liegt jetzt neben
    echo   MiraCommander.exe in %OUTPUT_DIR%.
    echo   Du kannst MiraCommander.exe jetzt starten!
    echo ========================================================
    explorer "%OUTPUT_DIR%"
) else (
    echo.
    echo [FEHLER] WebView2Loader.dll konnte nicht lokal gefunden werden.
)

pause
