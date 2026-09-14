/*
 * Markdown -> 思源块 DOM（BlockDOM）
 *
 * 同步写入统一使用 dataType: "dom"，块 DOM 由思源自带的 Lute 生成（与编辑器同一引擎），
 * 因此高亮块会得到原生结构：
 *   <div data-subtype="NOTE" data-node-id="…" data-node-index="1" data-type="NodeCallout" class="callout">
 *     <div class="callout-info" contenteditable="false">
 *       <span class="callout-icon">✏️</span><span class="callout-title">Note</span>
 *     </div>
 *     <div class="callout-content">…子块…</div>
 *   </div>
 *
 * 解析选项参照思源前端 protyle 的 Lute 配置（app/src/protyle/render/setLute.ts 中的 getAgentLute）。
 */

/** 共享的 Lute 实例（首次使用时创建） */
let luteEngine: any = null;

/** 思源前端的 Lute 解析选项（缺方法时跳过，兼容不同内核版本） */
const LUTE_OPTIONS: Record<string, any[]> = {
    // 基础：文本标记 / 行内 HTML / 高亮块 / IAL
    SetProtyleWYSIWYG: [true],
    SetTextMark: [true],
    SetHTMLTag2TextMark: [true],
    SetKramdownIAL: [true],
    SetCallout: [true],
    SetSuperBlock: [true],
    SetTabs: [true],
    SetCustomBlock: [true],
    SetBlockRef: [true],
    SetFileAnnotationRef: [true],
    // 行内语法
    SetInlineAsterisk: [true],
    SetInlineUnderscore: [true],
    SetGFMStrikethrough: [true],
    SetMark: [true],
    SetSup: [true],
    SetSub: [true],
    SetTag: [true],
    SetInlineMath: [true],
    SetInlineMathAllowDigitAfterOpenMarker: [true],
    // 关闭不使用的语法，避免误解析
    SetHeadingID: [false],
    SetYamlFrontMatter: [false],
    SetFootnotes: [false],
    SetLinkRef: [false],
    SetToC: [false],
    SetIndentCodeBlock: [false],
    SetSetext: [false],
    // 列表 / 任务列表
    SetUnorderedListMarker: ["-"],
    SetDataTask: [true],
    SetExportNormalizeTaskListMarker: [true],
    SetArbitraryTaskListItemMarker: [true],
    SetEnsureListItemParagraph: [true],
    // 图片路径允许空格
    SetImgPathAllowSpace: [true],
};

function getLuteEngine(): any {
    if (luteEngine) return luteEngine;
    const Lute = (window as any).Lute;
    if (!Lute || typeof Lute.New !== "function") return null;
    const lute = Lute.New();
    for (const name of Object.keys(LUTE_OPTIONS)) {
        try {
            if (typeof lute[name] === "function") {
                lute[name](...LUTE_OPTIONS[name]);
            }
        } catch (e) {
            // 忽略：不同内核版本的 Lute 可能没有该方法
        }
    }
    luteEngine = lute;
    return lute;
}

/**
 * Markdown -> 块 DOM。
 * 转换不可用时返回 null（例如 Lute 未加载、老版本内核缺少 Md2BlockDOM），由调用方退回 markdown 写入。
 */
export function markdownToBlockDom(markdown: string): string | null {
    if (!markdown || !markdown.trim()) return null;
    try {
        const lute = getLuteEngine();
        if (!lute || typeof lute.Md2BlockDOM !== "function") return null;
        const dom = lute.Md2BlockDOM(markdown);
        return dom && dom.trim() ? dom : null;
    } catch (e) {
        console.warn("Markdown 转块 DOM 失败，本次退回 markdown 写入：", e);
        return null;
    }
}
