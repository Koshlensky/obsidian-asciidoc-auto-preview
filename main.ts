import {
    App,
    Editor,
    MarkdownRenderer,
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
    setIcon,
    loadMathJax,
    renderMath,
    finishRenderMath,
} from 'obsidian';

// @ts-ignore
import AsciiMathParser from 'asciimath2tex';
const _am2tex = new AsciiMathParser();

// @ts-ignore
import Asciidoctor from '@asciidoctor/core';

const VIEW_TYPE_ADOC = 'adoc';

interface AdocPluginSettings {
    refreshDelay: number;
}

const DEFAULT_SETTINGS: AdocPluginSettings = {
    refreshDelay: 500,
};

// ─── View ────────────────────────────────────────────────────────────────────

class AdocView extends TextFileView {
    private plugin: AdocPlugin;
    private previewEl: HTMLDivElement;
    private sourceEl: HTMLTextAreaElement;
    private toolbarEl: HTMLDivElement;
    private mode: 'source' | 'preview';
    private debouncedRender: Debouncer<[], void>;
    private softWrap = false;

    constructor(leaf: WorkspaceLeaf, plugin: AdocPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.mode = 'preview';
    }

    getViewType(): string { return VIEW_TYPE_ADOC; }
    getDisplayText(): string { return this.file?.basename ?? 'AsciiDoc'; }
    getIcon(): string { return 'file-text'; }

    getViewData(): string {
        if (this.mode === 'source' && this.sourceEl) return this.sourceEl.value;
        return this.data;
    }

    setViewData(data: string, clear: boolean): void {
        this.data = data;
        if (!this.sourceEl || !this.previewEl) return;
        if (this.mode === 'source') {
            if (clear) {
                this.sourceEl.value = data;
            } else {
                const s = this.sourceEl.selectionStart;
                const e = this.sourceEl.selectionEnd;
                this.sourceEl.value = data;
                try { this.sourceEl.setSelectionRange(s, e); } catch (_) {}
            }
        } else {
            if (clear) this.renderPreview();
            else this.debouncedRender();
        }
    }

    clear(): void {
        this.data = '';
        if (this.sourceEl) this.sourceEl.value = '';
        if (this.previewEl) this.previewEl.innerHTML = '';
    }

    pushContentUpdate(content: string): void {
        if (this.mode !== 'preview') return;
        this.data = content;
        this.debouncedRender();
    }

    isPreviewMode(): boolean { return this.mode === 'preview'; }

    // Scroll the preview to an in-page anchor (called externally for cross-doc navigation)
    scrollToAnchor(id: string): void {
        if (this.mode !== 'preview' || !this.previewEl) return;
        this.previewEl.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
            ?.scrollIntoView({ behavior: 'smooth' });
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

        // ── Toolbar ──────────────────────────────────────────────────────────
        this.toolbarEl = container.createEl('div', { cls: 'adoc-toolbar' });
        this.buildToolbar();

        // ── Source editor ────────────────────────────────────────────────────
        this.sourceEl = container.createEl('textarea', { cls: 'adoc-source-editor' });
        this.sourceEl.spellcheck = false;

        this.sourceEl.addEventListener('input', () => {
            this.data = this.sourceEl.value;
            this.requestSave();
            this.plugin.broadcastContentChange(this.file, this.data);
        });

        // Intercept paste: if clipboard contains an image, save it to vault
        this.sourceEl.addEventListener('paste', (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    this.handleImagePaste(item);
                    return;
                }
            }
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

        this.applyModeDisplay();
    }

    async onClose(): Promise<void> {
        this.plugin.unregisterAdocView(this);
    }

    // ── Toolbar ───────────────────────────────────────────────────────────────

    private buildToolbar(): void {
        const t = this.toolbarEl;

        const mkBtn = (iconName: string, fallback: string, label: string, act: string, fn: () => void) => {
            const b = t.createEl('button', {
                cls: 'adoc-toolbar-btn',
                attr: { title: label, 'data-action': act },
            });
            setIcon(b, iconName);
            if (!b.querySelector('svg')) b.setText(fallback);
            b.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
            return b;
        };

        const sep = () => t.createEl('span', { cls: 'adoc-toolbar-sep' });

        mkBtn('bold',          'B',    'Toggle Bold',           'bold',      () => this.wrapOrInsert('*', '*', 'bold text'));
        mkBtn('italic',        'I',    'Toggle Italic',         'italic',    () => this.wrapOrInsert('_', '_', 'italic text'));
        mkBtn('code',          '`',    'Toggle Mono',           'mono',      () => this.wrapOrInsert('`', '`', 'code'));
        mkBtn('strikethrough', 'S',    'Toggle Strikethrough',  'strike',    () => this.wrapOrInsert('[line-through]#', '#', 'text'));
        mkBtn('highlighter',   '#',    'Toggle Highlight',      'highlight', () => this.wrapOrInsert('#', '#', 'highlighted'));
        sep();
        mkBtn('type',          'H1',   'Make Title',            'title',     () => this.insertTitle());
        mkBtn('link',          'Link', 'Create Link',           'link',      () => this.insertLink());
        mkBtn('image',         'Img',  'Paste Image',           'image',     () => this.insertImage());
        mkBtn('table',         'Tbl',  'Create Table',          'table',     () => this.insertTable());
        sep();
        mkBtn('clipboard',     'Fmt',  'Paste Formatted Text',  'paste',     () => this.pasteFormatted());
        sep();
        mkBtn('wrap-text',     'Wrap', 'Toggle Soft Wrap',      'wrap',      () => this.toggleSoftWrap());
    }

    // ── Formatting helpers ────────────────────────────────────────────────────

    private wrapOrInsert(before: string, after: string, placeholder: string): void {
        const ta  = this.sourceEl;
        const s   = ta.selectionStart;
        const e   = ta.selectionEnd;
        const sel = ta.value.slice(s, e);

        if (sel) {
            const pre  = ta.value.slice(Math.max(0, s - before.length), s);
            const post = ta.value.slice(e, e + after.length);
            if (pre === before && post === after) {
                ta.setRangeText(sel, s - before.length, e + after.length, 'end');
                ta.setSelectionRange(s - before.length, s - before.length + sel.length);
            } else {
                ta.setRangeText(before + sel + after, s, e, 'end');
                ta.setSelectionRange(s + before.length, s + before.length + sel.length);
            }
        } else {
            const ins = before + placeholder + after;
            ta.setRangeText(ins, s, e, 'end');
            ta.setSelectionRange(s + before.length, s + before.length + placeholder.length);
        }

        ta.focus();
        this.syncData();
    }

    private insertTitle(): void {
        const ta        = this.sourceEl;
        const pos       = ta.selectionStart;
        const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
        const rawEnd    = ta.value.indexOf('\n', pos);
        const lineEnd   = rawEnd === -1 ? ta.value.length : rawEnd;
        const line      = ta.value.slice(lineStart, lineEnd);
        const m         = line.match(/^(=+) /);

        if (m) {
            const level = m[1].length;
            const next  = level >= 6 ? '' : '='.repeat(level + 1) + ' ';
            ta.setRangeText(next + line.slice(m[0].length), lineStart, lineEnd, 'end');
        } else {
            ta.setRangeText('= ' + line, lineStart, lineEnd, 'end');
        }

        ta.focus();
        this.syncData();
    }

    private insertLink(): void {
        const ta  = this.sourceEl;
        const s   = ta.selectionStart;
        const e   = ta.selectionEnd;
        const sel = ta.value.slice(s, e);
        const ins = sel ? `link:URL[${sel}]` : 'link:URL[Link text]';
        ta.setRangeText(ins, s, e, 'end');
        ta.setSelectionRange(s + 5, s + 8);
        ta.focus();
        this.syncData();
    }

    // Paste Image: if clipboard contains an image save it; otherwise insert template
    private async insertImage(): Promise<void> {
        try {
            const clipItems: ClipboardItem[] = await (navigator.clipboard as any).read();
            for (const item of clipItems) {
                const imgType = item.types.find((t: string) => t.startsWith('image/'));
                if (imgType) {
                    const blob = await item.getType(imgType);
                    const savedFile = await this.saveImageToVault(blob, imgType);
                    this.insertImageReference(savedFile);
                    return;
                }
            }
        } catch (_) {}

        // Fallback: insert placeholder
        const ta  = this.sourceEl;
        const pos = ta.selectionStart;
        const ins = 'image::path/to/image.png[Alt text]';
        ta.setRangeText(ins, pos, ta.selectionEnd, 'end');
        ta.setSelectionRange(pos + 8, pos + 29);
        ta.focus();
        this.syncData();
    }

    private insertTable(): void {
        const ta  = this.sourceEl;
        const pos = ta.selectionStart;
        const ins = '\n[cols="1,1,1"]\n|===\n| Header 1 | Header 2 | Header 3\n\n| Cell 1   | Cell 2   | Cell 3\n| Cell 4   | Cell 5   | Cell 6\n|===\n';
        ta.setRangeText(ins, pos, ta.selectionEnd, 'end');
        ta.focus();
        this.syncData();
    }

    private async pasteFormatted(): Promise<void> {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) return;
            const ta  = this.sourceEl;
            const pos = ta.selectionStart;
            ta.setRangeText(text, pos, ta.selectionEnd, 'end');
            ta.focus();
            this.syncData();
        } catch (_) {}
    }

    private toggleSoftWrap(): void {
        this.softWrap = !this.softWrap;
        this.sourceEl.style.whiteSpace   = this.softWrap ? 'pre-wrap' : 'pre';
        this.sourceEl.style.overflowWrap = this.softWrap ? 'break-word' : 'normal';
        this.sourceEl.style.overflowX    = this.softWrap ? 'hidden' : 'auto';
        this.toolbarEl
            .querySelector<HTMLElement>('[data-action="wrap"]')
            ?.classList.toggle('is-active', this.softWrap);
    }

    // ── Image helpers ─────────────────────────────────────────────────────────

    private async handleImagePaste(item: DataTransferItem): Promise<void> {
        const blob = item.getAsFile();
        if (!blob) return;
        try {
            const savedFile = await this.saveImageToVault(blob, item.type);
            this.insertImageReference(savedFile);
        } catch (err) {
            console.error('[Asciidian] Failed to save pasted image:', err);
        }
    }

    private async saveImageToVault(blob: Blob, mimeType: string): Promise<TFile> {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const ext = mimeType === 'image/jpeg' ? 'jpg'
                  : mimeType === 'image/gif'  ? 'gif'
                  : mimeType === 'image/webp' ? 'webp'
                  : 'png';
        const fileName = `Pasted image ${stamp}.${ext}`;

        let savePath: string;
        try {
            savePath = await (this.app.fileManager as any).getAvailablePathForAttachment(fileName);
        } catch {
            const parent = this.file?.parent;
            const prefix = parent && !parent.isRoot() ? `${parent.path}/` : '';
            savePath = `${prefix}${fileName}`;
        }

        const arrayBuffer = await blob.arrayBuffer();
        return await this.app.vault.createBinary(savePath, arrayBuffer);
    }

    // Build an image:: reference using a path relative to the current file.
    // Falls back to full vault path when the image lives in a different folder.
    private insertImageReference(savedFile: TFile): void {
        const currentParent = this.file?.parent;
        const currentParentPath = (currentParent && !currentParent.isRoot()) ? currentParent.path : '';

        let insertPath: string;
        if (!currentParentPath) {
            // Current file is at vault root — use full vault path of the image
            insertPath = savedFile.path;
        } else if (savedFile.path.startsWith(currentParentPath + '/')) {
            // Image is under the same folder — use relative filename
            insertPath = savedFile.path.slice(currentParentPath.length + 1);
        } else {
            // Image is in a different folder — use full vault path so resolveImages can find it
            insertPath = savedFile.path;
        }

        const ta  = this.sourceEl;
        const pos = ta.selectionStart;
        ta.setRangeText(`image::${insertPath}[]\n`, pos, ta.selectionEnd, 'end');
        ta.focus();
        this.syncData();
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private syncData(): void {
        this.data = this.sourceEl.value;
        this.requestSave();
        this.plugin.broadcastContentChange(this.file, this.data);
    }

    private toggleMode(): void {
        this.mode = this.mode === 'source' ? 'preview' : 'source';
        this.applyModeDisplay();
    }

    private applyModeDisplay(): void {
        if (this.mode === 'source') {
            this.previewEl.style.display  = 'none';
            this.sourceEl.style.display   = 'block';
            this.toolbarEl.style.display  = 'flex';
            this.sourceEl.value = this.data ?? '';
            this.sourceEl.focus();
        } else {
            this.toolbarEl.style.display  = 'none';
            this.sourceEl.style.display   = 'none';
            this.previewEl.style.display  = 'block';
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
                    stem: '',          // enable latexmath by default; allows latexmath/asciimath macros
                },
            }) as string;
            this.previewEl.innerHTML = html;
            this.resolveImages();
            this.handleLinks();
            void this.renderMathFormulas();

            // If another view requested navigation to an anchor in this file, consume it
            const pending = this.plugin.pendingAnchor;
            if (pending && this.file && pending.file === this.file) {
                this.plugin.pendingAnchor = null;
                requestAnimationFrame(() => this.scrollToAnchor(pending.id));
            }
        } catch (e) {
            console.error('[AsciiDoc Preview] Render error:', e);
            this.previewEl.innerHTML =
                `<div class="adoc-render-error"><strong>Render error</strong><pre>${String(e)}</pre></div>`;
        }
    }

    private handleLinks(): void {
        if (!this.previewEl) return;
        this.previewEl.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(link => {
            const fresh = link.cloneNode(true) as HTMLAnchorElement;
            link.replaceWith(fresh);
            fresh.addEventListener('click', (e) => {
                e.preventDefault();
                void this.handleLinkClick(fresh.getAttribute('href') ?? '');
            });
        });
    }

    private async handleLinkClick(href: string): Promise<void> {
        if (/^https?:\/\//.test(href) || href.startsWith('mailto:')) {
            window.open(href, '_blank', 'noopener,noreferrer');
            return;
        }

        // Same-document anchor — e.g. href="#my-section"
        if (href.startsWith('#')) {
            this.scrollToAnchor(href.slice(1));
            return;
        }

        const hashIdx  = href.indexOf('#');
        const fragment = hashIdx !== -1 ? href.slice(hashIdx + 1) : '';
        let filePart   = hashIdx !== -1 ? href.slice(0, hashIdx) : href;

        if (!filePart) {
            // href was just a bare "#fragment" handled above; nothing else to do
            if (fragment) this.scrollToAnchor(fragment);
            return;
        }

        // xref fix: Asciidoctor generates .html hrefs — map back to .adoc
        filePart = filePart.replace(/\.html$/, '.adoc');

        // URL-decode: Asciidoctor encodes spaces/specials in filenames (e.g. %20)
        try { filePart = decodeURIComponent(filePart); } catch (_) {}

        const parent  = this.file?.parent;
        const absPath = !parent || parent.isRoot() ? filePart : `${parent.path}/${filePart}`;
        const target  = this.app.vault.getAbstractFileByPath(absPath);

        if (!(target instanceof TFile)) return;

        // Store the anchor so the target view can scroll after it renders
        if (fragment) {
            this.plugin.pendingAnchor = { file: target, id: fragment };
        }

        // Open cross-document links in a new tab
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.openFile(target);

        // Fallback: if renderPreview() already ran before we set pendingAnchor
        // (or the file was already open), try a direct scroll now
        if (fragment && this.plugin.pendingAnchor?.file === target) {
            this.plugin.pendingAnchor = null;
            const view = leaf.view;
            if (view instanceof AdocView) {
                requestAnimationFrame(() => (view as AdocView).scrollToAnchor(fragment));
            }
        }
    }

    // ── Math rendering ────────────────────────────────────────────────────────

    // Self-contained math rendering using Obsidian's renderMath API + asciimath2tex.
    // No external plugins or CDN required.
    //
    // Asciidoctor.js output format:
    //   latexmath:[...]         → <span class="stem">\(...\)</span>
    //   [latexmath] ++++ ... →   <div class="stemblock"><div class="content">\[...\]</div></div>
    //   asciimath:[...] / stem  → <span class="stem">\$...\$</span>
    //   [asciimath] ++++ ... →   <div class="stemblock"><div class="content">\$...\$</div></div>
    //
    // Flow: strip Asciidoctor delimiters → convert AsciiMath to TeX → renderMath → finishRenderMath
    private async renderMathFormulas(): Promise<void> {
        if (!this.previewEl) return;
        if (!this.previewEl.querySelector('.stem, .stemblock')) return;

        // Wait for Obsidian's bundled MathJax to initialise (safe to call multiple times)
        await loadMathJax();

        // Re-query AFTER the await so we always have fresh DOM refs in case
        // renderPreview() ran again while loadMathJax() was resolving
        const stems = Array.from(
            this.previewEl.querySelectorAll<HTMLElement>('.stem, .stemblock')
        );

        const toTypeset: HTMLElement[] = [];

        for (const el of stems) {
            // Skip detached nodes (previewEl was replaced while we awaited)
            if (!el.isConnected) continue;
            // Skip already-rendered elements
            if (el.querySelector('mjx-container')) continue;

            const isBlock = el.classList.contains('stemblock');

            // For block stems the actual formula lives in the nested .content div
            const srcEl = isBlock
                ? (el.querySelector<HTMLElement>('.content') ?? el)
                : el;

            let src    = srcEl.textContent?.trim() ?? '';
            let display = isBlock;

            if (src.startsWith('\\(') && src.endsWith('\\)')) {
                // LaTeX inline
                src = src.slice(2, -2).trim();
            } else if (src.startsWith('\\[') && src.endsWith('\\]')) {
                // LaTeX block
                src = src.slice(2, -2).trim();
                display = true;
            } else if (src.startsWith('\\$') && src.endsWith('\\$')) {
                // AsciiMath — convert to TeX with bundled parser
                try {
                    src = _am2tex.parse(src.slice(2, -2).trim());
                } catch {
                    src = src.slice(2, -2).trim();
                }
            }

            if (!src) continue;

            try {
                const rendered = renderMath(src, display);
                // Use innerHTML = '' to clear all child nodes (including text nodes)
                el.innerHTML = '';
                el.appendChild(rendered);
                if (!display) toTypeset.push(el);
            } catch (e) {
                console.error('[Asciidian] renderMath error:', e, { src, display });
            }
        }

        // Apply MathJax stylesheet for all rendered elements
        await finishRenderMath();

        // For inline math: ensure MathJax processes the newly attached containers
        // by triggering a typeset pass if the MathJax 3 API is available
        if (toTypeset.length > 0) {
            const MJ = (window as any).MathJax;
            if (typeof MJ?.typesetPromise === 'function') {
                try {
                    await MJ.typesetPromise(toTypeset);
                } catch (e) {
                    // non-fatal; renderMath already created the containers
                }
            }
        }
    }

    // Resolve image src attributes to vault resource URLs.
    // Tries relative path first (standard AsciiDoc), then absolute vault path.
    private resolveImages(): void {
        if (!this.previewEl) return;
        const parentPath = (this.file?.parent && !this.file.parent.isRoot())
            ? this.file.parent.path
            : '';

        this.previewEl.querySelectorAll<HTMLImageElement>('img[src]').forEach(img => {
            const rawSrc = img.getAttribute('src') ?? '';
            if (!rawSrc
                || rawSrc.startsWith('http')
                || rawSrc.startsWith('data:')
                || rawSrc.startsWith('blob:')
                || rawSrc.startsWith('app:')) return;

            // URL-decode: Asciidoctor may encode spaces as %20 in src attributes
            let src: string;
            try { src = decodeURIComponent(rawSrc); } catch (_) { src = rawSrc; }

            // 1. Relative to current file's parent folder (standard AsciiDoc resolution)
            if (parentPath) {
                const f = this.app.vault.getAbstractFileByPath(`${parentPath}/${src}`);
                if (f instanceof TFile) { img.src = this.app.vault.getResourcePath(f); return; }
            }

            // 2. Absolute vault path (used when image is in a different attachment folder)
            const f = this.app.vault.getAbstractFileByPath(src);
            if (f instanceof TFile) img.src = this.app.vault.getResourcePath(f);
        });
    }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class AdocPlugin extends Plugin {
    settings: AdocPluginSettings;
    processor: any;
    private activeViews: Set<AdocView> = new Set();

    // Pending cross-document anchor navigation set by handleLinkClick,
    // consumed by the target view's renderPreview()
    pendingAnchor: { file: TFile; id: string } | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();
        this.processor = Asciidoctor();

        this.registerView(VIEW_TYPE_ADOC, leaf => new AdocView(leaf, this));
        this.registerExtensions(['adoc', 'asciidoc', 'asc'], VIEW_TYPE_ADOC);

        this.addSettingTab(new AdocSettingTab(this.app, this));

        this.addCommand({
            id: 'new-adoc-note',
            name: 'New AsciiDoc note',
            callback: async () => {
                const activeFile = this.app.workspace.getActiveFile();
                const folder = activeFile?.parent ?? this.app.vault.getRoot();
                await this.createAdocNote(folder);
            },
        });

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

    registerAdocView(view: AdocView): void { this.activeViews.add(view); }
    unregisterAdocView(view: AdocView): void { this.activeViews.delete(view); }

    broadcastContentChange(file: TFile | null, content: string): void {
        if (!file) return;
        for (const view of this.activeViews) {
            if ((view as any).file === file) view.pushContentUpdate(content);
        }
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    onunload(): void { this.activeViews.clear(); }
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
    }
}
