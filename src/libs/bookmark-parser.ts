/*
 * 浏览器书签导出文件解析（Netscape Bookmark File Format）
 *
 * Chrome / Edge / Firefox / Safari 的「导出书签」都会生成这种 HTML：
 *   <DT><H3>文件夹名</H3>      → 文件夹，其内容跟在后面的 <DL> 里
 *   <DT><A HREF="...">标题</A> → 书签条目
 *   <DD>描述文字               → 上一条书签的描述（可选）
 *
 * 用浏览器原生 DOMParser 在内存中解析，不依赖内核文件接口，
 * 因此 Docker / 浏览器 / 移动端前端都能使用。
 */

export type BookmarkNode = BookmarkFolder | BookmarkEntry;

/** 一条书签 */
export interface BookmarkEntry {
    kind: "entry";
    /** 书签标题；导出文件里标题为空时用域名兜底 */
    title: string;
    url: string;
    /** 描述（<DD>，可能为空） */
    description: string;
    /** 所在文件夹路径（顶层容器也算第一段），用作「标签」列 */
    folderPath: string[];
    /** ADD_DATE 秒级时间戳，取不到为 0 */
    addDate: number;
}

/** 一个书签文件夹 */
export interface BookmarkFolder {
    kind: "folder";
    title: string;
    /** 含自身的完整路径 */
    path: string[];
    children: BookmarkNode[];
}

/** 一个解析完成的书签文件（= 一个浏览器的导出） */
export interface BookmarkFile {
    /** 来源名（默认取文件名），写入「来源」列并参与增量匹配 */
    source: string;
    /** 顶层节点（书签栏 / 其他书签 / 菜单 等） */
    roots: BookmarkNode[];
    /** 有效书签条数（过滤与去重后） */
    entryCount: number;
    /** 被过滤掉的条目数（javascript: / place: 等伪协议、空链接） */
    skipped: number;
    /** 同一来源内 URL 重复而被丢弃的条目数 */
    duplicated: number;
}

/** 无法同步的伪协议 / 特殊链接（Firefox 的 place: 书签、剪贴的脚本等） */
const IGNORED_SCHEMES = /^(javascript|data|place|about|blob|resource):/i;

/** 折叠空白（描述取 <DD> 的整段文字，导出文件里常有多余换行缩进） */
function cleanText(text: string): string {
    return (text || "").replace(/\s+/g, " ").trim();
}

function parseTime(value: string | null): number {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** 从元素里找指定直接子标签（HTML 解析后标签名大小写不定，统一转大写比较） */
function firstTagChild(el: Element, tag: string): Element | null {
    for (const child of Array.from(el.children)) {
        if (child.tagName.toUpperCase() === tag) return child;
    }
    return null;
}

/**
 * URL 归一化：同步记录与数据库行都按它匹配。
 * scheme 与主机名小写、去掉默认端口、去掉单个尾部斜杠与空 fragment，
 * path / query 保留大小写（它们区分大小写）。
 */
export function normalizeUrlKey(raw: string): string {
    const text = (raw || "").trim();
    if (!text) return "";
    try {
        const url = new URL(text);
        const scheme = url.protocol.toLowerCase();
        const host = url.hostname.toLowerCase();
        let port = "";
        if ((scheme === "http:" && url.port !== "80") || (scheme === "https:" && url.port !== "443")) {
            port = ":" + url.port;
        }
        let path = url.pathname;
        if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
        const query = url.search;
        const hash = url.hash === "#" ? "" : url.hash;
        return `${scheme}//${host}${port}${path}${query}${hash}`;
    } catch (e) {
        // 非标准 URL（少见）：原样小写比较
        return text.toLowerCase();
    }
}

/** 域名兜底标题 */
function hostFallbackTitle(url: string): string {
    try {
        return new URL(url).hostname || url;
    } catch (e) {
        return url;
    }
}

interface ParseContext {
    skipped: number;
    duplicated: number;
    seen: Set<string>;
    accepted: number;
}

/** 解析一个 <DL> 下的 DT/DD 序列，folderPath 为所在文件夹链 */
function walkDl(dl: Element, folderPath: string[], ctx: ParseContext): BookmarkNode[] {
    const nodes: BookmarkNode[] = [];
    let lastEntry: BookmarkEntry | null = null;
    const kids = Array.from(dl.children);

    for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        const tag = el.tagName.toUpperCase();

        if (tag === "DT") {
            lastEntry = null;
            const h3 = firstTagChild(el, "H3");
            const a = firstTagChild(el, "A");

            if (h3) {
                const title = cleanText(h3.textContent || "") || "未命名文件夹";
                const folder: BookmarkFolder = {
                    kind: "folder",
                    title,
                    path: [...folderPath, title],
                    children: [],
                };
                // 文件夹内容：标准导出是「紧跟本 DT 之后的兄弟 DL」；
                // 少数导出器把 DL 嵌在 DT 内部（H3 之后），两种都支持
                const innerDl = firstTagChild(el, "DL");
                if (innerDl) {
                    folder.children = walkDl(innerDl, folder.path, ctx);
                } else {
                    for (let j = i + 1; j < kids.length; j++) {
                        const nextTag = kids[j].tagName.toUpperCase();
                        if (nextTag === "DL") {
                            folder.children = walkDl(kids[j], folder.path, ctx);
                            break;
                        }
                        if (nextTag === "DT") break;
                    }
                }
                nodes.push(folder);
            } else if (a) {
                const entry = toEntry(a, folderPath, ctx);
                if (entry) {
                    nodes.push(entry);
                    lastEntry = entry;
                }
            }
        } else if (tag === "DD" && lastEntry) {
            const text = cleanText(el.textContent || "");
            if (text) {
                lastEntry.description = (lastEntry.description ? lastEntry.description + " " : "") + text;
            }
        }
    }
    return nodes;
}

/** 把一个 <A> 转成书签条目；不可同步或重复的返回 null 并计数 */
function toEntry(a: Element, folderPath: string[], ctx: ParseContext): BookmarkEntry | null {
    const url = (a.getAttribute("href") || "").trim();
    if (!url || IGNORED_SCHEMES.test(url) || !/^https?:|^ftp:/i.test(url)) {
        ctx.skipped++;
        return null;
    }
    const key = normalizeUrlKey(url);
    if (ctx.seen.has(key)) {
        ctx.duplicated++;
        return null;
    }
    ctx.seen.add(key);
    ctx.accepted++;
    const title = cleanText(a.textContent || "") || hostFallbackTitle(url);
    return {
        kind: "entry",
        title,
        url,
        description: cleanText(a.getAttribute("description") || ""),
        folderPath,
        addDate: parseTime(a.getAttribute("add_date")),
    };
}

/**
 * 解析一份浏览器导出的书签 HTML。
 * @param html 文件内容
 * @param source 来源名（浏览器 / 文件名）
 */
export function parseBookmarkHtml(html: string, source: string): BookmarkFile {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    const rootDl = doc.querySelector("dl");
    if (!rootDl) {
        throw new Error("文件中没有找到书签列表（<DL>），请确认这是浏览器「导出书签」生成的 HTML 文件");
    }
    const ctx: ParseContext = { skipped: 0, duplicated: 0, seen: new Set(), accepted: 0 };
    let roots = walkDl(rootDl, [], ctx);

    // 顶层直接是散落书签（不规范导出）时，包一个「未分类」文件夹方便勾选
    const loose = roots.filter((n): n is BookmarkEntry => n.kind === "entry");
    if (loose.length) {
        const folders = roots.filter((n): n is BookmarkFolder => n.kind === "folder");
        folders.push({ kind: "folder", title: "未分类", path: ["未分类"], children: loose });
        roots = folders;
    }

    return {
        source: cleanText(source) || "书签",
        roots,
        entryCount: ctx.accepted,
        skipped: ctx.skipped,
        duplicated: ctx.duplicated,
    };
}

/** 递归收集节点下的全部书签条目（勾选某个文件夹 = 同步它下面的所有书签） */
export function collectEntries(node: BookmarkNode, out: BookmarkEntry[] = []): BookmarkEntry[] {
    if (node.kind === "entry") {
        out.push(node);
        return out;
    }
    for (const child of node.children) {
        collectEntries(child, out);
    }
    return out;
}

/** 统计节点下的书签条数（文件夹显示数量用） */
export function countEntries(node: BookmarkNode): number {
    return collectEntries(node).length;
}
