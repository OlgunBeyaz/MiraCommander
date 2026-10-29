<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import Icon from "@iconify/svelte";

  let { label, path = $bindable(""), id }: { label: string; path?: string; id: string } = $props();

  async function handleBrowse() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: `Ordner auswählen: ${label}`,
    });
    if (selected) {
      path = selected;
    }
  }
</script>

<div class="folder-picker">
  <label for={id}>{label}</label>
  <div class="input-row">
    <input
      {id}
      type="text"
      placeholder="/pfad/zum/ordner"
      bind:value={path}
    />
    <button onclick={handleBrowse} class="browse-btn">
      <Icon icon="ci:folder-open" width="16" /> Durchsuchen
    </button>
  </div>
</div>

<style>
  .folder-picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label {
    font-weight: 600;
    font-size: 0.9em;
  }

  .input-row {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 0.9em;
    font-family: inherit;
  }

  input:focus {
    outline: none;
    border-color: #396cd8;
    box-shadow: 0 0 0 2px rgba(57, 108, 216, 0.2);
  }

  .browse-btn {
    padding: 8px 16px;
    background: #396cd8;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 0.85em;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.2s;
  }

  .browse-btn:hover {
    background: #2d5abf;
  }

  @media (prefers-color-scheme: dark) {
    .browse-btn {
      background: #5a8ef7;
    }
    .browse-btn:hover {
      background: #4a7de6;
    }
  }
</style>
