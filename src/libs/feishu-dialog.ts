/*
 * 飞书知识库同步对话框
 */

import { Dialog, showMessage } from "siyuan";
import { FeishuClient, FeishuDriveFile, FeishuWikiNode } from "./feishu-api";
import {
    DEFAULT_SYNC_OPTIONS,
    FeishuSync,
    FeishuSyncItem,
    FeishuSyncOptions,
    sanitizeTitle,
} from "./feishu-sync";
import { lsNotebooks } from "../api";

type SourceType = "wiki" | "storage" | "link";

/** 从链接或纯文本中解析飞书文件夹 token（支持直接粘贴文件夹链接） */
function extractFolderToken(input: string): string {
    const text = (input || "").trim();
    if (!text) return "";
    const match = /\/(?:drive\/)?folder\/([A-Za-z0-9_-]+)/.exec(text);
    if (match) return match[1];
    return text;
}

export interface ParsedFeishuLink {
    /** 解析出的类型 */
    type: "docx" | "doc" | "wiki" | "folder" | "unsupported";
    /** 文档 / 节点 / 文件夹 token */
    token: string;
    /** 原始输入 */
    raw: string;
    /** 不支持的原始类型名（用于提示） */
    unsupportedType?: string;
}

/**
 * 解析飞书链接。
 * 支持：/docx/、/docs/、/wiki/、/folder/；
 * 其它（sheets、base、mindnotes、file、slides 等）标记为 unsupported。
 */
export function parseFeishuLink(input: string): ParsedFeishuLink {
    const raw = (input || "").trim();
    const tokenOnly = /^[A-Za-z0-9_-]{8,}$/.test(raw);
    const rules: { re: RegExp; type: ParsedFeishuLink["type"] }[] = [
        { re: /\/(?:docx|docs)\/([A-Za-z0-9_-]+)/, type: "docx" },
        { re: /\/wiki\/([A-Za-z0-9_-]+)/, type: "wiki" },
        { re: /\/(?:drive\/)?folder\/([A-Za-z0-9_-]+)/, type: "folder" },
        { re: /\/doc\/([A-Za-z0-9_-]+)/, type: "doc" },
        { re: /\/(sheets|base|mindnotes|file|slides)\/([A-Za-z0-9_-]+)/, type: "unsupported" },
    ];
    for (const rule of rules) {
        const match = rule.re.exec(raw);
        if (!match) continue;
        if (rule.type === "unsupported") {
            return { type: "unsupported", token: match[2], raw, unsupportedType: match[1] };
        }
        return { type: rule.type, token: match[1], raw };
    }
    if (tokenOnly) {
        // 只粘贴了 token，按新版文档处理
        return { type: "docx", token: raw, raw };
    }
    return { type: "unsupported", token: "", raw };
}

interface TreeNodeMeta {
    kind: "space" | "wiki-node" | "drive-root" | "drive-folder" | "drive-file" | "link-doc";
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
    /** 文档位置（所有者缺失时在右侧显示） */
    source?: string;
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
    private linkInput: HTMLInputElement;
    private linkBtn: HTMLButtonElement;
    private linkRow: HTMLElement;
    private linkHintEl: HTMLElement;
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
        this.linkInput = root.querySelector("#feishu-link") as HTMLInputElement;
        this.linkBtn = root.querySelector("#feishu-link-btn") as HTMLButtonElement;
        this.linkRow = root.querySelector("#feishu-link-row") as HTMLElement;
        this.linkHintEl = root.querySelector("#feishu-link-hint") as HTMLElement;
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
                <option value="storage">${this.t("feishuSourceStorage", "存储（云盘）")}</option>
                <option value="link">${this.t("feishuSourceLink", "指定链接")}</option>
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
            <input id="feishu-folder" class="b3-text-field fn__flex-1" placeholder="${this.t("feishuFolderTokenPlaceholder", "留空 = 存储根目录；也可粘贴某个文件夹的链接")}">
        </div>
        <div class="feishu-sync__hint" id="feishu-drive-hint"></div>
        <div class="feishu-sync__row" id="feishu-link-row">
            <span class="feishu-sync__label">${this.t("feishuLinkLabel", "飞书链接")}</span>
            <input id="feishu-link" class="b3-text-field fn__flex-1" placeholder="${this.t("feishuLinkPlaceholder", "粘贴文档 /docx/、知识库 /wiki/、文件夹 /folder/ 链接")}">
            <button id="feishu-link-btn" class="b3-button b3-button--outline">${this.t("feishuLinkParse", "解析")}</button>
        </div>
        <div class="feishu-sync__hint" id="feishu-link-hint"></div>
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
        this.linkBtn.onclick = () => {
            void this.loadTree();
        };
        this.linkInput.addEventListener("keydown", (e) => {
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
            "「存储（云盘）」来源浏览的是官方所说的「云空间根目录」（即我的空间/云盘根）。飞书没有「共享空间/云盘各空间的列举接口」，因此留空只会显示根目录；要同步某个空间或文件夹，请把它的链接或 folder token 粘到上面。"
        );
        this.linkHintEl.textContent = this.t(
            "feishuLinkHint",
            "把飞书里的链接直接粘进来即可：文档 /docx/、旧版文档 /docs/、知识库 /wiki/、文件夹 /folder/。文件夹会展开成目录树，文档可直接勾选同步。"
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
        const isStorage = source === "storage";
        const isLink = source === "link";
        this.spaceRow.classList.toggle("fn__none", !isWiki);
        this.driveRow.classList.toggle("fn__none", !isStorage);
        this.driveHintEl.classList.toggle("fn__none", !isStorage);
        this.linkRow.classList.toggle("fn__none", !isLink);
        this.linkHintEl.classList.toggle("fn__none", !isLink);
    }

    private async loadTree() {
        this.treeEl.innerHTML = "";
        const source = this.sourceSelect.value as SourceType;
        if (source === "link") {
            await this.loadLink();
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
            this.setStatus("正在加载存储目录...");
            let title = this.t("feishuStorageRoot", "存储根目录");
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
                this.setStatus("注意：当前为应用身份，存储根目录是应用自己的空间（通常为空）");
                return;
            }
        }
        this.setStatus("");
    }

    /** 「指定链接」来源：解析粘贴的链接并渲染可同步节点 */
    private async loadLink() {
        const parsed = parseFeishuLink(this.linkInput.value);
        if (!parsed.raw) {
            this.setStatus(this.t("feishuLinkEmpty", "请输入飞书文档 / 知识库 / 文件夹链接"));
            return;
        }
        this.setStatus("正在解析链接...");
        try {
            if (parsed.type === "folder") {
                const title = await this.getFolderLabel(parsed.token);
                const meta: TreeNodeMeta = {
                    kind: "drive-root",
                    key: `drive:${parsed.token}`,
                    title,
                    expandable: true,
                    objToken: parsed.token,
                    path: [sanitizeTitle(title)],
                    loader: async () => this.loadDriveMetas(parsed.token, [sanitizeTitle(title)]),
                };
                this.treeEl.appendChild(this.createNodeElement(meta, 0));
                this.appendLog(`已解析为文件夹：${title}（token: ${parsed.token}）`);
            } else if (parsed.type === "wiki") {
                const node = await this.deps.client.getWikiNode(parsed.token);
                if (!node) {
                    this.appendLog("未能解析该知识库链接：请确认应用有权限，或换用「飞书知识库（Wiki）」来源浏览。");
                    return;
                }
                const spaceId = node.space_id || node.origin_space_id || "";
                const meta = this.wikiNodeToMeta(spaceId, node, []);
                this.treeEl.appendChild(this.createNodeElement(meta, 0));
                this.appendLog(`已解析为知识库节点：${node.title}（${node.obj_type}）`);
            } else if (parsed.type === "docx" || parsed.type === "doc") {
                const title = await this.getDocTitleSafe(parsed.token, parsed.type);
                const meta: TreeNodeMeta = {
                    kind: "link-doc",
                    key: `drive:${parsed.token}`,
                    title: title || parsed.token,
                    syncable: true,
                    objToken: parsed.token,
                    objType: parsed.type,
                    url: /^https?:\/\//i.test(parsed.raw) ? parsed.raw : undefined,
                    badge: parsed.type.toUpperCase(),
                    path: [],
                };
                this.treeEl.appendChild(this.createNodeElement(meta, 0));
                this.appendLog(`已解析为文档：${title || parsed.token}`);
            } else {
                const type = parsed.unsupportedType ? `（类型：${parsed.unsupportedType}）` : "";
                this.appendLog(`${this.t("feishuLinkUnsupported", "暂不支持该链接")}${type}`);
                this.appendLog("目前支持：文档 /docx/、旧版文档 /docs/、知识库 /wiki/、文件夹 /folder/。");
            }
        } catch (e) {
            this.appendLog(`解析链接失败：${e instanceof Error ? e.message : e}`);
        } finally {
            this.setStatus("");
        }
    }

    /** 获取文档标题（失败返回空串） */
    private async getDocTitleSafe(token: string, type: string): Promise<string> {
        if (type !== "docx") return "";
        try {
            const doc = await this.deps.client.getDocxDocument(token);
            return doc?.title || "";
        } catch (e) {
            return "";
        }
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
        const expandable = !!node.has_child && !!spaceId;
        return {
            kind: "wiki-node",
            key: `wiki:${node.node_token}`,
            title: node.title || "未命名",
            spaceId,
            nodeToken: node.node_token,
            expandable,
            syncable,
            objToken: node.obj_token,
            objType: node.obj_type,
            editTime: node.obj_edit_time,
            path,
            loader: expandable
                ? async () => this.loadWikiNodeMetas(spaceId, node.node_token, [...path, sanitizeTitle(node.title)])
                : undefined,
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

        if (meta.owner || meta.source) {
            const rightEl = document.createElement("span");
            rightEl.className = "feishu-sync__owner";
            rightEl.textContent = meta.owner || meta.source || "";
            const tips: string[] = [];
            if (meta.owner) tips.push(`${this.t("feishuOwner", "所有者")}：${meta.owner}`);
            if (meta.source) tips.push(`位置：${meta.source}`);
            rightEl.title = tips.join(" · ");
            node.appendChild(rightEl);
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
                        if (meta.expandable && meta.spaceId && (this.options.recursive || !meta.syncable)) {
                            await collectWiki(
                                meta.spaceId,
                                meta.nodeToken,
                                [...basePath, sanitizeTitle(meta.title)]
                            );
                        }
                    } else if (meta.kind === "drive-root" || meta.kind === "drive-folder") {
                        const folderToken = meta.kind === "drive-root" ? (meta.objToken || "") : meta.objToken;
                        const folderPath = meta.kind === "drive-root" ? basePath : [...basePath, sanitizeTitle(meta.title)];
                        await collectDrive(folderToken, folderPath);
                    } else if (meta.kind === "drive-file" || meta.kind === "link-doc") {
                        if (meta.syncable) {
                            push({
                                key: meta.key,
                                objToken: meta.objToken,
                                objType: meta.objType,
                                title: meta.title,
                                editTime: meta.editTime,
                                path: basePath,
                                url: meta.url,
                            });
                        }
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
