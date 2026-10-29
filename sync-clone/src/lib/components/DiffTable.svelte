<script lang="ts">
  import Icon from "@iconify/svelte";
  import type { DiffEntryDto } from "../types";

  let {
    diffs = [],
    plannedActions = new Map<string, string>(),
  }: {
    diffs: DiffEntryDto[];
    plannedActions?: Map<string, string>;
  } = $props();

  function statusClass(kind: string): string {
    switch (kind) {
      case "OnlyLeft": return "status-only-left";
      case "OnlyRight": return "status-only-right";
      case "Modified": return "status-modified";
      case "Equal": return "status-equal";
      default: return "";
    }
  }

  function statusLabel(kind: string): string {
    switch (kind) {
      case "OnlyLeft": return "Nur links";
      case "OnlyRight": return "Nur rechts";
      case "Modified": return "Geändert";
      case "Equal": return "Identisch";
      default: return kind;
    }
  }

  function statusIcon(kind: string): string {
    switch (kind) {
      case "OnlyLeft": return "ci:arrow-right";
      case "OnlyRight": return "ci:trash";
      case "Modified": return "ci:edit";
      case "Equal": return "ci:check";
      default: return "ci:circle-info";
    }
  }

  function plannedActionLabel(relPath: string): string {
    const action = plannedActions.get(relPath);
    if (!action) return "";
    switch (action) {
      case "CopyLeftToRight": return "→ Kopieren";
      case "DeleteRight": return "✕ Löschen";
      case "Skip": return "–";
      default: return action;
    }
  }

  function plannedActionClass(relPath: string): string {
    const action = plannedActions.get(relPath);
    if (action === "DeleteRight") return "plan-delete";
    if (action === "CopyLeftToRight") return "plan-copy";
    return "";
  }

  function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
  }
</script>

<div class="diff-table-wrapper">
  {#if diffs.length === 0}
    <p class="empty">Keine Unterschiede gefunden.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Relative Path</th>
          <th>Status</th>
          <th>Size Left</th>
          <th>Size Right</th>
          <th>Modified Left</th>
          <th>Modified Right</th>
          <th>Geplante Aktion</th>
        </tr>
      </thead>
      <tbody>
        {#each diffs as diff (diff.relative_path)}
          <tr class={statusClass(diff.kind)}>
            <td class="path-cell">{diff.relative_path}</td>
            <td><span class="badge {statusClass(diff.kind)}"><Icon icon={statusIcon(diff.kind)} width="14" /> {statusLabel(diff.kind)}</span></td>
            <td>{diff.left ? formatSize(diff.left.size) : "–"}</td>
            <td>{diff.right ? formatSize(diff.right.size) : "–"}</td>
            <td>{diff.left?.modified ?? "–"}</td>
            <td>{diff.right?.modified ?? "–"}</td>
            <td class={plannedActionClass(diff.relative_path)}>
              {plannedActionLabel(diff.relative_path)}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .diff-table-wrapper {
    overflow-x: auto;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
  }

  th {
    background: #f5f5f5;
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    border-bottom: 2px solid #e0e0e0;
    white-space: nowrap;
  }

  td {
    padding: 8px 12px;
    border-bottom: 1px solid #eee;
  }

  .path-cell {
    font-family: monospace;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 500;
    white-space: nowrap;
  }

  .status-only-left { background: #e3f2fd; }
  .status-only-right { background: #fff3e0; }
  .status-modified { background: #fce4ec; }
  .status-equal { background: #e8f5e9; }

  .empty {
    text-align: center;
    padding: 24px;
    color: #888;
  }

  .plan-copy { color: #1565c0; font-weight: 500; }
  .plan-delete { color: #c62828; font-weight: 500; }

  @media (prefers-color-scheme: dark) {
    .diff-table-wrapper {
      border-color: #444;
    }

    th {
      background: #333;
      border-bottom-color: #555;
    }

    td {
      border-bottom-color: #333;
    }

    .status-only-left { background: #1a237e44; }
    .status-only-right { background: #e6510044; }
    .status-modified { background: #b71c1c44; }
    .status-equal { background: #1b5e2044; }
  }
</style>
