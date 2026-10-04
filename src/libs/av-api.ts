/*
 * 思源内核「数据库（属性视图 Attribute View）」接口封装
 *
 * 接口路由以前缀 /api/av/ 为准（内核 kernel/api/router.go）。
 * 统一用 fetchSyncPost 并在 code != 0 时抛错，避免失败被 request() 静默吞成 null。
 */

import { fetchSyncPost } from "siyuan";

// ------------------------------ 类型（对齐内核 apicontract） ------------------------------

export interface AvKey {
    id: string;
    name: string;
    /** block | text | number | date | select | mSelect | url | email | phone | mAsset | ... */
    type: string;
    icon?: string;
    desc?: string;
    options?: { name: string; color?: string }[];
}

export interface AvValue {
    id?: string;
    keyID?: string;
    blockID?: string;
    type?: string;
    isDetached?: boolean;
    createdAt?: number;
    updatedAt?: number;
    block?: { id?: string; icon?: string; content?: string };
    text?: { content?: string };
    /** 新版内核只有 content；旧版还有 url 字段，写入时两者都带以兼容 */
    url?: { content?: string; url?: string };
    /** 单选 / 多选的值都存放在 mSelect 数组里 */
    mSelect?: { content?: string; color?: string }[];
}

export interface AvSearchResult {
    avID: string;
    avName?: string;
    blockID?: string;
    hPath?: string;
    viewID?: string;
    viewName?: string;
    viewLayout?: string;
    children?: AvSearchResult[];
}

/** 一条数据库行（表格=行 / 画廊看板=卡片），cells 已展开成 AVValue 列表 */
export interface AvRow {
    itemID: string;
    values: AvValue[];
}

// ------------------------------ 基础请求 ------------------------------

async function avRequest<T>(url: string, data: any): Promise<T> {
    let resp: any;
    try {
        resp = await fetchSyncPost(url, data);
    } catch (e) {
        throw new Error(`请求 ${url} 失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!resp) {
        throw new Error(`接口 ${url} 无响应`);
    }
    if (resp.code !== 0) {
        throw new Error(`接口 ${url} 报错：${resp.msg || "未知错误"}`);
    }
    return resp.data as T;
}

/** 生成思源风格的块/字段 ID（时间戳 + 随机段） */
export function genAvID(): string {
    const d = new Date();
    const p = (n: number, len = 2) => String(n).padStart(len, "0");
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const rand = Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, "0");
    return `${stamp}-${rand}`;
}

// ------------------------------ 读 ------------------------------

/** 按名称搜索数据库；keyword 留空返回全部。返回拍平（去掉视图 children 嵌套） */
export async function searchAttributeViews(keyword: string): Promise<AvSearchResult[]> {
    const data = await avRequest<any>("/api/av/searchAttributeView", { keyword: keyword || "" });
    const out: AvSearchResult[] = [];
    const walk = (items: any[]) => {
        for (const item of items || []) {
            if (item?.avID) out.push(item as AvSearchResult);
            if (item?.children?.length) walk(item.children);
        }
    };
    walk((data && (data as any).results) || []);
    return out;
}

/** 读取数据库的列定义（字段名 / 类型 / 选项） */
export async function getAvKeys(avID: string): Promise<AvKey[]> {
    const data = await avRequest<any>("/api/av/getAttributeViewKeysByAvID", { avID });
    if (Array.isArray(data)) return data as AvKey[];
    // 不同版本可能包一层 { keys: [...] }
    const keys = data?.keys ?? data?.keyValues;
    if (Array.isArray(keys)) {
        return keys.map((k: any) => (k.key ? k.key : k)) as AvKey[];
    }
    return [];
}

/** 渲染数据库视图（分页）；不传 viewID 时用当前视图 */
export function renderAttributeView(avID: string, blockID: string, page: number, pageSize: number): Promise<any> {
    const payload: any = { id: avID, page, pageSize };
    if (blockID) payload.blockID = blockID;
    return avRequest<any>("/api/av/renderAttributeView", payload);
}

/**
 * 读取数据库原始数据（全部 keyValues，不受视图筛选 / 分组 / 分页影响）。
 * 返回按行（itemID=blockID）聚合后的值列表；
 * 接口结构不符合预期时返回 null（由调用方回退 renderAttributeView 分页）。
 */
export async function getAvRows(avID: string): Promise<AvRow[] | null> {
    const data = await avRequest<any>("/api/av/getAttributeView", { id: avID });
    const keyValues = data?.av?.keyValues ?? data?.keyValues;
    if (!Array.isArray(keyValues)) return null;
    const byRow = new Map<string, AvValue[]>();
    for (const kv of keyValues) {
        const values = kv?.values;
        if (!Array.isArray(values)) continue;
        for (const v of values) {
            if (!v) continue;
            const itemID = v.blockID || v.itemID || "";
            if (!itemID) continue;
            if (!byRow.has(itemID)) byRow.set(itemID, []);
            byRow.get(itemID)!.push(v as AvValue);
        }
    }
    return Array.from(byRow.entries()).map(([itemID, values]) => ({ itemID, values }));
}

/**
 * 把 renderAttributeView 的返回拍平成行列表。
 * 兼容：表格 rows / 分组 groups（递归）/ 画廊看板 cards；单元格 cells 或 values。
 */
export function collectAvRows(rendered: any): AvRow[] {
    const out: AvRow[] = [];
    const pushRow = (row: any) => {
        if (!row) return;
        const itemID = row.id || row.blockID || row.itemID || "";
        const raw = row.cells ?? row.values ?? [];
        const values: AvValue[] = [];
        for (const cell of raw) {
            const value: any = cell && cell.value ? cell.value : cell;
            if (value && (value.keyID || value.type)) values.push(value as AvValue);
        }
        if (itemID) out.push({ itemID, values });
    };
    const walk = (view: any) => {
        if (!view || typeof view !== "object") return;
        if (Array.isArray(view.rows)) for (const row of view.rows) pushRow(row);
        if (Array.isArray(view.cards)) for (const card of view.cards) pushRow(card);
        if (Array.isArray(view.groups)) for (const group of view.groups) walk(group);
    };
    walk(rendered?.av ?? rendered);
    return out;
}

// ------------------------------ 写 ------------------------------

/** 值构造：主键（block 列）标题 */
export function blockValue(keyID: string, content: string): AvValue {
    return { keyID, type: "block", block: { content } };
}

/** 值构造：文本列 */
export function textValue(keyID: string, content: string): AvValue {
    return { keyID, type: "text", text: { content } };
}

/** 值构造：链接列（同时写 content 与旧版 url 字段，内核按版本取用） */
export function urlValue(keyID: string, href: string): AvValue {
    return { keyID, type: "url", url: { content: href, url: href } };
}

/** 值构造：单选 / 多选列（选项不存在时内核按 content 自动创建） */
export function selectValue(keyID: string, items: { content: string; color?: string }[]): AvValue {
    return { keyID, type: "mSelect", mSelect: items };
}

/** 从行的某个单元格读出文本内容（url 列优先，兼容旧版 url 字段） */
export function cellText(value: AvValue | undefined): string {
    if (!value) return "";
    if (value.url?.content || (value.url as any)?.url) return (value.url?.content || (value.url as any).url) as string;
    if (value.text?.content) return value.text.content;
    if (value.block?.content) return value.block.content;
    if (Array.isArray(value.mSelect)) return value.mSelect.map((s) => s.content || "").filter(Boolean).join(",");
    if ((value as any).number?.isNotEmpty) return String((value as any).number.content ?? "");
    return "";
}

/** 追加「独立行（detached）」，一次一批，每行是若干列的值 */
export async function appendDetachedRows(avID: string, rows: AvValue[][]): Promise<void> {
    await avRequest("/api/av/appendAttributeViewDetachedBlocksWithValues", { avID, blocksValues: rows });
}

/** 批量更新单元格：每项 {keyID, itemID, value}（内核要求的字段名是 rowID） */
export async function batchSetCells(
    avID: string,
    updates: { keyID: string; itemID: string; value: AvValue }[]
): Promise<void> {
    await avRequest("/api/av/batchSetAttributeViewBlockAttrs", {
        avID,
        values: updates.map((u) => ({ keyID: u.keyID, rowID: u.itemID, value: u.value })),
    });
}

/** 删除行：srcIDs 传 itemID（或绑定的块 ID） */
export async function removeAvBlocks(avID: string, srcIDs: string[]): Promise<void> {
    await avRequest("/api/av/removeAttributeViewBlocks", { avID, srcIDs });
}

/** 新增一列（previousKeyID 传 "" 时表格视图会插到最前，重排交给整理列流程统一处理） */
export async function addAvKey(
    avID: string,
    blockID: string,
    opts: { keyID: string; name: string; type: string; icon?: string; previousKeyID?: string }
): Promise<void> {
    const payload: any = {
        avID,
        keyID: opts.keyID,
        keyName: opts.name,
        keyType: opts.type,
        keyIcon: opts.icon || "",
        previousKeyID: opts.previousKeyID || "",
    };
    if (blockID) payload.blockID = blockID;
    await avRequest("/api/av/addAttributeViewKey", payload);
}

/** 删除一列（连同该列所有单元格的值一并删除） */
export async function removeAvKey(avID: string, keyID: string): Promise<void> {
    await avRequest("/api/av/removeAttributeViewKey", { avID, keyID });
}

/**
 * 修改列名 / 列类型（改列名没有独立的 av 路由，走 /api/transactions 的 updateAttrViewCol）。
 * 单选列与多选列的值都存放在 mSelect 数组里，select ↔ mSelect 互换时原有值会被保留。
 */
export async function updateAvCol(avID: string, keyID: string, name: string, type: string): Promise<void> {
    await avRequest("/api/transactions", {
        reqId: Date.now(),
        original: "",
        app: "siyuan-desktop",
        session: "bookmark-sync",
        transactions: [
            {
                doOperations: [
                    { action: "updateAttrViewCol", data: null, id: keyID, keyID, avID, name, type },
                ],
                undoOperations: null,
            },
        ],
    });
}

/**
 * 调整视图列顺序：把 keyID 移动到 previousKeyID 之后；previousKeyID 传 "" = 放到第一列。
 * 注意：内核把这里的 viewID 参数当作「数据库块 ID」去解析所在视图（kernel/api/av.go），
 * 传块 ID 可精确定位当前浏览的视图；传空则退化为数据库记录的当前视图。
 */
export async function sortViewKey(avID: string, blockID: string, keyID: string, previousKeyID: string): Promise<void> {
    const payload: any = { avID, keyID, previousKeyID };
    if (blockID) payload.viewID = blockID;
    await avRequest("/api/av/sortAttributeViewViewKey", payload);
}
