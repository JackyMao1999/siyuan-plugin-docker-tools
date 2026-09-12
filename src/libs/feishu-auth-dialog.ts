/*
 * 飞书用户授权对话框（OAuth 手动回填流程）
 */

import { Dialog, showMessage } from "siyuan";
import { forwardProxy, parseJsonBody } from "./feishu-api";
import { FeishuAuth } from "./feishu-auth";

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
    private logEl: HTMLElement;
    private redirectEl: HTMLElement;
    private codeInput: HTMLInputElement;
    private scopeInput: HTMLInputElement;
    private openBtn: HTMLButtonElement;
    private finishBtn: HTMLButtonElement;
    private revokeBtn: HTMLButtonElement;

    constructor(deps: FeishuAuthDialogDeps) {
        this.deps = deps;
        this.dialog = new Dialog({
            title: this.t("feishuAuthTitle", "飞书用户授权"),
            width: "640px",
            height: "520px",
            content: this.buildContent(),
        });

        const root = this.dialog.element;
        this.statusEl = root.querySelector("#feishu-auth-status") as HTMLElement;
        this.logEl = root.querySelector("#feishu-auth-log") as HTMLElement;
        this.redirectEl = root.querySelector("#feishu-auth-redirect") as HTMLElement;
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
    <div class="feishu-auth__steps">
        <ol>
            <li>点击 <b>① 打开授权页面</b>，在浏览器中登录飞书并同意授权。</li>
            <li>授权后浏览器会跳转到一个打不开的页面，这是正常的。</li>
            <li>复制地址栏里的<b>完整网址</b>（含 <code>code=</code>），粘贴到下方输入框。</li>
            <li>点击 <b>③ 完成授权</b>。</li>
        </ol>
    </div>
    <div class="feishu-auth__row">
        <span class="feishu-auth__label">回调地址</span>
        <span id="feishu-auth-redirect" class="feishu-auth__value"></span>
    </div>
    <div class="feishu-auth__row">
        <span class="feishu-auth__label">授权范围</span>
        <input id="feishu-auth-scope" class="b3-text-field fn__flex-1" value="${this.escapeAttr(config.scope)}">
    </div>
    <div class="feishu-auth__row">
        <button id="feishu-auth-open" class="b3-button b3-button--outline">① 打开授权页面</button>
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
        const config = this.deps.getConfig();
        this.redirectEl.textContent = config.redirectUri || "（未设置）";
        this.scopeInput.value = this.deps.auth.info?.scope || config.scope;
        this.renderStatus();

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

    private appendLog(message: string) {
        const line = document.createElement("div");
        line.className = "feishu-auth__log-line";
        line.textContent = message;
        this.logEl.appendChild(line);
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    private handleOpenAuthorize() {
        const config = this.deps.getConfig();
        if (!config.appId || !config.appSecret) {
            showMessage(this.t("feishuNotConfigured", "请先填写飞书 App ID 与 App Secret"), 4000, "error");
            return;
        }
        if (!config.redirectUri) {
            showMessage("请先在插件设置中填写回调地址（redirect_uri）", 4000, "error");
            return;
        }
        const scope = this.scopeInput.value.trim() || config.scope;
        const url = this.deps.auth.buildAuthorizeUrl(config.domain, config.appId, config.redirectUri, scope);
        this.appendLog(`已打开授权页面，回调地址：${config.redirectUri}`);
        this.appendLog("请在浏览器中完成授权，然后把地址栏的完整网址粘贴回上面的输入框。");
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
            await this.deps.auth.exchangeCode(
                config.domain,
                config.appId,
                config.appSecret,
                code,
                config.redirectUri,
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
