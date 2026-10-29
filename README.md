# MiraCommander 🚀

> **Orthodoxer Dual-Pane Dateimanager (inspiriert vom legendären Norton Commander)**  
> Entwickelt mit modernster Web- & Native-Technologie: **Tauri 2**, **Rust** und **TypeScript**.

👤 **Autor & Entwickler:** Kemal Akçocuk  
📄 **Lizenz:** MIT License (Open Source)

---

## 🌟 Plattformunabhängig (Cross-Platform)

MiraCommander ist vollständig **plattformunabhängig** ausgelegt und läuft nativ auf:
- 🐧 **Linux** (Debian, Ubuntu, Fedora, Arch etc. als `.deb`, `.rpm`, `AppImage`)
- 🪟 **Windows** (Windows 10 / 11 als `.msi`, `.exe`)
- 🍏 **macOS** (Apple Silicon M1/M2/M3 & Intel als `.dmg`, `.app`)

### Plattform-Spezifika sauber gelöst:
- **Pfade & Separatoren:** Saubere Unterstützung von Windows-Backslashes `\` und Unix `/` mit universeller Erkennung.
- **Laufwerkserkennung:** Automatische Erkennung aller Windows-Laufwerksbuchstaben (`C:\`, `D:\`, ...) sowie Unix-Mountpoints (`/`, `/mnt`, `/media`, `/Volumes`, `/home`).
- **Speicherplatzermittlung:** Plattformübergreifend mit `fs4` für Windows-, Linux- und macOS-Dateisysteme.
- **Versteckte Dateien:** Sowohl Unix Dot-Dateien (`.filename`) als auch Windows Dateiattribute (`FILE_ATTRIBUTE_HIDDEN`).
- **Rechte & Symlinks:** Plattformgerechtes Handling für Symlinks und Berechtigungen.
- **System-Verknüpfungen:** Dateien mit Standardanwendungen öffnen via nativer OS-Integration (`opener`).

---

## ✨ Features

- **Zwei-Fenster-Ansicht (Dual-Pane):** Blitzschnelle Navigation per Tastatur (`Tab`, Pfeiltasten, `Enter`, `..`).
- **Norton Commander Funktionsleiste:**
  - `F1` Hilfe & Tastaturübersicht
  - `F2` Benutzermenü (Systembefehle wie git status, df, etc.)
  - `F3` Viewer (Textdateien & universeller Bildbetrachter)
  - `F4` Editor (mit Speichern und Dirty-Check vor Schließen)
  - `Shift+F4` Neue Datei anlegen & direkt bearbeiten
  - `F5` Kopieren mit Live-Fortschritt, Häkchen `✓` und Konfliktdialog (Skip / Overwrite / Cancel)
  - `F6` Verschieben / Bewegen
  - `Shift+F6` Datei oder Verzeichnis umbenennen
  - `F7` Neues Verzeichnis anlegen
  - `F8` Löschen mit Sicherheitsabfrage
  - `F9` Norton Commander Pulldown-Menü (Links / Dateien / Befehle / Rechts)
  - `F10` Beenden
- **Kommandozeile & History:**
  - Eingabezeile unten direkt im aktuellen Arbeitsverzeichnis.
  - `Strg + Enter`: Dateiname in Befehlszeile übernehmen.
  - `Alt + F8` & Pfeiltasten: Befehlsverlauf durchblättern.
- **Schnellansicht (Quick View - Strg+Q):**
  - Schnelle Datei- oder Bildvorschau direkt im Gegenfenster.
- **Universal Image Viewer:**
  - Unterstützt PNG, JPG, GIF, WebP, SVG, BMP, ICO, TIFF, TGA, AVIF, HDR, QOI, PNM, DDS etc.
  - Mit stufenlosem Zoom, Bild-Pan per Maus, Rotation (↺/↻) und Pfeiltasten-Navigation.
- **Archiv-Funktionen:**
  - `Alt + F5`: Markierte Dateien direkt in ZIP packen (inkl. Zip64 für Dateien > 4 GB).
  - `Alt + F6`: ZIP-Dateien sicher entpacken (mit Zip-Slip-Schutz).
- **Dateisuche (Alt+F7):**
  - Rekursive Suche mit Masken (`*.rs`, `test*`, etc.) und optionaler Volltextsuche in Inhalten.
- **Verzeichnisvergleich (Strg+D):**
  - Findet und markiert Unterschiede zwischen linkem und rechtem Panel.

---

## 🛠️ Entwicklung & Build

### Voraussetzungen
1. [Node.js](https://nodejs.org/) (Version 18 oder neuer)
2. [Rust & Cargo](https://rustup.rs/) (aktuelle Stable-Version)
3. Plattform-Abhängigkeiten für Tauri 2:
   - **Linux:** `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev`
   - **Windows:** Microsoft C++ Build Tools & WebView2
   - **macOS:** Xcode Command Line Tools

### Starten im Entwicklungsmodus
```bash
npm install
npm run tauri dev
```

### Produktions-Build erstellen
```bash
npm run tauri build
```
Die fertigen Installationspakete liegen anschließend in:
- Linux: `src-tauri/target/release/bundle/deb/` bzw. `appimage/`
- Windows: `src-tauri/target/release/bundle/msi/`
- macOS: `src-tauri/target/release/bundle/dmg/`

---

## 📦 Automatischer Multiplatform-Release über GitHub Actions

Im Repository ist unter `.github/workflows/release.yml` eine automatisierte CI/CD-Pipeline eingerichtet.  
Sobald ein Tag gepusht wird (z. B. `git tag v0.2.0 && git push origin v0.2.0`), baut GitHub Actions automatisch:
- **Windows Executable & Installer** (`.exe` / `.msi`)
- **macOS Universal Binary & Disk Image** (`.dmg` für Apple Silicon & Intel)
- **Linux Pakete** (`.deb`, `.AppImage`)
und hängt diese direkt an das GitHub-Release an!

---

## 📜 Lizenz

Dieses Projekt ist unter der **MIT License** lizenziert – frei verwendbar, erweiterbar und Open Source.  
Copyright (c) Kemal Akçocuk.
