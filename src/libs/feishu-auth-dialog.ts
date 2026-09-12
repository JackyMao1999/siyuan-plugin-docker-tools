/*
 * 飞书用户授权对话框（OAuth 手动回填流程）
 */

import { Dialog, showMessage } from "siyuan";
import { forwardProxy, parseJsonBody } from "./feishu-api";
import { FeishuAuth } from "./feishu-auth";
import { copyToClipboard } from "./help-dialog";

export interface FeishuAuthDialogDeps {
    i18n: Record<string, any>;
    auth: FeishuAuth;
    getConfig: () => {
        domain: string;
        appId: string;
        appSecret: string;
        redirectUri: string;
        scope: string;
        authMode: string;
    };
    /** 保存回调地址到插件设置 */
    setRedirectUri?: (value: string) => Promise<void> | void;
    onChanged?: () => void;
}

/** 直接用 user_access_token 拉取用户信息 */
async function fetchUserInfo(domain: string, accessToken: string): Promise<any> {
    const url = `${domain}/open-apis/authen/v1/user_info`;
    const resp = await forwardProxy(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = parseJsonBody(resp, url);
    if (body?.code !== 0) {
        throw new Error(body?.msg || `获取用户信息失败（${body?.code}）`);
    }
    return body.data;
}

export class FeishuAuthDialog {
    private deps: FeishuAuthDialogDeps;
    private dialog: Dialog;
    private statusEl: HTMLElement;
    private alertEl: HTMLElement;
    private logEl: HTMLElement;
    private redirectInput: HTMLInputElement;
    private codeInput: HTMLInputElement;
    private scopeInput: HTMLInputElement;
    private openBtn: HTMLButtonElement;
    private finishBtn: HTMLButtonElement;
    private revokeBtn: HTMLButtonElement;

    constructor(deps: FeishuAuthDialogDeps) {
        this.deps = deps;
        this.dialog = new Dialog({
            title: this.t("feishuAuthTitle", "飞书用户授权"),
            width: "680px",
            height: "600px",
            content: this.buildContent(),
        });

        const root = this.dialog.element;
        this.statusEl = root.querySelector("#feishu-auth-status") as HTMLElement;
        this.alertEl = root.querySelector("#feishu-auth-alert") as HTMLElement;
        this.logEl = root.querySelector("#feishu-auth-log") as HTMLElement;
        this.redirectInput = root.querySelector("#feishu-auth-redirect") as HTMLInputElement;
        this.codeInput = root.querySelector("#feishu-auth-code") as HTMLInputElement;
        this.scopeInput = root.querySelector("#feishu-auth-scope") as HTMLInputElement;
        this.openBtn = root.querySelector("#feishu-auth-open") as HTMLButtonElement;
        this.finishBtn = root.querySelector("#feishu-auth-finish") as HTMLButtonElement;
        this.revokeBtn = root.querySelector("#feishu-auth-revoke") as HTMLButtonElement;

        this.openBtn.onclick = () => this.handleOpenAuthorize();
        this.finishBtn.onclick = () => {
            void this.handleFinish();
        };
        this.revokeBtn.onclick = () => {
            void this.handleRevoke();
        };
        (root.querySelector("#feishu-auth-copy") as HTMLElement).onclick = () => {
            void this.handleCopyRedirect();
        };
        (root.querySelector("#feishu-auth-console") as HTMLElement).onclick = () => this.handleOpenConsole();
        (root.querySelector("#feishu-auth-current") as HTMLElement).onclick = () => {
            void this.handleUseCurrentOrigin();
        };
        this.redirectInput.addEventListener("change", () => {
            void this.saveRedirectUri();
        });

        this.bindEvents();
        void this.init();
    }

    private t(key: string, fallback: string): string {
        const value = this.deps.i18n?.[key];
        return typeof value === "string" && value ? value : fallback;
    }

    private buildContent(): string {
        const config = this.deps.getConfig();
        return `<div class="feishu-auth b3-typography">
    <div class="feishu-auth__status" id="feishu-auth-status"></div>
    <div class="feishu-auth__alert" id="feishu-auth-alert"></div>
    <div class="feishu-auth__steps">
        <b>开始前请先完成「重定向 URL」配置，否则授权页会报 20029 错误。</b>
        <ol>
            <li>点 <b>打开后台配置页</b> → 开发配置 → <b>安全设置</b> → <b>重定向 URL</b> → 添加下方地址并保存/发布。</li>
            <li>确认插件里填的 <b>App ID</b> 就是配置了该地址的那个应用（配置在别的应用上也会报 20029）。</li>
            <li>点 <b>① 打开授权页面</b> → 同意授权 → 复制浏览器<b>地址栏完整网址</b> → 粘回下方 → <b>③ 完成授权</b>。</li>
        </ol>
    </div>
    <div class="feishu-auth__row">
        <span class="feishu-auth__label">重定向 URL</span>
        <input id="feishu-auth-redirect" class="b3-text-field fn__flex-1" value="${this.escapeAttr(config.redirectUri)}">
        <button id="feishu-auth-copy" class="b3-button b3-button--outline">复制</button>
    </div>
    <div class="feishu-auth__row">
        <button id="feishu-auth-console" class="b3-button b3-button--outline">打开后台配置页</button>
        <button id="feishu-auth-current" class="b3-button b3-button--outline">使用当前思源地址</button>
    </div>
    <div class="feishu-auth__row">
        <span class="feishu-auth__label">授权范围</span>
        <input id="feishu-auth-scope" class="b3-text-field fn__flex-1" value="${this.escapeAttr(config.scope)}">
    </div>
    <div class="feishu-auth__row">
        <button id="feishu-auth-open" class="b3-button b3-button--text">① 打开授权页面</button>
    </div>
    <div class="feishu-auth__row">
        <input id="feishu-auth-code" class="b3-text-field fn__flex-1" placeholder="② 粘贴回调网址或授权码 code">
    </div>
    <div class="feishu-auth__row">
        <button id="feishu-auth-finish" class="b3-button b3-button--text">③ 完成授权</button>
        <span class="fn__space"></span>
        <button id="feishu-auth-revoke" class="b3-button b3-button--outline">退出授权</button>
    </div>
    <div class="feishu-auth__log" id="feishu-auth-log"></div>
</div>`;
    }

    private bindEvents() {
        this.codeInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                void this.handleFinish();
            }
        });
    }

    private escapeAttr(text: string): string {
        return (text || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }

    private async init() {
        this.scopeInput.value = this.deps.auth.info?.scope || this.deps.getConfig().scope;
        this.renderStatus();
        this.renderChecklist();

        // 若当前就是浏览器前端且地址栏里带了 code，自动填入
        const href = window.location.href;
        if (/[?&#]code=/.test(href)) {
            this.codeInput.value = href;
            this.appendLog("检测到当前地址包含授权码，已自动填入，可直接点击「完成授权」。");
        }
    }

    private renderStatus() {
        const config = this.deps.getConfig();
        const info = this.deps.auth.info;
        const modeLabel = config.authMode === "user"
            ? this.t("feishuModeUser", "用户身份")
            : this.t("feishuModeTenant", "应用（机器人）身份");
        let text = `当前访问身份：<b>${modeLabel}</b>`;
        if (config.authMode === "user") {
            if (this.deps.auth.isAuthorized) {
                text += ` · 已授权${info?.userName ? "：" + info.userName : ""}`;
            } else {
                text += " · <span class=\"feishu-auth__warn\">尚未授权</span>";
            }
        } else {
            text += "（如需访问你自己的云文档/知识库，请在插件设置中把访问身份改为「用户身份」）";
        }
        this.statusEl.innerHTML = text;
        this.revokeBtn.disabled = !this.deps.auth.isAuthorized;
    }

    /** 显示回调地址校验结果 */
    private renderChecklist() {
        const warning = FeishuAuth.validateRedirectUri(this.redirectInput.value);
        if (warning) {
            this.alertEl.textContent = `⚠️ ${warning}`;
            this.alertEl.classList.remove("fn__none");
        } else {
            this.alertEl.textContent = "";
            this.alertEl.classList.add("fn__none");
        }
    }

    private appendLog(message: string) {
        const line = document.createElement("div");
        line.className = "feishu-auth__log-line";
        line.textContent = message;
        this.logEl.appendChild(line);
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    private async saveRedirectUri() {
        const value = this.redirectInput.value.trim();
        if (this.deps.setRedirectUri) {
            await this.deps.setRedirectUri(value);
        }
        this.renderChecklist();
        return value;
    }

    private async handleCopyRedirect() {
        const ok = await copyToClipboard(this.redirectInput.value.trim());
        showMessage(ok ? "已复制重定向 URL，请粘贴到飞书后台的「重定向 URL」" : "复制失败，请手动选择复制", 4000, ok ? "info" : "error");
    }

    private handleOpenConsole() {
        const config = this.deps.getConfig();
        if (!config.appId) {
            showMessage(this.t("feishuNotConfigured", "请先填写飞书 App ID 与 App Secret"), 4000, "error");
            return;
        }
        const url = FeishuAuth.appConsoleUrl(config.domain, config.appId);
        this.appendLog(`已打开开发者后台，请在「开发配置 → 安全设置 → 重定向 URL」中添加：${this.redirectInput.value.trim()}`);
        window.open(url, "_blank");
    }

    private async handleUseCurrentOrigin() {
        const origin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "";
        if (!origin) {
            showMessage("无法获取当前思源地址，请手动填写", 4000, "error");
            return;
        }
        this.redirectInput.value = `${origin}/`;
        await this.saveRedirectUri();
        this.appendLog(`已填入当前思源地址：${origin}/（请同样把它加到飞书后台的重定向 URL）`);
    }

    private handleOpenAuthorize() {
        const config = this.deps.getConfig();
        if (!config.appId || !config.appSecret) {
            showMessage(this.t("feishuNotConfigured", "请先填写飞书 App ID 与 App Secret"), 4000, "error");
            return;
        }
        const redirectUri = this.redirectInput.value.trim();
        const warning = FeishuAuth.validateRedirectUri(redirectUri);
        if (warning) {
            this.renderChecklist();
            showMessage(warning, 5000, "error");
            return;
        }
        void this.saveRedirectUri();

        const scope = this.scopeInput.value.trim() || config.scope;
        const url = this.deps.auth.buildAuthorizeUrl(config.domain, config.appId, redirectUri, scope);
        this.appendLog("已打开授权页面。若授权页提示 20029（重定向 URL 有误）：");
        this.appendLog(`请到「开发配置 → 安全设置 → 重定向 URL」添加：${redirectUri}`);
        this.appendLog("并确认 App ID 与配置该地址的应用一致，然后重新打开授权页。");
        window.open(url, "_blank");
    }

    private async handleFinish() {
        const config = this.deps.getConfig();
        if (!config.appId || !config.appSecret) {
            showMessage(this.t("feishuNotConfigured", "请先填写飞书 App ID 与 App Secret"), 4000, "error");
            return;
        }
        const code = FeishuAuth.extractCode(this.codeInput.value);
        if (!code) {
            showMessage("未能从粘贴内容中解析出授权码，请复制浏览器地址栏的完整网址", 5000, "error");
            return;
        }
        this.finishBtn.disabled = true;
        this.appendLog("正在用授权码换取 user_access_token...");
        try {
            const scope = this.scopeInput.value.trim() || config.scope;
            const redirectUri = this.redirectInput.value.trim() || config.redirectUri;
            await this.deps.auth.exchangeCode(
                config.domain,
                config.appId,
                config.appSecret,
                code,
                redirectUri,
                scope
            );
            this.appendLog("授权成功。");
            try {
                const info = await fetchUserInfo(config.domain, this.deps.auth.info!.accessToken);
                await this.deps.auth.saveUserInfo(info?.name || "", info?.open_id || "");
                this.appendLog(`已授权用户：${info?.name || "(未知)"}`);
            } catch (e) {
                this.appendLog(`获取用户信息失败（不影响同步）：${e instanceof Error ? e.message : e}`);
            }
            this.codeInput.value = "";
            this.renderStatus();
            this.deps.onChanged?.();
            showMessage("飞书用户授权成功", 4000);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.appendLog(`授权失败：${message}`);
            showMessage(`授权失败：${message}`, 6000, "error");
        } finally {
            this.finishBtn.disabled = false;
        }
    }

    private async handleRevoke() {
        await this.deps.auth.clear();
        this.appendLog("已退出授权。");
        this.renderStatus();
        this.deps.onChanged?.();
        showMessage("已退出飞书用户授权", 3000);
    }
}
