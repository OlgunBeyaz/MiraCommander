# MiraCommander - Automatische Rust-Umgebungseinrichtung
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  MiraCommander - Rust-Speicher automatisch einrichten" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

$RustBase = "D:\rust"
$CargoHome = "D:\rust\cargo"
$CargoTarget = "D:\rust\target"

# 1. Ordner anlegen
Write-Host "[1/4] Erstelle Verzeichnisse auf D:\rust..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $RustBase, $CargoHome, $CargoTarget | Out-Null
Write-Host "      - $CargoHome (Bibliotheken & Crates)" -ForegroundColor Green
Write-Host "      - $CargoTarget (Build-Artefakte)" -ForegroundColor Green

# 2. Windows Umgebungsvariablen setzen
Write-Host "[2/4] Setze permanente Umgebungsvariablen..." -ForegroundColor Yellow
[System.Environment]::SetEnvironmentVariable('CARGO_HOME', $CargoHome, 'User')
[System.Environment]::SetEnvironmentVariable('CARGO_TARGET_DIR', $CargoTarget, 'User')
$env:CARGO_HOME = $CargoHome
$env:CARGO_TARGET_DIR = $CargoTarget
Write-Host "      - CARGO_HOME und CARGO_TARGET_DIR gesetzt." -ForegroundColor Green

# 3. Projekt bereinigen
Write-Host "[3/4] Bereinige Projektordner (nur Code bleibt erhalten)..." -ForegroundColor Yellow
$CleanPaths = @("src-tauri\target", "target", "dist")
foreach ($p in $CleanPaths) {
    if (Test-Path $p) {
        Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
        Write-Host "      - $p entfernt." -ForegroundColor Green
    }
}

# 4. Cargo-Konfigurationen pruefen
Write-Host "[4/4] Aktualisiere Cargo-Konfiguration..." -ForegroundColor Yellow
$tomlContent = "[build]`ntarget-dir = `"D:/rust/target`"`n"
Set-Content -Path ".cargo\config.toml" -Value $tomlContent -Encoding UTF8
Set-Content -Path "src-tauri\.cargo\config.toml" -Value $tomlContent -Encoding UTF8
Write-Host "      - .cargo\config.toml aktualisiert." -ForegroundColor Green

Write-Host ""
Write-Host "FERTIG! Alles ist auf D:\rust eingerichtet." -ForegroundColor Cyan
