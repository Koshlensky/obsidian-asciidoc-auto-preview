import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    Notice,
    TFile,
    WorkspaceLeaf,
    debounce,
    Debouncer,
} from 'obsidian';

interface AsciiDocAutoPreviewSettings {
    delay: number;
    enabled: boolean;
}

const DEFAULT_SETTINGS: AsciiDocAutoPreviewSettings = {
    delay: 1000,
    enabled: true,
};

export default class AsciiDocAutoPreviewPlugin extends Plugin {
    settings: AsciiDocAutoPreviewSettings;
    private debouncedRefresh: Debouncer<[], void> | null = null;

    async onload() {
        await this.loadSettings();
        this.buildDebouncer();

        this.registerEvent(
            this.app.workspace.on('editor-change', () => {
                if (!this.settings.enabled) return;
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && activeFile.extension === 'adoc') {
                    this.debouncedRefresh?.();
                }
            })
        );

        this.addCommand({
            id: 'toggle-auto-preview',
            name: 'Toggle auto preview',
            callback: () => {
                this.settings.enabled = !this.settings.enabled;
                this.saveSettings();
                new Notice(
                    `AsciiDoc Auto Preview ${this.settings.enabled ? 'enabled' : 'disabled'}`
                );
            },
        });

        this.addCommand({
            id: 'refresh-preview-now',
            name: 'Refresh AsciiDoc preview now',
            callback: () => {
                this.refreshPreview();
            },
        });

        this.addSettingTab(new AsciiDocAutoPreviewSettingTab(this.app, this));
    }

    buildDebouncer() {
        this.debouncedRefresh = debounce(
            () => this.refreshPreview(),
            this.settings.delay,
            true
        );
    }

    async refreshPreview() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'adoc') return;

        // Strategy 1: try known AsciiDoc plugin command IDs
        const commandIds = [
            'asciidoc:reload-preview',
            'asciidoc:refresh-preview',
            'asciidoc:reload',
            'asciidoc-plugin:reload-preview',
            'asciidoc-preview:reload',
        ];
        // @ts-ignore
        const allCommands: Record<string, unknown> = this.app.commands?.commands ?? {};
        for (const cmdId of commandIds) {
            if (allCommands[cmdId]) {
                // @ts-ignore
                this.app.commands.executeCommandById(cmdId);
                return;
            }
        }

        // Strategy 2: find known AsciiDoc view types and call their render/refresh method
        const viewTypes = [
            'asciidoc',
            'asciidoc-preview',
            'adoc-preview',
            'asciidoc-view',
            'adoc',
        ];
        for (const type of viewTypes) {
            const leaves = this.app.workspace.getLeavesOfType(type);
            for (const leaf of leaves) {
                const view = leaf.view as any;
                if (view?.render) { view.render(); return; }
                if (view?.refresh) { view.refresh(); return; }
                if (view?.reload) { view.reload(); return; }
            }
        }

        // Strategy 3: iterate all leaves, find any view linked to the current .adoc file
        this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
            const view = leaf.view as any;
            const leafFile: TFile | undefined = view?.file;
            if (leafFile?.path === activeFile.path) {
                if (view?.render) view.render();
                else if (view?.refresh) view.refresh();
                else if (view?.onLoadFile) view.onLoadFile(activeFile);
            }
        });

        // Strategy 4: trigger vault/metadataCache events that the AsciiDoc plugin may listen to
        // @ts-ignore
        this.app.metadataCache?.trigger('changed', activeFile);
        this.app.vault.trigger('modify', activeFile);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        this.debouncedRefresh = null;
    }
}

class AsciiDocAutoPreviewSettingTab extends PluginSettingTab {
    plugin: AsciiDocAutoPreviewPlugin;

    constructor(app: App, plugin: AsciiDocAutoPreviewPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'AsciiDoc Auto Preview Settings' });

        new Setting(containerEl)
            .setName('Refresh delay (ms)')
            .setDesc('Milliseconds of inactivity before the preview is refreshed')
            .addText(text =>
                text
                    .setPlaceholder('1000')
                    .setValue(this.plugin.settings.delay.toString())
                    .onChange(async value => {
                        const parsed = parseInt(value);
                        this.plugin.settings.delay =
                            isNaN(parsed) || parsed < 100 ? 1000 : parsed;
                        this.plugin.buildDebouncer();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Enable auto preview')
            .setDesc('Automatically refresh the AsciiDoc preview when you stop typing')
            .addToggle(toggle =>
                toggle.setValue(this.plugin.settings.enabled).onChange(async value => {
                    this.plugin.settings.enabled = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}
