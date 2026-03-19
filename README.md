# AsciiDoc Auto Preview

An [Obsidian](https://obsidian.md) plugin that **automatically refreshes the AsciiDoc preview** whenever you stop typing, eliminating the need to manually trigger a reload.

Designed as a companion to any community AsciiDoc plugin that renders `.adoc` files but does not watch for live edits.

---

## The problem this solves

Standard AsciiDoc plugins for Obsidian render `.adoc` files on open but do **not** re-render when the file is being edited. You have to manually click "Reload preview" every time you make a change.

This plugin listens for editor changes and, after a configurable idle period (debounce), triggers the preview refresh automatically — so the preview always stays in sync without any manual action.

---

## Features

- Auto-refreshes the AsciiDoc preview after you stop typing
- Configurable idle delay (default: 1000 ms)
- Enable / disable via settings or the command palette
- Manual "Refresh now" command available at any time
- Works alongside any installed AsciiDoc community plugin

---

## Installation

### From Community Plugins (recommended)

1. Open Obsidian → **Settings** → **Community plugins**
2. Disable **Safe mode** if prompted
3. Click **Browse** and search for `AsciiDoc Auto Preview`
4. Click **Install**, then **Enable**

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/your-username/obsidian-asciidoc-auto-preview/releases/latest)
2. Copy all three files into `.obsidian/plugins/asciidoc-auto-preview/` inside your vault
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

---

## Usage

1. Open an `.adoc` file in Obsidian
2. Open the preview pane alongside the editor (split view)
3. Start editing — the preview refreshes automatically once you pause typing

### Commands

| Command | Description |
|---|---|
| `AsciiDoc Auto Preview: Toggle auto preview` | Enable or disable auto-refresh |
| `AsciiDoc Auto Preview: Refresh AsciiDoc preview now` | Manually trigger a preview refresh immediately |

---

## Settings

| Setting | Default | Description |
|---|---|---|
| **Refresh delay (ms)** | `1000` | Milliseconds to wait after the last keystroke before refreshing. Minimum: 100 ms. |
| **Enable auto preview** | `on` | Master switch for automatic refreshing. |

---

## How it works

The plugin hooks into Obsidian's `editor-change` event. Every keystroke on an `.adoc` file resets a debounce timer. Once the timer expires (the user stops typing), `refreshPreview()` is called. It tries the following strategies in order until one succeeds:

1. **Command execution** — calls a known reload command exposed by the installed AsciiDoc plugin (e.g. `asciidoc:reload-preview`)
2. **View type lookup** — searches all open leaves for known AsciiDoc view types (`asciidoc`, `adoc`, `asciidoc-preview`, …) and calls `render()` / `refresh()` / `reload()` directly on the view
3. **File-based lookup** — iterates every open leaf and finds any view whose linked file matches the currently active `.adoc` file
4. **Vault event trigger** — dispatches `vault:modify` and `metadataCache:changed` events as a last resort, which most AsciiDoc plugins react to

---

## Repository structure

```
obsidian-asciidoc-auto-preview/
├── main.ts               # Plugin source (TypeScript)
├── main.js               # Compiled bundle — committed for distribution
├── manifest.json         # Obsidian plugin metadata (id, name, version, minAppVersion)
├── versions.json         # Maps each release version to its minimum Obsidian version
├── styles.css            # Plugin CSS (empty — no custom UI elements are rendered)
├── esbuild.config.mjs    # esbuild bundler configuration
├── tsconfig.json         # TypeScript compiler options
├── package.json          # Node.js project config and npm build scripts
├── version-bump.mjs      # Syncs version across manifest.json and versions.json on npm version
└── LICENSE               # MIT License
```

---

## Development

**Requirements:** Node.js ≥ 18, npm

```bash
# Install dependencies
npm install

# Watch mode — rebuilds on every save
npm run dev

# Production build — type-check then bundle
npm run build

# Bump version (updates package.json, manifest.json, versions.json)
npm version patch   # or: minor / major
```

To test locally, copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/asciidoc-auto-preview/` in your Obsidian vault, then reload Obsidian.

---

## License

[MIT](LICENSE)
