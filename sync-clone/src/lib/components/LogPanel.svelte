<script lang="ts">
  import Icon from "@iconify/svelte";
  import type { LogEntry } from "../types";

  let {
    logs = [],
    logFilePath = "",
  }: {
    logs: LogEntry[];
    logFilePath?: string;
  } = $props();

  let logContainer: HTMLDivElement;

  const visibleLogs = $derived(logs.slice(-10));

  $effect(() => {
    logs; // track reactivity
    if (logContainer) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  });

  function logClass(level: string): string {
    switch (level) {
      case "error": return "log-error";
      case "warn": return "log-warn";
      default: return "log-info";
    }
  }

  function logIcon(level: string): string {
    switch (level) {
      case "error": return "ci:circle-close";
      case "warn": return "ci:warning";
      default: return "ci:circle-info";
    }
  }
</script>

<div class="log-panel">
  <div class="log-header">
    <h3>Log {logs.length > 10 ? `(letzte 10 von ${logs.length})` : `(${logs.length})`}</h3>
    {#if logFilePath}
      <span class="log-saved" title={logFilePath}><Icon icon="ci:check" width="12" /> Gespeichert</span>
    {/if}
  </div>
  <div class="log-container" bind:this={logContainer}>
    {#if visibleLogs.length === 0}
      <p class="empty">Keine Log-Einträge.</p>
    {:else}
      {#each visibleLogs as log, i (i)}
          <div class="log-entry {logClass(log.level)}">
          <span class="log-time">{log.timestamp}</span>
          <Icon icon={logIcon(log.level)} width="14" class="log-icon" />
          <span class="log-msg">{log.message}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .log-panel {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 16px;
  }

  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  h3 {
    margin: 0;
    font-size: 1em;
  }

  .log-saved {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8em;
    color: #2e7d32;
    background: #e8f5e9;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .log-container {
    max-height: 200px;
    overflow-y: auto;
    font-family: monospace;
    font-size: 0.8em;
    background: #fafafa;
    border-radius: 4px;
    padding: 8px;
  }

  .log-entry {
    display: flex;
    gap: 8px;
    padding: 2px 0;
  }

  .log-time {
    color: #888;
    white-space: nowrap;
  }

  .log-level {
    font-weight: 600;
    min-width: 40px;
  }

  .log-info :global(.log-icon) { color: #1565c0; }
  .log-warn :global(.log-icon) { color: #e65100; }
  .log-error :global(.log-icon) { color: #c62828; }

  .log-msg {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .empty {
    color: #888;
    font-style: italic;
  }

  @media (prefers-color-scheme: dark) {
    .log-panel { border-color: #444; }
    .log-container { background: #1a1a1a; }
    .log-saved { background: #1b5e2044; color: #66bb6a; }
  }
</style>
