/*
 * 通用帮助对话框：支持关键词检索、复制配置清单、打开外部链接
 */

import { Dialog, showMessage } from "siyuan";

export interface HelpTopic {
    /** 唯一标识 */
    id: string;
    /** 标题 */
    title: string;
    /** 额外检索关键词（空格分隔） */
    keywords: string;
    /** 内容 HTML */
    html: string;
}

export interface HelpDialogLabels {
    searchPlaceholder: string;
    noResult: string;
    copy: string;
    copied: string;
    copyFailed: string;
}

/** 去掉 HTML 标签，用于构建检索文本 */
function stripHtml(html: string): string {
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || "").replace(/\s+/g, " ").trim();
}

async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) {
        // 继续尝试降级方案
    }
    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
    } catch (e) {
        return false;
    }
}

/**
 * 打开帮助对话框
 */
export function openHelpDialog(title: string, topics: HelpTopic[], labels: HelpDialogLabels): Dialog {
    const body = topics
        .map((topic) => {
            const searchText = `${topic.title} ${topic.keywords} ${stripHtml(topic.html)}`.toLowerCase();
            return `<section class="plugin-help__topic" data-search="${escapeAttr(searchText)}">
    <h3 class="plugin-help__title">${topic.title}</h3>
    <div class="plugin-help__content b3-typography">${topic.html}</div>
</section>`;
        })
        .join("");

    const dialog = new Dialog({
        title,
        width: "720px",
        height: "620px",
        content: `<div class="plugin-help">
    <div class="plugin-help__bar">
        <input id="plugin-help-search" class="b3-text-field fn__flex-1" placeholder="${escapeAttr(labels.searchPlaceholder)}">
    </div>
    <div class="plugin-help__body" id="plugin-help-body">
        ${body}
        <div class="plugin-help__empty fn__none" id="plugin-help-empty">${escapeAttr(labels.noResult)}</div>
    </div>
</div>`,
    });

    const root = dialog.element;
    const searchInput = root.querySelector("#plugin-help-search") as HTMLInputElement;
    const bodyEl = root.querySelector("#plugin-help-body") as HTMLElement;
    const emptyEl = root.querySelector("#plugin-help-empty") as HTMLElement;
    const sections = Array.from(bodyEl.querySelectorAll(".plugin-help__topic")) as HTMLElement[];

    const doFilter = () => {
        const terms = searchInput.value.toLowerCase().split(/\s+/).filter(Boolean);
        let visible = 0;
        for (const section of sections) {
            const text = section.dataset.search || "";
            const matched = terms.every((term) => text.includes(term));
            section.classList.toggle("fn__none", !matched);
            if (matched) visible++;
        }
        emptyEl.classList.toggle("fn__none", visible > 0);
    };
    searchInput.addEventListener("input", doFilter);

    // 外部链接交给系统浏览器打开，避免对话框内跳转
    bodyEl.querySelectorAll("a[href]").forEach((anchor) => {
        (anchor as HTMLAnchorElement).onclick = (e) => {
            e.preventDefault();
            const href = (anchor as HTMLAnchorElement).getAttribute("href") || "";
            if (href) window.open(href, "_blank");
        };
    });

    // 绑定“复制”按钮
    bodyEl.querySelectorAll(".plugin-help__copy").forEach((button) => {
        (button as HTMLElement).onclick = async () => {
            const container = (button as HTMLElement).closest(".plugin-help__topic");
            const source = container?.querySelector(".plugin-help__copy-src") as HTMLElement | null;
            if (!source) return;
            const text = (source.textContent || "").trim();
            const ok = await copyToClipboard(text);
            showMessage(ok ? labels.copied : labels.copyFailed, 3000, ok ? "info" : "error");
        };
    });

    setTimeout(() => searchInput.focus(), 60);
    return dialog;
}

function escapeAttr(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
