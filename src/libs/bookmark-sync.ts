/*
 * 浏览器书签 -> 思源数据库 同步引擎
 *
 * 行身份 = 规范化 URL，直接以数据库实际内容为事实源：每次同步先读取全部现有行
 * （优先原始 keyValues，不受视图筛选影响），再决定「新增 / 更新 / 跳过 / 清理」。
 * 同步记录（bookmark-sync-records.json）保存内容 hash（增量跳过用）与已抓取的
 * 网页描述 webDesc（避免重复访问同一网站）。
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
    removeAvKey,
    renderAttributeView,
    selectValue,
    sortViewKey,
    textValue,
    updateAvCol,
    urlValue,
} from "./av-api";
import { fetchPageDescription, mapWithConcurrency } from "./web-desc";
import { BookmarkTagCategory, classifyBookmark, loadTagCategories, TAG_RULES_PATH } from "./bookmark-classify";

const RECORDS_FILE = "bookmark-sync-records.json";

/** 整理列时希望看到的目标列名 / 叫法 */
export const BOOKMARK_PK_NAME = "网站名";
export const BOOKMARK_TAGS_NAME = "标签";
/** 主键列还是这些「默认叫法」时才自动改名成网站名，自定义过的列名不动（3.2 模板叫「标题」，3.8 模板叫「主键」） */
const PK_DEFAULT_NAME_RE = /^\s*(标题|名称|主键|关键字|关键词|title|name|primary\s*key)\s*$/i;
/** 标签列名关键词（多选匹配 + 单选孤儿列识别共用；3.8 模板自带 select 列名叫「单选」） */
const TAG_NAME_RE = /标签|分类|目录|文件夹|单选|选择|tag|folder|categor|select/i;
/** 旧版插件遗留的「来源」文本列名 */
const SOURCE_NAME_RE = /^\s*(来源|source)\s*$/i;

/**
 * 浏览器导出的「默认容器」名称：这些层级对分类没有信息量，不打成标签。
 * 书签全散落在默认容器里时，退化为按主域名打标签（如 github.com）。
 */
const TRIVIAL_FOLDER_NAMES = new Set([
    "书签栏", "其他书签", "书签菜单", "书签提示栏", "移动端书签", "个人收藏", "收藏夹", "常用书签",
    "未分类", "未命名文件夹", "书签",
    "bookmarks bar", "bookmarks toolbar", "bookmarks menu", "other bookmarks", "mobile bookmarks",
    "favorites", "favorites bar", "other favorites", "mobile favorites", "bookmarks", "unfiled",
]);

/** 一条待同步书签 = 解析出的条目 + 所属来源名（仅用于展示与日志，不再入库） */
export interface SyncBookmark extends BookmarkEntry {
    source: string;
    /** 内容分类命中的标签（同步前按规则表填充，参与 hash：改规则 → hash 变 → 自动重刷标签） */
    categories?: string[];
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
    /** 描述为空时抓取目标网页的 <meta description> 填入（经内核网络代理） */
    fetchDescription: boolean;
}

export const DEFAULT_BOOKMARK_OPTIONS: BookmarkSyncOptions = {
    avID: "",
    blockID: "",
    dbName: "",
    savedFiles: [],
    incremental: true,
    removeMissing: false,
    syncTags: true,
    fetchDescription: true,
};

export interface BookmarkSyncRecord {
    url: string;
    title: string;
    hash: string;
    syncedAt: number;
    /** 上次抓到的网页描述（""=抓过但没抓到），避免每次同步重复访问 */
    webDesc?: string;
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

/** 书签内容 hash：标题 + 描述 + 文件夹路径 + 内容分类（URL 是身份，不参与） */
export function hashBookmark(entry: SyncBookmark, withTags: boolean): string {
    const tags = withTags ? `${entry.folderPath.join("/")}|${(entry.categories || []).join(",")}` : "";
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
 * 匹配不到进 missing，由「整理数据库列」一键补建。
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
        keys.find((k) => k.type === "mSelect" && TAG_NAME_RE.test(k.name || "")) ||
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

/**
 * 检测数据库列结构是否需要整理（同步前自动触发，也用于对话框展示）：
 * 缺列 / 主键还是模板默认叫法（3.2「标题」、3.8「主键」）/ 残留单选标签列 / 旧版遗留来源列
 */
export function detectTidyNeed(keys: AvKey[], wantTags: boolean): string[] {
    const reasons: string[] = [];
    const pk = keys.find((k) => k.type === "block") || null;
    if (pk && pk.name !== BOOKMARK_PK_NAME && (!pk.name || PK_DEFAULT_NAME_RE.test(pk.name))) {
        reasons.push(`主键「${pk.name || "（空）"}」待改名为「${BOOKMARK_PK_NAME}」`);
    }
    const cols = resolveColumns(keys, wantTags);
    if (cols.missing.length) reasons.push(`缺${cols.missing.map((m) => m.label).join("/")}列`);
    if (wantTags && keys.some((k) => k.type === "select" && TAG_NAME_RE.test(k.name || ""))) {
        reasons.push("存在单选标签列");
    }
    if (keys.some((k) => k.type === "text" && SOURCE_NAME_RE.test((k.name || "").trim()))) {
        reasons.push("存在旧版遗留「来源」列");
    }
    return reasons;
}

/**
 * 「整理数据库列」一键动作（幂等，可反复点，同步开始前也会自动执行一次）：
 *  1. 主键列改名为「网站名」（仅当它还叫「标题/主键」这类模板默认名时，自定义过的列名不动）
 *  2. 标签列：思源新建的数据库自带一个「标签」（3.2）/「单选」（3.8）**单选**列（这就是多余单选字段的来源）。
 *     没有多选标签列时，就把这个单选列原地转成「多选」（两者值都存在 mSelect 数组里，原有值不丢）；
 *     已有多选标签列、还残留叫「标签/单选」的单选孤儿列时，若它没有值就直接删除
 *  2b. 旧版插件遗留的「来源」文本列：整列没值就删除
 *  3. 补齐缺失列（网站链接 / 描述 / 标签）
 *  4. 当前视图的列顺序调整为：网站名 → 网站链接 → 标签 → 描述 → 其余列
 */
export async function tidyColumns(avID: string, blockID: string, wantTags: boolean): Promise<string[]> {
    const actions: string[] = [];
    if (!avID) throw new Error("请先选择目标数据库");
    let keys = await getAvKeys(avID);
    if (!keys.length) throw new Error("读取数据库列失败：请确认目标是一个数据库");

    // 1) 主键改名
    const pk = keys.find((k) => k.type === "block") || null;
    if (!pk) throw new Error("目标数据库没有主键（标题）列，无法自动整理");
    if (pk.name !== BOOKMARK_PK_NAME && (!pk.name || PK_DEFAULT_NAME_RE.test(pk.name))) {
        await updateAvCol(avID, pk.id, BOOKMARK_PK_NAME, "block");
        actions.push(`主键列「${pk.name || "（空）"}」已改名为「${BOOKMARK_PK_NAME}」`);
    }

    // 2) 标签列：单选转多选 / 删除孤儿单选列 / 缺失补建（关掉「写入标签」时一律不动）
    keys = await getAvKeys(avID);
    let tagsKey: AvKey | null = keys.find((k) => k.type === "mSelect" && TAG_NAME_RE.test(k.name || "")) || null;
    const straySelects = keys.filter(
        (k) => k.type === "select" && TAG_NAME_RE.test(k.name || "") && k.name !== BOOKMARK_PK_NAME
    );
    // 旧版插件遗留的「来源」文本列（现已不再写入），整列没值就顺手删掉
    const sourceStrays = keys.filter((k) => k.type === "text" && SOURCE_NAME_RE.test((k.name || "").trim()));
    if (wantTags) {
        if (!tagsKey && straySelects.length) {
            const conv = straySelects.shift() as AvKey;
            await updateAvCol(avID, conv.id, BOOKMARK_TAGS_NAME, "mSelect");
            tagsKey = { id: conv.id, name: BOOKMARK_TAGS_NAME, type: "mSelect" };
            actions.push(`单选列「${conv.name}」已原地转换为多选标签列（原有值保留）`);
        }
        if (!tagsKey && !keys.some((k) => k.type === "mSelect")) {
            await addAvKey(avID, blockID, { keyID: genAvID(), name: BOOKMARK_TAGS_NAME, type: "mSelect" });
            actions.push(`已新建多选列「${BOOKMARK_TAGS_NAME}」`);
        }
    }
    // 只删空孤儿列，有值的绝不动手，避免误删用户自己的数据（行数据读一次共用）
    let rowCache: AvRow[] | null = null;
    const columnEmpty = async (keyID: string): Promise<boolean> => {
        if (rowCache === null) {
            try {
                rowCache = await getAvRows(avID);
            } catch (e) {
                rowCache = null;
                return false; // 读不到就视为有值，不动手
            }
        }
        if (!rowCache) return false;
        for (const row of rowCache) {
            for (const v of row.values) {
                if (v.keyID === keyID && cellText(v)) return false;
            }
        }
        return true;
    };
    if (wantTags) {
        for (const s of straySelects) {
            if (await columnEmpty(s.id)) {
                await removeAvKey(avID, s.id);
                actions.push(`已删除多余的单选列「${s.name}」`);
            } else {
                actions.push(`单选列「${s.name}」里还有值，未删除（请确认后手工处理）`);
            }
        }
    }
    for (const s of sourceStrays) {
        if (await columnEmpty(s.id)) {
            await removeAvKey(avID, s.id);
            actions.push(`已删除旧版遗留的「${s.name}」列`);
        }
    }

    // 3) 补齐缺失列
    keys = await getAvKeys(avID);
    const cols = resolveColumns(keys, wantTags);
    if (cols.missing.length) {
        const created = await createMissingColumns(avID, blockID, cols.missing);
        actions.push(`已创建缺失列：${created.join("、")}`);
    }

    // 4) 列顺序：网站名 → 网站链接 → 标签 → 描述 → 其余列
    const finalKeys = await getAvKeys(avID);
    const finalCols = resolveColumns(finalKeys, wantTags);
    const order: string[] = [];
    const pushCol = (id?: string) => {
        if (id && !order.includes(id)) order.push(id);
    };
    pushCol(finalCols.name);
    pushCol(finalCols.url);
    pushCol(finalCols.tags);
    pushCol(finalCols.desc);
    for (const k of finalKeys) pushCol(k.id);
    let reorderErr = "";
    for (let i = 0; i < order.length; i++) {
        try {
            await sortViewKey(avID, blockID, order[i], i === 0 ? "" : order[i - 1]);
        } catch (e) {
            reorderErr = e instanceof Error ? e.message : String(e);
            break;
        }
    }
    if (reorderErr) {
        actions.push(`列顺序调整失败：${reorderErr}（可在数据库里拖列头手工排序）`);
    } else {
        actions.push(`列顺序已调整为「${BOOKMARK_PK_NAME} → 网站链接 → ${BOOKMARK_TAGS_NAME} → 描述」`);
    }
    return actions;
}

/** 按列类型构造一个单元格的值 */
function makeValue(keyID: string, columnType: string, content: string): AvValue {
    if (columnType === "url") return urlValue(keyID, content);
    if (columnType === "block") return blockValue(keyID, content);
    return textValue(keyID, content);
}

/**
 * 标签值组成（按序、去重、最多 4 个）：
 *  1. 内容分类命中项（bookmark-classify 规则表：工具 / 网盘 / 开发 / AI…，可改规则文件定制）
 *  2. 书签文件夹层级（跳过「书签栏」等浏览器默认容器，文件夹分类和用户自建习惯继续保留）
 *  3. 两者都没命中时退回主域名兜底，保证「自动分类」总是有得选
 */
function tagItems(entry: SyncBookmark): { content: string; color?: string }[] {
    const items: { content: string; color?: string }[] = [];
    const added = new Set<string>();
    const push = (name: string) => {
        const t = (name || "").trim();
        if (!t || added.has(t) || items.length >= 4) return;
        added.add(t);
        items.push({ content: t, color: optionColor(t) });
    };
    for (const c of entry.categories || []) push(c);
    for (const seg of entry.folderPath) {
        if (TRIVIAL_FOLDER_NAMES.has((seg || "").trim().toLowerCase())) continue;
        push(seg);
    }
    if (!items.length) {
        try {
            const host = new URL(entry.url).hostname.replace(/^www\./i, "");
            if (host) push(host);
        } catch (e) {
            /* URL 异常时不打标签 */
        }
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
        let keys = await getAvKeys(options.avID);
        if (!keys.length) throw new Error("读取数据库列失败：请确认目标是一个数据库，且当前账号可编辑");
        let cols = resolveColumns(keys, options.syncTags);
        if (!cols.name) throw new Error("目标数据库缺少主键（标题）列，请检查数据库结构");

        // ---------- 列结构不完整时自动整理一次（3.8 新库自带「主键」+「单选」模板列，不再要求手动点按钮） ----------
        let forceFullRewrite = false;
        const tidyReasons = detectTidyNeed(keys, options.syncTags);
        if (tidyReasons.length) {
            log(`列结构需要整理（${tidyReasons.join("；")}），自动整理中...`);
            const tidyActions = await tidyColumns(options.avID, options.blockID, options.syncTags);
            for (const action of tidyActions) log(`  · ${action}`);
            forceFullRewrite = tidyActions.some((a) => /已改名|已原地转换|已新建|已删除|已创建缺失/.test(a));
            if (forceFullRewrite) {
                keys = await getAvKeys(options.avID);
                cols = resolveColumns(keys, options.syncTags);
                log("列结构已变化：本次跳过增量判断，全量重写一遍，把标签 / 描述回填到所有已有行。");
            }
        }
        if (!cols.url) throw new Error('目标数据库缺少「网站链接」列：点「整理数据库列」一键补建');

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

        // ---------- 内容自动分类：按规则表（工作区可编辑）给每条书签打分类标签，先于 hash ----------
        if (options.syncTags && entries.length) {
            const categories: BookmarkTagCategory[] = await loadTagCategories(log);
            for (const entry of entries) {
                let host = "";
                try {
                    host = new URL(entry.url).hostname;
                } catch (e) {
                    host = "";
                }
                entry.categories = classifyBookmark(host, entry.title, categories);
            }
            const hit = entries.filter((x) => x.categories && x.categories.length).length;
            log(`内容分类命中 ${hit}/${entries.length} 条（规则文件 ${TAG_RULES_PATH}，可直接编辑定制）。`);
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
                if (!forceFullRewrite && options.incremental && record && record.hash === hash) {
                    summary.skipped++;
                    continue;
                }
                toUpdate.push({ entry, key, itemID });
            } else {
                toCreate.push({ entry, key });
            }
        }

        // ---------- 网页描述抓取：只处理「即将写入且来源没带描述」的条目 ----------
        /** key -> 本次可用的网页描述（含上次已抓到的复用） */
        const webDesc = new Map<string, string>();
        if (options.fetchDescription && cols.desc) {
            const queued = new Set<string>();
            const queue: { key: string; url: string }[] = [];
            for (const item of [...toCreate, ...toUpdate]) {
                if (item.entry.description || queued.has(item.key)) continue;
                const prev = this.records[item.key]?.webDesc;
                if (prev !== undefined) {
                    if (prev) webDesc.set(item.key, prev); // 上次抓到过：复用，不再访问
                    continue;                              // prev === ""：上次抓过没抓到，本次不重试
                }
                queued.add(item.key);
                queue.push({ key: item.key, url: item.entry.url });
            }
            if (queue.length) {
                log(`抓取网页描述：${queue.length} 条（8 并发，超时/失败静默跳过）...`);
                let got = 0;
                await mapWithConcurrency(queue, 8, async (q) => {
                    const text = await fetchPageDescription(q.url);
                    webDesc.set(q.key, text); // 失败也记 ""，标记为已尝试
                    if (text) got++;
                });
                log(`网页描述：成功 ${got} 条，${queue.length - got} 条未取到（不会写空覆盖已有描述）`);
            }
        }
        /** 单元格生效的描述：导出文件自带 > 抓取的网页 meta > 书签标题兜底（不少站点是 JS 壳页没有 meta，永不留空） */
        const effDesc = (key: string, entry: SyncBookmark): string => entry.description || webDesc.get(key) || entry.title;
        /** 组装同步记录（带上网页描述缓存） */
        const mkRecord = (key: string, entry: SyncBookmark, now: number): BookmarkSyncRecord => {
            const rec: BookmarkSyncRecord = {
                url: entry.url,
                title: entry.title,
                hash: hashBookmark(entry, options.syncTags),
                syncedAt: now,
            };
            const wd = webDesc.get(key) ?? this.records[key]?.webDesc;
            if (wd !== undefined) rec.webDesc = wd;
            return rec;
        };

        const totalWork = toCreate.length + toUpdate.length;
        let done = 0;
        const progress = () => onProgress?.(done, totalWork);
        progress();

        // ---------- 新增：批量追加独立行 ----------
        const createRows = (list: { entry: SyncBookmark; key: string }[]): AvValue[][] =>
            list.map(({ entry, key }) => {
                const values: AvValue[] = [blockValue(cols.name, entry.title)];
                values.push(makeValue(cols.url, cols.types[cols.url] || "url", entry.url));
                const desc = effDesc(key, entry);
                if (cols.desc && desc) values.push(textValue(cols.desc, desc));
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
                    this.records[item.key] = mkRecord(item.key, item.entry, now);
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
                if (cols.desc) {
                    // 空描述不覆盖已有单元格（可能存着上次抓到的网页描述）
                    const desc = effDesc(item.key, item.entry);
                    if (desc) cells.push({ keyID: cols.desc, itemID: item.itemID, value: textValue(cols.desc, desc) });
                }
                if (cols.tags && options.syncTags) {
                    cells.push({ keyID: cols.tags, itemID: item.itemID, value: selectValue(cols.tags, tagItems(item.entry)) });
                }
            }
            // 本批没有任何要写的单元格（例如仅映射了链接列且标题未变）：直接刷新记录即可
            if (!cells.length) {
                const now = Date.now();
                for (const item of chunk) {
                    summary.skipped++;
                    this.records[item.key] = mkRecord(item.key, item.entry, now);
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
                    this.records[item.key] = mkRecord(item.key, item.entry, now);
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
