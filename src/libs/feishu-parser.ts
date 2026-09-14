/*
 * 飞书新版文档（docx）块结构 -> Markdown 转换
 *
 * 参考：https://open.feishu.cn/document/docs/docs/data-structure/block
 */

import { FeishuBlock, FeishuTextElement } from "./feishu-api";

/** block_type 对应的文本块字段名 */
const TEXT_BLOCK_KEYS: Record<number, string> = {
    1: "page",
    2: "text",
    3: "heading1",
    4: "heading2",
    5: "heading3",
    6: "heading4",
    7: "heading5",
    8: "heading6",
    9: "heading7",
    10: "heading8",
    11: "heading9",
    12: "bullet",
    13: "ordered",
    14: "code",
    15: "quote",
    17: "todo",
};

/** 代码块语言枚举（飞书 CodeLanguage） */
const CODE_LANGUAGE: Record<number, string> = {
    1: "plaintext", 2: "abap", 3: "ada", 4: "apache", 5: "apex", 6: "assembly",
    7: "bash", 8: "csharp", 9: "cpp", 10: "c", 11: "cobol", 12: "css",
    13: "coffeescript", 14: "d", 15: "dart", 16: "delphi", 17: "django",
    18: "dockerfile", 19: "erlang", 20: "fortran", 21: "foxpro", 22: "go",
    23: "groovy", 24: "html", 25: "htmlbars", 26: "http", 27: "haskell",
    28: "json", 29: "java", 30: "javascript", 31: "julia", 32: "kotlin",
    33: "latex", 34: "lisp", 35: "logo", 36: "lua", 37: "matlab", 38: "makefile",
    39: "markdown", 40: "nginx", 41: "objectivec", 42: "openedge", 43: "php",
    44: "perl", 45: "postscript", 46: "powershell", 47: "prolog", 48: "protobuf",
    49: "python", 50: "r", 51: "rpg", 52: "ruby", 53: "rust", 54: "sas",
    55: "scss", 56: "sql", 57: "scala", 58: "scheme", 59: "scratch", 60: "shell",
    61: "swift", 62: "thrift", 63: "typescript", 64: "vbscript", 65: "vb",
    66: "xml", 67: "yaml", 68: "cmake", 69: "diff", 70: "gherkin", 71: "graphql",
    72: "glsl", 73: "properties", 74: "solidity", 75: "toml",
};

export interface ParseContext {
    /** 图片块 -> 思源资源相对路径，返回 null 表示未能本地化 */
    resolveImage?: (block: FeishuBlock) => Promise<string | null>;
    /** 附件块 -> 思源资源相对路径，返回 null 表示未能本地化 */
    resolveFile?: (block: FeishuBlock) => Promise<string | null>;
    /** 进度回调 */
    onProgress?: (message: string) => void;
}

interface ParserState {
    ctx: ParseContext;
    map: Map<string, FeishuBlock>;
    /** 已渲染过的块，用于兜底补渲染 */
    visited: Set<string>;
}

/**
 * 转义会破坏 Markdown 语法的字符：
 * - `\`、`` ` ``、`*`、`_`、`$`、`|`
 * - 其中 `$` 必须转义，否则正文里的金额等 `$` 会与公式的 `$` 错误配对
 * - `*`/`_` 转义后可避免 `a*b*c` 这类文本被误判为强调
 */
function escapeMd(text: string): string {
    return (text || "")
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\*/g, "\\*")
        .replace(/_/g, "\\_")
        .replace(/\$/g, "\\$")
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, " ");
}

/** 飞书颜色枚举 -> 思源字体色/背景色变量序号（思源为 1~13） */
function colorIndex(value: any): number {
    const n = Number(value) || 0;
    if (n <= 0) return 0;
    return Math.min(13, Math.max(1, n));
}

/**
 * 渲染行内公式。
 * Lute 默认不允许 `$` 后紧跟数字（避免把 $100 当公式），此时内侧补一个空格即可正常解析。
 */
function renderInlineMath(content: string): string {
    const formula = (content || "").replace(/\s*\n\s*/g, " ").trim();
    if (!formula) return "";
    return /^\d/.test(formula) ? `$ ${formula} $` : `$${formula}$`;
}

/** 转义 HTML 属性值（URL 里的引号与 & 会破坏行内元素结构） */
function escapeHtmlAttr(value: string): string {
    return (value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * 渲染一段带样式的文本，统一使用思源原生的行内元素（TextMark）：
 * - 加粗：`<span data-type="strong"></span>`
 * - 斜体：`<span data-type="em"></span>`
 * - 删除线：`<span data-type="s"></span>`
 * - 高亮/着色：`<span data-type="text" style="background-color: var(--b3-font-background11);"></span>`
 *
 * 不再使用 `**`/`*`/`~~`：Markdown 标记紧邻 HTML 或标点（如 `**[text](url)**`）时不会被解析，
 * 带颜色、链接的文字会丢掉加粗/斜体等样式；思源行内元素则可任意叠加（data-type 用空格分隔）。
 */
function renderTextRun(core: string, style: any): string {
    if (style.inline_code) {
        // 行内代码是字面内容，不能再套行内元素
        return "`" + escapeMd(core) + "`";
    }

    const types: string[] = [];
    if (style.bold) types.push("strong");
    if (style.italic) types.push("em");
    if (style.strikethrough) types.push("s");

    const css: string[] = [];
    const textColor = colorIndex(style.text_color);
    if (textColor) css.push(`color: var(--b3-font-color${textColor})`);
    const bgColor = colorIndex(style.background_color);
    if (bgColor) css.push(`background-color: var(--b3-font-background${bgColor})`);

    let url = "";
    if (style.link?.url) {
        try { url = decodeURIComponent(style.link.url); } catch (e) { url = style.link.url; }
    }

    if (!types.length && !css.length) {
        // 没有需要行内元素承载的样式：下划线用 <u>，链接保持 Markdown 写法
        let text = escapeMd(core);
        if (style.underline) text = `<u>${text}</u>`;
        if (url) text = `[${text}](${url})`;
        return text;
    }

    // 下划线一并放进 data-type：行内元素内再嵌套行内元素会被当作字面文本
    if (style.underline) types.push("u");
    // 只有颜色/背景色时由 text 标记承载
    if (css.length && !types.length) types.push("text");
    // 链接叠加其它样式时用思源原生写法，否则 `[text](url)` 会被当作字面文本
    if (url) types.unshift("a");

    const attrs = [`data-type="${types.join(" ")}"`];
    if (css.length) attrs.push(`style="${css.join("; ")};"`);
    if (url) attrs.push(`data-href="${escapeHtmlAttr(url)}"`);
    // 行内元素内的文本是字面内容，不能再做 Markdown 转义（否则会多出 `\`）；
    // 只有 u 标记会把内容再按行内 Markdown 解析一次，这时仍需转义
    const body = types.length === 1 && types[0] === "u" ? escapeMd(core) : core;
    return `<span ${attrs.join(" ")}>${body}</span>`;
}

function inlineFrom(elements: FeishuTextElement[] | undefined): string {
    if (!elements || !elements.length) return "";
    let out = "";
    for (const el of elements) {
        if (!el) continue;
        if (el.text_run) {
            // 行内元素与链接都不能跨行，先把换行压成空格
            const raw = (el.text_run.content || "").replace(/\r?\n/g, " ");
            if (!raw) continue;
            // 先把首尾空白摘出来，最后再拼回去：
            // 思源解析行内元素时会把内容 TrimSpace（空白外提为相邻文本），保持原样可避免少空格
            const matched = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
            const lead = matched ? matched[1] : "";
            const tail = matched ? matched[3] : "";
            const core = matched ? matched[2] : raw;
            if (!core) {
                out += raw;
                continue;
            }
            out += lead + renderTextRun(core, el.text_run.text_element_style || {}) + tail;
        } else if (el.equation) {
            out += renderInlineMath(el.equation.content || "");
        } else if (el.mention_user) {
            out += `@${el.mention_user.name || el.mention_user.user_id || "user"}`;
        } else if (el.mention_doc) {
            const title = el.mention_doc.title || el.mention_doc.token || "文档";
            let url = el.mention_doc.url || "";
            try { url = url ? decodeURIComponent(url) : ""; } catch (e) { /* ignore */ }
            out += url ? `[${escapeMd(title)}](${url})` : escapeMd(title);
        } else if (el.file) {
            out += "📎";
        }
    }
    return out;
}

function getTextContent(block: FeishuBlock): { elements: FeishuTextElement[]; style: any } {
    const key = TEXT_BLOCK_KEYS[block.block_type];
    const data = key ? block[key] : undefined;
    return { elements: data?.elements || [], style: data?.style || {} };
}

function prefixLines(text: string, prefix: string): string {
    if (!prefix) return text;
    return text
        .split("\n")
        .map((line) => (line ? prefix + line : line))
        .join("\n");
}

/**
 * 飞书高亮块背景色 -> 思源高亮块类型（图标与标题用思源该类型的默认值）。
 * 飞书 CalloutBackgroundColor：1 红 / 2 橙 / 3 黄 / 4 绿 / 5 蓝 / 6 紫 / 7 灰
 */
const CALLOUT_TYPE: Record<number, string> = {
    1: "WARNING",
    2: "CAUTION",
    3: "TIP",
    4: "TIP",
    5: "NOTE",
    6: "IMPORTANT",
    7: "NOTE",
};

/** 渲染引述内容：思源要求每一行都带 `>`，空行用 `>` 占位（否则会被当作引述结束） */
function quoteLines(lines: string[], prefix = ""): string {
    const quoted = lines.map((line) => (line ? "> " + line : ">"));
    return prefixLines(quoted.join("\n"), prefix);
}

/** 渲染一组子块 */
async function renderChildren(ids: string[] | undefined, state: ParserState, prefix = ""): Promise<string> {
    if (!ids || !ids.length) return "";
    const parts: { text: string; isList: boolean }[] = [];
    let orderedIndex = 1;
    for (const id of ids) {
        const block = state.map.get(id);
        if (!block) continue;
        // 同一块被多处引用时只渲染一次，避免重复内容
        if (state.visited.has(block.block_id)) continue;
        const isList = block.block_type === 12 || block.block_type === 13 || block.block_type === 17;
        let text: string;
        if (block.block_type === 13) {
            text = await renderBlock(block, state, prefix, orderedIndex);
            orderedIndex++;
        } else {
            orderedIndex = 1;
            text = await renderBlock(block, state, prefix);
        }
        if (text && text.trim()) {
            parts.push({ text, isList });
        }
    }
    let out = "";
    parts.forEach((part, index) => {
        if (index === 0) {
            out = part.text;
            return;
        }
        // 仅列表项之间用紧凑换行，其余一律空行分隔（避免代码块/引用被并入上一行）
        const separator = part.isList && parts[index - 1].isList ? "\n" : "\n\n";
        out += separator + part.text;
    });
    return out;
}

/** 渲染表格块 */
async function renderTable(block: FeishuBlock, state: ParserState, prefix: string): Promise<string> {
    const table = block.table || {};
    const cells: string[] = table.cells || block.children || [];
    const columnSize = Math.max(1, table.property?.column_size || 1);
    if (!cells.length) return "";

    const rows: string[][] = [];
    for (let i = 0; i < cells.length; i += columnSize) {
        const rowIds = cells.slice(i, i + columnSize);
        const row: string[] = [];
        for (const cellId of rowIds) {
            const cell = state.map.get(cellId);
            let content = cell ? await renderChildren(cell.children, state, "") : "";
            content = content.replace(/\n+/g, "<br>").replace(/\|/g, "\\|").trim();
            row.push(content);
        }
        while (row.length < columnSize) row.push("");
        rows.push(row);
    }
    if (!rows.length) return "";

    const header = rows[0];
    const lines: string[] = [];
    lines.push("| " + header.join(" | ") + " |");
    lines.push("| " + header.map(() => "---").join(" | ") + " |");
    for (let i = 1; i < rows.length; i++) {
        lines.push("| " + rows[i].join(" | ") + " |");
    }
    return prefixLines(lines.join("\n"), prefix);
}

async function renderBlock(block: FeishuBlock, state: ParserState, prefix = "", orderedIndex = 1): Promise<string> {
    const type = block.block_type;
    state.visited.add(block.block_id);
    const { elements, style } = getTextContent(block);

    switch (type) {
        case 1: // 页面（根块）
        case 24: // 分栏
        case 25: // 分栏列
        case 32: // 表格单元格
        case 34: { // 引用容器
            return renderChildren(block.children, state, prefix);
        }
        case 2: { // 段落
            const text = inlineFrom(elements);
            return text ? prefix + text : "";
        }
        case 3:
        case 4:
        case 5:
        case 6:
        case 7:
        case 8:
        case 9:
        case 10:
        case 11: { // 标题 1-9
            const level = Math.min(6, type - 2);
            const text = inlineFrom(elements);
            return text ? prefix + "#".repeat(level) + " " + text : "";
        }
        case 12: { // 无序列表
            const marker = "- ";
            const text = inlineFrom(elements);
            const child = await renderChildren(block.children, state, prefix + " ".repeat(marker.length));
            return (text ? prefix + marker + text : prefix + "-") + (child ? "\n" + child : "");
        }
        case 13: { // 有序列表
            // 按飞书返回的序号（sequence）渲染，缺失时按顺序递增
            const sequence = Number(style?.sequence);
            const index = Number.isFinite(sequence) && sequence > 0 ? sequence : orderedIndex;
            const marker = `${index}. `;
            const text = inlineFrom(elements);
            const child = await renderChildren(block.children, state, prefix + " ".repeat(marker.length));
            return (text ? prefix + marker + text : prefix + `${index}.`) + (child ? "\n" + child : "");
        }
        case 14: { // 代码块
            const lang = CODE_LANGUAGE[style?.language] || "";
            const code = elements.map((el) => el?.text_run?.content || "").join("");
            return prefixLines("```" + lang + "\n" + code + "\n```", prefix);
        }
        case 15: { // 引用 -> 思源引用块（NodeBlockquote，内部是 NodeParagraph）
            const text = inlineFrom(elements);
            const child = await renderChildren(block.children, state, "");
            const content = [text, child].filter(Boolean).join("\n");
            if (!content) return "";
            const lines = content.split("\n");
            // `[!xxx]` 开头会被思源识别成高亮块，转义首个 `[` 保持普通引用
            if (/^\[!/.test(lines[0])) {
                lines[0] = "\\" + lines[0];
            }
            return quoteLines(lines, prefix);
        }
        case 19: { // 高亮块 -> 思源高亮块（NodeCallout）
            const calloutType = CALLOUT_TYPE[Number(block.callout?.background_color) || 0] || "NOTE";
            const text = inlineFrom(elements);
            const child = await renderChildren(block.children, state, "");
            const content = [text, child].filter(Boolean).join("\n");
            const lines = content ? content.split("\n") : [];
            if (!lines.length) {
                // 只有标记行、没有正文时思源会把它降级成普通引用，补一个空行占位
                lines.push("");
            }
            return quoteLines([`[!${calloutType}]`, ...lines], prefix);
        }
        case 16: { // 公式块 -> 独立成段的行内公式
            const content = block.equation?.content || inlineFrom(elements);
            const math = renderInlineMath(content);
            return math ? prefix + math : "";
        }
        case 17: { // 待办
            const marker = style?.done ? "- [x] " : "- [ ] ";
            const text = inlineFrom(elements);
            const child = await renderChildren(block.children, state, prefix + " ".repeat(marker.length));
            return (prefix + marker + text) + (child ? "\n" + child : "");
        }
        case 22: { // 分割线
            return prefix + "---";
        }
        case 23: { // 附件
            const file = block.file || {};
            const name = file.name || "附件";
            if (state.ctx.resolveFile) {
                try {
                    const path = await state.ctx.resolveFile(block);
                    if (path) {
                        return prefix + `📎 [${escapeMd(name)}](${path})`;
                    }
                } catch (e) {
                    console.warn("下载飞书附件失败：", e);
                }
            }
            return prefix + `📎 ${escapeMd(name)}`;
        }
        case 26: { // 内嵌网页
            const url = block.iframe?.component?.url || "";
            if (!url) return "";
            let decoded = url;
            try { decoded = decodeURIComponent(url); } catch (e) { /* ignore */ }
            return prefix + `[${escapeMd(decoded)}](${decoded})`;
        }
        case 27: { // 图片
            const caption = inlineFrom(block.image?.caption?.content);
            let imageMd = "";
            if (state.ctx.resolveImage) {
                try {
                    const path = await state.ctx.resolveImage(block);
                    if (path) imageMd = `![${escapeMd(caption || "image")}](${path})`;
                } catch (e) {
                    console.warn("下载飞书图片失败：", e);
                }
            }
            if (!imageMd) {
                imageMd = `> ⚠️ 图片未能同步${caption ? "：" + caption : ""}`;
            } else if (caption) {
                imageMd += `\n\n${prefix}*${caption}*`;
            }
            return prefixLines(imageMd, prefix);
        }
        case 31: { // 表格
            return renderTable(block, state, prefix);
        }
        case 18: {
            return prefix + `> ⚠️ 多维表格暂不支持同步（token: ${block.bitable?.token || ""}）`;
        }
        case 20: {
            return prefix + `> 群名片块暂不支持同步`;
        }
        case 21: {
            return prefix + `> 流程图 / UML 图暂不支持同步`;
        }
        case 29: {
            return prefix + `> 思维笔记暂不支持同步`;
        }
        case 30: {
            return prefix + `> 电子表格暂不支持同步（token: ${block.sheet?.token || ""}）`;
        }
        case 42: {
            return prefix + `> 知识库目录块`;
        }
        default: {
            // 未支持类型：若含有子块则递归渲染，否则给出占位提示（避免内容静默丢失）
            if (block.children?.length) {
                return renderChildren(block.children, state, prefix);
            }
            const hint = block.text?.elements ? inlineFrom(block.text.elements) : "";
            return prefix + `> ⚠️ 暂不支持的块（类型 ${type}）${hint ? "：" + hint : ""}`;
        }
    }
}

/**
 * 将飞书文档块数组转换为 Markdown
 */
export async function docxBlocksToMarkdown(blocks: FeishuBlock[], ctx: ParseContext = {}): Promise<string> {
    if (!blocks || !blocks.length) return "";
    const map = new Map<string, FeishuBlock>();
    for (const block of blocks) {
        map.set(block.block_id, block);
    }
    const state: ParserState = { ctx, map, visited: new Set<string>() };

    // 找到根块（页面块，或没有父块的块）
    const root = blocks.find((b) => b.block_type === 1) || blocks.find((b) => !b.parent_id || !map.has(b.parent_id));
    let markdown = root
        ? await renderBlock(root, state)
        : await renderChildren(blocks.map((b) => b.block_id), state);

    // 兜底：补渲染「没有被任何块引用」的孤立块，避免因 children 缺失导致内容丢失
    const referenced = new Set<string>();
    if (root) referenced.add(root.block_id);
    for (const block of blocks) {
        if (block.block_type === 1) referenced.add(block.block_id);
        for (const childId of block.children || []) referenced.add(childId);
        const cells = block.table?.cells;
        if (Array.isArray(cells)) {
            for (const cellId of cells) referenced.add(cellId);
        }
    }
    const orphans = blocks.filter((b) => !referenced.has(b.block_id) && !state.visited.has(b.block_id));
    if (orphans.length) {
        ctx.onProgress?.(`检测到 ${orphans.length} 个未挂载的块，已追加补渲染`);
        const extra = await renderChildren(orphans.map((b) => b.block_id), state);
        if (extra) {
            markdown = `${markdown}\n\n${extra}`;
        }
    }

    const finalMarkdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

    // 自检：内容块很多但渲染结果极少，说明解析很可能异常（尽早暴露而不是静默丢内容）
    const contentBlocks = blocks.filter((b) => b.block_type !== 1).length;
    const segments = finalMarkdown.split(/\n{2,}/).filter((s) => s.trim()).length;
    if (contentBlocks >= 5 && segments <= 2) {
        ctx.onProgress?.(`⚠️ 自检：解析到 ${contentBlocks} 个内容块，但只渲染出 ${segments} 段，可能存在解析异常`);
    }

    return finalMarkdown;
}
