/*
 * 抓取网页描述（<meta name="description">，og / twitter description 兜底）
 *
 * 书签导出文件里的 <DD> 描述大多数浏览器根本不写，所以描述列改从目标网页抓取。
 * 插件在浏览器沙箱里直接 fetch 任意网站会被 CORS 拦截，统一走内核的
 * /api/network/forwardProxy（与飞书模块同一通道，Docker / 移动端都能用）。
 * 任何失败（超时、非 200、没有 meta）都安静地返回空串，不影响同步主流程。
 */

import { forwardProxy } from "./feishu-api";

/** description 基本都在 <head> 里，只扫描响应体前段，避免解析超大页面 */
const MAX_SCAN = 256 * 1024;
/** 描述单元格内容长度上限（思源单元格超长文本会影响表格渲染） */
const MAX_LEN = 300;
/** 单页抓取超时（毫秒） */
const TIMEOUT = 12000;

/** 模拟常见浏览器 UA，减少被反爬墙直接拒掉的概率 */
const USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 按优先级匹配的 meta 键名 */
const DESC_KEYS = ["description", "og:description", "twitter:description"];

function decodeBase64Text(base64: string): string {
    try {
        const binary = atob(base64 || "");
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    } catch (e) {
        return "";
    }
}

/** 常见 HTML 实体的最小解码（描述里出现频率最高的几个 + 数字实体） */
function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&nbsp;/gi, " ")
        .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
        })
        .replace(/&#(\d+);/g, (_m, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
        });
}

/** 解析单个 <meta> 标签的属性（属性名 -> 值，值支持双引号/单引号/裸值） */
function parseAttrs(tag: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tag))) {
        const name = m[1].toLowerCase();
        attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    }
    return attrs;
}

/** 从 HTML 前段提取 description：普通 description > og:description > twitter:description */
export function extractDescription(html: string): string {
    const found: Partial<Record<string, string>> = {};
    const re = /<meta\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
        const attrs = parseAttrs(m[0]);
        const key = (attrs.name || attrs.property || attrs.itemprop || "").toLowerCase();
        const content = (attrs.content || "").trim();
        if (!key || !content) continue;
        if (DESC_KEYS.includes(key) && !found[key]) {
            found[key] = content;
            if (found[DESC_KEYS[0]]) break; // 拿到标准 description 就够了
        }
    }
    for (const key of DESC_KEYS) {
        if (found[key]) return found[key];
    }
    return "";
}

/** 抓取单个页面的描述；失败返回空串 */
export async function fetchPageDescription(url: string): Promise<string> {
    if (!/^https?:\/\//i.test((url || "").trim())) return "";
    try {
        const resp = await forwardProxy(url, {
            method: "GET",
            timeout: TIMEOUT,
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml;q=0.9,*;q=0.8",
            },
            contentType: "text/html,application/xhtml+xml",
            responseEncoding: "text",
        });
        if (resp.status < 200 || 300 <= resp.status) return "";
        let body = resp.body || "";
        if (resp.bodyEncoding === "base64") body = decodeBase64Text(body);
        if (!body) return "";
        const head = body.length > MAX_SCAN ? body.slice(0, MAX_SCAN) : body;
        const desc = extractDescription(head).replace(/\s+/g, " ").trim();
        if (!desc) return "";
        return desc.length > MAX_LEN ? `${desc.slice(0, MAX_LEN - 1)}…` : desc;
    } catch (e) {
        return "";
    }
}

/** 小并发池：limit 个 worker 依次领任务；fn 内部不应抛错 */
export async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    if (!items.length) return;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor++];
            await fn(item);
        }
    });
    await Promise.all(workers);
}
