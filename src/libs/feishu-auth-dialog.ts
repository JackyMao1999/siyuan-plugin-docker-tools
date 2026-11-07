/*
 * 飞书用户授权对话框（自动回调与手动回填）
 */

import { Dialog, showMessage, getFrontend } from "siyuan";
import { forwardProxy, parseJsonBody, trustedFeishuDomain } from "./feishu-api";
import { FeishuAuth, mergeScopes, missingScopes } from "./feishu-auth";
import { browserRedirectUri, createOAuthState, DESKTOP_REDIRECT_URI, FeishuOAuthCallback } from "./feishu-oauth-callback";
import { copyToClipboard } from "./help-dialog";

export interface FeishuAuthDialogDeps {
    i18n: Record<string, any>;
    pluginName: string;
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
    onAuthorized?: () => void;
}

/** 直接用 user_access_token 拉取用户信息 */
async function fetchUserInfo(domain: string, accessToken: string): Promise<any> {
    const url = `${trustedFeishuDomain(domain)}/open-apis/authen/v1/user_info`;
    const resp = await forwardProxy(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
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
    private callback: FeishuOAuthCallback | null = null;
    private closed = false;
    private busy = false;

    private get desktop(): boolean {
        return ["desktop", "desktop-window"].includes(getFrontend());
    }

    private get recommendedUri(): string {
        return this.desktop ? DESKTOP_REDIRECT_URI : browserRedirectUri(this.deps.pluginName);
    }

    destroy(): void { if (!this.closed) this.dialog.destroy(); }


    constructor(deps: FeishuAuthDialogDeps) {
        this.deps = deps;
        this.dialog = new Dialog({
            title: this.t("feishuAuthTitle", "飞书用户授权"),
            width: "680px",
            height: "680px",
            destroyCallback: () => { this.closed = true; this.callback?.stop(); },
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

        this.openBtn.onclick = () => { void this.handleOpenAuthorize(); };
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
        <b>首次使用时配置一次「重定向 URL」即可；地址不变时无需重复配置。</b>
        <ol>
            <li>点 <b>打开后台配置页</b> → 开发配置 → <b>安全设置</b> → <b>重定向 URL</b> → 添加下方地址并保存/发布。</li>
            <li>确认插件里填的 <b>App ID</b> 就是配置了该地址的那个应用（配置在别的应用上也会报 20029）。</li>
            <li>点 <b>① 打开授权页面</b> → 同意授权 → 自动完成令牌交换。请保持此对话框打开。</li>
        </ol>
    </div>
    <div class="feishu-auth__row">
        <span class="feishu-auth__label">重定向 URL</span>
        <input id="feishu-auth-redirect" class="b3-text-field fn__flex-1" value="${this.escapeAttr(config.redirectUri)}">
        <button id="feishu-auth-copy" class="b3-button b3-button--outline">复制</button>
    </div>
    <div class="feishu-auth__row">
        <button id="feishu-auth-console" class="b3-button b3-button--outline">打开后台配置页</button>
        <button id="feishu-auth-current" class="b3-button b3-button--outline">使用推荐回调地址</button>
    </div>
    <div class="feishu-auth__row">
        <span class="feishu-auth__label">授权范围</span>
        <input id="feishu-auth-scope" class="b3-text-field fn__flex-1" value="${this.escapeAttr(config.scope)}">
    </div>
    <div class="feishu-auth__row">
        <button id="feishu-auth-open" class="b3-button b3-button--text">① 打开授权页面</button>
    </div>
    <div class="feishu-auth__row">
        <input id="feishu-auth-code" class="b3-text-field fn__flex-1" placeholder="自动回传失败时，可粘贴本次授权的完整回调网址">
    </div>
    <div class="feishu-auth__row">
        <button id="feishu-auth-finish" class="b3-button b3-button--text">手动完成授权</button>
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

    /** 当前授权记录相对插件所需权限缺失的部分（offline_access 仅用于刷新令牌，不影响接口调用） */
    private missingGrantedScopes(): string[] {
        const required = this.deps.getConfig().scope;
        return missingScopes(this.deps.auth.info?.scope, required).filter((scope) => scope !== "offline_access");
    }

    private async init() {
        // 老授权记录可能缺少后续新增的权限（如 board:whiteboard:node:read），
        // 这里把「已授权」与「插件所需」取并集，重新授权时一并申请
        this.scopeInput.value = mergeScopes(this.deps.auth.info?.scope, this.deps.getConfig().scope)
            .split(" ").filter(scope => scope !== "offline_access").join(" ");
        // The client-specific callback is persisted by the plugin. Opening this dialog must not rewrite it.
        this.renderStatus();
        this.renderChecklist();

        const missing = this.missingGrantedScopes();
        if (this.deps.auth.isAuthorized && missing.length) {
            this.appendLog(`⚠️ 当前授权缺少权限：${missing.join("、")}`);
            this.appendLog("点「① 打开授权页面」重新授权即可（授权范围已自动补全），否则相关接口会报 99991679。");
        }

    }

    private renderStatus() {
        const config = this.deps.getConfig();
        const info = this.deps.auth.info;
        const modeLabel = config.authMode === "user"
            ? this.t("feishuModeUser", "用户身份")
            : this.t("feishuModeTenant", "应用（机器人）身份");
        let text = `当前访问身份：<b>${this.escapeAttr(modeLabel)}</b>`;
        if (config.authMode === "user") {
            if (this.deps.auth.isAuthorized) {
                text += ` · 已授权${info?.userName ? "：" + this.escapeAttr(info.userName) : ""}`;
                const missing = this.missingGrantedScopes();
                if (missing.length) {
                    text += ` · <span class="feishu-auth__warn">缺少权限：${this.escapeAttr(missing.join("、"))}（请重新授权）</span>`;
                }
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
        this.redirectInput.value = this.recommendedUri;
        await this.saveRedirectUri();
        this.appendLog(`已填入推荐回调地址：${this.recommendedUri}（若飞书后台尚未登记此地址，请添加一次；已登记则无需修改）`);
    }

    private setBusy(value: boolean) {
        this.busy = value;
        this.openBtn.disabled = value;
        this.finishBtn.disabled = value;
        this.revokeBtn.disabled = value || !this.deps.auth.isAuthorized;
        this.redirectInput.disabled = value;
        this.scopeInput.disabled = value;
    }

    private reportError(message: string) {
        if (this.closed) return;
        this.appendLog(message);
        showMessage(message, 6000, "error");
        this.setBusy(false);
    }

    private async handleOpenAuthorize() {
        if (this.busy) return;
        const config = this.deps.getConfig();
        const redirectUri = this.redirectInput.value.trim();
        const warning = FeishuAuth.validateRedirectUri(redirectUri);
        if (warning || !config.appId || !config.appSecret) {
            this.reportError(warning || "请先填写飞书 App ID 与 App Secret");
            return;
        }
        // Reserve a browser tab while still inside the click gesture (before awaiting setup).
        const popup = this.desktop ? null : window.open("about:blank", "_blank");
        if (!this.desktop && !popup) {
            this.reportError("浏览器阻止了授权窗口，请允许此站点打开弹窗后重试");
            return;
        }
        this.callback?.stop();
        this.setBusy(true);
        try {
            const scope = this.scopeInput.value.trim() || config.scope;
            const state = createOAuthState();
            const url = this.deps.auth.buildAuthorizeUrl(config.domain, config.appId, redirectUri, scope, state);
            const callback = new FeishuOAuthCallback(redirectUri, state, async code => {
                const current = this.deps.getConfig();
                if (current.appId !== config.appId || current.appSecret !== config.appSecret || current.domain !== config.domain) {
                    throw new Error("应用配置已改变，请重新授权");
                }
                this.setBusy(true);
                await this.exchangeCode(code, { ...config, redirectUri, scope });
            }, message => this.reportError(message));
            this.callback = callback;
            await callback.start(this.desktop, this.desktop ? "" : browserRedirectUri(this.deps.pluginName));
            await this.saveRedirectUri();
            if (this.closed) { callback.stop(); popup?.close(); return; }
            if (popup) {
                // Callback delivery uses BroadcastChannel and does not need window.opener.
                popup.opener = null;
                popup.location.replace(url);
            } else {
                const nodeRequire = (window as any).require;
                await nodeRequire("electron").shell.openExternal(url);
            }
            this.appendLog("已打开授权页面，同意授权后将自动交换并保存令牌。请保持此对话框打开。");
            this.setBusy(false);
        } catch (e) {
            this.callback?.stop();
            popup?.close();
            this.reportError(e instanceof Error ? e.message : "无法打开授权页面");
        }
    }

    private async handleFinish() {
        if (this.busy) return;
        if (!this.callback || !/^https?:\/\//i.test(this.codeInput.value.trim())) {
            this.reportError("请先打开授权页面，再粘贴本次授权的完整回调网址（包含 code 和 state）");
            return;
        }
        try {
            await this.callback.complete(this.codeInput.value.trim());
            this.codeInput.value = "";
        } catch (e) {
            this.reportError(e instanceof Error ? e.message : "授权失败，请重新授权");
        }
    }

    private async exchangeCode(code: string, config: ReturnType<FeishuAuthDialogDeps["getConfig"]>) {
        this.appendLog("正在自动交换授权令牌...");
        await this.deps.auth.exchangeCode(config.domain, config.appId, config.appSecret, code, config.redirectUri, config.scope);
        try {
            const info = await fetchUserInfo(config.domain, this.deps.auth.info!.accessToken);
            await this.deps.auth.saveUserInfo(info?.name || "", info?.open_id || "");
        } catch {
            this.appendLog("未获取到用户显示名，不影响同步。");
        }
        if (this.closed) return;
        this.appendLog("授权成功，令牌已保存。");
        if (!this.deps.auth.info?.refreshToken) this.appendLog("本次未取得刷新令牌，访问令牌到期后需重新授权。");
        this.setBusy(false);
        this.renderStatus();
        this.deps.onChanged?.();
        showMessage("飞书用户授权成功", 4000);
        this.deps.onAuthorized?.();
    }

    private async handleRevoke() {
        if (this.busy) return;
        this.callback?.stop();
        this.callback = null;
        this.codeInput.value = "";
        await this.deps.auth.clear();
        this.appendLog("已退出授权。");
        this.renderStatus();
        this.deps.onChanged?.();
        showMessage("已退出飞书用户授权", 3000);
    }
}
