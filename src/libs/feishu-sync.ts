/*
 * 飞书文档 -> 思源笔记 同步引擎
 */

import { Plugin } from "siyuan";
import { FeishuBlock, FeishuClient } from "./feishu-api";
import { docxBlocksToMarkdown } from "./feishu-parser";
import {
    appendBlock,
    createDocWithMd,
    deleteBlock,
    getChildBlocks,
    sql,
    uploadAsset,
} from "../api";

const RECORDS_FILE = "feishu-sync-records.json";

export interface FeishuSyncOptions {
    /** 目标笔记本 ID */
    notebook: string;
    /** 同步到笔记本中的根路径，例如 "/飞书知识库" */
    rootPath: string;
    /** 是否递归同步子节点 */
    recursive: boolean;
    /** 是否同步图片 / 附件到本地资源 */
    syncAssets: boolean;
    /** 是否按编辑时间增量同步 */
    incremental: boolean;
    /** 是否在文档开头添加来源信息 */
    addSource: boolean;
}

export const DEFAULT_SYNC_OPTIONS: FeishuSyncOptions = {
    notebook: "",
    rootPath: "/飞书知识库",
    recursive: true,
    syncAssets: true,
    incremental: true,
    addSource: true,
};

/** 一条待同步的文档 */
export interface FeishuSyncItem {
    /** 唯一键：知识库节点使用 node_token，云文档使用文件 token */
    key: string;
    /** 文档 token */
    objToken: string;
    /** 文档类型：docx / doc */
    objType: string;
    title: string;
    /** 飞书侧最近编辑时间（秒级时间戳字符串） */
    editTime?: string;
    /** 目标目录层级（不含文档标题） */
    path: string[];
    /** 飞书网页链接（可选） */
    url?: string;
    /** 文档所有者名称（可选） */
    owner?: string;
}

export interface FeishuSyncRecord {
    docId: string;
    path: string;
    title: string;
    editTime?: string;
    syncedAt: number;
}

export type SyncStatus = "created" | "updated" | "skipped" | "failed";

export interface SyncResult {
    item: FeishuSyncItem;
    status: SyncStatus;
    docId?: string;
    message?: string;
}

/** 过滤掉文件名中的非法字符 */
export function sanitizeTitle(title: string): string {
    const cleaned = (title || "未命名文档")
        .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
    const result = cleaned || "未命名文档";
    return result.length > 100 ? result.slice(0, 100) : result;
}

/**
 * 把长 Markdown 按顶层块边界切分成多批，避免单次写入过大被截断。
 * 切分点只取「代码围栏之外的空行」，因此不会把代码块/表格切坏。
 */
export function splitMarkdownChunks(markdown: string, maxChars = 40000): string[] {
    const lines = (markdown || "").split("\n");
    const chunks: string[] = [];
    let current: string[] = [];
    let currentLen = 0;
    let inFence = false;

    const flush = () => {
        const text = current.join("\n").trim();
        if (text) chunks.push(text);
        current = [];
        currentLen = 0;
    };

    for (const line of lines) {
        if (/^\s*```/.test(line)) inFence = !inFence;
        current.push(line);
        currentLen += line.length + 1;
        if (!inFence && line.trim() === "" && currentLen >= maxChars) {
            flush();
        }
    }
    flush();
    return chunks.length ? chunks : [markdown];
}

/** 拼接路径片段 */
export function joinPath(...parts: string[]): string {
    const segments: string[] = [];
    for (const part of parts) {
        if (!part) continue;
        for (const seg of part.split("/")) {
            const trimmed = seg.trim();
            if (trimmed) segments.push(trimmed);
        }
    }
    return "/" + segments.join("/");
}

function base64ToBlob(base64: string, contentType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: contentType || "application/octet-stream" });
}

function extFromContentType(contentType: string, fallback: string): string {
    const map: Record<string, string> = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "image/bmp": ".bmp",
    };
    const clean = (contentType || "").split(";")[0].trim().toLowerCase();
    return map[clean] || fallback;
}

export class FeishuSync {
    private plugin: Plugin;
    private client: FeishuClient;
    private records: Record<string, FeishuSyncRecord> = {};
    private assetsCache = new Map<string, string | null>();

    constructor(plugin: Plugin, client: FeishuClient) {
        this.plugin = plugin;
        this.client = client;
    }

    async loadRecords(): Promise<void> {
        try {
            const data = await this.plugin.loadData(RECORDS_FILE);
            this.records = data || {};
        } catch (e) {
            console.warn("读取飞书同步记录失败:", e);
            this.records = {};
        }
    }

    async saveRecords(): Promise<void> {
        await this.plugin.saveData(RECORDS_FILE, this.records);
    }

    getRecords(): Record<string, FeishuSyncRecord> {
        return this.records;
    }

    /** 清空全部同步记录（下次同步会当作全新文档处理） */
    async clearRecords(): Promise<void> {
        this.records = {};
        await this.saveRecords();
    }

    private async docExists(docId: string): Promise<boolean> {
        try {
            const rows = await sql(`select id from blocks where id = '${docId}' and type = 'd' limit 1`);
            return !!(rows && rows.length);
        } catch (e) {
            return false;
        }
    }

    /** 按笔记本 + 人类可读路径查找已存在的文档（用于避免重复创建） */
    private async findDocIdByPath(notebook: string, hpath: string): Promise<string | null> {
        if (!notebook || !hpath) return null;
        try {
            const box = notebook.replace(/'/g, "''");
            const path = hpath.replace(/'/g, "''");
            const rows = await sql(`select id from blocks where box = '${box}' and hpath = '${path}' and type = 'd' limit 1`);
            return rows?.[0]?.id || null;
        } catch (e) {
            return null;
        }
    }

    /** 清空文档原有内容并写入新的分块内容 */
    private async writeChunks(docId: string, chunks: string[]): Promise<boolean> {
        const children = await getChildBlocks(docId);
        for (const child of children || []) {
            await deleteBlock(child.id);
        }
        for (let i = 0; i < chunks.length; i++) {
            const ops = await appendBlock("markdown", chunks[i], docId);
            if (!ops) return false;
        }
        return true;
    }

    /** 下载飞书素材并上传到思源资源目录，返回资源相对路径 */
    private async resolveAsset(token: string, name: string): Promise<string | null> {
        if (!token) return null;
        if (this.assetsCache.has(token)) {
            return this.assetsCache.get(token);
        }
        let path: string | null = null;
        try {
            const media = await this.client.downloadMedia(token);
            const ext = extFromContentType(media.contentType, ".bin");
            const fileName = name && /\.[a-z0-9]+$/i.test(name) ? name : `${token}${ext}`;
            const blob = base64ToBlob(media.base64, media.contentType);
            const file = new File([blob], sanitizeTitle(fileName), { type: media.contentType });
            path = await uploadAsset(file);
        } catch (e) {
            console.warn(`下载飞书素材失败 (${token}):`, e);
        }
        this.assetsCache.set(token, path);
        return path;
    }

    /** 构建一个文档的 Markdown 内容 */
    private async buildMarkdown(item: FeishuSyncItem, options: FeishuSyncOptions, log?: (msg: string) => void): Promise<{ markdown: string; blockCount: number }> {
        let markdown = "";
        let blockCount = 0;
        if (item.objType === "docx") {
            const blocks: FeishuBlock[] = await this.client.getDocxBlocks(item.objToken);
            blockCount = blocks.length;
            markdown = await docxBlocksToMarkdown(blocks, {
                resolveImage: options.syncAssets
                    ? async (block: FeishuBlock) => this.resolveAsset(block.image?.token, "image")
                    : undefined,
                resolveFile: options.syncAssets
                    ? async (block: FeishuBlock) => this.resolveAsset(block.file?.token, block.file?.name)
                    : undefined,
                onProgress: log,
            });
        } else if (item.objType === "doc") {
            log?.("旧版文档，使用纯文本内容同步（格式会有损失）");
            markdown = await this.client.getDocRawContent(item.objToken);
        } else {
            throw new Error(`暂不支持同步的文档类型：${item.objType}`);
        }

        if (options.addSource) {
            const owner = item.owner ? ` · 所有者：${item.owner}` : "";
            // 来源直接给出可点击的链接；拿不到链接时退化为 token
            const source = item.url
                ? `> 来源：${item.url}${owner}`
                : `> 来源：飞书文档（token: ${item.objToken}）${owner}`;
            markdown = `${source}\n\n${markdown}`;
        }
        return { markdown, blockCount };
    }

    /** 同步单个文档 */
    async syncItem(item: FeishuSyncItem, options: FeishuSyncOptions, log?: (msg: string) => void): Promise<SyncResult> {
        const record = this.records[item.key];
        if (options.incremental && record && item.editTime && record.editTime === item.editTime) {
            // 记录里说没变化，但思源里的文档可能已经被删除/移动，这里再校验一次，避免误跳过
            if (await this.docExists(record.docId)) {
                return { item, status: "skipped", docId: record.docId, message: "内容未变化" };
            }
            log?.(`  同步记录中的文档已不存在（可能已被删除），将重新创建`);
        }

        try {
            const built = await this.buildMarkdown(item, options, log);
            const markdown = built.markdown;
            if (!markdown.trim()) {
                return { item, status: "skipped", message: "文档内容为空" };
            }

            const title = sanitizeTitle(item.title);
            const path = joinPath(options.rootPath, ...item.path, title);

            // 分块写入：避免单次请求内容过大导致写入被截断
            const chunks = splitMarkdownChunks(markdown);

            // 1) 优先复用同步记录里的文档；2) 记录失效时按路径查找已有文档，避免重复创建
            let docId: string | null = record?.docId && await this.docExists(record.docId) ? record.docId : null;
            if (!docId) {
                docId = await this.findDocIdByPath(options.notebook, path);
                if (docId) {
                    log?.(`  已存在同路径文档，直接覆盖：${path}`);
                }
            }

            let status: SyncStatus;
            if (docId) {
                const ok = await this.writeChunks(docId, chunks);
                if (!ok) {
                    return { item, status: "failed", docId, message: "写入文档内容失败" };
                }
                status = "updated";
            } else {
                docId = await createDocWithMd(options.notebook, path, chunks[0] || "");
                if (docId) {
                    for (let i = 1; i < chunks.length; i++) {
                        const ops = await appendBlock("markdown", chunks[i], docId);
                        if (!ops) {
                            log?.(`  ⚠️ 第 ${i + 1}/${chunks.length} 批写入失败，后续内容可能缺失`);
                            break;
                        }
                    }
                }
                status = "created";
            }

            if (!docId) {
                return { item, status: "failed", message: "写入思源文档失败" };
            }

            // 写入校验：对比思源侧实际块数与写入批次数，便于定位「内容不全」
            try {
                const rows = await sql(`select count(*) as cnt from blocks where root_id = '${docId}'`);
                const blockCount = rows?.[0]?.cnt;
                log?.(`  校验：飞书块 ${built.blockCount || "?"} 个 → 写入 ${chunks.length} 批，思源现有 ${blockCount ?? "?"} 个块`);
            } catch (e) {
                // 校验失败不影响同步结果
            }

            this.records[item.key] = {
                docId,
                path,
                title,
                editTime: item.editTime,
                syncedAt: Date.now(),
            };
            return { item, status, docId };
        } catch (e) {
            return { item, status: "failed", message: e instanceof Error ? e.message : String(e) };
        }
    }

    /**
     * 批量同步
     * @param onProgress 进度回调 (已完成, 总数, 当前结果)
     */
    async syncItems(
        items: FeishuSyncItem[],
        options: FeishuSyncOptions,
        onProgress?: (done: number, total: number, result: SyncResult) => void,
        log?: (msg: string) => void
    ): Promise<SyncResult[]> {
        const results: SyncResult[] = [];
        let done = 0;
        for (const item of items) {
            log?.(`开始同步《${item.title}》...`);
            const result = await this.syncItem(item, options, log);
            results.push(result);
            done++;
            log?.(formatResult(result));
            onProgress?.(done, items.length, result);
        }
        await this.saveRecords();
        return results;
    }
}

function formatResult(result: SyncResult): string {
    switch (result.status) {
        case "created":
            return `✔ 已创建《${result.item.title}》`;
        case "updated":
            return `✔ 已更新《${result.item.title}》`;
        case "skipped":
            return `－ 跳过《${result.item.title}》${result.message ? "（" + result.message + "）" : ""}`;
        case "failed":
            return `✘ 失败《${result.item.title}》：${result.message || "未知错误"}`;
        default:
            return result.item.title;
    }
}
