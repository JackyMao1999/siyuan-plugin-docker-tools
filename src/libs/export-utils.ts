import { exportCurrentDocContent, getFileBlob } from "../api";

const DEFAULT_OPTIONS: ExportOptions = {
    pageSize: "A4",
    orientation: "portrait",
    marginTop: 15,
    marginBottom: 15,
    marginLeft: 20,
    marginRight: 20,
    fontFamily: "Noto Serif CJK SC, Source Han Serif SC, serif",
    fontSize: 11,
    lineHeight: 1.8,
    codeFontSize: 9,
    showToc: false,
    pageHeader: true,
    pageFooter: true,
    customCSS: "",
    exportMethod: "dom",
};

function getPageDimensions(pageSize: string, orientation: string): [number, number] {
    const sizes: Record<string, [number, number]> = {
        "A3": [297, 420],
        "A4": [210, 297],
        "A5": [148, 210],
        "Letter": [216, 279],
        "Legal": [216, 356],
        "B5": [176, 250],
    };
    let [w, h] = sizes[pageSize] || sizes["A4"];
    if (orientation === "landscape") {
        [w, h] = [h, w];
    }
    return [w, h];
}

async function inlineImages(element: HTMLElement): Promise<void> {
    const imgs = element.querySelectorAll("img");
    const promises: Promise<void>[] = [];
    imgs.forEach((img) => {
        const src = img.getAttribute("src");
        if (!src || src.startsWith("data:")) return;
        const promise = (async () => {
            try {
                const blob = await getFileBlob(src);
                if (blob) {
                    const dataUrl = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.readAsDataURL(blob);
                    });
                    img.setAttribute("src", dataUrl);
                }
            } catch (e) {
                console.warn("Failed to inline image:", src, e);
            }
        })();
        promises.push(promise);
    });
    await Promise.all(promises);
}

function getPrintCSS(options: ExportOptions): string {
    const [pageW, pageH] = getPageDimensions(options.pageSize, options.orientation);
    return [
        "@page { size: " + pageW + "mm " + pageH + "mm; margin: " + options.marginTop + "mm " + options.marginRight + "mm " + options.marginBottom + "mm " + options.marginLeft + "mm; }",
        "* { box-sizing: border-box; }",
        "body { font-family: " + options.fontFamily + "; font-size: " + options.fontSize + "pt; line-height: " + options.lineHeight + "; color: #333; background: white; margin: 0; }",
        ".export-wrapper { max-width: 100%; padding: 0; }",
        ".export-header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #333; margin-bottom: 30px; }",
        ".doc-title { font-size: " + (options.fontSize + 8) + "pt; font-weight: bold; margin: 0; color: #000; }",
        ".export-footer { text-align: center; margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: " + (options.fontSize - 2) + "pt; color: #666; }",
        "h1 { font-size: " + (options.fontSize + 6) + "pt; margin-top: 24pt; margin-bottom: 12pt; }",
        "h2 { font-size: " + (options.fontSize + 4) + "pt; margin-top: 20pt; margin-bottom: 10pt; page-break-after: avoid; }",
        "h3 { font-size: " + (options.fontSize + 2) + "pt; margin-top: 16pt; margin-bottom: 8pt; page-break-after: avoid; }",
        "h4, h5, h6 { font-size: " + options.fontSize + "pt; margin-top: 12pt; margin-bottom: 6pt; page-break-after: avoid; }",
        "p { margin: 6pt 0; text-align: justify; }",
        "pre, code { font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace; font-size: " + options.codeFontSize + "pt; }",
        "pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; padding: 10pt; overflow-x: auto; page-break-inside: avoid; white-space: pre-wrap; word-wrap: break-word; }",
        "code { background: #f0f0f0; padding: 1pt 3pt; border-radius: 2pt; } pre code { background: none; padding: 0; }",
        ".token.comment { color: #6a737d; } .token.keyword { color: #d73a49; } .token.string { color: #032f62; } .token.number { color: #005cc5; } .token.function { color: #6f42c1; }",
        "table { width: 100%; border-collapse: collapse; margin: 12pt 0; page-break-inside: auto; }",
        "th, td { border: 1px solid #ccc; padding: 6pt 8pt; text-align: left; } th { background: #f0f0f0; font-weight: bold; }",
        "tr { page-break-inside: avoid; }",
        "img { max-width: 100%; height: auto; page-break-inside: avoid; }",
        "blockquote { border-left: 4px solid #ccc; margin: 10pt 0; padding: 4pt 12pt; color: #555; background: #f9f9f9; }",
        "ul, ol { margin: 6pt 0; padding-left: 24pt; } li { margin: 2pt 0; } hr { border: none; border-top: 1px solid #ccc; margin: 16pt 0; }",
        ".toc { page-break-after: always; margin-bottom: 20pt; }",
        ".toc h1 { font-size: " + (options.fontSize + 6) + "pt; text-align: center; border-bottom: 2px solid #333; padding-bottom: 8pt; }",
        ".toc ul { list-style: none; padding: 0; } .toc li { padding: 2pt 0; }",
        ".toc a { text-decoration: none; color: #333; }",
        "a { color: #0366d6; text-decoration: underline; }",
        ".math { overflow-x: auto; } input[type='checkbox'] { margin-right: 4pt; }",
        "@media print { body { background: white; } .export-footer .page-number:after { content: counter(page); } }",
        options.customCSS || "",
    ].join("\n");
}

function renderMarkdown(markdown: string, title: string, options: ExportOptions): string {
    const Lute = (window as any).Lute;
    let html = "";
    if (Lute) {
        const lute = Lute.New();
        html = lute.Md2HTML(markdown);
    } else {
        html = "<pre>" + markdown + "</pre>";
    }
    const tocHtml = options.showToc ? '<nav class="toc"><h1>Table of Contents</h1><ul id="toc-list"></ul></nav>' : "";
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + title + '</title>' +
        '<base href="' + window.location.origin + '/">' +
        '<style>' + getPrintCSS(options) + '</style></head><body>' +
        '<div class="export-wrapper">' +
        (options.pageHeader ? '<header class="export-header"><h1 class="doc-title">' + title + '</h1></header>' : "") +
        tocHtml +
        '<main class="export-content">' + html + '</main>' +
        (options.pageFooter ? '<footer class="export-footer"><span class="page-number">Page <span class="page-num"></span></span></footer>' : "") +
        '</div></body></html>'
    );
}

function cleanupProtyleDOM(root: HTMLElement): void {
    root.classList.remove('protyle-wysiwyg--select');
    root.querySelectorAll('[contenteditable]').forEach(el => {
        el.removeAttribute('contenteditable');
    });
    root.querySelectorAll('[spellcheck]').forEach(el => {
        el.removeAttribute('spellcheck');
    });
    root.querySelectorAll('.protyle-attr, .protyle-icons').forEach(el => {
        el.remove();
    });
    root.innerHTML = root.innerHTML.replace(/\u200b/g, '');
}

function getStylesheetHTML(): string {
    const tags: string[] = [];
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
        tags.push(el.outerHTML);
    });
    return tags.join('\n');
}

async function renderHtmlInIframe(fullHtml: string, title: string): Promise<void> {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;border:none;';
    document.body.appendChild(iframe);

    const p = new Promise<void>((resolve) => {
        iframe.onload = async () => {
            const doc = iframe.contentDocument!;

            // Strip @media screen wrappers so protyle styles apply in print
            for (const sheet of doc.styleSheets) {
                try {
                    const rules = sheet.cssRules;
                    const expansions: { index: number; css: string }[] = [];
                    for (let i = 0; i < rules.length; i++) {
                        const rule = rules[i];
                        if (rule instanceof CSSMediaRule) {
                            const media = rule.media.mediaText;
                            if (media.includes('screen') && !media.includes('print') && !media.includes('all')) {
                                const inner = [];
                                for (let j = 0; j < rule.cssRules.length; j++) {
                                    inner.push(rule.cssRules[j].cssText);
                                }
                                expansions.push({ index: i, css: inner.join('\n') });
                            }
                        }
                    }
                    for (let i = expansions.length - 1; i >= 0; i--) {
                        const e = expansions[i];
                        sheet.deleteRule(e.index);
                        sheet.insertRule(e.css, e.index);
                    }
                } catch (e) {
                    // skip
                }
            }

            // Wait for web fonts to load
            try {
                await doc.fonts.ready;
            } catch (e) {
                // fonts not supported
            }

            const container = doc.querySelector(".export-wrapper, .protyle-wysiwyg") as HTMLElement;
            if (container) {
                try {
                    await inlineImages(container);
                } catch (e) {
                    console.warn("Image inlining failed:", e);
                }
            }
            iframe.contentWindow!.onafterprint = () => {
                document.body.removeChild(iframe);
                resolve();
            };
            // Small delay for rendering to settle
            setTimeout(() => iframe.contentWindow!.print(), 100);
        };
    });

    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(fullHtml);
    doc.title = title;
    doc.close();

    await p;
}

export async function exportToPdf(
    docId: string,
    options: ExportOptions
): Promise<void> {
    const res = await exportCurrentDocContent(docId);
    const hPath = res.hPath || "";
    const title = hPath.split("/").pop() || "document";
    const fullHtml = renderMarkdown(res.content || "", title, options);
    await renderHtmlInIframe(fullHtml, title);
}

export async function exportRenderedToPdf(
    wysiwygElement: HTMLElement,
    title: string,
    options: ExportOptions
): Promise<void> {
    const clone = wysiwygElement.cloneNode(true) as HTMLElement;
    cleanupProtyleDOM(clone);

    const wrapper = document.createElement('div');
    wrapper.className = 'export-wrapper';
    wrapper.appendChild(clone);

    const [pageW, pageH] = getPageDimensions(options.pageSize, options.orientation);
    const layoutCSS = [
        "@page { size: " + pageW + "mm " + pageH + "mm; margin: " + options.marginTop + "mm " + options.marginRight + "mm " + options.marginBottom + "mm " + options.marginLeft + "mm; }",
        "* { box-sizing: border-box; }",
        ".export-wrapper { max-width: 100%; padding: 0; }",
        options.pageHeader ? ".export-header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #333; margin-bottom: 30px; }" : "",
        options.pageHeader ? ".doc-title { font-size: 24pt; font-weight: bold; margin: 0; color: #000; }" : "",
        options.pageFooter ? ".export-footer { text-align: center; margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 9pt; color: #666; }" : "",
        "@media print { .export-footer .page-number:after { content: counter(page); } }",
        options.customCSS || "",
    ].filter(Boolean).join('\n');

    const stylesheetHTML = getStylesheetHTML();
    const baseHref = window.location.origin + '/';
    const printOverrides = [
        ':root { color-scheme: light; }',
        'html, body { color-scheme: light; background: white !important; }',
        '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }',
        '.protyle-wysiwyg .protyle-background { display: none !important; }',
        '.export-wrapper, .protyle-wysiwyg { width: auto !important; max-width: 100% !important; min-width: 0 !important; }',
        '.protyle-wysiwyg { padding-left: 0 !important; margin-left: 0 !important; }',
        '.protyle-wysiwyg [data-node-id] { padding-left: 0 !important; margin-left: 0 !important; }',
        '.protyle-wysiwyg .h1 > div, .protyle-wysiwyg .h2 > div, .protyle-wysiwyg .h3 > div, .protyle-wysiwyg .p > div, .protyle-wysiwyg .li > div { padding-left: 0 !important; }',
        '.protyle-wysiwyg img, .protyle-wysiwyg .img img { max-width: 100% !important; height: auto !important; }',
        '.protyle-wysiwyg pre, .protyle-wysiwyg .code-block { white-space: pre-wrap !important; word-break: break-all !important; max-width: 100% !important; overflow-x: hidden !important; }',
        '.protyle-wysiwyg table { table-layout: fixed !important; max-width: 100% !important; }',
        '.protyle-wysiwyg th, .protyle-wysiwyg td { word-wrap: break-word !important; overflow-wrap: break-word !important; }',
        '.protyle-wysiwyg [data-type], .protyle-wysiwyg .h1, .protyle-wysiwyg .h2, .protyle-wysiwyg .h3, .protyle-wysiwyg .p, .protyle-wysiwyg .li, .protyle-wysiwyg .bq { max-width: 100% !important; overflow-wrap: break-word !important; }',
        '.protyle-wysiwyg [style*="background"] { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }',
        '@media print {',
        '  body { background: white !important; }',
        '  .protyle-wysiwyg pre, .protyle-wysiwyg .code-block { white-space: pre-wrap !important; word-break: break-all !important; }',
        '}',
    ].join('\n');
    const fullHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + title + '</title>' +
        '<base href="' + baseHref + '">' +
        stylesheetHTML +
        '<style>' + layoutCSS + '</style>' +
        '<style>' + printOverrides + '</style>' +
        '</head><body>' +
        (options.pageHeader ? '<header class="export-header"><h1 class="doc-title">' + title + '</h1></header>' : '') +
        wrapper.outerHTML +
        (options.pageFooter ? '<footer class="export-footer"><span class="page-number">Page <span class="page-num"></span></span></footer>' : '') +
        '</body></html>';

    await renderHtmlInIframe(fullHtml, title);
}

export { DEFAULT_OPTIONS };
export type { ExportOptions };
