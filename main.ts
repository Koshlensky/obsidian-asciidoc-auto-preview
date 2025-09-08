import { Editor, Plugin, Debouncer } from 'obsidian';

interface AsciiDocAutoPreviewSettings {
    delay: number;
    enabled: boolean;
}

const DEFAULT_SETTINGS: AsciiDocAutoPreviewSettings = {
    delay: 800,
    enabled: true
}

export default class AsciiDocAutoPreviewPlugin extends Plugin {
    settings: AsciiDocAutoPreviewSettings;
    private debouncer: Debouncer<[]> | null = null;

    async onload() {
        await this.loadSettings();
        
        console.log('Loading AsciiDoc Auto Preview plugin');

        this.debouncer = new Debouncer(this.runPreviewCommand.bind(this), this.settings.delay);

        this.registerEvent(
            this.app.workspace.on('editor-change', (editor: Editor) => {
                if (!this.settings.enabled) return;
                
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && activeFile.extension === 'adoc') {
                    this.debouncer?.debounce();
                }
            })
        );

        this.addCommand({
            id: 'toggle-auto-preview',
            name: 'Toggle auto preview',
            callback: () => {
                this.settings.enabled = !this.settings.enabled;
                this.saveSettings();
                new Notice(`AsciiDoc Auto Preview ${this.settings.enabled ? 'enabled' : 'disabled'}`);
            }
        });

        this.addSettingTab(new AsciiDocAutoPreviewSettingTab(this.app, this));
    }

    private async runPreviewCommand() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'adoc') return;

        try {
            // Способ 1: Через выполнение команды
            const commandId = 'asciidoc:reload-preview';
            // @ts-ignore
            if (this.app.commands.commands[commandId]) {
                // @ts-ignore
                await this.app.commands.executeCommandById(commandId);
                return;
            }
            
            // Способ 2: Через прямое обновление вью
            const leaves = this.app.workspace.getLeavesOfType('asciidoc');
            for (const leaf of leaves) {
                // @ts-ignore
                const view = leaf.view;
                if (view && typeof view.render === 'function') {
                    view.render();
                    break;
                }
            }
        } catch (error) {
            console.error('Error refreshing AsciiDoc preview:', error);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        this.debouncer?.clear();
        console.log('Unloading AsciiDoc Auto Preview plugin');
    }
}

class AsciiDocAutoPreviewSettingTab extends PluginSettingTab {
    plugin: AsciiDocAutoPreviewPlugin;

    constructor(app: any, plugin: AsciiDocAutoPreviewPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'AsciiDoc Auto Preview Settings'});

        new Setting(containerEl)
            .setName('Refresh delay (ms)')
            .setDesc('Delay before auto-refresh after typing stops')
            .addText(text => text
                .setPlaceholder('800')
                .setValue(this.plugin.settings.delay.toString())
                .onChange(async (value) => {
                    this.plugin.settings.delay = parseInt(value) || 800;
                    this.plugin.debouncer?.setDelay(this.plugin.settings.delay);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable auto preview')
            .setDesc('Toggle automatic preview refreshing')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.enabled = value;
                    await this.plugin.saveSettings();
                }));
    }
}