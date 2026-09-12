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

/** 转义会破坏 Markdown 语法的字符 */
function escapeMd(text: string): string {
    return (text || "")
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, " ");
}

function inlineFrom(elements: FeishuTextElement[] | undefined): string {
    if (!elements || !elements.length) return "";
    let out = "";
    for (const el of elements) {
        if (!el) continue;
        if (el.text_run) {
            let text = escapeMd(el.text_run.content || "");
            if (!text) continue;
            const style: any = el.text_run.text_element_style || {};
            if (style.inline_code) text = "`" + text + "`";
            if (style.bold) text = "**" + text + "**";
            if (style.italic) text = "*" + text + "*";
            if (style.strikethrough) text = "~~" + text + "~~";
            if (style.underline) text = "<u>" + text + "</u>";
            const link = style.link?.url;
            if (link) {
                let url = link;
                try { url = decodeURIComponent(link); } catch (e) { /* ignore */ }
                text = `[${text}](${url})`;
            }
            out += text;
        } else if (el.equation) {
            out += `$${el.equation.content || ""}$`;
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

/** 渲染一组子块 */
async function renderChildren(ids: string[] | undefined, state: ParserState, prefix = ""): Promise<string> {
    if (!ids || !ids.length) return "";
    const parts: { text: string; isList: boolean }[] = [];
    let orderedIndex = 1;
    for (const id of ids) {
        const block = state.map.get(id);
        if (!block) continue;
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
        case 19: // 高亮块
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
            const text = inlineFrom(elements);
            const child = await renderChildren(block.children, state, prefix + "  ");
            return (text ? prefix + "- " + text : prefix + "-") + (child ? "\n" + child : "");
        }
        case 13: { // 有序列表
            const text = inlineFrom(elements);
            const child = await renderChildren(block.children, state, prefix + "  ");
            return (text ? prefix + `${orderedIndex}. ` + text : prefix + `${orderedIndex}.`) + (child ? "\n" + child : "");
        }
        case 14: { // 代码块
            const lang = CODE_LANGUAGE[style?.language] || "";
            const code = elements.map((el) => el?.text_run?.content || "").join("");
            return prefixLines("```" + lang + "\n" + code + "\n```", prefix);
        }
        case 15: { // 引用
            const text = inlineFrom(elements);
            const child = await renderChildren(block.children, state, "");
            const content = [text, child].filter(Boolean).join("\n");
            if (!content) return "";
            return prefixLines(content.split("\n").map((line) => "> " + line).join("\n"), prefix);
        }
        case 16: { // 公式块
            const content = block.equation?.content || inlineFrom(elements);
            if (!content) return "";
            return prefixLines(`$$\n${content}\n$$`, prefix);
        }
        case 17: { // 待办
            const text = inlineFrom(elements);
            const checked = style?.done ? "x" : " ";
            const child = await renderChildren(block.children, state, prefix + "  ");
            return (prefix + `- [${checked}] ` + text) + (child ? "\n" + child : "");
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
