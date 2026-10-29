<script lang="ts">
  let {
    active = false,
    progress = 0,
    label = "",
  }: {
    active?: boolean;
    progress?: number;
    label?: string;
  } = $props();

  const indeterminate = $derived(progress <= 0);
  const percent = $derived(Math.min(100, Math.max(0, progress)));
</script>

{#if active}
  <div class="progress-wrapper">
    {#if label}
      <span class="progress-label">{label}</span>
    {/if}
    <div class="progress-track">
      {#if indeterminate}
        <div class="progress-bar indeterminate"></div>
      {:else}
        <div class="progress-bar determinate" style="width: {percent}%"></div>
      {/if}
    </div>
    {#if !indeterminate}
      <span class="progress-pct">{percent.toFixed(0)}%</span>
    {/if}
  </div>
{/if}

<style>
  .progress-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 0;
  }

  .progress-label {
    font-size: 0.85em;
    color: #666;
    white-space: nowrap;
  }

  .progress-track {
    flex: 1;
    height: 8px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  }

  .progress-bar {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .determinate {
    background: linear-gradient(90deg, #396cd8, #5a8ef7);
  }

  .indeterminate {
    width: 40%;
    background: linear-gradient(90deg, #396cd8, #5a8ef7);
    animation: indeterminate 1.5s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  .progress-pct {
    font-size: 0.8em;
    font-weight: 600;
    color: #396cd8;
    min-width: 36px;
    text-align: right;
  }

  @media (prefers-color-scheme: dark) {
    .progress-label { color: #aaa; }
    .progress-track { background: #333; }
  }
</style>