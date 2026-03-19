import {
    App,
    Editor,
    Menu,
    Plugin,
    PluginSettingTab,
    Setting,
    TAbstractFile,
    TFile,
    TFolder,
    TextFileView,
    WorkspaceLeaf,
    debounce,
    Debouncer,
} from 'obsidian';

// @ts-ignore
import Asciidoctor from '@asciidoctor/core';

const VIEW_TYPE_ADOC = 'adoc';

interface AdocPluginSettings {
    refreshDelay: number;
    defaultMode: 'source' | 'preview';
}

const DEFAULT_SETTINGS: AdocPluginSettings = {
    refreshDelay: 500,
    defaultMode: 'preview',
};

// ─── View ────────────────────────────────────────────────────────────────────

class AdocView extends TextFileView {
    private plugin: AdocPlugin;
    private previewEl: HTMLDivElement;
    private sourceEl: HTMLTextAreaElement;
    private mode: 'source' | 'preview';
    private debouncedRender: Debouncer<[], void>;

    constructor(leaf: WorkspaceLeaf, plugin: AdocPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.mode = plugin.settings.defaultMode;
    }

    getViewType(): string {
        return VIEW_TYPE_ADOC;
    }

    getDisplayText(): string {
        return this.file?.basename ?? 'AsciiDoc';
    }

    getIcon(): string {
        return 'file-text';
    }

    // Called by Obsidian to retrieve content before saving to disk
    getViewData(): string {
        if (this.mode === 'source' && this.sourceEl) {
            return this.sourceEl.value;
        }
        return this.data;
    }

    // Called by Obsidian when loading the file (clear=true) or reloading (clear=false)
    setViewData(data: string, clear: boolean): void {
        this.data = data;
        if (!this.sourceEl || !this.previewEl) return;

        if (this.mode === 'source') {
            if (clear) {
                this.sourceEl.value = data;
            } else {
                const start = this.sourceEl.selectionStart;
                const end = this.sourceEl.selectionEnd;
                this.sourceEl.value = data;
                try { this.sourceEl.setSelectionRange(start, end); } catch (_) {}
            }
        } else {
            if (clear) {
                this.renderPreview();
            } else {
                this.debouncedRender();
            }
        }
    }

    clear(): void {
        this.data = '';
        if (this.sourceEl) this.sourceEl.value = '';
        if (this.previewEl) this.previewEl.innerHTML = '';
    }

    // Called by the plugin when another view's source textarea changes in real time
    pushContentUpdate(content: string): void {
        if (this.mode !== 'preview') return;
        this.data = content;
        this.debouncedRender();
    }

    isPreviewMode(): boolean {
        return this.mode === 'preview';
    }

    async onOpen(): Promise<void> {
        this.plugin.registerAdocView(this);

        this.debouncedRender = debounce(
            () => this.renderPreview(),
            this.plugin.settings.refreshDelay,
            true
        );

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('adoc-view-container');

        // ── Source editor ────────────────────────────────────────────────────
        this.sourceEl = container.createEl('textarea', { cls: 'adoc-source-editor' });
        this.sourceEl.spellcheck = false;
        this.sourceEl.addEventListener('input', () => {
            this.data = this.sourceEl.value;
            this.requestSave();
            // Push real-time content to all preview panes showing this file
            this.plugin.broadcastContentChange(this.file, this.data);
        });

        // ── Preview pane ─────────────────────────────────────────────────────
        this.previewEl = container.createEl('div', { cls: 'adoc-preview' });

        // ── Header toggle button ─────────────────────────────────────────────
        this.addAction('book-open', 'Toggle source / preview', () => this.toggleMode());

        // ── Event listeners ──────────────────────────────────────────────────

        // 1. File saved to vault (auto-save, external editor, Ctrl+S)
        this.registerEvent(
            this.app.vault.on('modify', async (file: TAbstractFile) => {
                if (!(file instanceof TFile) || file !== this.file || this.mode !== 'preview') return;
                const content = await this.app.vault.read(file);
                this.data = content;
                this.renderPreview();
            })
        );

        // 2. Real-time edits from Obsidian's built-in CodeMirror editor in another pane
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor: Editor) => {
                if (this.app.workspace.getActiveFile() !== this.file || this.mode !== 'preview') return;
                this.data = editor.getValue();
                this.debouncedRender();
            })
        );

        // Set initial visibility (content arrives later via setViewData)
        this.applyModeDisplay();
    }

    async onClose(): Promise<void> {
        this.plugin.unregisterAdocView(this);
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private toggleMode(): void {
        this.mode = this.mode === 'source' ? 'preview' : 'source';
        this.applyModeDisplay();
    }

    private applyModeDisplay(): void {
        if (this.mode === 'source') {
            this.previewEl.style.display = 'none';
            this.sourceEl.style.display = 'block';
            this.sourceEl.value = this.data ?? '';
            this.sourceEl.focus();
        } else {
            this.sourceEl.style.display = 'none';
            this.previewEl.style.display = 'block';
            if (this.data) this.renderPreview();
        }
    }

    private renderPreview(): void {
        if (!this.previewEl) return;
        try {
            const html = this.plugin.processor.convert(this.data ?? '', {
                safe: 'safe',
                attributes: {
                    showtitle: '',
                    icons: 'font',
                    'source-highlighter': 'highlight.js',
                },
            }) as string;
            this.previewEl.innerHTML = html;
            this.resolveImages();
        } catch (e) {
            console.error('[AsciiDoc Preview] Render error:', e);
            this.previewEl.innerHTML =
                `<div class="adoc-render-error"><strong>Render error</strong><pre>${String(e)}</pre></div>`;
        }
    }

    private resolveImages(): void {
        if (!this.file?.parent || !this.previewEl) return;
        const parentPath = this.file.parent.path;
        this.previewEl.querySelectorAll<HTMLImageElement>('img[src]').forEach(img => {
            const src = img.getAttribute('src') ?? '';
            if (
                src.startsWith('http') ||
                src.startsWith('data:') ||
                src.startsWith('blob:') ||
                src.startsWith('app:')
            ) return;
            const imagePath =
                parentPath === '/' || parentPath === '' ? src : `${parentPath}/${src}`;
            const f = this.app.vault.getAbstractFileByPath(imagePath);
            if (f instanceof TFile) {
                img.src = this.app.vault.getResourcePath(f);
            }
        });
    }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class AdocPlugin extends Plugin {
    settings: AdocPluginSettings;
    processor: any;
    private activeViews: Set<AdocView> = new Set();

    async onload(): Promise<void> {
        await this.loadSettings();
        this.processor = Asciidoctor();

        this.registerView(VIEW_TYPE_ADOC, leaf => new AdocView(leaf, this));
        this.registerExtensions(['adoc', 'asciidoc', 'asc'], VIEW_TYPE_ADOC);

        this.addSettingTab(new AdocSettingTab(this.app, this));

        // Command palette: New AsciiDoc note
        this.addCommand({
            id: 'new-adoc-note',
            name: 'New AsciiDoc note',
            callback: async () => {
                const activeFile = this.app.workspace.getActiveFile();
                const folder = activeFile?.parent ?? this.app.vault.getRoot();
                await this.createAdocNote(folder);
            },
        });

        // File-explorer context menu: New .adoc note
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
                const folder = file instanceof TFolder ? file : file.parent;
                if (!folder) return;
                menu.addItem(item => {
                    item
                        .setTitle('New .adoc note')
                        .setIcon('file-plus-2')
                        .setSection('action')
                        .onClick(async () => {
                            await this.createAdocNote(folder);
                        });
                });
            })
        );
    }

    private async createAdocNote(folder: TFolder): Promise<void> {
        const folderPath = folder.isRoot() ? '' : folder.path;
        const newPath = this.uniqueAdocPath(folderPath, 'Untitled');
        const newFile = await this.app.vault.create(newPath, '= Untitled\n\n');
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(newFile);
    }

    private uniqueAdocPath(folderPath: string, baseName: string): string {
        const prefix = folderPath ? `${folderPath}/` : '';
        let path = `${prefix}${baseName}.adoc`;
        let i = 1;
        while (this.app.vault.getAbstractFileByPath(path)) {
            path = `${prefix}${baseName} ${i++}.adoc`;
        }
        return path;
    }

    registerAdocView(view: AdocView): void {
        this.activeViews.add(view);
    }

    unregisterAdocView(view: AdocView): void {
        this.activeViews.delete(view);
    }

    // Notify all preview panes that the source content has changed (real-time, pre-save)
    broadcastContentChange(file: TFile | null, content: string): void {
        if (!file) return;
        for (const view of this.activeViews) {
            if ((view as any).file === file) {
                view.pushContentUpdate(content);
            }
        }
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    onunload(): void {
        this.activeViews.clear();
    }
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

class AdocSettingTab extends PluginSettingTab {
    plugin: AdocPlugin;

    constructor(app: App, plugin: AdocPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'AsciiDoc Preview Settings' });

        new Setting(containerEl)
            .setName('Auto-refresh delay (ms)')
            .setDesc('How long to wait after the last keystroke before updating the preview')
            .addText(text =>
                text
                    .setPlaceholder('500')
                    .setValue(this.plugin.settings.refreshDelay.toString())
                    .onChange(async value => {
                        const parsed = parseInt(value);
                        this.plugin.settings.refreshDelay =
                            isNaN(parsed) || parsed < 100 ? 500 : parsed;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Default view mode')
            .setDesc('Whether to open .adoc files in Preview or Source mode by default')
            .addDropdown(drop =>
                drop
                    .addOption('preview', 'Preview (rendered HTML)')
                    .addOption('source', 'Source (plain text)')
                    .setValue(this.plugin.settings.defaultMode)
                    .onChange(async value => {
                        this.plugin.settings.defaultMode = value as 'source' | 'preview';
                        await this.plugin.saveSettings();
                    })
            );
    }
}
