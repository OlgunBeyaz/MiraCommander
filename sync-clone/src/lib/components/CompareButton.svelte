<script lang="ts">
  import Icon from "@iconify/svelte";
  import { t } from "$lib/i18n";

  let { onclick, loading = false }: { onclick: () => void; loading?: boolean } = $props();
</script>

<button onclick={onclick} disabled={loading}>
  {#if loading}
    <Icon icon="ci:loading" width="16" class="spin" /> {t('progress.scanning')}
  {:else}
    <Icon icon="ci:search" width="16" /> {t('sync.preview')}
  {/if}
</button>

<style>
  button {
    padding: 10px 24px;
    background: #396cd8;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 1em;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  button:hover:not(:disabled) {
    background: #2d5abf;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  button {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
