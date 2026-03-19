# Asciidian (AsciiDoc Plugin for Obsidian)

An [Obsidian](https://obsidian.md) plugin that **renders `.adoc` files natively** inside Obsidian, with a live-updating preview that refreshes automatically while you type — no manual reload required.

This plugin is a self-contained replacement for `asciidoctor-editor`. It bundles [Asciidoctor.js](https://asciidoctor.org) and handles `.adoc`, `.asciidoc`, and `.asc` files directly.

---

## The problem this solves

Existing AsciiDoc plugins for Obsidian render the file on open but **do not update the preview** when the file is edited. You have to manually trigger a reload every time. Markdown files in Obsidian work without this limitation — this plugin brings the same behaviour to AsciiDoc.

---

## Features

- Renders `.adoc` / `.asciidoc` / `.asc` files with full AsciiDoc support (headings, tables, admonitions, code blocks, images, TOC, footnotes, …)
- **Live preview** — automatically re-renders while you type, with a configurable debounce delay
- **Three auto-refresh triggers** work simultaneously:
  1. Editing in our own source mode (textarea in a split pane)
  2. Editing in Obsidian's built-in plain-text editor in another pane
  3. Any external file modification detected by the vault
- Toggle between **Source** (plain-text editor) and **Preview** (rendered HTML) modes with one click
- Image paths resolved to vault resources automatically
- Configurable default mode and refresh delay
- Styles adapt to the active Obsidian theme via CSS variables

---

## Installation

### Disable `asciidoctor-editor` first

This plugin registers the same file extensions (`.adoc`, `.asciidoc`, `.asc`). If both plugins are active at the same time, there will be a conflict. Disable `asciidoctor-editor` before enabling this one.

### From Community Plugins (recommended)

1. Open Obsidian → **Settings** → **Community plugins**
2. Disable **Safe mode** if prompted
3. Click **Browse** and search for `AsciiDoc Preview`
4. Click **Install**, then **Enable**

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/your-username/obsidian-asciidoc-auto-preview/releases/latest)
2. Copy all three files into `.obsidian/plugins/asciidoc-auto-preview/` inside your vault
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

---

## Usage

Open any `.adoc` file — it opens in **Preview mode** by default (configurable).

### Split-pane live editing

1. Open the `.adoc` file → it shows the rendered preview
2. Open the same file in a second pane → set one pane to **Source** mode (click the book icon)
3. Type in the Source pane → the Preview pane updates automatically

### Mode toggle

Click the **book icon** (⊞) in the view header to switch between Source and Preview modes.

### Commands

| Command | Description |
|---|---|
| *(none — use the header icon)* | Toggle source / preview |

---

## Settings

Open **Settings → AsciiDoc Preview**.

| Setting | Default | Description |
|---|---|---|
| **Auto-refresh delay (ms)** | `500` | Milliseconds to wait after the last keystroke before re-rendering. Minimum: 100 ms. |
| **Default view mode** | `Preview` | Whether `.adoc` files open in Preview or Source mode. |

---

## How the live-refresh works

When a preview pane is open, it listens to three independent triggers simultaneously:

| Trigger | Scenario |
|---|---|
| `workspace → editor-change` | The same file is open in Obsidian's built-in plain-text editor in another pane |
| Plugin internal event `adoc-changed` | The file is open in our own Source mode in a split pane |
| `vault → modify` | The file was saved to disk (auto-save, external editor, or manual Ctrl+S) |

All three routes converge on the same `renderPreview()` function, which runs `Asciidoctor.convert()` on the current content and injects the resulting HTML into the preview pane.

---

## Repository structure

```
obsidian-asciidoc-auto-preview/
├── main.ts               # Plugin source (TypeScript)
│                           ├─ AdocView   — TextFileView subclass (renderer + editor)
│                           ├─ AdocPlugin — Plugin entry point, shared Asciidoctor processor
│                           └─ AdocSettingTab — Settings UI
├── main.js               # Compiled & bundled output (committed for distribution)
├── manifest.json         # Obsidian plugin metadata (id, name, version, minAppVersion)
├── versions.json         # Maps each release version to its minimum Obsidian version
├── styles.css            # View container, textarea editor, and AsciiDoc preview styles
├── esbuild.config.mjs    # esbuild bundler configuration
├── tsconfig.json         # TypeScript compiler options
├── package.json          # npm project config; includes @asciidoctor/core as a dev dependency
├── version-bump.mjs      # Syncs version across manifest.json and versions.json on npm version
└── LICENSE               # MIT License
```

---

## Development

**Requirements:** Node.js ≥ 18, npm

```bash
# Install dependencies (includes @asciidoctor/core ~1.8 MB bundle)
npm install

# Watch mode — rebuilds on every save
npm run dev

# Production build — type-check then bundle
npm run build

# Bump version (updates package.json, manifest.json, versions.json)
npm version patch   # or: minor / major
```

To test locally, copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/asciidoc-auto-preview/` in your Obsidian vault, then reload Obsidian.

> **Note:** The production bundle is ~2 MB because Asciidoctor.js is included in full. This is expected and matches the size of other AsciiDoc plugins for Obsidian.
