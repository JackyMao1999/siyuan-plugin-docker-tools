/*
 * 浏览器书签 -> 思源数据库 同步引擎
 *
 * 行身份 = 规范化 URL，直接以数据库实际内容为事实源：每次同步先读取全部现有行
 * （优先原始 keyValues，不受视图筛选影响），再决定「新增 / 更新 / 跳过 / 清理」。
 * 同步记录（bookmark-sync-records.json）只保存内容 hash，用于增量跳过。
 */

import { Plugin } from "siyuan";
import { BookmarkEntry, normalizeUrlKey } from "./bookmark-parser";
import {
    addAvKey,
    appendDetachedRows,
    AvKey,
    AvRow,
    AvValue,
    batchSetCells,
    blockValue,
    cellText,
    collectAvRows,
    genAvID,
    getAvKeys,
    getAvRows,
    removeAvBlocks,
    renderAttributeView,
    selectValue,
    textValue,
    urlValue,
} from "./av-api";

const RECORDS_FILE = "bookmark-sync-records.json";

/** 一条待同步书签 = 解析出的条目 + 所属来源名（仅用于展示与日志，不再入库） */
export interface SyncBookmark extends BookmarkEntry {
    source: string;
}

/** 拖入过、已自动保存到工作区的书签文件副本 */
export interface SavedBookmarkFile {
    /** 来源显示名（= 导出文件名去后缀，可双击重命名） */
    source: string;
    /** 工作区内的副本路径，如 /data/bookmarks/bookmarks.html */
    path: string;
}

export interface BookmarkSyncOptions {
    /** 目标数据库 ID */
    avID: string;
    /** 承载数据库的块 ID（可能为空） */
    blockID: string;
    /** 目标数据库名（仅展示用） */
    dbName: string;
    /** 自动保存过工作区副本的书签文件 */
    savedFiles: SavedBookmarkFile[];
    /** 增量同步：内容未变的书签跳过 */
    incremental: boolean;
    /** 清理：来源文件里已消失、且是我们同步进去的行，删除对应记录 */
    removeMissing: boolean;
    /** 把书签所在文件夹路径写入「标签」列（自动分类） */
    syncTags: boolean;
}

export const DEFAULT_BOOKMARK_OPTIONS: BookmarkSyncOptions = {
    avID: "",
    blockID: "",
    dbName: "",
    savedFiles: [],
    incremental: true,
    removeMissing: false,
    syncTags: true,
};

export interface BookmarkSyncRecord {
    url: string;
    title: string;
    hash: string;
    syncedAt: number;
}

export interface BookmarkSyncSummary {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    removed: number;
    failed: number;
}

/** 解析出的目标列：keyID + 列类型；missing 为缺失列的中文名 */
export interface ResolvedColumns {
    name: string;
    url: string;
    desc: string;
    tags: string;
    types: Record<string, string>;
    missing: { label: string; name: string; type: string }[];
}

/** 同步记录 / 行匹配用的键 = 规范化 URL */
export function bookmarkRecordKey(url: string): string {
    return normalizeUrlKey(url);
}

/** FNV-1a 32 位 hash（十六进制），内容变化检测够用 */
export function hashString(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

/** 书签内容 hash：标题 + 描述 + 标签路径（URL 是身份，不参与） */
export function hashBookmark(entry: SyncBookmark, withTags: boolean): string {
    const tags = withTags ? entry.folderPath.join("/") : "";
    return hashString(`${entry.title}\n${entry.description}\n${tags}`);
}

/** 选项内容对应的稳定颜色（思源预设色号 1~22 循环） */
function optionColor(text: string): string {
    const n = parseInt(hashString(text), 16) % 22;
    return String(n + 1);
}

/**
 * 自动匹配目标数据库的列：
 * 主键 = block 列；网站链接 = url 列（或名字像链接的文本列）；
 * 描述按列名匹配文本列；标签只匹配「多选」列（单选列不参与，避免写多值失败）。
 * 匹配不到进 missing，由对话框一键创建。
 */
export function resolveColumns(keys: AvKey[], wantTags: boolean): ResolvedColumns {
    const types: Record<string, string> = {};
    for (const k of keys) types[k.id] = k.type || "text";

    const nameKey = keys.find((k) => k.type === "block") || null;

    const urlKey =
        keys.find((k) => k.type === "url") ||
        keys.find((k) => k.type === "text" && /链接|网址|url|link|href/i.test(k.name || "")) ||
        null;

    const descKey = keys.find((k) => k.type === "text" && /描述|说明|备注|desc|note/i.test(k.name || "")) || null;
    const tagsKey =
        keys.find((k) => k.type === "mSelect" && /标签|分类|目录|文件夹|tag|folder|categor/i.test(k.name || "")) ||
        keys.find((k) => k.type === "mSelect") ||
        null;

    const missing: ResolvedColumns["missing"] = [];
    if (!urlKey) missing.push({ label: "网站链接", name: "网站链接", type: "url" });
    if (!descKey) missing.push({ label: "描述", name: "描述", type: "text" });
    if (wantTags && !tagsKey) missing.push({ label: "标签", name: "标签", type: "mSelect" });

    return {
        name: nameKey?.id || "",
        url: urlKey?.id || "",
        desc: descKey?.id || "",
        tags: tagsKey?.id || "",
        types,
        missing,
    };
}

/** 一键创建缺失列，返回创建好的列名列表 */
export async function createMissingColumns(
    avID: string,
    blockID: string,
    missing: ResolvedColumns["missing"]
): Promise<string[]> {
    const created: string[] = [];
    for (const col of missing) {
        await addAvKey(avID, blockID, { keyID: genAvID(), name: col.name, type: col.type });
        created.push(col.label);
    }
    return created;
}

/** 按列类型构造一个单元格的值 */
function makeValue(keyID: string, columnType: string, content: string): AvValue {
    if (columnType === "url") return urlValue(keyID, content);
    if (columnType === "block") return blockValue(keyID, content);
    return textValue(keyID, content);
}

/** 标签值：文件夹路径的每一层 = 一个多选项 */
function tagItems(entry: BookmarkEntry): { content: string; color?: string }[] {
    const items: { content: string; color?: string }[] = [];
    const added = new Set<string>();
    for (const seg of entry.folderPath) {
        if (!seg || added.has(seg)) continue;
        added.add(seg);
        items.push({ content: seg, color: optionColor(seg) });
    }
    return items;
}

export class BookmarkSync {
    private plugin: Plugin;
    private records: Record<string, BookmarkSyncRecord> = {};

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    async loadRecords(): Promise<void> {
        try {
            const data = await this.plugin.loadData(RECORDS_FILE);
            this.records = data || {};
        } catch (error) {
            console.error("Error loading bookmark sync records:", error);
            this.records = {};
        }
    }

    async saveRecords(): Promise<void> {
        await this.plugin.saveData(RECORDS_FILE, this.records);
    }

    getRecords(): Record<string, BookmarkSyncRecord> {
        return this.records;
    }

    async clearRecords(): Promise<void> {
        this.records = {};
        await this.saveRecords();
    }

    /**
     * 执行同步：entries = 勾选后的全部书签。
     * log / onProgress 由对话框注入，用于进度展示。
     */
    async sync(
        entries: SyncBookmark[],
        options: BookmarkSyncOptions,
        log: (msg: string) => void,
        onProgress?: (done: number, total: number) => void
    ): Promise<BookmarkSyncSummary> {
        const summary: BookmarkSyncSummary = { total: entries.length, created: 0, updated: 0, skipped: 0, removed: 0, failed: 0 };
        if (!options.avID) throw new Error("未选择目标数据库");
        if (!entries.length) throw new Error("没有待同步的书签");

        log(`读取数据库列定义（${entries.length} 条书签待比对）...`);
        const keys = await getAvKeys(options.avID);
        if (!keys.length) throw new Error("读取数据库列失败：请确认目标是一个数据库，且当前账号可编辑");
        const cols = resolveColumns(keys, options.syncTags);
        if (!cols.name) throw new Error("目标数据库缺少主键（标题）列，请检查数据库结构");
        if (!cols.url) throw new Error('目标数据库缺少「网站链接」列：点「创建缺失列」一键补建');

        // ---------- 读取数据库现有行（URL -> itemID） ----------
        const dbAny = new Map<string, string>();
        const dbTitle = new Map<string, string>(); // itemID -> 当前主键标题（避免无谓重写）
        let duplicateRows = 0;
        log("正在读取数据库现有条目...");

        // 优先读原始 keyValues（全量、不受视图筛选影响）；不可用时回退分页渲染
        let dbRows: AvRow[] | null = null;
        try {
            dbRows = await getAvRows(options.avID);
        } catch (e) {
            dbRows = null;
        }
        if (dbRows === null) {
            dbRows = [];
            const readPageSize = 200;
            for (let page = 1; page <= 500; page++) {
                const rendered = await renderAttributeView(options.avID, options.blockID, page, readPageSize);
                const rows = collectAvRows(rendered);
                dbRows.push(...rows);
                if (rows.length < readPageSize) break;
            }
        }
        for (const row of dbRows) {
            let url = "";
            let title = "";
            for (const v of row.values) {
                if (v.keyID === cols.url) url = cellText(v);
                else if (v.keyID === cols.name) title = cellText(v);
            }
            dbTitle.set(row.itemID, title);
            const u = normalizeUrlKey(url);
            if (!u) continue; // 手工添加的空链接行不参与
            if (dbAny.has(u)) duplicateRows++;
            else dbAny.set(u, row.itemID);
        }
        if (duplicateRows > 0) {
            log(`注意：数据库里有 ${duplicateRows} 行 URL 重复，同步只认最先出现的一行。`);
        }

        // ---------- 分类：新增 / 更新 / 跳过 ----------
        const toCreate: { entry: SyncBookmark; key: string }[] = [];
        const toUpdate: { entry: SyncBookmark; key: string; itemID: string }[] = [];
        const sourceKeys = new Set<string>();
        const seen = new Set<string>();
        /** 本次来源仍能命中（或刚创建）的行，清理阶段绝不碰 */
        const touched = new Set<string>();
        for (const entry of entries) {
            const key = bookmarkRecordKey(entry.url);
            sourceKeys.add(key);
            if (!key) continue;
            if (seen.has(key)) {
                summary.skipped++; // 同一批里 URL 相同（跨浏览器重复书签）合并为一行
                continue;
            }
            seen.add(key);
            const itemID = dbAny.get(key) || "";
            if (itemID) {
                touched.add(itemID);
                const record = this.records[key];
                const hash = hashBookmark(entry, options.syncTags);
                if (options.incremental && record && record.hash === hash) {
                    summary.skipped++;
                    continue;
                }
                toUpdate.push({ entry, key, itemID });
            } else {
                toCreate.push({ entry, key });
            }
        }

        const totalWork = toCreate.length + toUpdate.length;
        let done = 0;
        const progress = () => onProgress?.(done, totalWork);
        progress();

        // ---------- 新增：批量追加独立行 ----------
        const createRows = (list: { entry: SyncBookmark }[]): AvValue[][] =>
            list.map(({ entry }) => {
                const values: AvValue[] = [blockValue(cols.name, entry.title)];
                values.push(makeValue(cols.url, cols.types[cols.url] || "url", entry.url));
                if (cols.desc && entry.description) values.push(textValue(cols.desc, entry.description));
                if (cols.tags && options.syncTags) {
                    const items = tagItems(entry);
                    if (items.length) values.push(selectValue(cols.tags, items));
                }
                return values;
            });

        const createChunkSize = 100;
        for (let i = 0; i < toCreate.length; i += createChunkSize) {
            const chunk = toCreate.slice(i, i + createChunkSize);
            try {
                await appendDetachedRows(options.avID, createRows(chunk));
                const now = Date.now();
                for (const item of chunk) {
                    summary.created++;
                    this.records[item.key] = {
                        url: item.entry.url,
                        title: item.entry.title,
                        hash: hashBookmark(item.entry, options.syncTags),
                        syncedAt: now,
                    };
                }
                log(`新增 ${chunk.length} 条（累计 ${summary.created}/${toCreate.length}）`);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                summary.failed += chunk.length;
                log(`⚠️ 新增一批（${chunk.length} 条）失败：${msg}`);
            }
            done += chunk.length;
            progress();
        }

        // ---------- 更新：批量改单元格 ----------
        const updateChunkRows = 25;
        for (let i = 0; i < toUpdate.length; i += updateChunkRows) {
            const chunk = toUpdate.slice(i, i + updateChunkRows);
            const cells: { keyID: string; itemID: string; value: AvValue }[] = [];
            for (const item of chunk) {
                // 标题没变就不写主键单元格（块单元格写入代价最高，且多数变化只有标签/描述）
                if (dbTitle.get(item.itemID) !== item.entry.title) {
                    cells.push({ keyID: cols.name, itemID: item.itemID, value: blockValue(cols.name, item.entry.title) });
                }
                if (cols.desc) cells.push({ keyID: cols.desc, itemID: item.itemID, value: textValue(cols.desc, item.entry.description) });
                if (cols.tags && options.syncTags) {
                    cells.push({ keyID: cols.tags, itemID: item.itemID, value: selectValue(cols.tags, tagItems(item.entry)) });
                }
            }
            // 本批没有任何要写的单元格（例如仅映射了链接列且标题未变）：直接刷新记录即可
            if (!cells.length) {
                const now = Date.now();
                for (const item of chunk) {
                    summary.skipped++;
                    this.records[item.key] = {
                        url: item.entry.url,
                        title: item.entry.title,
                        hash: hashBookmark(item.entry, options.syncTags),
                        syncedAt: now,
                    };
                }
                done += chunk.length;
                progress();
                continue;
            }
            try {
                await batchSetCells(options.avID, cells);
                const now = Date.now();
                for (const item of chunk) {
                    summary.updated++;
                    this.records[item.key] = {
                        url: item.entry.url,
                        title: item.entry.title,
                        hash: hashBookmark(item.entry, options.syncTags),
                        syncedAt: now,
                    };
                }
                log(`更新 ${chunk.length} 条（累计 ${summary.updated}/${toUpdate.length}）`);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                summary.failed += chunk.length;
                log(`⚠️ 更新一批（${chunk.length} 条）失败：${msg}`);
            }
            done += chunk.length;
            progress();
        }

        // ---------- 清理：来源里已消失的书签 ----------
        const staleKeys: string[] = [];
        for (const key of Object.keys(this.records)) {
            if (!sourceKeys.has(key)) staleKeys.push(key);
        }
        const deletable: { key: string; itemID: string }[] = [];
        for (const key of staleKeys) {
            const itemID = dbAny.get(key) || "";
            if (itemID && touched.has(itemID)) {
                // 行仍被本次来源命中（只是旧键格式变化），作废记录即可
                delete this.records[key];
            } else if (itemID) {
                deletable.push({ key, itemID });
            } else {
                delete this.records[key]; // 行已被手工删除，记录顺手清掉
            }
        }
        if (deletable.length) {
            if (options.removeMissing) {
                const removeChunkSize = 100;
                for (let i = 0; i < deletable.length; i += removeChunkSize) {
                    const chunk = deletable.slice(i, i + removeChunkSize);
                    try {
                        await removeAvBlocks(options.avID, chunk.map((d) => d.itemID));
                        for (const d of chunk) {
                            summary.removed++;
                            delete this.records[d.key];
                        }
                        log(`清理 ${chunk.length} 条已消失的书签（累计 ${summary.removed}/${deletable.length}）`);
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        summary.failed += chunk.length;
                        log(`⚠️ 清理一批失败：${msg}`);
                    }
                }
            } else {
                log(`发现 ${deletable.length} 条书签已不在来源文件中（未勾选「清理」，保留原行不动）。`);
            }
        }

        await this.saveRecords();
        log(
            `完成：新增 ${summary.created}，更新 ${summary.updated}，跳过 ${summary.skipped}，` +
            `清理 ${summary.removed}，失败 ${summary.failed}。`
        );
        return summary;
    }
}
