/*
 * 浏览器书签同步对话框
 *
 * 流程：添加书签导出文件（选择 / 拖拽 / 工作区路径）→ 勾选要同步的文件夹
 *       → 选择目标数据库 → 校对字段映射 → 开始同步。
 */

import { Dialog, confirm, showMessage } from "siyuan";
import { getBlockAttrs, getWorkspaceFileText } from "../api";
import {
    BookmarkEntry,
    BookmarkFile,
    BookmarkFolder,
    BookmarkNode,
    collectEntries,
    countEntries,
    parseBookmarkHtml,
} from "./bookmark-parser";
import {
    BookmarkSync,
    BookmarkSyncOptions,
    DEFAULT_BOOKMARK_OPTIONS,
    ResolvedColumns,
    SyncBookmark,
    createMissingColumns,
    resolveColumns,
} from "./bookmark-sync";
import {
    AvKey,
    AvSearchResult,
    getAvKeys,
    renderAttributeView,
    searchAttributeViews,
} from "./av-api";

export interface BookmarkDialogDeps {
    sync: BookmarkSync;
    i18n: Record<string, any>;
    getOptions: () => BookmarkSyncOptions;
    saveOptions: (options: BookmarkSyncOptions) => Promise<void>;
    openHelp: () => void;
}

/** 当前是否处于同步中 */
let syncing = false;

export class BookmarkSyncDialog {
    private deps: BookmarkDialogDeps;
    private dialog: Dialog;
    private options: BookmarkSyncOptions;

    private treeEl: HTMLElement;
    private sourcesEl: HTMLElement;
    private logEl: HTMLElement;
    private statusEl: HTMLElement;
    private syncBtn: HTMLButtonElement;
    private dropEl: HTMLElement;
    private fileInput: HTMLInputElement;
    private workspaceInput: HTMLInputElement;
    private dbKeywordInput: HTMLInputElement;
    private dbSelect: HTMLSelectElement;
    private blockIdInput: HTMLInputElement;
    private columnsEl: HTMLElement;
    private ensureBtn: HTMLButtonElement;
    private dbStatusEl: HTMLElement;

    private incrementalInput: HTMLInputElement;
    private tagsInput: HTMLInputElement;
    private sourceInput: HTMLInputElement;
    private removeInput: HTMLInputElement;

    /** 已解析的书签文件（= 来源） */
    private files: BookmarkFile[] = [];
    /** 搜索到的数据库候选 */
    private dbResults: AvSearchResult[] = [];
    /** 目标数据库的列定义与匹配结果 */
    private keys: AvKey[] = [];
    private columns: ResolvedColumns | null = null;
    private columnsDirty = true;

    constructor(deps: BookmarkDialogDeps) {
        this.deps = deps;
        this.options = { ...DEFAULT_BOOKMARK_OPTIONS, ...deps.getOptions() };

        this.dialog = new Dialog({
            title: this.t("bookmarkSyncTitle", "浏览器书签同步"),
            width: "860px",
            height: "640px",
            content: this.buildContent(),
            destroyCallback: () => {
                syncing = false;
            },
        });

        const root = this.dialog.element;
        this.treeEl = root.querySelector("#bm-tree") as HTMLElement;
        this.sourcesEl = root.querySelector("#bm-sources") as HTMLElement;
        this.logEl = root.querySelector("#bm-log") as HTMLElement;
        this.statusEl = root.querySelector("#bm-status") as HTMLElement;
        this.syncBtn = root.querySelector("#bm-sync-btn") as HTMLButtonElement;
        this.dropEl = root.querySelector("#bm-drop") as HTMLElement;
        this.fileInput = root.querySelector("#bm-file-input") as HTMLInputElement;
        this.workspaceInput = root.querySelector("#bm-workspace") as HTMLInputElement;
        this.dbKeywordInput = root.querySelector("#bm-db-keyword") as HTMLInputElement;
        this.dbSelect = root.querySelector("#bm-db") as HTMLSelectElement;
        this.blockIdInput = root.querySelector("#bm-block-id") as HTMLInputElement;
        this.columnsEl = root.querySelector("#bm-columns") as HTMLElement;
        this.ensureBtn = root.querySelector("#bm-ensure-cols") as HTMLButtonElement;
        this.dbStatusEl = root.querySelector("#bm-db-status") as HTMLElement;
        this.incrementalInput = root.querySelector("#bm-incremental") as HTMLInputElement;
        this.tagsInput = root.querySelector("#bm-tags") as HTMLInputElement;
        this.sourceInput = root.querySelector("#bm-source") as HTMLInputElement;
        this.removeInput = root.querySelector("#bm-remove") as HTMLInputElement;

        this.bindEvents();
        this.init();
    }

    private t(key: string, fallback: string): string {
        const value = this.deps.i18n?.[key];
        return typeof value === "string" && value ? value : fallback;
    }

    private buildContent(): string {
        return `<div class="bookmark-sync b3-typography">
    <div class="bookmark-sync__config">
        <div class="bookmark-sync__drop" id="bm-drop">
            ${this.t("bookmarkDropHint", "点击或拖拽浏览器「导出书签」生成的 HTML（可多选：Chrome / Edge / Firefox / Safari 都支持）")}
            <input type="file" id="bm-file-input" accept=".html,.htm,text/html" multiple class="fn__none">
        </div>
        <div class="bookmark-sync__row">
            <span class="bookmark-sync__label">${this.t("bookmarkWorkspaceLabel", "工作区文件路径")}</span>
            <input id="bm-workspace" class="b3-text-field fn__flex-1" placeholder="${this.t("bookmarkWorkspacePlaceholder", "例如 /data/bookmarks-chrome.html（Docker：先放进挂载目录）")}">
            <button id="bm-workspace-btn" class="b3-button b3-button--outline">${this.t("bookmarkWorkspaceLoad", "加载")}</button>
        </div>
        <div class="bookmark-sync__sources" id="bm-sources"></div>
        <div class="bookmark-sync__row">
            <span class="bookmark-sync__label">${this.t("bookmarkDbLabel", "目标数据库")}</span>
            <input id="bm-db-keyword" class="b3-text-field fn__flex-1" placeholder="${this.t("bookmarkDbPlaceholder", "数据库名称关键词，留空列出全部")}">
            <button id="bm-db-search" class="b3-button b3-button--outline">${this.t("bookmarkDbSearch", "搜索")}</button>
            <select id="bm-db" class="b3-select fn__size200"></select>
        </div>
        <div class="bookmark-sync__row">
            <span class="bookmark-sync__label">${this.t("bookmarkBlockIdLabel", "或直接粘贴块 ID")}</span>
            <input id="bm-block-id" class="b3-text-field fn__flex-1" placeholder="${this.t("bookmarkBlockIdPlaceholder", "数据库块的 ID（或数据库 ID）")}">
            <button id="bm-block-id-btn" class="b3-button b3-button--outline">${this.t("bookmarkBlockIdUse", "使用")}</button>
            <span id="bm-db-status" class="bookmark-sync__status"></span>
        </div>
        <div class="bookmark-sync__row">
            <span class="bookmark-sync__label">${this.t("bookmarkColumns", "字段映射")}</span>
            <span id="bm-columns" class="bookmark-sync__hint-inline"></span>
            <button id="bm-ensure-cols" class="b3-button b3-button--outline fn__none">${this.t("bookmarkEnsureCols", "创建缺失列")}</button>
        </div>
        <div class="bookmark-sync__row bookmark-sync__options">
            <label><input type="checkbox" id="bm-incremental"> ${this.t("bookmarkIncremental", "增量同步")}</label>
            <label><input type="checkbox" id="bm-tags"> ${this.t("bookmarkTags", "写入标签（文件夹路径）")}</label>
            <label><input type="checkbox" id="bm-source"> ${this.t("bookmarkSourceCol", "写入来源列")}</label>
            <label><input type="checkbox" id="bm-remove"> ${this.t("bookmarkRemoveMissing", "清理已消失的书签")}</label>
        </div>
    </div>
    <div class="bookmark-sync__tree" id="bm-tree"></div>
    <div class="bookmark-sync__log" id="bm-log"></div>
    <div class="bookmark-sync__footer">
        <button id="bm-reset-btn" class="b3-button b3-button--outline">${this.t("bookmarkResetRecords", "重置同步记录")}</button>
        <button id="bm-help-btn" class="b3-button b3-button--outline">${this.t("helpMenu", "使用帮助")}</button>
        <span class="fn__space"></span>
        <button id="bm-sync-btn" class="b3-button b3-button--text">${this.t("bookmarkStartSync", "开始同步")}</button>
    </div>
</div>`;
    }

    private init() {
        this.incrementalInput.checked = this.options.incremental;
        this.tagsInput.checked = this.options.syncTags;
        this.sourceInput.checked = this.options.syncSource;
        this.removeInput.checked = this.options.removeMissing;
        this.workspaceInput.value = this.options.workspaceFile || "";

        if (this.options.avID) {
            this.setDbStatus(this.options.dbName || this.t("bookmarkDbSelected", "当前数据库"));
            void this.refreshColumns();
        } else {
            this.appendLog(this.t("bookmarkInitHint", "① 添加浏览器导出的书签文件 ② 选择目标数据库 ③ 开始同步。"));
        }
    }

    private bindEvents() {
        this.dropEl.onclick = () => this.fileInput.click();
        this.fileInput.addEventListener("change", () => {
            void this.addFiles(this.fileInput.files);
            this.fileInput.value = "";
        });
        this.dropEl.addEventListener("dragover", (e) => {
            e.preventDefault();
            this.dropEl.classList.add("bookmark-sync__drop--hover");
        });
        this.dropEl.addEventListener("dragleave", () => {
            this.dropEl.classList.remove("bookmark-sync__drop--hover");
        });
        this.dropEl.addEventListener("drop", (e) => {
            e.preventDefault();
            this.dropEl.classList.remove("bookmark-sync__drop--hover");
            void this.addFiles(e.dataTransfer?.files || null);
        });

        (this.dialog.element.querySelector("#bm-workspace-btn") as HTMLElement).onclick = () => {
            void this.loadFromWorkspace();
        };
        this.workspaceInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void this.loadFromWorkspace();
            }
        });

        (this.dialog.element.querySelector("#bm-db-search") as HTMLElement).onclick = () => {
            void this.searchDb();
        };
        this.dbKeywordInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void this.searchDb();
            }
        });
        this.dbSelect.onchange = () => {
            const picked = this.dbResults[Number(this.dbSelect.value)];
            if (picked) void this.pickDatabase(picked);
        };
        (this.dialog.element.querySelector("#bm-block-id-btn") as HTMLElement).onclick = () => {
            void this.usePastedId();
        };
        this.ensureBtn.onclick = () => {
            void this.ensureColumns();
        };

        this.syncBtn.onclick = () => {
            void this.handleSync();
        };
        (this.dialog.element.querySelector("#bm-reset-btn") as HTMLElement).onclick = () => {
            confirm(
                this.t("bookmarkResetRecords", "重置同步记录"),
                this.t("bookmarkResetConfirm", "重置后，下次同步会把所有勾选的书签按内容重新写入数据库（不会产生重复行）。确定继续？"),
                () => {
                    void (async () => {
                        await this.deps.sync.clearRecords();
                        this.appendLog(this.t("bookmarkRecordsReset", "已重置同步记录。"));
                        showMessage(this.t("bookmarkRecordsReset", "已重置同步记录"), 3000);
                    })();
                }
            );
        };
        (this.dialog.element.querySelector("#bm-help-btn") as HTMLElement).onclick = () => {
            this.deps.openHelp();
        };

        for (const input of [this.incrementalInput, this.removeInput]) {
            input.onchange = () => this.collectOptions();
        }
        // 「标签」「来源」开关会改变字段匹配结果（缺失列是否计入），需要刷新映射展示
        this.tagsInput.onchange = () => {
            this.collectOptions();
            void this.refreshColumns();
        };
        this.sourceInput.onchange = () => {
            this.collectOptions();
            void this.refreshColumns();
        };
    }

    private collectOptions() {
        this.options.incremental = this.incrementalInput.checked;
        this.options.syncTags = this.tagsInput.checked;
        this.options.syncSource = this.sourceInput.checked;
        this.options.removeMissing = this.removeInput.checked;
        this.options.workspaceFile = this.workspaceInput.value.trim();
    }

    // ------------------------------ 来源文件 ------------------------------

    /** 读取并解析用户选择的书签文件 */
    private async addFiles(list: FileList | null) {
        if (!list || !list.length) return;
        for (const file of Array.from(list)) {
            try {
                const text = await file.text();
                this.addParsed(parseBookmarkHtml(text, this.labelOf(file.name)));
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.appendLog(`${this.t("bookmarkParseFailed", "解析失败")}：${file.name} — ${msg}`);
                showMessage(`${this.t("bookmarkParseFailed", "解析失败")}：${msg}`, 5000, "error");
            }
        }
    }

    private labelOf(name: string): string {
        return (name || "").replace(/\.(html?|xml)$/i, "") || "书签";
    }

    /** 从工作区路径加载书签文件（Docker 场景：文件放在挂载目录里） */
    private async loadFromWorkspace() {
        const path = this.workspaceInput.value.trim();
        if (!path) {
            showMessage(this.t("bookmarkNoWorkspacePath", "请先填写工作区文件路径"), 4000, "error");
            return;
        }
        try {
            const text = await getWorkspaceFileText(path);
            this.addParsed(parseBookmarkHtml(text, this.labelOf(path.split("/").pop() || path)));
            this.collectOptions();
            await this.deps.saveOptions(this.options);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.appendLog(`加载工作区文件失败：${msg}`);
            showMessage(`加载失败：${msg}`, 5000, "error");
        }
    }

    private addParsed(file: BookmarkFile) {
        const existing = this.files.findIndex((f) => f.source === file.source);
        if (existing >= 0) {
            this.files.splice(existing, 1, file);
            this.appendLog(`注意：来源「${file.source}」已存在，本次添加已替换它（要同时导入多个浏览器，请双击来源标签改名，或先重命名导出文件）。`);
        } else {
            this.files.push(file);
        }
        this.appendLog(
            `已解析「${file.source}」：${file.entryCount} 条书签` +
            (file.skipped ? `，过滤 ${file.skipped} 条` : "") +
            (file.duplicated ? `，去重 ${file.duplicated} 条` : "")
        );
        this.renderSources();
        this.renderTree();
    }

    /** 双击标签重命名来源；重名时自动加序号 */
    private renameSource(file: BookmarkFile) {
        const input = document.createElement("input");
        input.className = "b3-text-field bookmark-sync__chip-input";
        input.value = file.source;
        const chip = this.sourcesEl;
        chip.innerHTML = "";
        this.files.forEach((f) => {
            const el = document.createElement("span");
            el.className = "bookmark-sync__chip";
            if (f === file) {
                el.appendChild(input);
            } else {
                const label = document.createElement("span");
                label.textContent = `${f.source}（${f.entryCount}）`;
                el.appendChild(label);
            }
            chip.appendChild(el);
        });
        input.focus();
        input.select();
        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;
            let name = input.value.trim() || file.source;
            const taken = new Set(this.files.filter((f) => f !== file).map((f) => f.source));
            if (taken.has(name)) {
                let i = 2;
                while (taken.has(`${name} (${i})`)) i++;
                name = `${name} (${i})`;
            }
            if (name !== file.source) {
                file.source = name;
                this.appendLog(`来源已重命名，同步将按新名称匹配（旧名称的行在开启「来源列」时会被视为不同来源）。`);
            }
            this.renderSources();
            this.renderTree();
        };
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
            } else if (e.key === "Escape") {
                committed = true;
                this.renderSources();
            }
        });
    }

    private removeFile(index: number) {
        this.files.splice(index, 1);
        this.renderSources();
        this.renderTree();
    }

    private renderSources() {
        this.sourcesEl.innerHTML = "";
        this.files.forEach((file, index) => {
            const chip = document.createElement("span");
            chip.className = "bookmark-sync__chip";
            const label = document.createElement("span");
            label.textContent = `${file.source}（${file.entryCount}）`;
            label.title = this.t("bookmarkChipRename", "双击重命名来源");
            label.ondblclick = () => this.renameSource(file);
            chip.appendChild(label);
            const close = document.createElement("button");
            close.className = "bookmark-sync__chip-close";
            close.textContent = "✕";
            close.title = this.t("bookmarkRemoveSource", "移除该来源");
            close.onclick = () => this.removeFile(index);
            chip.appendChild(close);
            this.sourcesEl.appendChild(chip);
        });
    }

    // ------------------------------ 勾选树 ------------------------------

    private renderTree() {
        this.treeEl.innerHTML = "";
        this.files.forEach((file, fileIdx) => {
            const wrap = document.createElement("div");
            wrap.className = "bookmark-sync__node-wrap";

            const node = document.createElement("div");
            node.className = "bookmark-sync__node";

            const toggle = document.createElement("span");
            toggle.className = "bookmark-sync__toggle";
            toggle.textContent = "▾";
            node.appendChild(toggle);

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = true;
            checkbox.className = "bookmark-sync__checkbox";
            checkbox.dataset.fileIdx = String(fileIdx);
            // 取消勾选整个来源时，同步取消内部所有勾选（避免残留子项被收集）
            checkbox.addEventListener("change", () => {
                const kids = wrap.querySelectorAll(".bookmark-sync__checkbox");
                for (const kid of Array.from(kids)) {
                    if (kid !== checkbox) (kid as HTMLInputElement).checked = checkbox.checked;
                }
            });
            node.appendChild(checkbox);

            const icon = document.createElement("span");
            icon.className = "bookmark-sync__icon";
            icon.textContent = "🌐";
            node.appendChild(icon);

            const title = document.createElement("span");
            title.className = "bookmark-sync__node-title";
            title.textContent = file.source;
            node.appendChild(title);

            const badge = document.createElement("span");
            badge.className = "bookmark-sync__badge";
            badge.textContent = `${file.entryCount}`;
            node.appendChild(badge);

            wrap.appendChild(node);

            const children = document.createElement("div");
            children.className = "bookmark-sync__children";
            for (const root of file.roots) {
                children.appendChild(this.createNodeElement(root, 1));
            }
            wrap.appendChild(children);

            const toggleFile = () => {
                const collapsed = children.classList.contains("fn__none");
                children.classList.toggle("fn__none", !collapsed);
                toggle.textContent = collapsed ? "▾" : "▸";
            };
            toggle.onclick = (e) => {
                e.stopPropagation();
                toggleFile();
            };
            title.onclick = () => toggleFile();

            this.treeEl.appendChild(wrap);
        });
    }

    /** 递归渲染文件夹节点；书签条目只计数不展开成叶子（数量大） */
    private createNodeElement(node: BookmarkNode, depth: number): HTMLElement {
        const container = document.createElement("div");
        container.className = "bookmark-sync__node-wrap";
        // 把书签树节点引用挂到 DOM 上，收集勾选结果时使用
        (container as any).__bmNode = node;

        const row = document.createElement("div");
        row.className = "bookmark-sync__node";
        row.style.paddingLeft = `${depth * 16 + 4}px`;

        const isFolder = node.kind === "folder";
        const toggle = document.createElement("span");
        toggle.className = "bookmark-sync__toggle";
        toggle.textContent = isFolder ? "▸" : "";
        row.appendChild(toggle);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.className = "bookmark-sync__checkbox";
        row.appendChild(checkbox);

        const icon = document.createElement("span");
        icon.className = "bookmark-sync__icon";
        icon.textContent = isFolder ? "📁" : "📄";
        row.appendChild(icon);

        const title = document.createElement("span");
        title.className = "bookmark-sync__node-title";
        title.textContent = node.title;
        row.appendChild(title);

        const badge = document.createElement("span");
        badge.className = "bookmark-sync__badge";
        badge.textContent = String(countEntries(node));
        row.appendChild(badge);

        // 勾选联动：勾/去勾文件夹时同步所有子孙（部分勾选时回退为“子孙各自决定”）
        checkbox.addEventListener("change", () => {
            const kids = container.querySelectorAll(".bookmark-sync__checkbox");
            for (const kid of Array.from(kids)) {
                if (kid !== checkbox) (kid as HTMLInputElement).checked = checkbox.checked;
            }
        });

        container.appendChild(row);

        if (!isFolder) return container;

        const folder = node as BookmarkFolder;
        const children = document.createElement("div");
        children.className = "bookmark-sync__children fn__none";
        container.appendChild(children);

        let loaded = false;
        const expand = () => {
            const collapsed = children.classList.contains("fn__none");
            if (collapsed && !loaded) {
                loaded = true;
                for (const child of folder.children) {
                    children.appendChild(this.createNodeElement(child, depth + 1));
                }
                // 本文件夹未勾选时，首次渲染的子节点继承未勾选状态（避免"复活"被排除的子树）
                if (!checkbox.checked) {
                    for (const kid of Array.from(children.querySelectorAll(".bookmark-sync__checkbox"))) {
                        (kid as HTMLInputElement).checked = false;
                    }
                }
            }
            children.classList.toggle("fn__none", !collapsed);
            toggle.textContent = collapsed ? "▾" : "▸";
        };
        toggle.onclick = (e) => {
            e.stopPropagation();
            expand();
        };
        title.onclick = () => expand();

        return container;
    }

    /**
     * 收集勾选的书签：
     * 文件级勾选 = 整个文件；否则递归各层文件夹节点，
     * 勾了的收集整棵子树，没勾的继续往里找单独勾起来的子文件夹。
     */
    private collectSelected(): SyncBookmark[] {
        const out: SyncBookmark[] = [];
        const seen = new Set<BookmarkEntry>();
        const pushNode = (node: BookmarkNode, source: string) => {
            for (const entry of collectEntries(node)) {
                if (seen.has(entry)) continue;
                seen.add(entry);
                out.push({ ...entry, source });
            }
        };

        const walkWrap = (wrap: HTMLElement, source: string) => {
            for (const childEl of Array.from(wrap.children)) {
                const data = (childEl as any).__bmNode as BookmarkNode | undefined;
                const cb = childEl.querySelector(":scope > .bookmark-sync__node > .bookmark-sync__checkbox") as HTMLInputElement | null;
                const childrenEl = childEl.querySelector(":scope > .bookmark-sync__children") as HTMLElement | null;
                if (data && cb?.checked) {
                    pushNode(data, source);
                    continue;
                }
                if (childrenEl) walkWrap(childrenEl, source);
            }
        };

        this.files.forEach((file, fileIdx) => {
            const wrap = this.treeEl.children[fileIdx] as HTMLElement | undefined;
            if (!wrap) return;
            const fileCheckbox = wrap.querySelector(":scope > .bookmark-sync__node > .bookmark-sync__checkbox") as HTMLInputElement;
            if (fileCheckbox?.checked) {
                for (const root of file.roots) pushNode(root, file.source);
                return;
            }
            const childrenEl = wrap.querySelector(":scope > .bookmark-sync__children") as HTMLElement | null;
            if (childrenEl) walkWrap(childrenEl, file.source);
        });
        return out;
    }

    // ------------------------------ 目标数据库 ------------------------------

    private setDbStatus(text: string) {
        if (this.dbStatusEl) this.dbStatusEl.textContent = text;
    }

    private async searchDb() {
        try {
            const keyword = this.dbKeywordInput.value.trim();
            this.dbResults = await searchAttributeViews(keyword);
            this.dbSelect.innerHTML = "";
            if (!this.dbResults.length) {
                const option = document.createElement("option");
                option.value = "";
                option.textContent = this.t("bookmarkDbNone", "（未找到数据库：先在某个文档里插入「数据库」）");
                this.dbSelect.appendChild(option);
                return;
            }
            // 同名数据库在不同文档里会出现多条搜索结果，按 avID 去重
            const unique = new Map<string, AvSearchResult>();
            for (const r of this.dbResults) {
                if (!unique.has(r.avID)) unique.set(r.avID, r);
            }
            this.dbResults = Array.from(unique.values());
            const blank = document.createElement("option");
            blank.value = "";
            blank.textContent = this.t("bookmarkDbPick", "— 选择数据库 —");
            this.dbSelect.appendChild(blank);
            this.dbResults.forEach((r, index) => {
                const option = document.createElement("option");
                option.value = String(index);
                option.textContent = `${r.avName || r.avID}${r.hPath ? ` — ${r.hPath}` : ""}`;
                this.dbSelect.appendChild(option);
            });
            if (this.options.avID) {
                const at = this.dbResults.findIndex((r) => r.avID === this.options.avID);
                if (at >= 0) this.dbSelect.value = String(at);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.appendLog(`搜索数据库失败：${msg}`);
            showMessage(`搜索数据库失败：${msg}`, 5000, "error");
        }
    }

    private async pickDatabase(result: AvSearchResult) {
        this.options.avID = result.avID;
        this.options.blockID = result.blockID || "";
        this.options.dbName = result.avName || "";
        this.columnsDirty = true;
        this.setDbStatus(this.options.dbName || result.avID.slice(0, 8));
        await this.deps.saveOptions(this.options);
        void this.refreshColumns();
    }

    /** 支持直接粘贴「数据库块 ID」或「数据库 ID」 */
    private async usePastedId() {
        const id = this.blockIdInput.value.trim();
        if (!id) {
            showMessage(this.t("bookmarkBlockIdEmpty", "请先粘贴 ID"), 3000, "error");
            return;
        }
        try {
            let avID = "";
            let blockID = "";
            const attrs = await getBlockAttrs(id);
            if (attrs && attrs["av-id"]) {
                blockID = id;
                avID = attrs["av-id"];
            } else {
                // 可能贴的是数据库 ID 本身
                const keys = await getAvKeys(id);
                if (!keys.length) throw new Error(this.t("bookmarkIdNotDb", "这个 ID 不是数据库块，也不是数据库 ID"));
                avID = id;
                blockID = "";
            }
            // 快速验证可读，顺便拿数据库名
            let dbName = "";
            try {
                const rendered = await renderAttributeView(avID, blockID, 1, 1);
                dbName = rendered?.av?.name || "";
            } catch (e) {
                // 名称拿不到不影响同步
            }
            this.options.avID = avID;
            this.options.blockID = blockID;
            this.options.dbName = dbName;
            this.columnsDirty = true;
            this.setDbStatus(dbName || avID.slice(0, 8));
            await this.deps.saveOptions(this.options);
            void this.refreshColumns();
            showMessage(this.t("bookmarkDbSet", "已设置目标数据库"), 3000);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.appendLog(`设置目标数据库失败：${msg}`);
            showMessage(`设置目标数据库失败：${msg}`, 5000, "error");
        }
    }

    // ------------------------------ 字段映射 ------------------------------

    private colName(keyID: string): string {
        return this.keys.find((k) => k.id === keyID)?.name || keyID;
    }

    /** 读取列定义并自动匹配五个字段，结果展示在「字段映射」行 */
    private async refreshColumns() {
        if (!this.options.avID) return;
        try {
            if (this.columnsDirty || !this.keys.length) {
                this.keys = await getAvKeys(this.options.avID);
                this.columnsDirty = false;
            }
            const cols = resolveColumns(this.keys, this.options.syncTags, this.options.syncSource);
            this.columns = cols;

            const parts: string[] = [];
            if (cols.name) parts.push(`${this.t("bookmarkColName", "网站名")}→${this.colName(cols.name)}`);
            if (cols.url) parts.push(`${this.t("bookmarkColUrl", "网站链接")}→${this.colName(cols.url)}`);
            if (cols.desc) parts.push(`${this.t("bookmarkColDesc", "描述")}→${this.colName(cols.desc)}`);
            if (cols.tags && this.options.syncTags) parts.push(`${this.t("bookmarkColTags", "标签")}→${this.colName(cols.tags)}`);
            if (cols.source && this.options.syncSource) parts.push(`${this.t("bookmarkColSource", "来源")}→${this.colName(cols.source)}`);
            const labels = cols.missing.map((m) => m.label);
            if (labels.length) parts.push(`${this.t("bookmarkColMissing", "缺失")}：${labels.join("、")}`);

            this.columnsEl.textContent = parts.length ? parts.join("；") : this.t("bookmarkColumnsEmpty", "（读取不到列，请确认目标数据库可编辑）");
            this.ensureBtn.classList.toggle("fn__none", !labels.length);
            if (!cols.url) {
                this.appendLog(this.t("bookmarkUrlColMissing", "目标数据库缺少「网站链接」列：点「创建缺失列」一键补建后再同步。"));
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.columnsEl.textContent = "";
            this.appendLog(`读取数据库列失败：${msg}`);
        }
    }

    private async ensureColumns() {
        if (!this.options.avID || !this.columns) return;
        try {
            this.ensureBtn.disabled = true;
            const created = await createMissingColumns(this.options.avID, this.options.blockID, this.columns.missing);
            if (created.length) this.appendLog(`已创建列：${created.join("、")}`);
            this.keys = [];
            this.columnsDirty = true;
            await this.refreshColumns();
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.appendLog(`创建列失败：${msg}`);
            showMessage(`创建列失败：${msg}`, 5000, "error");
        } finally {
            this.ensureBtn.disabled = false;
        }
    }

    // ------------------------------ 同步 ------------------------------

    private async handleSync() {
        if (syncing) return;
        this.collectOptions();

        if (!this.files.length) {
            showMessage(this.t("bookmarkNoFile", "请先添加至少一个书签导出文件"), 4000, "error");
            return;
        }
        if (!this.options.avID) {
            showMessage(this.t("bookmarkNoDb", "请先选择目标数据库"), 4000, "error");
            return;
        }
        const selected = this.collectSelected();
        if (!selected.length) {
            showMessage(this.t("bookmarkNoSelection", "请勾选要同步的书签文件夹"), 4000, "error");
            return;
        }

        syncing = true;
        this.syncBtn.disabled = true;
        this.logEl.innerHTML = "";
        this.setStatus("");
        try {
            await this.deps.saveOptions(this.options);
            this.appendLog(`共 ${selected.length} 条书签待同步。`);
            this.setStatus(this.t("bookmarkSyncing", "同步中..."));

            const summary = await this.deps.sync.sync(
                selected,
                this.options,
                (msg) => this.appendLog(msg),
                (done, total) => this.setStatus(total ? `${done}/${total}` : "")
            );

            const text = this.t("bookmarkDone", "书签同步完成");
            const line =
                `${text}：新增 ${summary.created}，更新 ${summary.updated}，跳过 ${summary.skipped}，` +
                `清理 ${summary.removed}，失败 ${summary.failed}`;
            this.appendLog(line);
            this.setStatus(line);
            showMessage(line, 7000, summary.failed ? "error" : "info");
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.appendLog(`同步出错：${msg}`);
            showMessage(`同步出错：${msg}`, 6000, "error");
        } finally {
            syncing = false;
            this.syncBtn.disabled = false;
        }
    }

    private setStatus(text: string) {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    private appendLog(message: string) {
        const line = document.createElement("div");
        line.className = "bookmark-sync__log-line";
        line.textContent = message;
        this.logEl.appendChild(line);
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }
}
