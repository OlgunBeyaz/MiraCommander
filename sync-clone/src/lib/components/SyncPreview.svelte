<script lang="ts">
  import Icon from "@iconify/svelte";
  import { t } from "$lib/i18n";
  import type { SyncPlanDto } from "../types";

  let {
    plan,
  }: {
    plan: SyncPlanDto | null;
  } = $props();

  function actionLabel(action: string): string {
    switch (action) {
      case "CopyLeftToRight": return t('sync.copy') ?? 'Copy';
      case "DeleteRight": return t('sync.delete') ?? 'Delete';
      case "Skip": return t('sync.skip') ?? 'Skip';
      default: return action;
    }
  }

  function actionIcon(action: string): string {
    switch (action) {
      case "CopyLeftToRight": return "ci:copy";
      case "DeleteRight": return "ci:trash";
      case "Skip": return "ci:close-big";
      default: return "ci:circle-info";
    }
  }

  function actionClass(action: string): string {
    switch (action) {
      case "CopyLeftToRight": return "action-copy";
      case "DeleteRight": return "action-delete";
      default: return "action-skip";
    }
  }

  function countByAction(action: string): number {
    if (!plan) return 0;
    return plan.actions.filter((a) => a.action === action).length;
  }
</script>

<div class="sync-preview">
  <h3>{t('sync.preview')}</h3>

  {#if plan}
    <div class="summary">
      <span class="stat">{t('sync.copy')}: <strong>{countByAction("CopyLeftToRight")}</strong></span>
      <span class="stat">{t('sync.delete')}: <strong>{countByAction("DeleteRight")}</strong></span>
      <span class="stat">{t('sync.skip')}: <strong>{countByAction("Skip")}</strong></span>
    </div>

    <div class="action-list">
      {#each plan.actions as item, i (item.relative_path + i)}
        {#if item.action !== "Skip"}
          <div class="action-item {actionClass(item.action)}">
            <span class="action-label"><Icon icon={actionIcon(item.action)} width="14" /> {actionLabel(item.action)}</span>
            <code class="action-path">{item.relative_path}</code>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
  <p class="no-plan">{t('status.preview_none')}</p>
  {/if}
</div>

<style>
  .sync-preview {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 16px;
  }

  h3 {
    margin: 0 0 12px;
    font-size: 1em;
  }

  .summary {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    font-size: 0.9em;
  }

  .stat strong {
    font-weight: 600;
  }

  .action-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
  }

  .action-item {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .action-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 500;
    min-width: 100px;
  }

  .action-path {
    font-family: monospace;
    font-size: 0.9em;
  }

  .action-copy { background: #e3f2fd; }
  .action-delete { background: #fce4ec; }
  .action-skip { display: none; }

  .no-plan {
    color: #888;
    font-size: 0.9em;
  }

  @media (prefers-color-scheme: dark) {
    .sync-preview { border-color: #444; }
    .action-copy { background: #1a237e44; }
    .action-delete { background: #b71c1c44; }
  }
</style>
