import {
    Plugin,
    showMessage,
    Menu,
    adaptHotkey,
    getFrontend,
    getAllEditor,
} from "siyuan";
import "./index.scss";
import "./export-styles.scss";
import { SettingUtils } from "./libs/setting-utils";
import { printDoc, exportToPdf, DEFAULT_OPTIONS, fetchDocContent } from "./libs/export-utils";
import { showBatchExportDialog } from "./libs/batch-export";

const STORAGE_NAME = "doc-export-config";

export default class DocExportPlugin extends Plugin {

    private isMobile: boolean;
    private settingUtils: SettingUtils;

    async onload() {
        try {
            console.log("loading plugin-doc-export-tools", this.i18n);

            this.data[STORAGE_NAME] = {};

            const frontEnd = getFrontend();
            this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

            this.addIcons(`<symbol id="iconPrint" viewBox="0 0 32 32">
<path d="M26.667 8h-1.333v-5.333c0-0.733-0.6-1.333-1.333-1.333h-16c-0.733 0-1.333 0.6-1.333 1.333v5.333h-1.333c-1.467 0-2.667 1.2-2.667 2.667v10.667c0 1.467 1.2 2.667 2.667 2.667h1.333v5.333c0 0.733 0.6 1.333 1.333 1.333h16c0.733 0 1.333-0.6 1.333-1.333v-5.333h1.333c1.467 0 2.667-1.2 2.667-2.667v-10.667c0-1.467-1.2-2.667-2.667-2.667zM9.333 4h13.333v4h-13.333v-4zM22.667 28h-13.333v-8h13.333v8zM26.667 21.333h-1.333v-2.667c0-0.733-0.6-1.333-1.333-1.333h-16c-0.733 0-1.333 0.6-1.333 1.333v2.667h-1.333v-10.667h21.333v10.667zM18.667 22.667h-5.333v1.333h5.333v-1.333z"></path>
</symbol>`);
            this.addIcons(`<symbol id="iconPDF" viewBox="0 0 32 32">
<path d="M24 2h-16c-1.1 0-2 0.9-2 2v24c0 1.1 0.9 2 2 2h16c1.1 0 2-0.9 2-2v-24c0-1.1-0.9-2-2-2zM24 28h-16v-24h16v24zM8 24h16v2h-16zM11 12h3v-3h-3v3zM15 12h3v-3h-3v3zM11 17h3v-3h-3v3zM15 17h3v-3h-3v3zM11 22h3v-3h-3v3zM15 22h3v-3h-3v3z"></path>
</symbol>`);
            this.addIcons(`<symbol id="iconBatch" viewBox="0 0 32 32">
<path d="M27 4h-22c-0.6 0-1 0.4-1 1v22c0 0.6 0.4 1 1 1h22c0.6 0 1-0.4 1-1v-22c0-0.6-0.4-1-1-1zM26 26h-20v-20h20v20zM10 14h12v2h-12zM10 18h12v2h-12zM10 22h8v2h-8zM10 10h12v2h-12z"></path>
</symbol>`);

            this.protyleSlash = [];
            this.protyleOptions = {
                toolbar: ["block-ref", "a", "|", "text", "strong", "em", "u", "s", "mark", "sup", "sub", "clear", "|", "code", "kbd", "tag", "inline-math", "inline-memo"],
            };

            this.settingUtils = new SettingUtils({
                plugin: this, name: STORAGE_NAME
            });

            this.initSettings();

            try {
                await this.settingUtils.load();
            } catch (error) {
                console.error("Error loading settings:", error);
            }

            this.addCommand({
                langKey: "printDoc",
                hotkey: "⌃⌥P",
                callback: () => {
                    this.handlePrint().catch(e => console.error("printDoc failed:", e));
                },
            });

            this.addCommand({
                langKey: "exportPdf",
                hotkey: "⌃⌥D",
                callback: () => {
                    this.handleExportPdf().catch(e => console.error("exportPdf failed:", e));
                },
            });

            console.log(this.i18n.helloPlugin);
        } catch (error) {
            console.error("Plugin onload error:", error);
        }
    }

    onLayoutReady() {
        const topBarElement = this.addTopBar({
            icon: "iconPrint",
            title: this.i18n.topBarTitle,
            position: "right",
            callback: () => {
                if (this.isMobile) {
                    this.showPrintMenu();
                } else {
                    let rect = topBarElement.getBoundingClientRect();
                    if (rect.width === 0) {
                        rect = document.querySelector("#barMore")?.getBoundingClientRect() as DOMRect;
                    }
                    if (rect.width === 0) {
                        rect = document.querySelector("#barPlugins")?.getBoundingClientRect() as DOMRect;
                    }
                    this.showPrintMenu(rect);
                }
            }
        });
    }

    async onunload() {
        console.log(this.i18n.byePlugin);
    }

    private initSettings() {
        this.settingUtils.addItem({
            key: "pageSize",
            value: DEFAULT_OPTIONS.pageSize,
            type: "select",
            title: this.i18n.pageSize,
            description: this.i18n.pageSizeDesc,
            options: {
                "A4": "A4",
                "Letter": "Letter",
                "Legal": "Legal",
                "A3": "A3",
                "A5": "A5",
                "B5": "B5"
            },
            action: { callback: () => this.settingUtils.takeAndSave("pageSize") }
        });

        this.settingUtils.addItem({
            key: "orientation",
            value: DEFAULT_OPTIONS.orientation,
            type: "select",
            title: this.i18n.orientation,
            description: this.i18n.orientationDesc,
            options: {
                "portrait": this.i18n.portrait,
                "landscape": this.i18n.landscape
            },
            action: { callback: () => this.settingUtils.takeAndSave("orientation") }
        });

        this.settingUtils.addItem({
            key: "marginTop",
            value: DEFAULT_OPTIONS.marginTop,
            type: "number",
            title: this.i18n.marginTop,
            description: this.i18n.marginDesc,
            action: { callback: () => this.settingUtils.takeAndSave("marginTop") }
        });

        this.settingUtils.addItem({
            key: "marginBottom",
            value: DEFAULT_OPTIONS.marginBottom,
            type: "number",
            title: this.i18n.marginBottom,
            description: this.i18n.marginDesc,
            action: { callback: () => this.settingUtils.takeAndSave("marginBottom") }
        });

        this.settingUtils.addItem({
            key: "marginLeft",
            value: DEFAULT_OPTIONS.marginLeft,
            type: "number",
            title: this.i18n.marginLeft,
            description: this.i18n.marginDesc,
            action: { callback: () => this.settingUtils.takeAndSave("marginLeft") }
        });

        this.settingUtils.addItem({
            key: "marginRight",
            value: DEFAULT_OPTIONS.marginRight,
            type: "number",
            title: this.i18n.marginRight,
            description: this.i18n.marginDesc,
            action: { callback: () => this.settingUtils.takeAndSave("marginRight") }
        });

        this.settingUtils.addItem({
            key: "fontFamily",
            value: DEFAULT_OPTIONS.fontFamily,
            type: "textinput",
            title: this.i18n.fontFamily,
            description: this.i18n.fontFamilyDesc,
            action: { callback: () => this.settingUtils.takeAndSave("fontFamily") }
        });

        this.settingUtils.addItem({
            key: "fontSize",
            value: DEFAULT_OPTIONS.fontSize,
            type: "number",
            title: this.i18n.fontSize,
            description: this.i18n.fontSizeDesc,
            action: { callback: () => this.settingUtils.takeAndSave("fontSize") }
        });

        this.settingUtils.addItem({
            key: "lineHeight",
            value: DEFAULT_OPTIONS.lineHeight,
            type: "slider",
            title: this.i18n.lineHeight,
            description: this.i18n.lineHeightDesc,
            slider: { min: 1.0, max: 3.0, step: 0.1 },
            action: { callback: () => this.settingUtils.takeAndSave("lineHeight") }
        });

        this.settingUtils.addItem({
            key: "codeFontSize",
            value: DEFAULT_OPTIONS.codeFontSize,
            type: "number",
            title: this.i18n.codeFontSize,
            description: this.i18n.codeFontSizeDesc,
            action: { callback: () => this.settingUtils.takeAndSave("codeFontSize") }
        });

        this.settingUtils.addItem({
            key: "showToc",
            value: DEFAULT_OPTIONS.showToc,
            type: "checkbox",
            title: this.i18n.showToc,
            description: this.i18n.showTocDesc,
            action: { callback: () => this.settingUtils.takeAndSave("showToc") }
        });

        this.settingUtils.addItem({
            key: "pageHeader",
            value: DEFAULT_OPTIONS.pageHeader,
            type: "checkbox",
            title: this.i18n.pageHeader,
            description: this.i18n.pageHeaderDesc,
            action: { callback: () => this.settingUtils.takeAndSave("pageHeader") }
        });

        this.settingUtils.addItem({
            key: "pageFooter",
            value: DEFAULT_OPTIONS.pageFooter,
            type: "checkbox",
            title: this.i18n.pageFooter,
            description: this.i18n.pageFooterDesc,
            action: { callback: () => this.settingUtils.takeAndSave("pageFooter") }
        });

        this.settingUtils.addItem({
            key: "customCSS",
            value: DEFAULT_OPTIONS.customCSS,
            type: "textarea",
            title: this.i18n.customCSS,
            description: this.i18n.customCSSDesc,
            action: { callback: () => this.settingUtils.takeAndSave("customCSS") }
        });

        this.settingUtils.addItem({
            key: "pdfImageQuality",
            value: DEFAULT_OPTIONS.pdfImageQuality,
            type: "slider",
            title: this.i18n.pdfImageQuality,
            description: this.i18n.pdfImageQualityDesc,
            slider: { min: 0.5, max: 1.0, step: 0.05 },
            action: { callback: () => this.settingUtils.takeAndSave("pdfImageQuality") }
        });

        this.settingUtils.addItem({
            key: "pdfScale",
            value: DEFAULT_OPTIONS.pdfScale,
            type: "select",
            title: this.i18n.pdfScale,
            description: this.i18n.pdfScaleDesc,
            options: {
                "1": "1x",
                "2": "2x",
                "3": "3x"
            },
            action: { callback: () => this.settingUtils.takeAndSave("pdfScale") }
        });
    }

    private getOptions(): ExportOptions {
        return {
            pageSize: this.settingUtils.get("pageSize") || DEFAULT_OPTIONS.pageSize,
            orientation: this.settingUtils.get("orientation") || DEFAULT_OPTIONS.orientation,
            marginTop: Number(this.settingUtils.get("marginTop")) || DEFAULT_OPTIONS.marginTop,
            marginBottom: Number(this.settingUtils.get("marginBottom")) || DEFAULT_OPTIONS.marginBottom,
            marginLeft: Number(this.settingUtils.get("marginLeft")) || DEFAULT_OPTIONS.marginLeft,
            marginRight: Number(this.settingUtils.get("marginRight")) || DEFAULT_OPTIONS.marginRight,
            fontFamily: this.settingUtils.get("fontFamily") || DEFAULT_OPTIONS.fontFamily,
            fontSize: Number(this.settingUtils.get("fontSize")) || DEFAULT_OPTIONS.fontSize,
            lineHeight: Number(this.settingUtils.get("lineHeight")) || DEFAULT_OPTIONS.lineHeight,
            codeFontSize: Number(this.settingUtils.get("codeFontSize")) || DEFAULT_OPTIONS.codeFontSize,
            showToc: Boolean(this.settingUtils.get("showToc")) || DEFAULT_OPTIONS.showToc,
            pageHeader: Boolean(this.settingUtils.get("pageHeader")) || DEFAULT_OPTIONS.pageHeader,
            pageFooter: Boolean(this.settingUtils.get("pageFooter")) || DEFAULT_OPTIONS.pageFooter,
            customCSS: this.settingUtils.get("customCSS") || DEFAULT_OPTIONS.customCSS,
            pdfImageQuality: Number(this.settingUtils.get("pdfImageQuality")) || DEFAULT_OPTIONS.pdfImageQuality,
            pdfScale: Number(this.settingUtils.get("pdfScale")) || DEFAULT_OPTIONS.pdfScale,
        };
    }

    private showPrintMenu(rect?: DOMRect) {
        const menu = new Menu("docPrintMenu", () => {});
        menu.addItem({
            icon: "iconPrint",
            label: this.i18n.printDoc,
            accelerator: adaptHotkey("⌃⌥P"),
            click: () => this.handlePrint().catch(e => console.error("Print failed:", e))
        });
        menu.addItem({
            icon: "iconPDF",
            label: this.i18n.exportPdf,
            accelerator: adaptHotkey("⌃⌥D"),
            click: () => this.handleExportPdf().catch(e => console.error("PDF export failed:", e))
        });
        menu.addSeparator();
        menu.addItem({
            icon: "iconBatch",
            label: this.i18n.batchExport,
            click: () => this.handleBatchExport().catch(e => console.error("Batch export failed:", e))
        });
        menu.addSeparator();
        menu.addItem({
            icon: "iconSettings",
            label: this.i18n.openSettings,
            click: () => this.openSetting()
        });

        if (this.isMobile) {
            menu.fullscreen();
        } else if (rect) {
            menu.open({
                x: rect.right,
                y: rect.bottom,
                isLeft: true,
            });
        }
    }

    private getEditor() {
        const editors = getAllEditor();
        if (editors.length === 0) {
            showMessage(this.i18n.noOpenDoc);
            return null;
        }
        for (const editor of editors) {
            try {
                const el = editor.protyle?.element;
                if (el && !el.classList.contains('fn__none') && el.offsetParent !== null) {
                    return editor;
                }
            } catch (e) {
                continue;
            }
        }
        showMessage(this.i18n.noOpenDoc);
        return null;
    }

    private async handlePrint() {
        const editor = this.getEditor();
        if (!editor) return;

        const docId = editor.protyle.block.rootID;
        const options = this.getOptions();

        try {
            await printDoc(docId, options);
        } catch (e) {
            console.error("Print failed:", e);
            showMessage(this.i18n.printFailed, 5000);
        }
    }

    private async handleExportPdf() {
        const editor = this.getEditor();
        if (!editor) return;

        const docId = editor.protyle.block.rootID;
        const options = this.getOptions();

        try {
            showMessage(this.i18n.exportStarted, 3000);
            await exportToPdf(docId, options);
        } catch (e) {
            console.error("PDF export failed:", e);
            showMessage(this.i18n.printFailed, 5000);
        }
    }

    private async handleBatchExport() {
        const options = this.getOptions();
        try {
            await showBatchExportDialog({
                plugin: this,
                options,
                fetchDocContent,
                exportToPdf,
            });
        } catch (e) {
            console.error("Batch export failed:", e);
            showMessage(this.i18n.printFailed, 5000);
        }
    }
}
