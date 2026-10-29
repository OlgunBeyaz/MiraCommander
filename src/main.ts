import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import './style.css';

type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number;
  hidden: boolean;
  readonly: boolean;
};

type Directory = {
  path: string;
  parent: string | null;
  entries: Entry[];
};

type Location = {
  name: string;
  path: string;
};

type ImageData = {
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  formatName: string;
  sizeBytes: number;
};

type Side = 0 | 1;

type CopyProgressPayload = {
  itemName: string;
  current: number;
  total: number;
  status: 'copying' | 'done' | 'skipped' | 'error';
};

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'jpe', 'jif', 'jfif', 'gif', 'webp', 'bmp', 'ico', 'svg',
  'tiff', 'tif', 'tga', 'avif', 'hdr', 'exr', 'qoi', 'pnm', 'pbm', 'pgm', 'ppm',
  'dds', 'ff'
]);

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

type DiskSpace = { totalBytes: number; availableBytes: number; usedBytes: number };

type Panel = {
  data: Directory | null;
  cursor: number;
  marked: Set<string>;
  showHidden: boolean;
  sort: 'name' | 'ext' | 'size' | 'modified';
  reverse: boolean;
  filter: string;
  infoMode?: boolean;
  quickViewMode?: boolean;
  quickViewData?: { name: string; content?: string; isImage?: boolean; imgUrl?: string; size: number } | null;
  infoData?: { totalFiles: number; totalDirs: number; totalBytes: number } | null;
  diskSpace?: DiskSpace | null;
  visiblePanel: boolean;
};

// State persistence
function loadSettings() {
  try {
    const s = localStorage.getItem('mira_settings');
    if (s) return JSON.parse(s);
  } catch (e) {
    console.error(e);
  }
  return null;
}

function saveSettings() {
  try {
    const s = {
      p0: { path: panels[0].data?.path, showHidden: panels[0].showHidden, sort: panels[0].sort, reverse: panels[0].reverse },
      p1: { path: panels[1].data?.path, showHidden: panels[1].showHidden, sort: panels[1].sort, reverse: panels[1].reverse },
      cmdHistory
    };
    localStorage.setItem('mira_settings', JSON.stringify(s));
  } catch (e) {
    console.error(e);
  }
}

const saved = loadSettings();

const panels: [Panel, Panel] = [0, 1].map((i) => ({
  data: null,
  cursor: 0,
  marked: new Set<string>(),
  showHidden: saved ? saved[`p${i}`]?.showHidden ?? false : false,
  sort: saved ? saved[`p${i}`]?.sort ?? 'name' : 'name',
  reverse: saved ? saved[`p${i}`]?.reverse ?? false : false,
  filter: '',
  visiblePanel: true,
})) as [Panel, Panel];

let active: Side = 0;
let locationList: Location[] = [];
let dialogOpen = false;
let isTransferRunning = false;
let status = 'Bereit';
let activeMenu: string | null = null;

// Command Line & History
let cmdHistory: string[] = saved?.cmdHistory || [];
let cmdHistoryIndex = -1;
let currentCmdText = '';

const app = document.querySelector<HTMLDivElement>('#app')!;
const $ = (selector: string) => document.querySelector<HTMLElement>(selector);

export function safe(value: string) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const countBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
    ? `${(n / 1024).toFixed(1)} KB`
    : n < 1073741824
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${(n / 1073741824).toFixed(2)} GB`;

// Wildcard matching for mask selection (+ and -)
function wildcardMatch(pattern: string, str: string): boolean {
  let p = pattern.trim();
  if (!p || p === '*' || p === '*.*') return true;
  if (!p.includes('*') && !p.includes('?')) {
    p = `*${p}*`;
  }
  const regexStr = '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexStr, 'i').test(str);
}

const visible = (side: Side): Entry[] => {
  const p = panels[side];
  let arr = (p.data?.entries ?? []).filter((e) => (p.showHidden || !e.hidden) && wildcardMatch(p.filter, e.name));
  arr = [...arr].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let cmp = 0;
    if (p.sort === 'name') {
      cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    } else if (p.sort === 'ext') {
      const extA = a.name.split('.').pop() || '';
      const extB = b.name.split('.').pop() || '';
      cmp = extA.localeCompare(extB, undefined, { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name);
    } else if (p.sort === 'size') {
      cmp = a.size - b.size;
    } else {
      cmp = a.modified - b.modified;
    }
    return p.reverse ? -cmp : cmp;
  });
  return arr;
};

const current = (side: Side = active) => visible(side)[panels[side].cursor];
const selected = () => {
  const p = panels[active];
  return p.marked.size ? [...p.marked] : current() ? [current().path] : [];
};

const time = (n: number) => (n ? new Date(n * 1000).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function icon(e: Entry) {
  if (e.isDir) return '▣';
  if (isImageFile(e.name)) return '▧';
  const ext = e.name.split('.').pop()?.toLowerCase() || '';
  if (['zip', '7z', 'rar', 'tar', 'gz', 'bz2'].includes(ext)) return '▤';
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext)) return '♫';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '▶';
  if (['pdf', 'doc', 'docx', 'odt'].includes(ext)) return '📄';
  if (['rs', 'ts', 'js', 'html', 'css', 'json', 'py', 'c', 'cpp'].includes(ext)) return '⚙';
  return '▤';
}

function panelHTML(side: Side): string {
  const p = panels[side];
  if (!p.visiblePanel) {
    return `<section class="panel ${side === active ? 'active' : ''}" data-side="${side}" style="display:flex;align-items:center;justify-content:center;color:#6b85a8;">
      <div>Fenster ausgeblendet (Strg+${side === 0 ? 'F1' : 'F2'})</div>
    </section>`;
  }

  const dir = p.data;
  const entries = visible(side);
  const fileCount = entries.filter((e) => !e.isDir).length;
  const dirCount = entries.length - fileCount;
  const hotkeyText = side === 0 ? 'Alt+F1' : 'Alt+F2';

  // Quick View Mode
  if (p.quickViewMode) {
    const q = p.quickViewData;
    return `
      <section class="panel ${side === active ? 'active' : ''}" data-side="${side}">
        <div class="panel-heading">
          <span class="panel-mark">${side === 0 ? '01' : '02'}</span>
          <span>SCHNELLANSICHT (QUICK VIEW)</span>
          <button class="small-btn close-quickview-btn" data-side="${side}">✕ Schließen</button>
        </div>
        <div class="quick-view-container">
          <div class="quick-view-meta">
            <strong>${safe(q?.name || 'Keine Datei ausgewählt')}</strong>
            <span>${q ? countBytes(q.size) : ''}</span>
          </div>
          ${
            q?.isImage && q.imgUrl
              ? `<img src="${q.imgUrl}" class="quick-view-img" alt="${safe(q.name)}"/>`
              : `<div class="quick-view-content">${safe(q?.content || 'Kein Vorschau-Inhalt verfügbar')}</div>`
          }
        </div>
        <div class="panel-footer"><span>Strg+Q zum Schließen</span></div>
      </section>
    `;
  }

  // Info Mode
  if (p.infoMode) {
    const info = p.infoData;
    const disk = p.diskSpace;
    return `
      <section class="panel ${side === active ? 'active' : ''}" data-side="${side}">
        <div class="panel-heading">
          <span class="panel-mark">${side === 0 ? '01' : '02'}</span>
          <span>SYSTEM- &amp; VERZEICHNISINFO</span>
          <button class="small-btn close-info-btn" data-side="${side}">✕ Schließen</button>
        </div>
        <div style="flex:1;overflow:auto;padding:18px;line-height:1.8;font-size:12px;color:#c0d5f2;">
          <h3 style="margin-top:0;color:#7eb2ff;">${safe(dir?.path || '—')}</h3>
          <div style="background:#0c172a;border:1px solid #233b61;border-radius:8px;padding:14px;margin-bottom:12px;">
            <div>Ordner im Verzeichnis: <strong>${info?.totalDirs ?? '...'}</strong></div>
            <div>Dateien im Verzeichnis: <strong>${info?.totalFiles ?? '...'}</strong></div>
            <div>Gesamte Dateigröße: <strong>${info ? countBytes(info.totalBytes) : '...'}</strong></div>
          </div>
          <div style="background:#0c172a;border:1px solid #233b61;border-radius:8px;padding:14px;">
            <div>Laufwerk / Datenträger:</div>
            <div>Freier Speicher: <strong style="color:#57deaa;">${disk ? countBytes(disk.availableBytes) : '—'}</strong></div>
            <div>Belegter Speicher: <strong>${disk ? countBytes(disk.usedBytes) : '—'}</strong></div>
            <div>Gesamtkapazität: <strong>${disk ? countBytes(disk.totalBytes) : '—'}</strong></div>
          </div>
        </div>
        <div class="panel-footer"><span>Strg+L zum Schließen</span></div>
      </section>
    `;
  }

  const disk = p.diskSpace;
  const diskText =
    disk && disk.totalBytes > 0
      ? `💾 Frei: <strong>${countBytes(disk.availableBytes)}</strong> / Belegt: <strong>${countBytes(disk.usedBytes)}</strong> (Gesamt: ${countBytes(disk.totalBytes)})`
      : p.marked.size
      ? `${p.marked.size} markiert`
      : 'Keine Markierung';

  return `<section class="panel ${side === active ? 'active' : ''}" data-side="${side}">
  <div class="panel-heading"><span class="panel-mark">${side === 0 ? '01' : '02'}</span><span>${side === 0 ? 'LINKES FENSTER' : 'RECHTES FENSTER'}</span><span class="panel-drive-badge" title="Laufwerk / Ort wählen (${hotkeyText})">${hotkeyText} LW</span><span class="panel-state">${side === active ? '● AKTIV' : 'INAKTIV'}</span></div>
  <div class="pathbar"><button class="nav-up" data-side="${side}" title="Übergeordneter Ordner">↑</button><input class="path-input" data-side="${side}" value="${safe(dir?.path || '')}" spellcheck="false" aria-label="Pfad"/><button class="reload" data-side="${side}" title="Aktualisieren">↻</button></div>
  <div class="toolbar"><label class="location-select-wrap"><select class="location-select" data-side="${side}" aria-label="Laufwerk wählen"><option value="">⌄ Laufwerke / Orte (${hotkeyText})</option>${locationList.map((l) => `<option value="${safe(l.path)}">${safe(l.name)}</option>`).join('')}</select></label><button class="small-btn toggle-hidden ${p.showHidden ? 'selected' : ''}" data-side="${side}" title="Versteckte Dateien anzeigen">${p.showHidden ? '◉' : '◎'} Versteckte</button><input class="filter-input" data-side="${side}" placeholder="⌕ Filter (+/-) ..." value="${safe(p.filter)}" aria-label="Dateien filtern"/></div>
  <div class="fileheader"><button class="sort" data-side="${side}" data-sort="name">NAME ${p.sort === 'name' ? (p.reverse ? '↓' : '↑') : ''}</button><button class="sort sizecol" data-side="${side}" data-sort="size">GRÖSSE ${p.sort === 'size' ? (p.reverse ? '↓' : '↑') : ''}</button><button class="sort datecol" data-side="${side}" data-sort="modified">GEÄNDERT ${p.sort === 'modified' ? (p.reverse ? '↓' : '↑') : ''}</button></div>
  <div class="file-list" data-side="${side}" tabindex="0" aria-label="Dateiliste">${dir?.parent ? `<div class="file-row parent" data-side="${side}" data-parent="true"><span class="filename"><span class="file-icon">↰</span>..</span><span class="sizecol">&lt;ZURÜCK&gt;</span><span class="datecol"></span></div>` : ''}
  ${entries
    .map(
      (e, i) =>
        `<div class="file-row ${i === p.cursor ? 'cursor' : ''} ${p.marked.has(e.path) ? 'marked' : ''}" data-side="${side}" data-index="${i}" title="${safe(e.path)}"><span class="filename"><span class="markbox">${p.marked.has(e.path) ? '✓' : ''}</span><span class="file-icon ${e.isDir ? 'folder' : ''}">${icon(e)}</span><span class="file-name">${safe(e.name)}${e.isSymlink ? ' ↗' : ''}</span></span><span class="sizecol">${e.isDir ? '&lt;ORDNER&gt;' : countBytes(e.size)}</span><span class="datecol">${time(e.modified)}</span></div>`
    )
    .join('')}
  ${!entries.length ? `<div class="empty">${p.filter ? 'Keine Treffer' : 'Dieses Verzeichnis ist leer'}</div>` : ''}</div>
  <div class="panel-footer"><span>${dirCount} Ordner · ${fileCount} Dateien</span><span class="panel-disk-space">${diskText}</span></div></section>`;
}

function renderMenuBar(): string {
  return `
    <nav class="menu-bar" aria-label="Norton Commander Menü (F9)">
      <div class="menu-item" data-menu="left">
        <button class="menu-btn ${activeMenu === 'left' ? 'active' : ''}"><u>L</u>inks</button>
        <div class="menu-dropdown ${activeMenu === 'left' ? 'show' : ''}">
          <div class="menu-entry" data-action="drive-left">Laufwerk... <span class="shortcut">Alt+F1</span></div>
          <div class="menu-entry" data-action="toggle-left">Panel ein/aus <span class="shortcut">Strg+F1</span></div>
          <div class="menu-entry" data-action="info-left">Info-Panel <span class="shortcut">Strg+L</span></div>
          <div class="menu-entry" data-action="quickview-left">Schnellansicht <span class="shortcut">Strg+Q</span></div>
          <div class="menu-divider"></div>
          <div class="menu-entry" data-action="sort-name">Sortieren nach Name <span class="shortcut">Strg+F3</span></div>
          <div class="menu-entry" data-action="sort-ext">Sortieren nach Typ/Erw. <span class="shortcut">Strg+F4</span></div>
          <div class="menu-entry" data-action="sort-time">Sortieren nach Datum <span class="shortcut">Strg+F5</span></div>
          <div class="menu-entry" data-action="sort-size">Sortieren nach Größe <span class="shortcut">Strg+F6</span></div>
          <div class="menu-divider"></div>
          <div class="menu-entry" data-action="reload-both">Neu einlesen <span class="shortcut">Strg+R</span></div>
        </div>
      </div>

      <div class="menu-item" data-menu="files">
        <button class="menu-btn ${activeMenu === 'files' ? 'active' : ''}"><u>D</u>ateien</button>
        <div class="menu-dropdown ${activeMenu === 'files' ? 'show' : ''}">
          <div class="menu-entry" data-action="user-menu">Benutzermenü <span class="shortcut">F2</span></div>
          <div class="menu-entry" data-action="view-file">Ansehen / Viewer <span class="shortcut">F3</span></div>
          <div class="menu-entry" data-action="edit-file">Bearbeiten <span class="shortcut">F4</span></div>
          <div class="menu-entry" data-action="new-file">Neue Datei anlegen <span class="shortcut">Shift+F4</span></div>
          <div class="menu-entry" data-action="copy">Kopieren... <span class="shortcut">F5</span></div>
          <div class="menu-entry" data-action="move">Umbenennen / Bewegen... <span class="shortcut">F6</span></div>
          <div class="menu-entry" data-action="mkdir">Verzeichnis anlegen <span class="shortcut">F7</span></div>
          <div class="menu-entry" data-action="delete">Löschen <span class="shortcut">F8</span></div>
          <div class="menu-divider"></div>
          <div class="menu-entry" data-action="open-system">Mit Standardprogramm öffnen <span class="shortcut">Enter</span></div>
          <div class="menu-entry" data-action="pack-zip">In ZIP packen <span class="shortcut">Alt+F5</span></div>
          <div class="menu-entry" data-action="unpack-zip">ZIP entpacken <span class="shortcut">Alt+F6</span></div>
          <div class="menu-divider"></div>
          <div class="menu-entry" data-action="exit">Beenden <span class="shortcut">F10</span></div>
        </div>
      </div>

      <div class="menu-item" data-menu="commands">
        <button class="menu-btn ${activeMenu === 'commands' ? 'active' : ''}"><u>B</u>efehle</button>
        <div class="menu-dropdown ${activeMenu === 'commands' ? 'show' : ''}">
          <div class="menu-entry" data-action="search">Dateien suchen... <span class="shortcut">Alt+F7</span></div>
          <div class="menu-entry" data-action="history">Befehlsverlauf (History) <span class="shortcut">Alt+F8</span></div>
          <div class="menu-entry" data-action="swap">Panels tauschen <span class="shortcut">Strg+U</span></div>
          <div class="menu-entry" data-action="compare">Verzeichnisse vergleichen <span class="shortcut">Strg+D</span></div>
          <div class="menu-entry" data-action="sync">Verzeichnisse synchronisieren</div>
          <div class="menu-divider"></div>
          <div class="menu-entry" data-action="select-mask">Gruppe wählen <span class="shortcut">+</span></div>
          <div class="menu-entry" data-action="unselect-mask">Gruppe abwählen <span class="shortcut">-</span></div>
          <div class="menu-entry" data-action="invert-selection">Markierung umkehren <span class="shortcut">*</span></div>
        </div>
      </div>

      <div class="menu-item" data-menu="right">
        <button class="menu-btn ${activeMenu === 'right' ? 'active' : ''}"><u>R</u>echts</button>
        <div class="menu-dropdown ${activeMenu === 'right' ? 'show' : ''}">
          <div class="menu-entry" data-action="drive-right">Laufwerk... <span class="shortcut">Alt+F2</span></div>
          <div class="menu-entry" data-action="toggle-right">Panel ein/aus <span class="shortcut">Strg+F2</span></div>
          <div class="menu-entry" data-action="info-right">Info-Panel <span class="shortcut">Strg+L</span></div>
          <div class="menu-entry" data-action="quickview-right">Schnellansicht <span class="shortcut">Strg+Q</span></div>
        </div>
      </div>
    </nav>
  `;
}

function render() {
  const currentPath = panels[active].data?.path || '';
  app.innerHTML = `
    <div class="shell">
      ${renderMenuBar()}
      <header class="topbar">
        <div class="brand">
          <img src="/appicon.png" class="brand-logo" alt="MiraCommander Logo" style="width:40px;height:40px;border-radius:10px;object-fit:cover;box-shadow:0 4px 12px #00000055;" />
          <div>
            <strong>MIRA <b>COMMANDER</b></strong>
            <small>NORTON COMMANDER SUITE <span class="version">v0.2.0</span></small>
          </div>
        </div>
        <div class="top-actions">
          <button id="help-top" title="Hilfe (F1)">? &nbsp; Hilfe</button>
          <button id="refresh-all" title="Beide Fenster aktualisieren (Strg+R)">↻ &nbsp; Aktualisieren</button>
          <button id="about-top" title="Informationen über MiraCommander">ℹ &nbsp; Info</button>
        </div>
      </header>

      <main class="panels">
        ${panelHTML(0)}
        <div class="between">⋮</div>
        ${panelHTML(1)}
      </main>

      <div class="cmd-box">
        <span class="cmd-prompt">${safe(currentPath)}&gt;</span>
        <input id="cmd-line" class="cmd-input" type="text" placeholder="Befehl eingeben (Strg+Enter für Dateiname, Alt+F8 für History, Enter zum Ausführen)..." spellcheck="false" value="${safe(currentCmdText)}"/>
        <button id="cmd-run-btn" class="cmd-run">Ausführen</button>
      </div>

      <div class="status">
        <span class="live-dot">●</span>
        <span id="status-message">${safe(status)}</span>
        <span class="status-right">${panels[active].data?.path ? safe(panels[active].data!.path) : '—'}</span>
      </div>

      <footer class="function-bar">
        ${[
          ['F1', 'Hilfe'],
          ['F2', 'Menü'],
          ['F3', 'Ansehen'],
          ['F4', 'Editieren'],
          ['F5', 'Kopieren'],
          ['F6', 'Bewegen'],
          ['F7', 'Ordner+'],
          ['F8', 'Löschen'],
          ['F9', 'Pulldown'],
          ['F10', 'Beenden']
        ]
          .map(([key, label]) => `<button class="fn" data-key="${key}"><kbd>${key}</kbd><span>${label}</span></button>`)
          .join('')}
      </footer>
    </div>
    <div id="modal-root"></div>
  `;
  bind();
}

function notify(message: string) {
  status = message;
  const n = $('#status-message');
  if (n) n.textContent = status;
}

async function load(side: Side, path: string, reset = true) {
  try {
    const data = await invoke<Directory>('list_dir', { path });
    const p = panels[side];
    p.data = data;
    try {
      p.diskSpace = await invoke<DiskSpace>('get_disk_space', { path: data.path });
    } catch {
      p.diskSpace = null;
    }
    if (reset) {
      p.cursor = 0;
      p.marked.clear();
      p.filter = '';
    } else {
      p.cursor = Math.min(p.cursor, Math.max(visible(side).length - 1, 0));
    }
    render();
    saveSettings();
    notify(`${data.entries.length} Einträge geladen`);
  } catch (e) {
    notify(`Fehler: ${String(e)}`);
    alert(`Verzeichnis konnte nicht geöffnet werden:\n${String(e)}`);
  }
}

async function refresh() {
  await Promise.all([0, 1].map((i) => (panels[i as Side].data ? load(i as Side, panels[i as Side].data!.path, false) : Promise.resolve())));
}

async function openSelected() {
  const e = current();
  if (!e) return;
  if (e.isDir) {
    await load(active, e.path);
  } else if (isImageFile(e.name)) {
    await viewImage(e.path);
  } else {
    // If text file, open in viewer, otherwise use system opener
    const ext = e.name.split('.').pop()?.toLowerCase() || '';
    const textExts = new Set(['txt', 'md', 'rs', 'ts', 'js', 'json', 'html', 'css', 'toml', 'yaml', 'yml', 'xml', 'log', 'ini', 'cfg', 'sh', 'bat']);
    if (textExts.has(ext)) {
      await viewFile(false);
    } else {
      try {
        await invoke('open_in_system', { path: e.path });
        notify(`Mit Standardprogramm geöffnet: ${e.name}`);
      } catch {
        await viewFile(false);
      }
    }
  }
}

async function parent(side: Side = active) {
  const d = panels[side].data;
  if (d?.parent) await load(side, d.parent);
}

function swapPanels() {
  const p0 = panels[0];
  const p1 = panels[1];
  panels[0] = p1;
  panels[1] = p0;
  active = active === 0 ? 1 : 0;
  render();
  saveSettings();
  notify('Panels getauscht (Strg+U)');
}

function invertSelection() {
  const p = panels[active];
  const list = visible(active);
  if (!list.length) return;
  list.forEach((e) => {
    if (p.marked.has(e.path)) p.marked.delete(e.path);
    else p.marked.add(e.path);
  });
  render();
  notify(`Markierung umgekehrt: ${p.marked.size} ausgewählt`);
}

function selectByMaskPrompt(isSelect: boolean) {
  const p = panels[active];
  const title = isSelect ? 'Dateien nach Maske auswählen (+)' : 'Dateien nach Maske abwählen (−)';
  showModal(
    title,
    `<p>Gib eine Maske ein (z. B. <code>*.txt</code>, <code>*report*</code>, <code>test?.rs</code>):</p>
     <input id="mask-input" class="modal-input" value="*.*" spellcheck="false" />`,
    `<button data-cancel class="button-secondary">Abbrechen</button><button id="btn-mask-apply" class="button-primary">Anwenden</button>`,
    () => {
      const input = $('#mask-input') as HTMLInputElement;
      input?.focus();
      input?.select();
      const apply = () => {
        const mask = input.value.trim();
        if (!mask) return;
        const entries = visible(active);
        let count = 0;
        entries.forEach((e) => {
          if (wildcardMatch(mask, e.name)) {
            if (isSelect) {
              p.marked.add(e.path);
              count++;
            } else {
              p.marked.delete(e.path);
              count++;
            }
          }
        });
        closeModal();
        render();
        notify(`${count} Elemente ${isSelect ? 'markiert' : 'abgewählt'}`);
      };
      $('#btn-mask-apply')?.addEventListener('click', apply);
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
        }
      });
    }
  );
}

function selectAll() {
  const p = panels[active];
  const list = visible(active);
  const allMarked = list.length > 0 && list.every((e) => p.marked.has(e.path));
  if (allMarked) {
    p.marked.clear();
    notify('Markierung aufgehoben');
  } else {
    list.forEach((e) => p.marked.add(e.path));
    notify(`Alle ${p.marked.size} Elemente markiert`);
  }
  render();
}

function compareDirectories() {
  const p0 = panels[0].data?.entries || [];
  const p1 = panels[1].data?.entries || [];
  const p0Names = new Map(p0.map((e) => [e.name, e]));
  const p1Names = new Map(p1.map((e) => [e.name, e]));

  panels[0].marked.clear();
  panels[1].marked.clear();

  let diff0 = 0;
  p0.forEach((e) => {
    const other = p1Names.get(e.name);
    if (!other || other.size !== e.size || Math.abs(other.modified - e.modified) > 2) {
      panels[0].marked.add(e.path);
      diff0++;
    }
  });

  let diff1 = 0;
  p1.forEach((e) => {
    const other = p0Names.get(e.name);
    if (!other || other.size !== e.size || Math.abs(other.modified - e.modified) > 2) {
      panels[1].marked.add(e.path);
      diff1++;
    }
  });

  render();
  notify(`Vergleich: Links ${diff0} Unterschiede markiert, Rechts ${diff1} Unterschiede`);
}

async function toggleInfoPanel() {
  const p = panels[active];
  p.infoMode = !p.infoMode;
  if (p.infoMode && p.data) {
    render();
    try {
      p.infoData = await invoke('get_dir_info', { path: p.data.path });
      render();
    } catch (e) {
      console.error(e);
    }
  } else {
    render();
  }
}

async function toggleQuickView() {
  const targetSide: Side = active === 0 ? 1 : 0;
  const p = panels[targetSide];
  p.quickViewMode = !p.quickViewMode;
  if (p.quickViewMode) {
    await updateQuickView();
  } else {
    p.quickViewData = null;
    render();
  }
}

async function updateQuickView() {
  const targetSide: Side = active === 0 ? 1 : 0;
  const p = panels[targetSide];
  if (!p.quickViewMode) return;

  const item = current(active);
  if (!item || item.isDir) {
    p.quickViewData = { name: item?.name || 'Keine Datei', content: 'Keine Dateivorschau für Ordner', size: 0 };
    render();
    return;
  }

  if (isImageFile(item.name)) {
    try {
      const data = await invoke<ImageData>('read_image', { path: item.path });
      p.quickViewData = { name: item.name, isImage: true, imgUrl: data.dataUrl, size: item.size };
    } catch (e) {
      p.quickViewData = { name: item.name, content: `Fehler: ${String(e)}`, size: item.size };
    }
  } else {
    try {
      const text = await invoke<string>('read_text', { path: item.path });
      p.quickViewData = { name: item.name, content: text.substring(0, 8000), size: item.size };
    } catch {
      p.quickViewData = { name: item.name, content: '<Binärdatei oder kann nicht angezeigt werden>', size: item.size };
    }
  }
  render();
}

function showUserMenu() {
  showModal(
    'Benutzermenü (F2)',
    `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button class="button-secondary user-menu-opt" data-cmd="git status">1. Git Status anzeigen</button>
      <button class="button-secondary user-menu-opt" data-cmd="ls -la">2. Ausführliche Dateiliste (ls -la)</button>
      <button class="button-secondary user-menu-opt" data-cmd="df -h">3. Speicherbelegung prüfen (df -h)</button>
      <button class="button-secondary user-menu-opt" data-cmd="uptime">4. Systemlaufzeit &amp; Last (uptime)</button>
    </div>
    `,
    `<button data-cancel class="button-primary">Schließen</button>`,
    () => {
      document.querySelectorAll('.user-menu-opt').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cmd = (btn as HTMLElement).dataset.cmd;
          if (cmd) {
            closeModal();
            void executeCmd(cmd);
          }
        });
      });
    }
  );
}

function showCmdHistory() {
  if (!cmdHistory.length) {
    notify('Befehlsverlauf ist leer');
    return;
  }
  showModal(
    'Befehlsverlauf (History - Alt+F8)',
    `
    <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
      ${cmdHistory
        .map((c, i) => `<div class="menu-entry history-entry" data-index="${i}" style="font-family:ui-monospace,monospace;">${safe(c)}</div>`)
        .join('')}
    </div>
    `,
    `<button data-cancel class="button-primary">Schließen</button>`,
    () => {
      document.querySelectorAll('.history-entry').forEach((el) => {
        el.addEventListener('click', () => {
          const idx = Number((el as HTMLElement).dataset.index);
          const cmd = cmdHistory[idx];
          if (cmd) {
            closeModal();
            currentCmdText = cmd;
            const input = $('#cmd-line') as HTMLInputElement;
            if (input) {
              input.value = cmd;
              input.focus();
            }
          }
        });
      });
    }
  );
}

async function executeCmd(commandLine: string) {
  const p = panels[active].data?.path;
  if (!p) return;
  notify(`Führe aus: ${commandLine}...`);
  if (!cmdHistory.includes(commandLine)) {
    cmdHistory.push(commandLine);
    if (cmdHistory.length > 50) cmdHistory.shift();
    saveSettings();
  }
  cmdHistoryIndex = -1;

  try {
    const res = await invoke<string>('execute_terminal_cmd', { cwd: p, commandLine });
    showModal(
      `Befehlsausgabe: ${safe(commandLine)}`,
      `<pre style="background:#091220;border:1px solid #1e3352;padding:12px;border-radius:6px;max-height:400px;overflow:auto;font-size:12px;color:#a9ccf7;">${safe(res)}</pre>`,
      `<button data-cancel class="button-primary">Schließen</button>`
    );
    void refresh();
  } catch (e) {
    alert(`Befehlsfehler: ${String(e)}`);
  }
}

function showSearchDialog() {
  const startDir = panels[active].data?.path || '';
  showModal(
    'Dateisuche (Alt+F7)',
    `
    <p>Verzeichnis: <strong>${safe(startDir)}</strong></p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <label>Dateiname / Maske:
        <input id="search-pattern" class="modal-input" placeholder="z. B. *.rs, test*, doc.txt" value="*" spellcheck="false" />
      </label>
      <label>Enthaltener Text (optional):
        <input id="search-content" class="modal-input" placeholder="z. B. fn main, TODO, MiraCommander" spellcheck="false" />
      </label>
      <button id="btn-start-search" class="button-primary" style="margin-top:6px;">Suche starten</button>
      <div id="search-results-box" style="margin-top:10px;max-height:260px;overflow-y:auto;background:#0c172a;border:1px solid #233b61;border-radius:6px;padding:8px;display:none;"></div>
    </div>
    `,
    `<button data-cancel class="button-secondary">Schließen</button>`,
    () => {
      const patInput = $('#search-pattern') as HTMLInputElement;
      const contentInput = $('#search-content') as HTMLInputElement;
      const resultsBox = $('#search-results-box') as HTMLDivElement;
      const startBtn = $('#btn-start-search') as HTMLButtonElement;

      patInput?.focus();

      const doSearch = async () => {
        const pattern = patInput.value.trim() || '*';
        const content = contentInput.value.trim() || null;
        startBtn.disabled = true;
        startBtn.textContent = 'Suche läuft...';
        resultsBox.style.display = 'block';
        resultsBox.innerHTML = '<div style="color:#8da8ce;padding:10px;text-align:center;">Durchsuche Verzeichnisse...</div>';

        try {
          type Res = { name: string; path: string; isDir: boolean; size: number; matchLine: string | null };
          const results = await invoke<Res[]>('search_files', { root: startDir, pattern, contentQuery: content });
          startBtn.disabled = false;
          startBtn.textContent = 'Erneut suchen';

          if (!results.length) {
            resultsBox.innerHTML = '<div style="color:#8da8ce;padding:10px;text-align:center;">Keine Übereinstimmungen gefunden.</div>';
            return;
          }

          resultsBox.innerHTML = `
            <div style="font-size:11px;color:#7eb2ff;margin-bottom:6px;font-weight:bold;">${results.length} Treffer gefunden (Klick zum Öffnen im Panel):</div>
            ${results
              .map(
                (r, i) => `
              <div class="search-result-row" data-path="${safe(r.path)}" style="padding:5px 8px;border-bottom:1px solid #172740;cursor:pointer;border-radius:4px;">
                <div style="color:#d3e5ff;font-weight:600;">${safe(r.name)} <span style="font-size:10px;color:#7893b8;font-weight:normal;">${countBytes(r.size)}</span></div>
                <div style="font-size:10px;color:#6b87aa;font-family:ui-monospace,monospace;">${safe(r.path)}</div>
                ${r.matchLine ? `<div style="font-size:10px;color:#57deaa;font-family:ui-monospace,monospace;margin-top:2px;">↳ ${safe(r.matchLine)}</div>` : ''}
              </div>
            `
              )
              .join('')}
          `;

          resultsBox.querySelectorAll('.search-result-row').forEach((el) => {
            el.addEventListener('click', async () => {
              const p = (el as HTMLElement).dataset.path;
              if (p) {
                closeModal();
                const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
                const parentDir = idx >= 0 ? p.substring(0, idx) : p;
                await load(active, parentDir);
                const list = visible(active);
                const fileIdx = list.findIndex((e) => e.path === p);
                if (fileIdx >= 0) {
                  panels[active].cursor = fileIdx;
                  render();
                }
              }
            });
          });
        } catch (e) {
          startBtn.disabled = false;
          startBtn.textContent = 'Suche starten';
          resultsBox.innerHTML = `<div style="color:#ff8585;padding:10px;">Fehler: ${safe(String(e))}</div>`;
        }
      };

      startBtn?.addEventListener('click', () => void doSearch());
      patInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void doSearch();
      });
      contentInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void doSearch();
      });
    }
  );
}

function packZipPrompt() {
  const items = selected();
  if (!items.length) {
    notify('Keine Dateien zum Packen ausgewählt');
    return;
  }
  const targetDir = panels[active === 0 ? 1 : 0].data?.path || panels[active].data?.path || '';
  const firstItem = items[0];
  const idx = Math.max(firstItem.lastIndexOf('/'), firstItem.lastIndexOf('\\'));
  const defaultName = (idx >= 0 ? firstItem.substring(idx + 1) : 'archive') + '.zip';
  const fullTargetZip = `${targetDir}/${defaultName}`;

  showModal(
    'Dateien packen (Alt+F5)',
    `
    <p>${items.length} Element(e) in ZIP-Archiv komprimieren:</p>
    <label>Ziel-Archivpfad:
      <input id="zip-target" class="modal-input" value="${safe(fullTargetZip)}" spellcheck="false" />
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:#c0d5f2;">
      <input type="checkbox" id="zip-overwrite"/> Vorhandene Datei überschreiben
    </label>
    `,
    `<button data-cancel class="button-secondary">Abbrechen</button><button id="btn-pack-confirm" class="button-primary">Packen</button>`,
    () => {
      const input = $('#zip-target') as HTMLInputElement;
      input?.focus();
      const run = async () => {
        const dest = input.value.trim();
        const overwrite = ($('#zip-overwrite') as HTMLInputElement)?.checked ?? false;
        if (!dest) return;
        closeModal();
        notify(`Erstelle Archiv: ${dest}...`);
        try {
          await invoke('pack_zip', { sources: items, destinationZip: dest, overwrite });
          notify(`ZIP erfolgreich erstellt: ${dest}`);
          void refresh();
        } catch (e) {
          alert(`Fehler beim Packen:\n${String(e)}`);
          notify(`Packen fehlgeschlagen: ${String(e)}`);
        }
      };
      $('#btn-pack-confirm')?.addEventListener('click', () => void run());
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void run();
      });
    }
  );
}

function unpackZipPrompt() {
  const item = current();
  if (!item || !item.name.toLowerCase().endsWith('.zip')) {
    notify('Bitte wähle eine .zip Datei zum Entpacken aus');
    return;
  }
  const otherSide = active === 0 ? 1 : 0;
  const destDir = panels[otherSide].data?.path || panels[active].data?.path || '';

  showModal(
    'ZIP-Archiv entpacken (Alt+F6)',
    `
    <p>Archiv: <strong>${safe(item.name)}</strong></p>
    <label>Zielverzeichnis:
      <input id="unpack-target" class="modal-input" value="${safe(destDir)}" spellcheck="false" />
    </label>
    `,
    `<button data-cancel class="button-secondary">Abbrechen</button><button id="btn-unpack-confirm" class="button-primary">Entpacken</button>`,
    () => {
      const input = $('#unpack-target') as HTMLInputElement;
      input?.focus();
      const run = async () => {
        const dest = input.value.trim();
        if (!dest) return;
        closeModal();
        notify(`Entpacke ${item.name}...`);
        try {
          await invoke('unpack_zip', { zipPath: item.path, destinationFolder: dest });
          notify(`ZIP erfolgreich entpackt nach: ${dest}`);
          void refresh();
        } catch (e) {
          alert(`Fehler beim Entpacken:\n${String(e)}`);
          notify(`Entpacken fehlgeschlagen: ${String(e)}`);
        }
      };
      $('#btn-unpack-confirm')?.addEventListener('click', () => void run());
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void run();
      });
    }
  );
}

function showModal(title: string, body: string, actions: string, onRender?: () => void) {
  dialogOpen = true;
  const root = $('#modal-root')!;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${safe(title)}</h2>
        ${body}
        <div class="modal-actions">${actions}</div>
      </div>
    </div>
  `;
  root.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!isTransferRunning) closeModal();
    })
  );
  onRender?.();
}

function closeModal() {
  if (isTransferRunning) {
    return; // Do not dismiss modal while file transfer is in progress!
  }
  dialogOpen = false;
  $('#modal-root')!.innerHTML = '';
  document.querySelector<HTMLElement>('.panel.active .file-list')?.focus();
}

const buttonCancel = '<button data-cancel class="button-secondary">Abbrechen</button>';

async function runTransferTask(actionName: string, items: string[], destination: string, conflictMode: 'overwrite' | 'skip' | 'error') {
  dialogOpen = true;
  isTransferRunning = true;
  const root = $('#modal-root')!;

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(650px,95vw);">
        <h2>${safe(actionName)} läuft...</h2>
        <div class="progress-box">
          <div class="progress-meta">
            <span id="prog-status">Vorbereitung...</span>
            <span id="prog-count">0 / ${items.length}</span>
          </div>
          <div class="progressbar-container">
            <div id="prog-bar" class="progressbar-bar"></div>
          </div>
          <div class="progress-file-list" id="prog-file-list"></div>
        </div>
        <div class="modal-actions" style="margin-top:16px;">
          <button id="btn-cancel-transfer" class="button-danger">Abbrechen</button>
        </div>
      </div>
    </div>
  `;

  const bar = root.querySelector<HTMLDivElement>('#prog-bar')!;
  const statusEl = root.querySelector<HTMLSpanElement>('#prog-status')!;
  const countEl = root.querySelector<HTMLSpanElement>('#prog-count')!;
  const listEl = root.querySelector<HTMLDivElement>('#prog-file-list')!;
  const cancelBtn = root.querySelector<HTMLButtonElement>('#btn-cancel-transfer')!;

  cancelBtn.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Wird abgebrochen...';
    try {
      await invoke('cancel_operation');
      notify('Abbruch angefordert...');
    } catch (e) {
      console.error(e);
    }
  });

  let unlisten: UnlistenFn | null = null;
  unlisten = await listen<CopyProgressPayload>('file-copy-progress', (event) => {
    const p = event.payload;
    const pct = p.total > 0 ? Math.min(100, Math.round((p.current / p.total) * 100)) : 0;
    bar.style.width = `${pct}%`;
    countEl.textContent = `${p.current} / ${p.total} (${pct}%)`;
    statusEl.textContent = p.status === 'skipped' ? `Übersprungen: ${p.itemName}` : `Kopiert: ${p.itemName}`;

    const iconHtml = p.status === 'skipped' ? '<span class="skip-icon">↷</span>' : '<span class="check-icon">✓</span>';
    const row = document.createElement('div');
    row.className = 'progress-file-row';
    row.innerHTML = `${iconHtml}<span class="name">${safe(p.itemName)}</span><span style="font-size:10px;color:#7893b8;margin-left:auto;">${p.status === 'skipped' ? 'übersprungen' : 'erfolgreich'}</span>`;
    listEl.prepend(row);
  });

  try {
    const command = actionName === 'Kopieren' ? 'copy_paths' : 'move_paths';
    await invoke(command, { sources: items, destination, conflict: conflictMode });
    bar.style.width = '100%';
    statusEl.textContent = `${actionName} erfolgreich abgeschlossen!`;
    notify(`${actionName} beendet`);
  } catch (e) {
    statusEl.textContent = `Fehler: ${String(e)}`;
    notify(`Fehler bei ${actionName}: ${String(e)}`);
  } finally {
    isTransferRunning = false;
    if (unlisten) unlisten();

    const actionsContainer = root.querySelector<HTMLDivElement>('.modal-actions');
    if (actionsContainer) {
      actionsContainer.innerHTML = '<button id="btn-transfer-ok" class="button-primary" style="min-width:100px;">OK</button>';
      const okBtn = root.querySelector<HTMLButtonElement>('#btn-transfer-ok');
      okBtn?.focus();
      okBtn?.addEventListener('click', () => {
        closeModal();
        void refresh();
      });
    }
  }
}

async function startTransfer(actionName: string, items: string[], destination: string) {
  try {
    const conflicts = await invoke<string[]>('check_conflicts', { sources: items, destination });
    if (conflicts.length > 0) {
      showModal(
        `Konflikt: ${conflicts.length} Datei(en) existieren bereits`,
        `
        <p>Im Zielordner <strong>${safe(destination)}</strong> sind bereits folgende Dateien vorhanden:</p>
        <div style="background:#0c172a;border:1px solid #283e60;border-radius:6px;max-height:140px;overflow-y:auto;padding:8px 12px;font-size:12px;color:#ffc39e;margin-bottom:12px;">
          ${conflicts.map((c) => `<div>• ${safe(c)}</div>`).join('')}
        </div>
        <p>Wie möchtest du fortfahren?</p>
        `,
        `
        <button id="btn-conflict-cancel" class="button-secondary">Abbrechen</button>
        <button id="btn-conflict-skip" class="button-secondary" style="border:1px solid #5d7fa8;">Übergehen (Skip)</button>
        <button id="btn-conflict-overwrite" class="button-danger">Überschreiben (Overwrite)</button>
        `,
        () => {
          $('#btn-conflict-cancel')?.addEventListener('click', closeModal);
          $('#btn-conflict-skip')?.addEventListener('click', () => {
            void runTransferTask(actionName, items, destination, 'skip');
          });
          $('#btn-conflict-overwrite')?.addEventListener('click', () => {
            void runTransferTask(actionName, items, destination, 'overwrite');
          });
        }
      );
      return;
    }
  } catch (e) {
    console.error(e);
  }

  await runTransferTask(actionName, items, destination, 'error');
}

function operation(type: 'copy' | 'move' | 'delete' | 'mkdir' | 'rename' | 'newfile') {
  const items = selected();
  const single = current();
  const otherSide = active === 0 ? 1 : 0;
  const destDir = panels[otherSide].data?.path;
  const currentDir = panels[active].data?.path;

  if (type === 'newfile') {
    if (!currentDir) return;
    showModal(
      'Neue Datei anlegen (Shift+F4)',
      `<p>Verzeichnis: <strong>${safe(currentDir)}</strong></p><input id="new-filename" class="modal-input" placeholder="Dateiname.txt" spellcheck="false" />`,
      `${buttonCancel}<button id="confirm-newfile" class="button-primary">Anlegen &amp; Öffnen</button>`,
      () => {
        const input = $('#new-filename') as HTMLInputElement;
        input?.focus();
        const run = async () => {
          const val = input.value.trim();
          if (!val) return;
          closeModal();
          try {
            await invoke('create_file', { parent: currentDir, name: val });
            await load(active, currentDir);
            const list = visible(active);
            const idx = list.findIndex((e) => e.name === val);
            if (idx >= 0) panels[active].cursor = idx;
            await viewFile(true);
          } catch (e) {
            alert(`Fehler beim Anlegen:\n${String(e)}`);
          }
        };
        $('#confirm-newfile')?.addEventListener('click', () => void run());
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void run();
        });
      }
    );
    return;
  }

  if (type === 'mkdir') {
    if (!currentDir) return;
    showModal(
      'Neues Verzeichnis anlegen (F7)',
      `<p>Pfad: <strong>${safe(currentDir)}</strong></p><input id="name" class="modal-input" placeholder="Ordnername" spellcheck="false" />`,
      `${buttonCancel}<button id="confirm" class="button-primary">Erstellen</button>`,
      () => {
        const input = $('#name') as HTMLInputElement;
        input?.focus();
        const run = async () => {
          const val = input.value.trim();
          if (!val) return;
          closeModal();
          try {
            await invoke('create_dir', { parent: currentDir, name: val });
            await load(active, currentDir);
            notify(`Ordner "${val}" erstellt`);
          } catch (e) {
            alert(String(e));
          }
        };
        $('#confirm')?.addEventListener('click', () => void run());
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void run();
        });
      }
    );
    return;
  }

  if (type === 'rename') {
    if (!single) return;
    showModal(
      'Umbenennen (Shift+F6)',
      `<p>Aktueller Name: <strong>${safe(single.name)}</strong></p><input id="name" class="modal-input" value="${safe(single.name)}" spellcheck="false" />`,
      `${buttonCancel}<button id="confirm" class="button-primary">Umbenennen</button>`,
      () => {
        const input = $('#name') as HTMLInputElement;
        input?.focus();
        input?.select();
        const run = async () => {
          const val = input.value.trim();
          if (!val || val === single.name) return;
          closeModal();
          try {
            await invoke('rename_path', { source: single.path, name: val });
            await load(active, currentDir!);
            notify(`Umbenannt in "${val}"`);
          } catch (e) {
            alert(String(e));
          }
        };
        $('#confirm')?.addEventListener('click', () => void run());
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void run();
        });
      }
    );
    return;
  }

  if (type === 'delete') {
    if (!items.length) return;
    showModal(
      'Dateien löschen (F8)',
      `<p class="warning">Möchtest du die folgenden <strong>${items.length}</strong> Element(e) wirklich endgültig löschen?</p><div style="max-height:120px;overflow:auto;background:#0c172a;padding:8px 12px;border-radius:6px;border:1px solid #283e60;font-size:12px;color:#c0d5f2;">${items.map((p) => `<div>• ${safe(p)}</div>`).join('')}</div>`,
      `${buttonCancel}<button id="confirm" class="button-danger">Löschen</button>`,
      () => {
        $('#confirm')?.addEventListener('click', async () => {
          closeModal();
          try {
            await invoke('delete_paths', { paths: items });
            notify(`${items.length} Element(e) gelöscht`);
            void refresh();
          } catch (e) {
            alert(String(e));
          }
        });
      }
    );
    return;
  }

  if (type === 'copy' || type === 'move') {
    if (!items.length) return;
    const title = type === 'copy' ? 'Kopieren (F5)' : 'Verschieben (F6)';
    const promptText = type === 'copy' ? 'Kopiere' : 'Verschiebe';
    const initialDest = destDir || currentDir || '';

    showModal(
      title,
      `
      <p>${promptText} <strong>${items.length}</strong> Element(e) nach:</p>
      <input id="transfer-dest-input" class="modal-input" value="${safe(initialDest)}" spellcheck="false" />
      <div style="max-height:110px;overflow:auto;background:#0c172a;padding:8px 12px;border-radius:6px;border:1px solid #283e60;font-size:12px;color:#c0d5f2;margin-top:8px;">
        ${items.map((p) => `<div>• ${safe(p)}</div>`).join('')}
      </div>
      `,
      `${buttonCancel}<button id="confirm-transfer" class="button-primary">${type === 'copy' ? 'Kopieren' : 'Verschieben'}</button>`,
      () => {
        const input = $('#transfer-dest-input') as HTMLInputElement;
        input?.focus();
        const run = () => {
          const destination = input.value.trim();
          if (!destination) return;
          closeModal();
          void startTransfer(type === 'copy' ? 'Kopieren' : 'Verschieben', items, destination);
        };
        $('#confirm-transfer')?.addEventListener('click', run);
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') run();
        });
      }
    );
  }
}

// Image Viewer with AbortController for clean event lifecycle
let imageList: Entry[] = [];
let currentImageIndex = 0;
let imageViewerAbortController: AbortController | null = null;

async function viewImage(targetPath: string) {
  const currentEntries = visible(active);
  imageList = currentEntries.filter((e) => !e.isDir && isImageFile(e.name));
  currentImageIndex = imageList.findIndex((e) => e.path === targetPath);
  if (currentImageIndex === -1 && current()) {
    imageList = [current()!];
    currentImageIndex = 0;
  }
  await renderImageViewer();
}

async function renderImageViewer() {
  if (currentImageIndex < 0 || currentImageIndex >= imageList.length) return;
  const entry = imageList[currentImageIndex];
  notify(`Lade Bild: ${entry.name}...`);

  // Clean up any existing listeners
  if (imageViewerAbortController) {
    imageViewerAbortController.abort();
  }
  imageViewerAbortController = new AbortController();
  const { signal } = imageViewerAbortController;

  try {
    const data = await invoke<ImageData>('read_image', { path: entry.path });
    dialogOpen = true;
    const root = $('#modal-root')!;

    let zoom = 1;
    let rotation = 0;
    let posX = 0;
    let posY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const dimText = data.width && data.height ? `${data.width} × ${data.height} px` : '';

    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal image-modal" role="dialog" aria-modal="true">
          <div class="image-viewer-toolbar">
            <div class="image-meta">
              <span class="badge">${safe(data.formatName)}</span>
              <strong>${safe(entry.name)}</strong>
              <span>${dimText ? `· ${dimText}` : ''} · ${countBytes(data.sizeBytes)}</span>
              <span class="muted">(${currentImageIndex + 1} / ${imageList.length})</span>
            </div>
            <div class="image-tools">
              <button id="img-zoom-out" title="Verkleinern (−)">−</button>
              <button id="img-zoom-reset" title="Originalgröße">100%</button>
              <button id="img-zoom-in" title="Vergrößern (+)">+</button>
              <button id="img-rot-left" title="90° nach links">↺</button>
              <button id="img-rot-right" title="90° nach rechts">↻</button>
              <button id="img-close-btn" class="button-secondary">✕</button>
            </div>
          </div>
          <div class="image-stage" id="img-stage">
            ${imageList.length > 1 ? '<button class="image-nav prev" id="img-prev" title="Vorheriges Bild (Pfeil Links)">◀</button>' : ''}
            <img id="img-element" src="${data.dataUrl}" alt="${safe(entry.name)}" style="transform: translate(0px, 0px) scale(1) rotate(0deg);" />
            ${imageList.length > 1 ? '<button class="image-nav next" id="img-next" title="Nächstes Bild (Pfeil Rechts)">▶</button>' : ''}
          </div>
        </div>
      </div>
    `;

    const img = root.querySelector<HTMLImageElement>('#img-element')!;
    const stage = root.querySelector<HTMLDivElement>('#img-stage')!;

    const applyTransform = () => {
      img.style.transform = `translate(${posX}px, ${posY}px) scale(${zoom}) rotate(${rotation}deg)`;
    };

    const closeViewer = () => {
      imageViewerAbortController?.abort();
      imageViewerAbortController = null;
      closeModal();
    };

    root.querySelector('#img-close-btn')?.addEventListener('click', closeViewer, { signal });

    root.querySelector('#img-zoom-in')?.addEventListener('click', () => {
      zoom = Math.min(zoom * 1.25, 20);
      applyTransform();
    }, { signal });

    root.querySelector('#img-zoom-out')?.addEventListener('click', () => {
      zoom = Math.max(zoom / 1.25, 0.05);
      applyTransform();
    }, { signal });

    root.querySelector('#img-zoom-reset')?.addEventListener('click', () => {
      zoom = 1;
      rotation = 0;
      posX = 0;
      posY = 0;
      applyTransform();
    }, { signal });

    root.querySelector('#img-rot-left')?.addEventListener('click', () => {
      rotation = (rotation - 90) % 360;
      applyTransform();
    }, { signal });

    root.querySelector('#img-rot-right')?.addEventListener('click', () => {
      rotation = (rotation + 90) % 360;
      applyTransform();
    }, { signal });

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.15 : 0.85;
      zoom = Math.min(Math.max(zoom * delta, 0.05), 20);
      applyTransform();
    }, { passive: false, signal });

    stage.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.image-nav')) return;
      isDragging = true;
      startX = e.clientX - posX;
      startY = e.clientY - posY;
      stage.classList.add('dragging');
    }, { signal });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      posX = e.clientX - startX;
      posY = e.clientY - startY;
      applyTransform();
    }, { signal });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      stage.classList.remove('dragging');
    }, { signal });

    const prevAction = () => {
      if (imageList.length > 1) {
        currentImageIndex = (currentImageIndex - 1 + imageList.length) % imageList.length;
        void renderImageViewer();
      }
    };
    const nextAction = () => {
      if (imageList.length > 1) {
        currentImageIndex = (currentImageIndex + 1) % imageList.length;
        void renderImageViewer();
      }
    };

    root.querySelector('#img-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      prevAction();
    }, { signal });

    root.querySelector('#img-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      nextAction();
    }, { signal });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!dialogOpen) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevAction();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextAction();
      } else if (e.key === '+' || e.key === '=') {
        zoom = Math.min(zoom * 1.25, 20);
        applyTransform();
      } else if (e.key === '-') {
        zoom = Math.max(zoom / 1.25, 0.05);
        applyTransform();
      } else if (e.key.toLowerCase() === 'r') {
        rotation = (rotation + 90) % 360;
        applyTransform();
      } else if (e.key === '0') {
        zoom = 1;
        posX = 0;
        posY = 0;
        rotation = 0;
        applyTransform();
      }
    }, { signal });

    notify(`Bild geöffnet: ${entry.name} (${dimText || data.formatName})`);
  } catch (e) {
    alert(`Bild konnte nicht geladen werden:\n${String(e)}`);
    notify(`Fehler beim Laden des Bildes: ${String(e)}`);
  }
}

async function viewFile(edit: boolean) {
  const e = current();
  if (!e || e.isDir) return;
  if (!edit && isImageFile(e.name)) {
    await viewImage(e.path);
    return;
  }
  try {
    const text = await invoke<string>('read_text', { path: e.path });
    let originalText = text;

    showModal(
      `${edit ? 'Bearbeiten' : 'Ansehen'}: ${safe(e.name)}`,
      `<div class="editor-info">UTF-8 / ANSI · ${countBytes(e.size)} · ${safe(e.path)}</div><textarea id="editor" class="editor" ${edit ? '' : 'readonly'}>${safe(text)}</textarea>`,
      `${buttonCancel}${edit ? '<button id="confirm-save" class="button-primary">Speichern</button>' : ''}`,
      () => {
        const textarea = $('#editor') as HTMLTextAreaElement;
        textarea?.focus();

        if (edit) {
          const doSave = async () => {
            const newContent = textarea.value;
            try {
              await invoke('write_text', { path: e.path, content: newContent });
              originalText = newContent;
              notify(`Gespeichert: ${e.name}`);
              closeModal();
              void refresh();
            } catch (err) {
              alert(`Speichern fehlgeschlagen:\n${String(err)}`);
            }
          };

          $('#confirm-save')?.addEventListener('click', () => void doSave());

          // Dirty check on cancel/esc
          const cancelBtns = document.querySelectorAll('[data-cancel]');
          cancelBtns.forEach((btn) => {
            btn.replaceWith(btn.cloneNode(true)); // remove old listeners
          });
          document.querySelectorAll('[data-cancel]').forEach((btn) => {
            btn.addEventListener('click', () => {
              if (textarea.value !== originalText) {
                if (!confirm('Ungespeicherte Änderungen verwerfen?')) return;
              }
              closeModal();
            });
          });
        }
      }
    );
  } catch (err) {
    alert(String(err));
  }
}

function pickDrive(side: Side) {
  if (!locationList.length) {
    notify('Keine Laufwerke verfügbar');
    return;
  }
  showModal(
    `Laufwerk / Ort wählen (${side === 0 ? 'Links - Alt+F1' : 'Rechts - Alt+F2'})`,
    `
    <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;">
      ${locationList
        .map(
          (loc, i) => `
        <button class="button-secondary drive-pick-btn" data-path="${safe(loc.path)}" style="text-align:left;display:flex;align-items:center;gap:12px;padding:10px 14px;">
          <kbd style="font-weight:bold;color:#7eb2ff;">${i + 1}</kbd>
          <strong style="color:#d5e5fb;">${safe(loc.name)}</strong>
          <span style="color:#6b87aa;font-size:11px;margin-left:auto;font-family:ui-monospace,monospace;">${safe(loc.path)}</span>
        </button>
      `
        )
        .join('')}
    </div>
    `,
    `<button data-cancel class="button-primary">Schließen</button>`,
    () => {
      document.querySelectorAll('.drive-pick-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const path = (btn as HTMLElement).dataset.path;
          if (path) {
            closeModal();
            await load(side, path);
          }
        });
      });
    }
  );
}

function showAbout() {
  showModal(
    'Über MiraCommander',
    `
    <div style="text-align:center;padding:10px 0 16px;">
      <img src="/appicon.png" style="width:72px;height:72px;border-radius:16px;margin-bottom:12px;box-shadow:0 8px 24px #000a;" alt="Logo"/>
      <div style="font-size:32px;font-weight:900;color:#7eb2ff;letter-spacing:-1.5px;margin-bottom:4px;">MIRA COMMANDER</div>
      <div style="font-size:12px;color:#8ba9d3;letter-spacing:1px;margin-bottom:18px;">VERSION 0.2.0 · NORTON COMMANDER REBORN</div>
      
      <div style="background:#0c172a;border:1px solid #233b61;border-radius:10px;padding:16px;text-align:left;line-height:1.8;font-size:13px;color:#d4e5ff;margin-bottom:14px;">
        <div>👤 <strong>Schöpfer &amp; Entwickler:</strong> <span style="color:#57deaa;font-weight:bold;">Kemal Akçocuk</span></div>
        <div>💡 <strong>Konzept:</strong> Orthodoxer Zwei-Fenster-Dateimanager inspiriert vom legendären <em>Norton Commander</em></div>
        <div>⚡ <strong>Architektur:</strong> Tauri 2 + Rust Core Backend + TypeScript / Vite Frontend</div>
        <div>📄 <strong>Lizenz:</strong> MIT License · Open Source für GitHub</div>
      </div>
      
      <p style="font-size:12px;color:#85a2c9;margin:0;line-height:1.6;">
        Entwickelt für maximale Performance, Sicherheit bei Dateioperationen und universelle Formatunterstützung auf Linux, Windows und macOS.
      </p>
    </div>
    `,
    `<button data-cancel class="button-primary">Schließen</button>`
  );
}

function help() {
  showModal(
    'Norton Commander Tastaturreferenz',
    `<div class="help-grid">
      ${[
        ['Tab', 'Zwischen linkem und rechtem Panel wechseln'],
        ['Alt+F1 / Alt+F2', 'Laufwerk im linken / rechten Panel wechseln'],
        ['Strg+F1 / Strg+F2', 'Linkes / rechtes Panel ein- / ausblenden'],
        ['F1', 'Hilfe anzeigen'],
        ['F2', 'Benutzermenü anzeigen'],
        ['F3', 'Datei ansehen (Text / universeller Bildbetrachter)'],
        ['F4', 'Datei bearbeiten (mit Dirty-Check)'],
        ['Shift+F4', 'Neue leere Datei anlegen & öffnen'],
        ['F5', 'Kopieren (mit Fortschritt, Häkchen & Konfliktdialog)'],
        ['F6', 'Verschieben / Bewegen'],
        ['Shift+F6', 'Datei oder Verzeichnis umbenennen'],
        ['F7', 'Neues Verzeichnis anlegen'],
        ['F8', 'Endgültig löschen'],
        ['F9', 'Pulldown-Menü (Links, Dateien, Befehle, Rechts)'],
        ['F10', 'MiraCommander beenden'],
        ['+', 'Gruppe nach Maske markieren (z. B. *.txt, *.png)'],
        ['-', 'Gruppe nach Maske abwählen'],
        ['*', 'Markierung im aktiven Panel umkehren (Invertieren)'],
        ['Ins / Leertaste', 'Einzelne Datei markieren / abwählen'],
        ['Strg + A', 'Alle Dateien im aktiven Panel markieren'],
        ['Strg + U', 'Panels tauschen (Links ⇄ Rechts)'],
        ['Strg + L', 'Info-Panel umschalten (Speicher & Statistik)'],
        ['Strg + Q', 'Schnellansicht (Quick View Vorschau im Gegenfenster)'],
        ['Strg + D', 'Verzeichnisse vergleichen (Unterschiede markieren)'],
        ['Strg + F3-F6', 'Sortieren nach Name / Erweiterung / Zeit / Größe'],
        ['Alt + F7', 'Dateisuche nach Name und Dateiinhalten'],
        ['Alt + F8', 'Befehlsverlauf (History)'],
        ['Alt + F5 / Alt + F6', 'ZIP-Archiv packen / entpacken'],
        ['Strg + R', 'Beide Panels neu einlesen (Aktualisieren)'],
        ['Strg + Enter', 'Aktuellen Dateinamen in Kommandozeile übernehmen']
      ]
        .map(([a, b]) => `<kbd>${a}</kbd><span>${b}</span>`)
        .join('')}
    </div>
    <p class="muted">Hinweis: Dateioperationen erfolgen direkt auf dem lokalen Dateisystem. Bei Konflikten stehen Übergehen, Überschreiben und Abbrechen zur Verfügung.</p>`,
    `<button data-cancel class="button-primary">Schließen</button>`
  );
}

async function command(key: string, shift = false) {
  switch (key) {
    case 'F1':
      help();
      break;
    case 'F2':
      showUserMenu();
      break;
    case 'F3':
      await viewFile(false);
      break;
    case 'F4':
      if (shift) operation('newfile');
      else await viewFile(true);
      break;
    case 'F5':
      operation('copy');
      break;
    case 'F6':
      operation(shift ? 'rename' : 'move');
      break;
    case 'F7':
      operation('mkdir');
      break;
    case 'F8':
      operation('delete');
      break;
    case 'F9':
      activeMenu = activeMenu ? null : 'files';
      render();
      break;
    case 'F10':
      if (confirm('MiraCommander schließen?')) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      }
      break;
  }
}

function toggleMark() {
  const p = panels[active];
  const item = current();
  if (item) {
    if (p.marked.has(item.path)) p.marked.delete(item.path);
    else p.marked.add(item.path);
    const max = Math.max(visible(active).length - 1, 0);
    p.cursor = Math.min(p.cursor + 1, max);
    render();
    document.querySelector(`.panel.active .file-row.cursor`)?.scrollIntoView({ block: 'nearest' });
    void updateQuickView();
  }
}

function bind() {
  document.querySelectorAll<HTMLElement>('.panel').forEach((el) =>
    el.addEventListener('mousedown', (e) => {
      const side = Number(el.dataset.side) as Side;
      if (!(e.target as HTMLElement).closest('input,select')) {
        if (side !== active) {
          active = side;
          render();
        }
      }
    })
  );

  document.querySelectorAll<HTMLElement>('.file-row[data-index]').forEach((el) => {
    el.addEventListener('click', (e) => {
      active = Number(el.dataset.side) as Side;
      const p = panels[active];
      p.cursor = Number(el.dataset.index);
      if ((e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) {
        const item = current();
        if (item) p.marked.has(item.path) ? p.marked.delete(item.path) : p.marked.add(item.path);
      }
      render();
      void updateQuickView();
    });
    el.addEventListener('dblclick', () => {
      active = Number(el.dataset.side) as Side;
      panels[active].cursor = Number(el.dataset.index);
      void openSelected();
    });
  });

  document.querySelectorAll<HTMLElement>('.file-row[data-parent]').forEach((el) =>
    el.addEventListener('dblclick', () => void parent(Number(el.dataset.side) as Side))
  );

  document.querySelectorAll<HTMLInputElement>('.path-input').forEach((el) =>
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        void load(Number(el.dataset.side) as Side, el.value);
        el.blur();
      }
    })
  );

  document.querySelectorAll<HTMLInputElement>('.filter-input').forEach((el) =>
    el.addEventListener('input', () => {
      const s = Number(el.dataset.side) as Side;
      panels[s].filter = el.value;
      panels[s].cursor = 0;
      const pos = el.selectionStart;
      render();
      const input = document.querySelectorAll<HTMLInputElement>('.filter-input')[s];
      input.focus();
      input.setSelectionRange(pos, pos);
    })
  );

  document.querySelectorAll<HTMLSelectElement>('.location-select').forEach((el) =>
    el.addEventListener('change', () => {
      if (el.value) void load(Number(el.dataset.side) as Side, el.value);
    })
  );

  document.querySelectorAll<HTMLElement>('.nav-up').forEach((el) =>
    el.addEventListener('click', () => void parent(Number(el.dataset.side) as Side))
  );

  document.querySelectorAll<HTMLElement>('.reload').forEach((el) =>
    el.addEventListener('click', () => {
      const s = Number(el.dataset.side) as Side;
      if (panels[s].data) void load(s, panels[s].data!.path, false);
    })
  );

  document.querySelectorAll<HTMLElement>('.toggle-hidden').forEach((el) =>
    el.addEventListener('click', () => {
      const s = Number(el.dataset.side) as Side;
      panels[s].showHidden = !panels[s].showHidden;
      render();
      saveSettings();
    })
  );

  document.querySelectorAll<HTMLElement>('.sort').forEach((el) =>
    el.addEventListener('click', () => {
      const s = Number(el.dataset.side) as Side;
      const sort = el.dataset.sort as Panel['sort'];
      const p = panels[s];
      p.reverse = p.sort === sort ? !p.reverse : false;
      p.sort = sort;
      p.cursor = 0;
      render();
      saveSettings();
    })
  );

  document.querySelectorAll<HTMLElement>('.close-info-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = Number(btn.dataset.side) as Side;
      panels[s].infoMode = false;
      render();
    });
  });

  document.querySelectorAll<HTMLElement>('.close-quickview-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = Number(btn.dataset.side) as Side;
      panels[s].quickViewMode = false;
      panels[s].quickViewData = null;
      render();
    });
  });

  document.querySelectorAll<HTMLElement>('.fn').forEach((el) => el.addEventListener('click', () => void command(el.dataset.key!)));
  $('#help-top')?.addEventListener('click', help);
  $('#refresh-all')?.addEventListener('click', () => void refresh());
  $('#about-top')?.addEventListener('click', showAbout);

  // Command prompt input
  const cmdInput = $('#cmd-line') as HTMLInputElement;
  const cmdRunBtn = $('#cmd-run-btn') as HTMLButtonElement;

  const triggerCmd = () => {
    const val = cmdInput?.value.trim();
    if (val) {
      currentCmdText = '';
      void executeCmd(val);
    }
  };

  cmdRunBtn?.addEventListener('click', triggerCmd);
  cmdInput?.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      triggerCmd();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length) {
        cmdHistoryIndex = cmdHistoryIndex === -1 ? cmdHistory.length - 1 : Math.max(0, cmdHistoryIndex - 1);
        cmdInput.value = cmdHistory[cmdHistoryIndex] || '';
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cmdHistory.length && cmdHistoryIndex !== -1) {
        cmdHistoryIndex = Math.min(cmdHistory.length - 1, cmdHistoryIndex + 1);
        cmdInput.value = cmdHistory[cmdHistoryIndex] || '';
      }
    } else if (e.key === 'Escape') {
      cmdInput.value = '';
      currentCmdText = '';
      cmdInput.blur();
      document.querySelector<HTMLElement>('.panel.active .file-list')?.focus();
    }
  });

  cmdInput?.addEventListener('input', () => {
    currentCmdText = cmdInput.value;
  });

  // Norton Commander Pulldown Menus
  document.querySelectorAll<HTMLElement>('.menu-item').forEach((item) => {
    const btn = item.querySelector('.menu-btn');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = item.dataset.menu || null;
      activeMenu = activeMenu === menu ? null : menu;
      render();
    });
  });

  document.querySelectorAll<HTMLElement>('.menu-entry').forEach((entry) => {
    entry.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = entry.dataset.action;
      activeMenu = null;
      render();
      if (!action) return;

      switch (action) {
        case 'drive-left':
          pickDrive(0);
          break;
        case 'drive-right':
          pickDrive(1);
          break;
        case 'toggle-left':
          panels[0].visiblePanel = !panels[0].visiblePanel;
          render();
          break;
        case 'toggle-right':
          panels[1].visiblePanel = !panels[1].visiblePanel;
          render();
          break;
        case 'info-left':
          active = 0;
          void toggleInfoPanel();
          break;
        case 'info-right':
          active = 1;
          void toggleInfoPanel();
          break;
        case 'quickview-left':
        case 'quickview-right':
          void toggleQuickView();
          break;
        case 'sort-name':
          panels[active].sort = 'name';
          render();
          break;
        case 'sort-ext':
          panels[active].sort = 'ext';
          render();
          break;
        case 'sort-time':
          panels[active].sort = 'modified';
          render();
          break;
        case 'sort-size':
          panels[active].sort = 'size';
          render();
          break;
        case 'reload-both':
          void refresh();
          break;
        case 'user-menu':
          showUserMenu();
          break;
        case 'view-file':
          void viewFile(false);
          break;
        case 'edit-file':
          void viewFile(true);
          break;
        case 'new-file':
          operation('newfile');
          break;
        case 'copy':
          operation('copy');
          break;
        case 'move':
          operation('move');
          break;
        case 'mkdir':
          operation('mkdir');
          break;
        case 'delete':
          operation('delete');
          break;
        case 'open-system':
          void openSelected();
          break;
        case 'pack-zip':
          packZipPrompt();
          break;
        case 'unpack-zip':
          unpackZipPrompt();
          break;
        case 'exit':
          void command('F10');
          break;
        case 'search':
          showSearchDialog();
          break;
        case 'history':
          showCmdHistory();
          break;
        case 'swap':
          swapPanels();
          break;
        case 'compare':
          compareDirectories();
          break;
        case 'select-mask':
          selectByMaskPrompt(true);
          break;
        case 'unselect-mask':
          selectByMaskPrompt(false);
          break;
        case 'invert-selection':
          invertSelection();
          break;
      }
    });
  });

  window.addEventListener('click', () => {
    if (activeMenu) {
      activeMenu = null;
      render();
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (dialogOpen) {
    if (e.key === 'Escape') {
      if (!isTransferRunning) {
        e.preventDefault();
        closeModal();
      }
    }
    return;
  }

  // Alt combinations
  if (e.altKey && e.key === 'F1') {
    e.preventDefault();
    pickDrive(0);
    return;
  }
  if (e.altKey && e.key === 'F2') {
    e.preventDefault();
    pickDrive(1);
    return;
  }
  if (e.altKey && e.key === 'F5') {
    e.preventDefault();
    packZipPrompt();
    return;
  }
  if (e.altKey && e.key === 'F6') {
    e.preventDefault();
    unpackZipPrompt();
    return;
  }
  if (e.altKey && e.key === 'F7') {
    e.preventDefault();
    showSearchDialog();
    return;
  }
  if (e.altKey && e.key === 'F8') {
    e.preventDefault();
    showCmdHistory();
    return;
  }

  // Strg combinations
  if (e.ctrlKey && e.key === 'F1') {
    e.preventDefault();
    panels[0].visiblePanel = !panels[0].visiblePanel;
    render();
    return;
  }
  if (e.ctrlKey && e.key === 'F2') {
    e.preventDefault();
    panels[1].visiblePanel = !panels[1].visiblePanel;
    render();
    return;
  }
  if (e.ctrlKey && e.key === 'F3') {
    e.preventDefault();
    panels[active].sort = 'name';
    render();
    notify('Sortierung: Nach Name (Strg+F3)');
    return;
  }
  if (e.ctrlKey && e.key === 'F4') {
    e.preventDefault();
    panels[active].sort = 'ext';
    render();
    notify('Sortierung: Nach Erweiterung (Strg+F4)');
    return;
  }
  if (e.ctrlKey && e.key === 'F5') {
    e.preventDefault();
    panels[active].sort = 'modified';
    render();
    notify('Sortierung: Nach Änderungsdatum (Strg+F5)');
    return;
  }
  if (e.ctrlKey && e.key === 'F6') {
    e.preventDefault();
    panels[active].sort = 'size';
    render();
    notify('Sortierung: Nach Größe (Strg+F6)');
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'u') {
    e.preventDefault();
    swapPanels();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    void toggleInfoPanel();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'q') {
    e.preventDefault();
    void toggleQuickView();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    compareDirectories();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    selectAll();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    void refresh();
    return;
  }
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    const it = current();
    if (it) {
      const input = $('#cmd-line') as HTMLInputElement;
      if (input) {
        input.value = (input.value ? input.value + ' ' : '') + `"${it.name}"`;
        input.focus();
      }
    }
    return;
  }

  if ((e.target as HTMLElement).matches('input,textarea,select')) return;

  if (e.key === 'Tab') {
    e.preventDefault();
    active = active === 0 ? 1 : 0;
    render();
    document.querySelector<HTMLElement>('.panel.active .file-list')?.focus();
    return;
  }
  if (e.key === '+') {
    e.preventDefault();
    selectByMaskPrompt(true);
    return;
  }
  if (e.key === '-') {
    e.preventDefault();
    selectByMaskPrompt(false);
    return;
  }
  if (e.key === '*') {
    e.preventDefault();
    invertSelection();
    return;
  }
  if (
    e.key === 'ArrowDown' ||
    e.key === 'ArrowUp' ||
    e.key === 'Home' ||
    e.key === 'End' ||
    e.key === 'PageDown' ||
    e.key === 'PageUp'
  ) {
    e.preventDefault();
    const p = panels[active];
    const max = Math.max(visible(active).length - 1, 0);
    p.cursor =
      e.key === 'ArrowDown'
        ? Math.min(max, p.cursor + 1)
        : e.key === 'ArrowUp'
        ? Math.max(0, p.cursor - 1)
        : e.key === 'Home'
        ? 0
        : e.key === 'End'
        ? max
        : e.key === 'PageDown'
        ? Math.min(max, p.cursor + 12)
        : Math.max(0, p.cursor - 12);
    render();
    document.querySelector(`.panel.active .file-row.cursor`)?.scrollIntoView({ block: 'nearest' });
    void updateQuickView();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    void openSelected();
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    void parent();
    return;
  }
  if (e.key === ' ' || e.key === 'Insert') {
    e.preventDefault();
    toggleMark();
    return;
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    operation('delete');
    return;
  }
  if (e.key === 'F9') {
    e.preventDefault();
    activeMenu = activeMenu ? null : 'left';
    render();
    return;
  }
  if (e.shiftKey && e.key === 'F4') {
    e.preventDefault();
    operation('newfile');
    return;
  }
  if (e.shiftKey && e.key === 'F6') {
    e.preventDefault();
    operation('rename');
    return;
  }
  if (/^F(1|2|3|4|5|6|7|8|10)$/.test(e.key)) {
    e.preventDefault();
    void command(e.key, e.shiftKey);
  }
});

async function initSplashscreen() {
  const splash = document.getElementById('mira-splash');
  const splashImg = document.getElementById('mira-splash-img') as HTMLImageElement | null;

  if (splashImg) {
    splashImg.addEventListener('error', async () => {
      try {
        const img = await invoke<ImageData>('read_image', { path: 'D:\\MiraSystems\\MiraSystem.png' });
        if (img?.dataUrl) {
          splashImg.src = img.dataUrl;
        }
      } catch (err) {
        console.error('Splashscreen image fallback error:', err);
      }
    });
  }

  if (splash) {
    // Exact 5 seconds duration
    setTimeout(() => {
      splash.classList.add('fade-out');
      setTimeout(() => {
        splash.remove();
      }, 600);
    }, 5000);
  }
}

async function init() {
  void initSplashscreen();
  render();
  try {
    locationList = await invoke<Location[]>('locations');
    const home = await invoke<string>('home');
    const p0Path = saved?.p0?.path || home;
    const p1Path = saved?.p1?.path || home;
    await Promise.all([load(0, p0Path), load(1, p1Path)]);
    notify('MiraCommander bereit · Tab zum Fensterwechsel · F1 für Hilfe');
  } catch (e) {
    notify(`Startfehler: ${String(e)}`);
  }
}

void init();
