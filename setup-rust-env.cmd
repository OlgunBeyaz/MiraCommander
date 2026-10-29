@echo off
chcp 65001 >nul
echo ========================================================
echo   MiraCommander - Rust-Speicher & Umgebung einrichten
echo ========================================================
echo.

set CARGO_TARGET_DIR_PATH=D:\rust\target

echo [1/3] Erstelle Build-Target-Verzeichnis in D:\rust\target...
if not exist "D:\rust" mkdir "D:\rust"
if not exist "%CARGO_TARGET_DIR_PATH%" mkdir "%CARGO_TARGET_DIR_PATH%"
echo       - %CARGO_TARGET_DIR_PATH% (fuer alle Build-Kompilate)
echo.

echo [2/3] Setze dauerhafte Windows-Umgebungsvariable...
:: Hinweis: CARGO_HOME belassen wir auf dem NTFS-Standardlaufwerk (%USERPROFILE%\.cargo),
:: da exFAT-Partitionen auf D:\ sonst "Fehler 87: Falscher Parameter" bei tar-mtime werfen.
setx CARGO_TARGET_DIR "%CARGO_TARGET_DIR_PATH%" >nul
reg delete "HKCU\Environment" /v CARGO_HOME /f >nul 2>&1
set "CARGO_TARGET_DIR=%CARGO_TARGET_DIR_PATH%"
echo       - CARGO_TARGET_DIR = %CARGO_TARGET_DIR_PATH%
echo.

echo [3/3] Bereinige Projektordner (Loesche alte target/ und dist/)...
if exist "src-tauri\target" rd /s /q "src-tauri\target"
if exist "target" rd /s /q "target"
if exist "dist" rd /s /q "dist"
echo       Projektordner ist sauber (nur noch Quellcode vorhanden).
echo.

echo ========================================================
echo   FERTIG! Alles wurde eingerichtet.
echo   Kompilate landen in D:\rust\target.
echo   Dein Projektordner bleibt frei von Build-Dateien.
echo ========================================================
echo.
pause
