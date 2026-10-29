<script lang="ts">
  import Icon from "@iconify/svelte";
  import { t } from "$lib/i18n";

  let {
    open = $bindable(false),
  }: {
    open?: boolean;
  } = $props();

  function close() {
    open = false;
  }

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="backdrop" onclick={handleBackdrop}>
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <span class="dialog-title"><Icon icon="ci:info" width="20" /> {t('app.about')}</span>
        <button class="close-btn" onclick={close}>
          <Icon icon="ci:close-big" width="18" />
        </button>
      </div>

      <div class="dialog-body">
        <div class="app-icon">
          <Icon icon="ci:sync" width="48" />
        </div>
        <h2>{t('app.title')}</h2>
        <p class="version">{t('about.version', { v: '0.1.0' })}</p>
        <p class="description">{t('about.description')}</p>

        <hr />

        <div class="copyright">
          <p><strong>{t('about.copyright')}</strong></p>
          <p>{t('about.all_rights')}</p>
        </div>

        <div class="tech">
          <p>{t('about.built_with')}</p>
          <div class="tech-badges">
            <span class="badge"><Icon icon="ci:settings" width="12" /> Tauri v2</span>
            <span class="badge"><Icon icon="ci:fire" width="12" /> SvelteKit 5</span>
            <span class="badge"><Icon icon="ci:gear" width="12" /> Rust</span>
            <span class="badge"><Icon icon="ci:image" width="12" /> Iconify</span>
          </div>
        </div>

        <p class="license">{t('about.license')}</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .dialog {
    background: white;
    border-radius: 12px;
    width: 420px;
    max-width: 90vw;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
  }

  .dialog-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.95em;
  }

  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    color: #666;
    display: flex;
    align-items: center;
  }

  .close-btn:hover {
    background: #e0e0e0;
    color: #333;
  }

  .dialog-body {
    padding: 24px;
    text-align: center;
  }

  .app-icon {
    color: #396cd8;
    margin-bottom: 8px;
  }

  h2 {
    margin: 0;
    font-size: 1.3em;
  }

  .version {
    color: #888;
    font-size: 0.85em;
    margin: 4px 0;
  }

  .description {
    color: #555;
    font-size: 0.9em;
    margin: 0 0 16px;
  }

  hr {
    border: none;
    border-top: 1px solid #eee;
    margin: 16px 0;
  }

  .copyright p {
    margin: 2px 0;
    font-size: 0.85em;
    color: #555;
  }

  .tech {
    margin: 16px 0;
  }

  .tech p {
    font-size: 0.8em;
    color: #888;
    margin: 0 0 8px;
  }

  .tech-badges {
    display: flex;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75em;
    padding: 3px 10px;
    background: #f0f4ff;
    color: #396cd8;
    border-radius: 12px;
    font-weight: 500;
  }

  .license {
    font-size: 0.8em;
    color: #aaa;
    margin: 16px 0 0;
  }

  @media (prefers-color-scheme: dark) {
    .dialog {
      background: #2a2a2a;
      color: #f0f0f0;
    }

    .dialog-header {
      background: #333;
      border-bottom-color: #444;
    }

    .close-btn:hover {
      background: #444;
      color: #eee;
    }

    .description { color: #bbb; }
    .copyright p { color: #bbb; }
    hr { border-top-color: #444; }
    .badge { background: #1a237e44; color: #5a8ef7; }
    .license { color: #666; }
  }
</style>