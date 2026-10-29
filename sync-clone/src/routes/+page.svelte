<script lang="ts">
  import Icon from "@iconify/svelte";
  import { scanFolders, createSyncPlan, executeSyncPlan, saveLogFile } from "$lib/api";
  import type {
    DiffEntryDto,
    SyncPlanDto,
    SyncResultDto,
    SyncMode,
    LogEntry,
  } from "$lib/types";
  import FolderPicker from "$lib/components/FolderPicker.svelte";
  import CompareButton from "$lib/components/CompareButton.svelte";
  import DiffTable from "$lib/components/DiffTable.svelte";
  import SyncPreview from "$lib/components/SyncPreview.svelte";
  import LogPanel from "$lib/components/LogPanel.svelte";
  import ProgressBar from "$lib/components/ProgressBar.svelte";
  import AboutDialog from "$lib/components/AboutDialog.svelte";

  let leftPath = $state("");
  let rightPath = $state("");
  let mode: SyncMode = $state("update");
  let diffs: DiffEntryDto[] = $state([]);
  let plan: SyncPlanDto | null = $state(null);
  let result: SyncResultDto | null = $state(null);
  let logs: LogEntry[] = $state([]);
  let logFilePath = $state("");
  let scanning = $state(false);
  let planning = $state(false);
  let executing = $state(false);
  let plannedActions = $state(new Map<string, string>());
  let statusMessage = $state("");
  let aboutOpen = $state(false);

  import { locale, setLocale, t as _t } from "$lib/i18n";
  function t(key: string, vars?: Record<string, string | number>) { return _t(key, vars); }
  let selectedLocale = 'en';
  const unsubscribeLocale = locale.subscribe((v) => (selectedLocale = v || 'en'));

  function addLog(level: LogEntry["level"], message: string) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    logs = [...logs, { timestamp, message, level }];
  }

  async function handleCompare() {
    if (!leftPath || !rightPath) {
      addLog("warn", t('messages.select_both'));
      return;
    }

    scanning = true;
    plan = null;
    result = null;
    plannedActions = new Map();
    diffs = [];
    statusMessage = t('status.scanning');
    addLog("info", t('messages.scan_started', { left: leftPath, right: rightPath }));

    try {
      diffs = await scanFolders(leftPath, rightPath);
      addLog("info", t('messages.scan_results', { count: diffs.length }));

      const nonEqual = diffs.filter((d) => d.kind !== "Equal");
      if (nonEqual.length === 0) {
        statusMessage = t('status.scan_complete');
        addLog("info", t('status.scan_complete'));
      } else {
        statusMessage = `📊 ${nonEqual.length} differences found`;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", `Scan failed: ${msg}`);
      statusMessage = t('status.scan_failed');
    } finally {
      scanning = false;
    }
  }

  async function handlePreview() {
    if (diffs.length === 0) {
      addLog("warn", t('status.preview_none'));
      return;
    }

    planning = true;
    statusMessage = t('sync.creating_plan');
    addLog("info", `Create sync plan (mode: ${mode})`);

    try {
      plan = await createSyncPlan(leftPath, rightPath, mode, diffs);
      plannedActions = new Map(
        plan.actions.map((a) => [a.relative_path, a.action])
      );

      const kopieren = plan.actions.filter((a) => a.action === "CopyLeftToRight").length;
      const loeschen = plan.actions.filter((a) => a.action === "DeleteRight").length;
      statusMessage = t('messages.plan_summary', { copy: kopieren, delete: loeschen });
      addLog("info", t('messages.plan_created', { copy: kopieren, delete: loeschen }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", `Plan creation failed: ${msg}`);
      statusMessage = "❌ Plan-Erstellung fehlgeschlagen";
    } finally {
      planning = false;
    }
  }

  async function handleSync() {
    let activePlan = plan;

    // Automatisch Plan erstellen, falls noch nicht vorhanden
      if (!activePlan) {
      if (diffs.length === 0) {
        addLog("warn", t('status.no_data'));
        return;
      }
      addLog("info", t('messages.auto_plan'));
      try {
        activePlan = await createSyncPlan(leftPath, rightPath, mode, diffs);
        plan = activePlan;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("error", `Plan-Erstellung fehlgeschlagen: ${msg}`);
        statusMessage = "❌ Plan-Erstellung fehlgeschlagen";
        return;
      }
    }

    executing = true;
    result = null;
    statusMessage = t('sync.running');
    addLog("info", "Start sync execution");

    try {
      result = await executeSyncPlan(activePlan);
      const { success_count, error_count } = result;
      statusMessage = `✅ Sync complete: ${success_count} successful, ${error_count} errors`;
      addLog("info", `Sync complete: ${success_count} OK, ${error_count} errors`);

      if (error_count > 0 && result.errors) {
        for (const err of result.errors) {
          addLog("error", `${err.message}${err.path ? ` (${err.path})` : ""}`);
        }
      }

      // Log automatisch speichern
      try {
        const allLogs = [...logs];
        logFilePath = await saveLogFile(allLogs);
        addLog("info", `Log gespeichert: ${logFilePath}`);
      } catch (logErr: unknown) {
        const logMsg = logErr instanceof Error ? logErr.message : String(logErr);
        addLog("warn", `Log could not be saved: ${logMsg}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog("error", `Sync failed: ${msg}`);
      statusMessage = "❌ Sync fehlgeschlagen";
    } finally {
      executing = false;
    }
  }
</script>

<main class="app">
  <nav class="menu-bar">
    <div class="menu-left">
      <span class="menu-brand"><Icon icon="ci:sync" width="16" /> MiraFileSync</span>
    </div>
    <div class="menu-right">
      <label style="display:flex;align-items:center;gap:8px">
        <span style="font-size:0.9em">{t('menu.language')}</span>
        <select bind:value={selectedLocale} on:change={() => setLocale(selectedLocale)}>
          <option value="en">English</option>
          <option value="tr">Türkçe</option>
        </select>
      </label>

      <button class="menu-btn" onclick={() => aboutOpen = true}>
        <Icon icon="ci:info" width="14" /> {t('app.info')}
      </button>
    </div>
  </nav>

  <h1>{t('app.title')}</h1>
  <p class="subtitle">{t('app.subtitle')}</p>

  <div class="folder-row">
    <FolderPicker bind:path={leftPath} label={t('folders.left_label')} id="left-folder" />
    <FolderPicker bind:path={rightPath} label={t('folders.right_label')} id="right-folder" />
  </div>

  <div class="toolbar">
    <CompareButton onclick={handleCompare} loading={scanning} />

    <div class="mode-select">
      <label for="sync-mode">{t('sync.mode_label')}</label>
      <select id="sync-mode" bind:value={mode}>
        <option value="update">{t('sync.update')}</option>
        <option value="mirror">{t('sync.mirror')}</option>
      </select>
    </div>

    <button onclick={handlePreview} disabled={planning || diffs.length === 0}>
      <Icon icon="ci:list-checks" width="16" />
      {planning ? t('sync.creating_plan') : t('sync.preview')}
    </button>

    <button
      class="sync-btn"
      onclick={handleSync}
      disabled={executing || (diffs.length === 0 && !plan)}
    >
      <Icon icon="ci:play-arrow" width="16" />
      {executing ? t('sync.running') : t('sync.run')}
    </button>
  </div>

  {#if statusMessage}
    <div class="status">{statusMessage}</div>
  {/if}

  <ProgressBar active={scanning || planning || executing} label={scanning ? t('progress.scanning') : planning ? t('progress.planning') : executing ? t('progress.syncing') : ""} />

  <div class="content-grid">
    <div class="diff-section">
      <h2><Icon icon="ci:table" width="18" /> {t('diff.results')} ({diffs.length})</h2>
      <DiffTable {diffs} {plannedActions} />
    </div>

    <div class="sidebar">
      <SyncPreview {plan} />

      {#if result}
        <div class="result-box">
          <h3><Icon icon="ci:check-circle" width="16" /> {t('result.title')}</h3>
          <p>{t('result.success')}: <strong>{result.success_count}</strong></p>
          <p>{t('result.errors')}: <strong>{result.error_count}</strong></p>
        </div>
      {/if}
    </div>
  </div>

  <LogPanel {logs} {logFilePath} />
  <AboutDialog bind:open={aboutOpen} />
</main>

<style>
  .app {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .menu-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    margin: 0 -24px;
    padding-left: 24px;
    padding-right: 24px;
    background: #f8f8f8;
    border-bottom: 1px solid #e0e0e0;
  }

  .menu-brand {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 0.85em;
    color: #396cd8;
  }

  .menu-right {
    display: flex;
    gap: 4px;
  }

  .menu-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: 0.8em;
    cursor: pointer;
    color: #555;
  }

  .menu-btn:hover {
    background: #e8e8e8;
    border-color: #ddd;
  }

  h1 {
    margin: 0;
    font-size: 1.5em;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .subtitle {
    margin: 0;
    color: #888;
    font-size: 0.9em;
  }

  .folder-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .mode-select {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9em;
  }

  .mode-select select {
    padding: 8px 12px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.9em;
    background: white;
  }

  button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 20px;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: white;
    font-size: 0.9em;
    cursor: pointer;
    transition: all 0.2s;
  }

  button:hover:not(:disabled) {
    border-color: #396cd8;
    color: #396cd8;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sync-btn {
    background: #2e7d32;
    color: white;
    border-color: #2e7d32;
  }

  .sync-btn:hover:not(:disabled) {
    background: #1b5e20;
    border-color: #1b5e20;
    color: white;
  }

  .status {
    padding: 8px 16px;
    background: #f5f5f5;
    border-radius: 6px;
    font-size: 0.9em;
    text-align: center;
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr 350px;
    gap: 16px;
  }

  .diff-section h2 {
    margin: 0 0 8px;
    font-size: 1.1em;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .result-box {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 16px;
  }

  .result-box h3 {
    margin: 0 0 8px;
    font-size: 1em;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .result-box p {
    margin: 4px 0;
    font-size: 0.9em;
  }

  @media (prefers-color-scheme: dark) {
    .menu-bar { background: #222; border-bottom-color: #444; }
    .menu-brand { color: #5a8ef7; }
    .menu-btn { color: #bbb; }
    .menu-btn:hover { background: #333; border-color: #555; }
    .status { background: #333; }
    .mode-select select { background: #333; color: #f6f6f6; border-color: #555; }
    button { background: #333; color: #f6f6f6; border-color: #555; }
    .sync-btn { background: #2e7d32; border-color: #2e7d32; }
    .result-box { border-color: #444; }
    .app { color: #f6f6f6; }
  }
</style>
