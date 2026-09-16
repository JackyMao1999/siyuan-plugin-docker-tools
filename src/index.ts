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
import { exportToPdf, exportRenderedToPdf, DEFAULT_OPTIONS } from "./libs/export-utils";
import { FEISHU_DOMAIN_CN, FEISHU_DOMAIN_LARK, FeishuClient } from "./libs/feishu-api";
import { DEFAULT_SYNC_OPTIONS, FeishuSync, FeishuSyncOptions } from "./libs/feishu-sync";
import { FeishuSyncDialog } from "./libs/feishu-dialog";
import { openHelpDialog } from "./libs/help-dialog";
import { getExportHelpTopics, getFeishuHelpTopics } from "./libs/help-content";
import { DEFAULT_USER_SCOPE, FeishuAuth, missingScopes } from "./libs/feishu-auth";
import { FeishuAuthDialog } from "./libs/feishu-auth-dialog";

const STORAGE_NAME = "doc-export-config";
const FEISHU_CONFIG_FILE = "feishu-sync-config.json";
const FEISHU_AUTH_FILE = "feishu-auth.json";
const DEFAULT_REDIRECT_URI = "http://localhost:8080/feishu-callback";

export default class DocExportPlugin extends Plugin {

    private isMobile: boolean;
    private settingUtils: SettingUtils;
    private feishuClient: FeishuClient;
    private feishuSync: FeishuSync;
    private feishuAuth: FeishuAuth;
    private feishuOptions: FeishuSyncOptions = { ...DEFAULT_SYNC_OPTIONS };

    async onload() {
        try {
            console.log("loading plugin-doc-export-tools", this.i18n);

            this.data[STORAGE_NAME] = {};

            const frontEnd = getFrontend();
            this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

            this.addIcons(`<symbol id="iconPrint" viewBox="0 0 32 32">
<path d="M26.667 8h-1.333v-5.333c0-0.733-0.6-1.333-1.333-1.333h-16c-0.733 0-1.333 0.6-1.333 1.333v5.333h-1.333c-1.467 0-2.667 1.2-2.667 2.667v10.667c0 1.467 1.2 2.667 2.667 2.667h1.333v5.333c0 0.733 0.6 1.333 1.333 1.333h16c0.733 0 1.333-0.6 1.333-1.333v-5.333h1.333c1.467 0 2.667-1.2 2.667-2.667v-10.667c0-1.467-1.2-2.667-2.667-2.667zM9.333 4h13.333v4h-13.333v-4zM22.667 28h-13.333v-8h13.333v8zM26.667 21.333h-1.333v-2.667c0-0.733-0.6-1.333-1.333-1.333h-16c-0.733 0-1.333 0.6-1.333 1.333v2.667h-1.333v-10.667h21.333v10.667zM18.667 22.667h-5.333v1.333h5.333v-1.333z"></path>
</symbol>`);
            this.addIcons(`<symbol id="iconDocker" viewBox="0 0 24 24">
<path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"></path>
</symbol>`);
            this.addIcons(`<symbol id="iconPDF" viewBox="0 0 32 32">
<path d="M24 2h-16c-1.1 0-2 0.9-2 2v24c0 1.1 0.9 2 2 2h16c1.1 0 2-0.9 2-2v-24c0-1.1-0.9-2-2-2zM24 28h-16v-24h16v24zM8 24h16v2h-16zM11 12h3v-3h-3v3zM15 12h3v-3h-3v3zM11 17h3v-3h-3v3zM15 17h3v-3h-3v3zM11 22h3v-3h-3v3zM15 22h3v-3h-3v3z"></path>
</symbol>`);
            this.addIcons(`<symbol id="iconBatch" viewBox="0 0 32 32">
<path d="M27 4h-22c-0.6 0-1 0.4-1 1v22c0 0.6 0.4 1 1 1h22c0.6 0 1-0.4 1-1v-22c0-0.6-0.4-1-1-1zM26 26h-20v-20h20v20zM10 14h12v2h-12zM10 18h12v2h-12zM10 22h8v2h-8zM10 10h12v2h-12z"></path>
</symbol>`);
            this.addIcons(`<symbol id="iconFeishuSync" viewBox="0 0 32 32">
<path d="M16 3 5 9.5v13L16 29l11-6.5v-13L16 3zm0 2.3 8.7 5.1v10.2L16 25.7 7.3 20.6V10.4L16 5.3z"></path>
<path d="M16 10.5l-4.5 2.6v5.2l4.5 2.6 4.5-2.6v-5.2L16 10.5zm0 2.3 2.4 1.4v2.8L16 18.4l-2.4-1.4v-2.8L16 12.8z"></path>
</symbol>`);
            this.addIcons(`<symbol id="iconFeishuUser" viewBox="0 0 32 32">
<path d="M16 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 2.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z"></path>
<path d="M6 28c0-5 4.5-8.4 10-8.4S26 23 26 28h-2.6c0-3.6-3.3-6-7.4-6s-7.4 2.4-7.4 6H6z"></path>
</symbol>`);
            this.addIcons(`<symbol id="iconFeishuHelp" viewBox="0 0 32 32">
<path d="M16 2C8.3 2 2 8.3 2 16s6.3 14 14 14 14-6.3 14-14S23.7 2 16 2zm0 25.4C9.7 27.4 4.6 22.3 4.6 16S9.7 4.6 16 4.6 27.4 9.7 27.4 16 22.3 27.4 16 27.4z"></path>
<path d="M16 22.5a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z"></path>
<path d="M16 6.8c-2.9 0-5.1 2-5.1 4.8h2.6c0-1.4 1.1-2.4 2.5-2.4s2.4.9 2.4 2.1c0 .9-.5 1.5-1.6 2.2-1.4.9-1.9 1.7-1.9 3v.5h2.5v-.4c0-1 .4-1.6 1.6-2.4 1.3-.9 1.9-1.8 1.9-3.1 0-2.5-2.1-4.3-4.9-4.3z"></path>
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

            // 初始化飞书知识库同步
            this.feishuAuth = new FeishuAuth(
                () => this.loadData(FEISHU_AUTH_FILE),
                async (tokens) => {
                    if (tokens) {
                        await this.saveData(FEISHU_AUTH_FILE, tokens);
                    } else {
                        await this.removeData(FEISHU_AUTH_FILE);
                    }
                }
            );
            await this.feishuAuth.init();
            this.feishuClient = new FeishuClient(this.getFeishuCredentials());
            this.feishuClient.setUserTokenProvider(this.feishuAuth);
            this.feishuSync = new FeishuSync(this, this.feishuClient);
            await this.loadFeishuOptions();
            try {
                await this.feishuSync.loadRecords();
            } catch (error) {
                console.error("Error loading feishu sync records:", error);
            }

            this.addCommand({
                langKey: "printDoc",
                hotkey: "⌃⌥P",
                callback: () => {
                    this.handleExportPdf().catch(e => console.error("exportPdf failed:", e));
                },
            });

            this.addCommand({
                langKey: "exportPdf",
                hotkey: "⌃⌥D",
                callback: () => {
                    this.handleExportPdf().catch(e => console.error("exportPdf failed:", e));
                },
            });

            this.addCommand({
                langKey: "feishuSync",
                hotkey: "⌃⌥F",
                callback: () => {
                    this.openFeishuSync();
                },
            });

            console.log(this.i18n.helloPlugin);
        } catch (error) {
            console.error("Plugin onload error:", error);
        }
    }

    onLayoutReady() {
        const topBarElement = this.addTopBar({
            icon: "iconDocker",
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
        // 顶部 tab 切换：只显示当前分组的设置项
        this.settingUtils.addTabs([
            { id: "export", label: this.i18n.settingTabExport || "导出 PDF / 打印" },
            { id: "feishu", label: this.i18n.settingTabFeishu || "飞书知识库同步" },
            { id: "general", label: this.i18n.settingTabGeneral || "通用 / 帮助" },
        ]);

        this.settingUtils.useGroup("general");

        this.settingUtils.addItem({
            key: "help",
            value: "",
            type: "button",
            title: this.i18n.helpTitle,
            description: this.i18n.helpDesc,
            button: {
                label: this.i18n.helpButton,
                callback: () => this.openHelp()
            }
        });

        this.settingUtils.useGroup("export");

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
            key: "exportMethod",
            value: DEFAULT_OPTIONS.exportMethod,
            type: "select",
            title: this.i18n.exportMethod,
            description: this.i18n.exportMethodDesc,
            options: {
                "dom": "DOM " + (this.i18n.exportMethodDom || "Clone"),
                "markdown": "Markdown " + (this.i18n.exportMethodMd || "Convert")
            },
            action: { callback: () => this.settingUtils.takeAndSave("exportMethod") }
        });

        this.settingUtils.useGroup("feishu");

        this.settingUtils.addItem({
            key: "feishuBoardWidth",
            value: DEFAULT_SYNC_OPTIONS.boardImageWidth,
            type: "number",
            title: this.i18n.feishuBoardWidth,
            description: this.i18n.feishuBoardWidthDesc,
            action: { callback: () => this.settingUtils.takeAndSave("feishuBoardWidth") }
        });

        this.settingUtils.addItem({
            key: "feishuDomain",
            value: FEISHU_DOMAIN_CN,
            type: "select",
            title: this.i18n.feishuDomain,
            description: this.i18n.feishuDomainDesc,
            options: {
                [FEISHU_DOMAIN_CN]: "飞书 (feishu.cn)",
                [FEISHU_DOMAIN_LARK]: "Lark (larksuite.com)"
            },
            action: {
                callback: () => {
                    this.settingUtils.takeAndSave("feishuDomain").then(() => this.refreshFeishuCredentials());
                }
            }
        });

        this.settingUtils.addItem({
            key: "feishuAppId",
            value: "",
            type: "textinput",
            title: this.i18n.feishuAppId,
            description: this.i18n.feishuAppIdDesc,
            action: {
                callback: () => {
                    this.settingUtils.takeAndSave("feishuAppId").then(() => this.refreshFeishuCredentials());
                }
            }
        });

        this.settingUtils.addItem({
            key: "feishuAppSecret",
            value: "",
            type: "textinput",
            title: this.i18n.feishuAppSecret,
            description: this.i18n.feishuAppSecretDesc,
            action: {
                callback: () => {
                    this.settingUtils.takeAndSave("feishuAppSecret").then(() => this.refreshFeishuCredentials());
                }
            }
        });

        this.settingUtils.addItem({
            key: "feishuAuthMode",
            value: "tenant",
            type: "select",
            title: this.i18n.feishuAuthMode,
            description: this.i18n.feishuAuthModeDesc,
            options: {
                "tenant": this.i18n.feishuAuthModeTenant,
                "user": this.i18n.feishuAuthModeUser
            },
            action: {
                callback: () => {
                    this.settingUtils.takeAndSave("feishuAuthMode").then(() => this.refreshFeishuCredentials());
                }
            }
        });

        this.settingUtils.addItem({
            key: "feishuRedirectUri",
            value: DEFAULT_REDIRECT_URI,
            type: "textinput",
            title: this.i18n.feishuRedirectUri,
            description: this.i18n.feishuRedirectUriDesc,
            action: { callback: () => this.settingUtils.takeAndSave("feishuRedirectUri") }
        });

        this.settingUtils.addItem({
            key: "feishuAuth",
            value: "",
            type: "button",
            title: this.i18n.feishuAuthTitle,
            description: this.i18n.feishuAuthDesc,
            button: {
                label: this.i18n.feishuAuthButton,
                callback: () => this.openFeishuAuth()
            }
        });

    }

    /** 读取飞书应用凭据 */
    private getFeishuCredentials() {
        return {
            domain: (this.settingUtils?.get("feishuDomain") as string) || FEISHU_DOMAIN_CN,
            appId: (this.settingUtils?.get("feishuAppId") as string) || "",
            appSecret: (this.settingUtils?.get("feishuAppSecret") as string) || "",
            authMode: ((this.settingUtils?.get("feishuAuthMode") as string) === "user" ? "user" : "tenant") as "user" | "tenant",
        };
    }

    private getFeishuRedirectUri(): string {
        return ((this.settingUtils?.get("feishuRedirectUri") as string) || "").trim() || DEFAULT_REDIRECT_URI;
    }

    private getFeishuAuthConfig() {
        return {
            ...this.getFeishuCredentials(),
            redirectUri: this.getFeishuRedirectUri(),
            scope: DEFAULT_USER_SCOPE,
        };
    }

    /** 画板 / mermaid 图片最大宽度（px，0 = 原始尺寸） */
    private getBoardImageWidth(): number {
        const value = Number(this.settingUtils?.get("feishuBoardWidth"));
        if (!Number.isFinite(value) || value <= 0) return 0;
        return Math.min(4000, Math.round(value));
    }

    /** 用户身份下当前授权记录缺失的权限（offline_access 只用于刷新令牌，不提示） */
    private getMissingUserScopes(): string[] {
        if (this.getFeishuCredentials().authMode !== "user") return [];
        if (!this.feishuAuth?.isAuthorized) return [];
        return missingScopes(this.feishuAuth.info?.scope, DEFAULT_USER_SCOPE)
            .filter((scope) => scope !== "offline_access");
    }

    /** 当前身份描述，用于同步对话框提示 */
    private getFeishuIdentityLabel(): string {
        const credentials = this.getFeishuCredentials();
        if (credentials.authMode !== "user") {
            return "应用（机器人）身份";
        }
        if (this.feishuAuth?.isAuthorized) {
            const name = this.feishuAuth.info?.userName;
            return name ? `用户身份（${name}）` : "用户身份";
        }
        return "用户身份（未授权）";
    }

    private refreshFeishuCredentials() {
        if (this.feishuClient) {
            this.feishuClient.setCredentials(this.getFeishuCredentials());
        }
    }

    /** 打开飞书用户授权对话框 */
    private openFeishuAuth() {
        const credentials = this.getFeishuCredentials();
        if (!credentials.appId || !credentials.appSecret) {
            showMessage(this.i18n.feishuNotConfigured, 5000, "error");
            this.openSetting();
            return;
        }
        new FeishuAuthDialog({
            i18n: this.i18n as any,
            auth: this.feishuAuth,
            getConfig: () => this.getFeishuAuthConfig(),
            setRedirectUri: async (value: string) => {
                await this.settingUtils.setAndSave("feishuRedirectUri", value);
            },
            onChanged: () => this.refreshFeishuCredentials(),
        });
    }

    private async loadFeishuOptions() {
        try {
            const data = await this.loadData(FEISHU_CONFIG_FILE);
            if (data) {
                this.feishuOptions = { ...DEFAULT_SYNC_OPTIONS, ...data };
            }
        } catch (error) {
            console.error("Error loading feishu sync options:", error);
        }
    }

    private saveFeishuOptions = async (options: FeishuSyncOptions) => {
        this.feishuOptions = { ...options };
        await this.saveData(FEISHU_CONFIG_FILE, this.feishuOptions);
    }

    /** 打开使用帮助（可检索的配置向导） */
    private openHelp() {
        openHelpDialog(
            this.i18n.helpTitle || "使用帮助",
            [...getFeishuHelpTopics(), ...getExportHelpTopics()],
            {
                searchPlaceholder: this.i18n.helpSearch || "搜索：如「权限」「App ID」「图片」「边距」",
                noResult: this.i18n.helpNoResult || "没有找到相关内容，换个关键词试试",
                copy: this.i18n.helpCopy || "复制",
                copied: this.i18n.helpCopied || "已复制到剪贴板",
                copyFailed: this.i18n.helpCopyFailed || "复制失败，请手动选择复制",
            }
        );
    }

    /** 打开飞书知识库同步对话框 */
    private openFeishuSync() {
        const credentials = this.getFeishuCredentials();
        if (!credentials.appId || !credentials.appSecret) {
            showMessage(this.i18n.feishuNotConfigured, 5000, "error");
            this.openSetting();
            return;
        }
        this.feishuClient.setCredentials(credentials);
        new FeishuSyncDialog({
            client: this.feishuClient,
            sync: this.feishuSync,
            i18n: this.i18n as any,
            // 画板图片宽度取自插件设置，改了设置无需重开对话框
            getOptions: () => ({ ...this.feishuOptions, boardImageWidth: this.getBoardImageWidth() }),
            saveOptions: this.saveFeishuOptions,
            openSetting: () => this.openSetting(),
            identityLabel: () => this.getFeishuIdentityLabel(),
            isUserMode: () => this.getFeishuCredentials().authMode === "user",
            getMissingScopes: () => this.getMissingUserScopes(),
            openAuth: () => this.openFeishuAuth(),
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
            showToc: this.settingUtils.get("showToc") ?? DEFAULT_OPTIONS.showToc,
            pageHeader: this.settingUtils.get("pageHeader") ?? DEFAULT_OPTIONS.pageHeader,
            pageFooter: this.settingUtils.get("pageFooter") ?? DEFAULT_OPTIONS.pageFooter,
            customCSS: this.settingUtils.get("customCSS") || DEFAULT_OPTIONS.customCSS,
            exportMethod: (this.settingUtils.get("exportMethod") as "dom" | "markdown") || DEFAULT_OPTIONS.exportMethod,
        };
    }

    private showPrintMenu(rect?: DOMRect) {
        const menu = new Menu("docPrintMenu", () => {});
        menu.addItem({
            icon: "iconPrint",
            label: this.i18n.printDoc,
            accelerator: adaptHotkey("⌃⌥P"),
            click: () => this.handleExportPdf().catch(e => console.error("Export failed:", e))
        });
        menu.addItem({
            icon: "iconPDF",
            label: this.i18n.exportPdf,
            accelerator: adaptHotkey("⌃⌥D"),
            click: () => this.handleExportPdf().catch(e => console.error("PDF export failed:", e))
        });
        menu.addSeparator();
        menu.addItem({
            icon: "iconFeishuSync",
            label: this.i18n.feishuSync,
            accelerator: adaptHotkey("⌃⌥F"),
            click: () => this.openFeishuSync()
        });
        menu.addItem({
            icon: "iconFeishuUser",
            label: this.i18n.feishuAuthMenu,
            click: () => this.openFeishuAuth()
        });
        menu.addSeparator();
        menu.addItem({
            icon: "iconFeishuHelp",
            label: this.i18n.helpMenu,
            click: () => this.openHelp()
        });
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
                if (!el || el.classList.contains('fn__none')) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    return editor;
                }
            } catch (e) {
                continue;
            }
        }
        showMessage(this.i18n.noOpenDoc);
        return null;
    }

    private async handleExportPdf() {
        const editor = this.getEditor();
        if (!editor) return;

        const options = this.getOptions();
        const docId = editor.protyle.block.rootID;

        if (options.exportMethod === 'dom') {
            const wysiwyg = editor.protyle.wysiwyg?.element;
            if (wysiwyg && wysiwyg.children.length > 0) {
                const title = editor.protyle.title?.element?.textContent?.trim() || 'document';
                try {
                    await exportRenderedToPdf(wysiwyg, title, options);
                    return;
                } catch (e) {
                    console.warn("DOM export failed, falling back to Markdown:", e);
                }
            }
        }

        try {
            await exportToPdf(docId, options);
        } catch (e) {
            console.error("PDF export failed:", e);
            showMessage(this.i18n.printFailed, 5000);
        }
    }
}
