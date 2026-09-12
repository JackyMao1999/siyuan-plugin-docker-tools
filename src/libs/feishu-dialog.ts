/*
 * 飞书知识库同步对话框
 */

import { Dialog, showMessage } from "siyuan";
import { FeishuClient, FeishuDriveFile, FeishuSearchResult, FeishuWikiNode } from "./feishu-api";
import {
    DEFAULT_SYNC_OPTIONS,
    FeishuSync,
    FeishuSyncItem,
    FeishuSyncOptions,
    sanitizeTitle,
} from "./feishu-sync";
import { lsNotebooks } from "../api";

type SourceType = "wiki" | "drive" | "search";

/** 从链接或纯文本中解析飞书文件夹 token（支持直接粘贴文件夹链接） */
function extractFolderToken(input: string): string {
    const text = (input || "").trim();
    if (!text) return "";
    const match = /\/(?:drive\/)?folder\/([A-Za-z0-9_-]+)/.exec(text);
    if (match) return match[1];
    return text;
}

interface TreeNodeMeta {
    kind: "space" | "wiki-node" | "drive-root" | "drive-folder" | "drive-file" | "search-doc";
    key: string;
    title: string;
    /** wiki 空间 ID */
    spaceId?: string;
    /** wiki 节点 token */
    nodeToken?: string;
    /** 是否可展开 */
    expandable?: boolean;
    /** 是否已加载子节点 */
    loaded?: boolean;
    expanded?: boolean;
    /** 是否可以同步 */
    syncable?: boolean;
    objToken?: string;
    objType?: string;
    editTime?: string;
    url?: string;
    /** 列表上显示的额外标签（如文档类型） */
    badge?: string;
    /** 文档所有者（用于在列表右侧显示） */
    owner?: string;
    /** 目标目录层级 */
    path: string[];
    /** 子节点加载器 */
    loader?: () => Promise<TreeNodeMeta[]>;
}

export interface FeishuSyncDialogDeps {
    client: FeishuClient;
    sync: FeishuSync;
    i18n: Record<string, any>;
    getOptions: () => FeishuSyncOptions;
    saveOptions: (options: FeishuSyncOptions) => Promise<void>;
    openSetting: () => void;
    /** 当前访问身份描述，例如「应用（机器人）身份」 */
    identityLabel?: () => string;
    /** 是否使用用户身份 */
    isUserMode?: () => boolean;
    /** 打开用户授权对话框 */
    openAuth?: () => void;
}

/** 当前是否处于同步中 */
let syncing = false;

export class FeishuSyncDialog {
    private deps: FeishuSyncDialogDeps;
    private dialog: Dialog;
    private treeEl: HTMLElement;
    private logEl: HTMLElement;
    private statusEl: HTMLElement;
    private syncBtn: HTMLButtonElement;
    private spaceSelect: HTMLSelectElement;
    private spaceRow: HTMLElement;
    private notebookSelect: HTMLSelectElement;
    private rootPathInput: HTMLInputElement;
    private sourceSelect: HTMLSelectElement;
    private folderInput: HTMLInputElement;
    private driveRow: HTMLElement;
    private driveHintEl: HTMLElement;
    private searchInput: HTMLInputElement;
    private searchBtn: HTMLButtonElement;
    private searchRow: HTMLElement;
    private searchHintEl: HTMLElement;
    private recursiveInput: HTMLInputElement;
    private assetsInput: HTMLInputElement;
    private incrementalInput: HTMLInputElement;
    private sourceNoteInput: HTMLInputElement;
    private options: FeishuSyncOptions;

    constructor(deps: FeishuSyncDialogDeps) {
        this.deps = deps;
        this.options = { ...DEFAULT_SYNC_OPTIONS, ...deps.getOptions() };

        this.dialog = new Dialog({
            title: this.t("feishuSyncTitle", "飞书知识库同步"),
            width: "860px",
            height: "640px",
            content: this.buildContent(),
            destroyCallback: () => {
                syncing = false;
            },
        });

        const root = this.dialog.element;
        this.treeEl = root.querySelector("#feishu-tree") as HTMLElement;
        this.logEl = root.querySelector("#feishu-log") as HTMLElement;
        this.statusEl = root.querySelector("#feishu-status") as HTMLElement;
        this.syncBtn = root.querySelector("#feishu-sync-btn") as HTMLButtonElement;
        this.spaceSelect = root.querySelector("#feishu-space") as HTMLSelectElement;
        this.spaceRow = root.querySelector("#feishu-space-row") as HTMLElement;
        this.notebookSelect = root.querySelector("#feishu-notebook") as HTMLSelectElement;
        this.rootPathInput = root.querySelector("#feishu-rootpath") as HTMLInputElement;
        this.sourceSelect = root.querySelector("#feishu-source") as HTMLSelectElement;
        this.folderInput = root.querySelector("#feishu-folder") as HTMLInputElement;
        this.driveRow = root.querySelector("#feishu-drive-row") as HTMLElement;
        this.driveHintEl = root.querySelector("#feishu-drive-hint") as HTMLElement;
        this.searchInput = root.querySelector("#feishu-search") as HTMLInputElement;
        this.searchBtn = root.querySelector("#feishu-search-btn") as HTMLButtonElement;
        this.searchRow = root.querySelector("#feishu-search-row") as HTMLElement;
        this.searchHintEl = root.querySelector("#feishu-search-hint") as HTMLElement;
        this.recursiveInput = root.querySelector("#feishu-recursive") as HTMLInputElement;
        this.assetsInput = root.querySelector("#feishu-assets") as HTMLInputElement;
        this.incrementalInput = root.querySelector("#feishu-incremental") as HTMLInputElement;
        this.sourceNoteInput = root.querySelector("#feishu-source-note") as HTMLInputElement;

        this.bindEvents();
        this.init().catch((e) => {
            console.error("初始化飞书同步对话框失败:", e);
            this.appendLog(`初始化失败：${e instanceof Error ? e.message : e}`);
        });
    }

    private t(key: string, fallback: string): string {
        const value = this.deps.i18n?.[key];
        return typeof value === "string" && value ? value : fallback;
    }

    private buildContent(): string {
        return `<div class="feishu-sync b3-typography">
    <div class="feishu-sync__config">
        <div class="feishu-sync__row">
            <span class="feishu-sync__label">${this.t("feishuSourceType", "同步来源")}</span>
            <select id="feishu-source" class="b3-select fn__size200">
                <option value="wiki">${this.t("feishuSourceWiki", "飞书知识库（Wiki）")}</option>
                <option value="drive">${this.t("feishuSourceDrive", "飞书云文档（文件夹）")}</option>
                <option value="search">${this.t("feishuSourceSearch", "搜索有权限的文档")}</option>
            </select>
            <button id="feishu-refresh" class="b3-button b3-button--outline fn__flex-center">${this.t("feishuRefresh", "刷新")}</button>
            <span class="fn__space"></span>
            <span id="feishu-status" class="feishu-sync__status"></span>
        </div>
        <div class="feishu-sync__row" id="feishu-space-row">
            <span class="feishu-sync__label">${this.t("feishuSpace", "知识空间")}</span>
            <select id="feishu-space" class="b3-select fn__size200"></select>
        </div>
        <div class="feishu-sync__row" id="feishu-drive-row">
            <span class="feishu-sync__label">${this.t("feishuFolderToken", "文件夹 token / 链接")}</span>
            <input id="feishu-folder" class="b3-text-field fn__flex-1" placeholder="${this.t("feishuFolderTokenPlaceholder", "留空 = 我的空间；也可粘贴共享空间 / 文件夹的链接")}">
        </div>
        <div class="feishu-sync__hint" id="feishu-drive-hint"></div>
        <div class="feishu-sync__row" id="feishu-search-row">
            <span class="feishu-sync__label">${this.t("feishuSearchLabel", "关键词")}</span>
            <input id="feishu-search" class="b3-text-field fn__flex-1" placeholder="${this.t("feishuSearchPlaceholder", "输入关键词搜索有权限的文档（最多 30 字）")}">
            <button id="feishu-search-btn" class="b3-button b3-button--outline">${this.t("feishuSearchBtn", "搜索")}</button>
        </div>
        <div class="feishu-sync__hint" id="feishu-search-hint"></div>
        <div class="feishu-sync__row">
            <span class="feishu-sync__label">${this.t("feishuNotebook", "目标笔记本")}</span>
            <select id="feishu-notebook" class="b3-select fn__size200"></select>
            <span class="feishu-sync__label">${this.t("feishuRootPath", "根路径")}</span>
            <input id="feishu-rootpath" class="b3-text-field fn__size200" value="${this.options.rootPath}">
        </div>
        <div class="feishu-sync__row feishu-sync__options">
            <label><input type="checkbox" id="feishu-recursive"> ${this.t("feishuRecursive", "递归子文档")}</label>
            <label><input type="checkbox" id="feishu-assets"> ${this.t("feishuAssets", "同步图片/附件")}</label>
            <label><input type="checkbox" id="feishu-incremental"> ${this.t("feishuIncremental", "增量同步")}</label>
            <label><input type="checkbox" id="feishu-source-note"> ${this.t("feishuAddSource", "添加来源")}</label>
        </div>
    </div>
    <div class="feishu-sync__tree" id="feishu-tree"></div>
    <div class="feishu-sync__log" id="feishu-log"></div>
    <div class="feishu-sync__footer">
        <button id="feishu-auth-btn" class="b3-button b3-button--outline">${this.t("feishuAuthMenu", "用户授权")}</button>
        <span class="fn__space"></span>
        <button id="feishu-sync-btn" class="b3-button b3-button--text">${this.t("feishuStartSync", "开始同步")}</button>
    </div>
</div>`;
    }

    private bindEvents() {
        this.sourceSelect.onchange = () => {
            this.updateRowVisibility();
            void this.loadTree();
        };
        this.folderInput.addEventListener("change", () => {
            void this.loadTree();
        });
        this.searchBtn.onclick = () => {
            void this.loadTree();
        };
        this.searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void this.loadTree();
            }
        });
        (this.dialog.element.querySelector("#feishu-refresh") as HTMLElement).onclick = () => {
            void this.loadTree();
        };
        this.spaceSelect.onchange = () => {
            void this.loadTree();
        };
        this.syncBtn.onclick = () => {
            void this.handleSync();
        };
        (this.dialog.element.querySelector("#feishu-auth-btn") as HTMLElement).onclick = () => {
            this.deps.openAuth?.();
        };
        this.recursiveInput.onchange = () => this.collectOptions();
        this.assetsInput.onchange = () => this.collectOptions();
        this.incrementalInput.onchange = () => this.collectOptions();
        this.sourceNoteInput.onchange = () => this.collectOptions();
    }

    private async init() {
        this.recursiveInput.checked = this.options.recursive;
        this.assetsInput.checked = this.options.syncAssets;
        this.incrementalInput.checked = this.options.incremental;
        this.sourceNoteInput.checked = this.options.addSource;

        this.driveHintEl.textContent = this.t(
            "feishuDriveHint",
            "「云文档」来源只能列出云盘「我的空间」；飞书「我的文档库」是独立的个人模块，开放平台暂无接口可列举。要同步共享空间或指定文件夹，请把它的链接（或 folder token）粘到上面。"
        );
        this.searchHintEl.textContent = this.t(
            "feishuSearchHint",
            "按关键词搜索「当前身份有权限」的文档：应用身份=应用可见的文档，用户身份=你能看到的文档。需要应用开通 search:docs:read 权限。"
        );
        this.updateRowVisibility();

        if (!this.deps.client.isConfigured) {
            this.appendLog("⚠️ 尚未配置飞书的 App ID / App Secret。");
            this.appendLog("请打开插件设置填写；不确定怎么配置，可在设置中点击「打开帮助 / 配置向导」查看分步说明。");
            this.syncBtn.disabled = true;
            return;
        }

        const identity = this.deps.identityLabel?.();
        if (identity) {
            this.appendLog(`当前飞书访问身份：${identity}`);
        }
        if (this.deps.isUserMode && !this.deps.isUserMode()) {
            this.appendLog("提示：「应用（机器人）身份」只能看到被授权给应用的内容；若要访问你自己的云文档/知识库，请在设置中改为「用户身份」并完成授权。");
        }

        await Promise.all([this.loadNotebooks(), this.loadSpaces()]);
        await this.loadTree();
    }

    private async loadNotebooks() {
        try {
            const res = await lsNotebooks();
            const notebooks = res?.notebooks || [];
            this.notebookSelect.innerHTML = "";
            for (const notebook of notebooks) {
                const option = document.createElement("option");
                option.value = notebook.id;
                option.textContent = notebook.name;
                this.notebookSelect.appendChild(option);
                if (notebook.id === this.options.notebook) {
                    option.selected = true;
                }
            }
            // 未指定或已失效时，默认选择第一个笔记本
            const exists = notebooks.some((notebook) => notebook.id === this.options.notebook);
            if (!exists && notebooks.length) {
                this.options.notebook = notebooks[0].id;
                this.notebookSelect.value = notebooks[0].id;
            }
        } catch (e) {
            this.appendLog(`读取笔记本失败：${e instanceof Error ? e.message : e}`);
        }
    }

    private async loadSpaces() {
        try {
            const spaces = await this.deps.client.listWikiSpaces();
            this.spaceSelect.innerHTML = "";
            for (const space of spaces) {
                const option = document.createElement("option");
                option.value = space.space_id;
                option.textContent = space.name || space.space_id;
                this.spaceSelect.appendChild(option);
            }
            if (!spaces.length) {
                const option = document.createElement("option");
                option.value = "";
                option.textContent = "（无可用知识空间）";
                this.spaceSelect.appendChild(option);
            }
        } catch (e) {
            this.spaceSelect.innerHTML = `<option value="">（加载失败）</option>`;
            this.appendLog(`读取知识空间失败：${e instanceof Error ? e.message : e}`);
        }
    }

    /** 按当前来源显示/隐藏对应的配置行 */
    private updateRowVisibility() {
        const source = this.sourceSelect.value as SourceType;
        const isWiki = source === "wiki";
        const isDrive = source === "drive";
        const isSearch = source === "search";
        this.spaceRow.classList.toggle("fn__none", !isWiki);
        this.driveRow.classList.toggle("fn__none", !isDrive);
        this.driveHintEl.classList.toggle("fn__none", !isDrive);
        this.searchRow.classList.toggle("fn__none", !isSearch);
        this.searchHintEl.classList.toggle("fn__none", !isSearch);
    }

    private async loadTree() {
        this.treeEl.innerHTML = "";
        const source = this.sourceSelect.value as SourceType;
        if (source === "search") {
            await this.loadSearchResults();
            return;
        }
        if (source === "wiki") {
            const spaceId = this.spaceSelect.value;
            const spaceName = this.spaceSelect.selectedOptions[0]?.textContent || "知识库";
            if (!spaceId) return;
            this.setStatus("正在加载知识库目录...");
            const spaceMeta: TreeNodeMeta = {
                kind: "space",
                key: `space:${spaceId}`,
                title: spaceName,
                spaceId,
                expandable: true,
                path: [],
                loader: async () => this.loadWikiNodeMetas(spaceId, undefined, [spaceName]),
            };
            this.treeEl.appendChild(this.createNodeElement(spaceMeta, 0));
        } else {
            const folderToken = this.getDriveFolderToken();
            this.setStatus("正在加载云文档目录...");
            let title = this.t("feishuMySpace", "我的空间");
            let basePath: string[] = [];
            if (folderToken) {
                title = await this.getFolderLabel(folderToken);
                basePath = [sanitizeTitle(title)];
            }
            const rootMeta: TreeNodeMeta = {
                kind: "drive-root",
                key: `drive:${folderToken || "root"}`,
                title,
                expandable: true,
                objToken: folderToken,
                path: basePath,
                loader: async () => this.loadDriveMetas(folderToken, basePath),
            };
            this.treeEl.appendChild(this.createNodeElement(rootMeta, 0));
            if (!folderToken && this.deps.isUserMode && !this.deps.isUserMode()) {
                this.setStatus("注意：当前为应用身份，「我的空间」是应用自己的空间（通常为空）");
                return;
            }
        }
        this.setStatus("");
    }

    /** 搜索当前身份有权限的文档并展示结果（自动翻页，直到取完或达到上限） */
    private async loadSearchResults() {
        const keyword = (this.searchInput.value || "").trim();
        if (keyword.length > 30) {
            this.appendLog("关键词最长 30 个字符，已自动截取前 30 个字符。");
        }
        // 关键词可以为空：接口允许 query 为空字符串，此时返回全部可见文档
        const query = keyword.slice(0, 30);
        const maxItems = 500;
        this.setStatus(this.t("feishuSearchSearching", "搜索中..."));

        try {
            let pageToken = "";
            let loaded = 0;
            let total = 0;
            let truncated = false;
            do {
                const result = await this.deps.client.searchDocs(query, pageToken || undefined, 20);
                total = result.total || total;
                for (const item of result.items) {
                    this.appendSearchResult(item);
                }
                loaded += result.items.length;
                pageToken = result.hasMore ? result.pageToken : "";
                this.setStatus(`已加载 ${loaded}/${total || "?"}`);
                if (loaded >= maxItems && pageToken) {
                    truncated = true;
                    break;
                }
            } while (pageToken);

            if (!loaded) {
                this.appendLog(this.t("feishuSearchEmpty", "没有搜索到文档（也可能是应用缺少 search:docs:read 权限）"));
                return;
            }
            this.appendLog(
                truncated
                    ? `共约 ${total} 个结果，仅加载前 ${loaded} 个；可用更精确的关键词缩小范围。`
                    : `共 ${total || loaded} 个结果，已全部加载。`
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.appendLog(`搜索失败：${message}`);
            this.appendLog("若为权限错误，请在飞书后台为应用开通 search:docs:read 权限后重试。");
        } finally {
            this.setStatus("");
        }
    }

    /** 渲染一条搜索结果 */
    private appendSearchResult(item: FeishuSearchResult) {
        const syncable = item.docType === "DOCX" || item.docType === "DOC" || item.entityType === "WIKI";
        const meta: TreeNodeMeta = {
            kind: "search-doc",
            key: `search:${item.token}`,
            title: item.title || item.token,
            syncable,
            objToken: item.token,
            objType: (item.docType || "").toLowerCase(),
            url: item.url,
            owner: item.ownerName,
            badge: item.docType || item.entityType,
            path: [],
        };
        this.treeEl.appendChild(this.createNodeElement(meta, 0));
    }

    /** 把搜索结果解析为可同步的条目 */
    private async resolveSearchResult(meta: TreeNodeMeta): Promise<FeishuSyncItem | null> {
        const objToken = meta.objToken || "";
        const objType = (meta.objType || "").toLowerCase();
        if (objType === "wiki") {
            const node = await this.deps.client.getWikiNode(objToken);
            if (!node || (node.obj_type !== "docx" && node.obj_type !== "doc")) {
                this.appendLog(`跳过《${meta.title}》：知识库节点类型「${node?.obj_type || "未知"}」暂不支持`);
                return null;
            }
            return {
                key: `wiki:${node.node_token}`,
                objToken: node.obj_token,
                objType: node.obj_type,
                title: node.title || meta.title,
                editTime: node.obj_edit_time,
                owner: meta.owner,
                path: [],
            };
        }
        if (objType !== "docx" && objType !== "doc") {
            this.appendLog(`跳过《${meta.title}》：类型「${objType || "未知"}」暂不支持`);
            return null;
        }
        return {
            key: `drive:${objToken}`,
            objToken,
            objType,
            title: meta.title,
            owner: meta.owner,
            path: [],
            url: meta.url,
        };
    }

    /** 从输入内容里解析文件夹 token（支持直接粘贴链接） */
    private getDriveFolderToken(): string {
        return extractFolderToken(this.folderInput?.value || "");
    }

    /** 获取文件夹显示名，失败时退化为 token 前缀 */
    private async getFolderLabel(token: string): Promise<string> {
        const meta = await this.deps.client.getFolderMeta(token);
        return meta?.name || `指定文件夹（${token.slice(0, 10)}…）`;
    }

    private async loadWikiNodeMetas(spaceId: string, parentToken: string | undefined, path: string[]): Promise<TreeNodeMeta[]> {
        const nodes = await this.deps.client.listWikiNodes(spaceId, parentToken);
        return nodes.map((node) => this.wikiNodeToMeta(spaceId, node, path));
    }

    private wikiNodeToMeta(spaceId: string, node: FeishuWikiNode, path: string[]): TreeNodeMeta {
        const syncable = node.obj_type === "docx" || node.obj_type === "doc";
        return {
            kind: "wiki-node",
            key: `wiki:${node.node_token}`,
            title: node.title || "未命名",
            spaceId,
            nodeToken: node.node_token,
            expandable: !!node.has_child,
            syncable,
            objToken: node.obj_token,
            objType: node.obj_type,
            editTime: node.obj_edit_time,
            path,
            loader: async () => this.loadWikiNodeMetas(spaceId, node.node_token, [...path, sanitizeTitle(node.title)]),
        };
    }

    private async loadDriveMetas(folderToken: string, path: string[]): Promise<TreeNodeMeta[]> {
        const files = await this.deps.client.listDriveFiles(folderToken);
        return files.map((file) => this.driveFileToMeta(file, path));
    }

    private driveFileToMeta(file: FeishuDriveFile, path: string[]): TreeNodeMeta {
        const isFolder = file.type === "folder";
        const syncable = file.type === "docx" || file.type === "doc";
        return {
            kind: isFolder ? "drive-folder" : "drive-file",
            key: `drive:${file.token}`,
            title: file.name || "未命名",
            expandable: isFolder,
            syncable,
            objToken: file.token,
            objType: file.type,
            url: file.url,
            path,
            loader: isFolder ? async () => this.loadDriveMetas(file.token, [...path, sanitizeTitle(file.name)]) : undefined,
        };
    }

    private createNodeElement(meta: TreeNodeMeta, depth: number): HTMLElement {
        const container = document.createElement("div");
        container.className = "feishu-sync__node-wrap";

        const node = document.createElement("div");
        node.className = "feishu-sync__node";
        node.style.paddingLeft = `${depth * 16 + 4}px`;

        const toggle = document.createElement("span");
        toggle.className = "feishu-sync__toggle";
        toggle.textContent = meta.expandable ? "▸" : "";
        node.appendChild(toggle);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "feishu-sync__checkbox";
        checkbox.dataset.meta = JSON.stringify({
            kind: meta.kind,
            key: meta.key,
            title: meta.title,
            spaceId: meta.spaceId,
            nodeToken: meta.nodeToken,
            expandable: meta.expandable,
            syncable: meta.syncable,
            objToken: meta.objToken,
            objType: meta.objType,
            editTime: meta.editTime,
            url: meta.url,
            owner: meta.owner,
            path: meta.path,
        });
        if (!meta.syncable && !meta.expandable) {
            checkbox.disabled = true;
        }
        node.appendChild(checkbox);

        const icon = document.createElement("span");
        icon.className = "feishu-sync__icon";
        icon.textContent = meta.expandable ? "📁" : "📄";
        node.appendChild(icon);

        const title = document.createElement("span");
        title.className = "feishu-sync__node-title";
        title.textContent = meta.title;
        node.appendChild(title);

        if (meta.badge) {
            const typeBadge = document.createElement("span");
            typeBadge.className = "feishu-sync__badge";
            typeBadge.textContent = meta.badge;
            node.appendChild(typeBadge);
        }

        if (meta.owner) {
            const ownerEl = document.createElement("span");
            ownerEl.className = "feishu-sync__owner";
            ownerEl.textContent = meta.owner;
            ownerEl.title = `${this.t("feishuOwner", "所有者")}：${meta.owner}`;
            node.appendChild(ownerEl);
        }

        if (!meta.syncable && !meta.expandable) {
            const badge = document.createElement("span");
            badge.className = "feishu-sync__badge";
            badge.textContent = this.t("feishuUnsupported", "暂不支持");
            node.appendChild(badge);
        }

        container.appendChild(node);

        const children = document.createElement("div");
        children.className = "feishu-sync__children fn__none";
        container.appendChild(children);

        const expand = async () => {
            if (!meta.expandable) return;
            const collapsed = children.classList.contains("fn__none");
            if (collapsed && !meta.loaded) {
                meta.loaded = true;
                toggle.textContent = "▾";
                children.classList.remove("fn__none");
                children.innerHTML = `<div class="feishu-sync__loading">加载中...</div>`;
                try {
                    const childMetas = (await meta.loader?.()) || [];
                    children.innerHTML = "";
                    if (!childMetas.length) {
                        children.innerHTML = `<div class="feishu-sync__empty">（空）</div>`;
                    }
                    for (const child of childMetas) {
                        children.appendChild(this.createNodeElement(child, depth + 1));
                    }
                } catch (e) {
                    children.innerHTML = `<div class="feishu-sync__empty">加载失败：${e instanceof Error ? e.message : e}</div>`;
                }
                return;
            }
            toggle.textContent = collapsed ? "▾" : "▸";
            children.classList.toggle("fn__none", !collapsed);
        };

        toggle.onclick = (e) => {
            e.stopPropagation();
            void expand();
        };
        title.onclick = () => {
            void expand();
        };

        return container;
    }

    private setStatus(text: string) {
        if (this.statusEl) this.statusEl.textContent = text;
    }

    private appendLog(message: string) {
        const line = document.createElement("div");
        line.className = "feishu-sync__log-line";
        line.textContent = message;
        this.logEl.appendChild(line);
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    private collectOptions() {
        this.options.recursive = this.recursiveInput.checked;
        this.options.syncAssets = this.assetsInput.checked;
        this.options.incremental = this.incrementalInput.checked;
        this.options.addSource = this.sourceNoteInput.checked;
        this.options.notebook = this.notebookSelect.value;
        this.options.rootPath = this.rootPathInput.value.trim() || DEFAULT_SYNC_OPTIONS.rootPath;
    }

    /** 收集勾选的文档（含容器递归） */
    private async collectSelectedItems(): Promise<FeishuSyncItem[]> {
        const items: FeishuSyncItem[] = [];
        const seen = new Set<string>();
        const push = (item: FeishuSyncItem) => {
            if (seen.has(item.key)) return;
            seen.add(item.key);
            items.push(item);
        };

        const collectWiki = async (spaceId: string, parentToken: string | undefined, path: string[]) => {
            const nodes = await this.deps.client.listWikiNodes(spaceId, parentToken);
            for (const node of nodes) {
                if (node.obj_type === "docx" || node.obj_type === "doc") {
                    push({
                        key: `wiki:${node.node_token}`,
                        objToken: node.obj_token,
                        objType: node.obj_type,
                        title: node.title,
                        editTime: node.obj_edit_time,
                        path,
                    });
                }
                if (node.has_child && this.options.recursive) {
                    await collectWiki(spaceId, node.node_token, [...path, sanitizeTitle(node.title)]);
                }
            }
        };

        const collectDrive = async (folderToken: string, path: string[]) => {
            const files = await this.deps.client.listDriveFiles(folderToken);
            for (const file of files) {
                if (file.type === "folder") {
                    if (this.options.recursive) {
                        await collectDrive(file.token, [...path, sanitizeTitle(file.name)]);
                    }
                } else if (file.type === "docx" || file.type === "doc") {
                    push({
                        key: `drive:${file.token}`,
                        objToken: file.token,
                        objType: file.type,
                        title: file.name,
                        path,
                        url: file.url,
                    });
                }
            }
        };

        // 遍历树上所有勾选节点：叶子文档直接收集，容器节点按需递归拉取
        const walk = async (wrap: HTMLElement) => {
            for (const child of Array.from(wrap.children)) {
                const node = child.querySelector(":scope > .feishu-sync__node") as HTMLElement;
                const children = child.querySelector(":scope > .feishu-sync__children") as HTMLElement;
                if (!node) continue;
                const checkbox = node.querySelector(".feishu-sync__checkbox") as HTMLInputElement;
                if (checkbox?.checked) {
                    const meta: TreeNodeMeta = JSON.parse(checkbox.dataset.meta || "{}");
                    const basePath = meta.path || [];
                    if (meta.kind === "space" && meta.spaceId) {
                        await collectWiki(meta.spaceId, undefined, [sanitizeTitle(meta.title)]);
                    } else if (meta.kind === "wiki-node") {
                        if (meta.syncable) {
                            push({
                                key: meta.key,
                                objToken: meta.objToken,
                                objType: meta.objType,
                                title: meta.title,
                                editTime: meta.editTime,
                                path: basePath,
                            });
                        }
                        if (meta.expandable && (this.options.recursive || !meta.syncable)) {
                            await collectWiki(
                                meta.spaceId,
                                meta.nodeToken,
                                [...basePath, sanitizeTitle(meta.title)]
                            );
                        }
                    } else if (meta.kind === "drive-root") {
                        await collectDrive(meta.objToken || "", meta.path || []);
                    } else if (meta.kind === "drive-folder") {
                        await collectDrive(
                            meta.objToken,
                            [...basePath, sanitizeTitle(meta.title)]
                        );
                    } else if (meta.kind === "drive-file" && meta.syncable) {
                        push({
                            key: meta.key,
                            objToken: meta.objToken,
                            objType: meta.objType,
                            title: meta.title,
                            path: basePath,
                            url: meta.url,
                        });
                    } else if (meta.kind === "search-doc" && meta.syncable) {
                        const item = await this.resolveSearchResult(meta);
                        if (item) push(item);
                    }
                }
                // 继续遍历已加载的子节点，以便收集被单独勾选的深层文档（重复项由 seen 去重）
                if (children && children.children.length) {
                    await walk(children);
                }
            }
        };

        await walk(this.treeEl);
        return items;
    }

    private async handleSync() {
        if (syncing) return;
        this.collectOptions();
        if (!this.options.notebook) {
            showMessage(this.t("feishuNoNotebook", "请选择目标笔记本"), 4000, "error");
            return;
        }
        syncing = true;
        this.syncBtn.disabled = true;
        this.logEl.innerHTML = "";
        this.setStatus(this.t("feishuCollecting", "正在收集待同步文档..."));

        try {
            await this.deps.saveOptions(this.options);
            const items = await this.collectSelectedItems();
            if (!items.length) {
                this.setStatus("");
                showMessage(this.t("feishuNoSelection", "请勾选需要同步的文档或目录"), 4000, "error");
                return;
            }
            this.appendLog(`共 ${items.length} 个文档待同步。`);
            this.setStatus(this.t("feishuSyncing", "同步中..."));

            const results = await this.deps.sync.syncItems(
                items,
                this.options,
                (done, total) => this.setStatus(`${done}/${total}`),
                (msg) => this.appendLog(msg)
            );

            const created = results.filter((r) => r.status === "created").length;
            const updated = results.filter((r) => r.status === "updated").length;
            const skipped = results.filter((r) => r.status === "skipped").length;
            const failed = results.filter((r) => r.status === "failed").length;
            const summary = `同步完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}，失败 ${failed}`;
            this.appendLog(summary);
            this.setStatus(summary);
            showMessage(summary, 6000, failed ? "error" : "info");
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.appendLog(`同步出错：${message}`);
            this.setStatus("");
            showMessage(`同步出错：${message}`, 6000, "error");
        } finally {
            syncing = false;
            this.syncBtn.disabled = false;
        }
    }
}
