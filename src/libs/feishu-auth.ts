/*
 * 飞书用户身份授权（OAuth 2.0 授权码模式）
 *
 * 说明：
 *  - 应用（tenant_access_token）身份只能看到「被授权给应用」的知识库/文档；
 *    用户（user_access_token）身份则可以看到「当前用户自己」的云文档与知识库。
 *  - 插件无法接收 HTTP 回调，因此采用「手动回填」方式：
 *    打开授权页 → 授权后浏览器跳转到回调地址（页面打不开没关系）
 *    → 把地址栏里的完整回调地址（含 code）粘回来即可。
 */

import { FeishuClient, forwardProxy, parseJsonBody } from "./feishu-api";

/** 用户授权默认申请的权限（offline_access 用于获取 refresh_token） */
export const DEFAULT_USER_SCOPE =
    "wiki:wiki:readonly docx:document:readonly drive:drive:readonly offline_access";

export interface FeishuUserTokens {
    accessToken: string;
    refreshToken: string;
    /** access_token 过期时间（毫秒时间戳） */
    accessExpire: number;
    /** refresh_token 过期时间（毫秒时间戳） */
    refreshExpire: number;
    /** 授权范围 */
    scope?: string;
    /** 授权时使用的 App ID，用于判断应用是否被更换 */
    appId?: string;
    /** 授权用户显示名 */
    userName?: string;
    /** 授权用户 open_id */
    openId?: string;
}

export class FeishuAuth {
    private tokens: FeishuUserTokens | null = null;
    private loader: () => Promise<FeishuUserTokens | null>;
    private saver: (tokens: FeishuUserTokens | null) => Promise<void>;

    constructor(loader: () => Promise<FeishuUserTokens | null>, saver: (tokens: FeishuUserTokens | null) => Promise<void>) {
        this.loader = loader;
        this.saver = saver;
    }

    async init(): Promise<void> {
        try {
            this.tokens = await this.loader();
        } catch (e) {
            console.warn("读取飞书用户授权信息失败:", e);
            this.tokens = null;
        }
    }

    get info(): FeishuUserTokens | null {
        return this.tokens;
    }

    get isAuthorized(): boolean {
        return !!this.tokens?.accessToken;
    }

    /** 判断当前保存的授权是否属于指定应用 */
    belongsTo(appId: string): boolean {
        if (!this.tokens) return false;
        return !this.tokens.appId || this.tokens.appId === appId;
    }

    /** 生成授权链接。redirectUri 需与飞书后台「安全设置」中配置的回调地址一致 */
    buildAuthorizeUrl(domain: string, appId: string, redirectUri: string, scope: string): string {
        const base = `${FeishuClient.accountsDomain(domain)}/open-apis/authen/v1/authorize`;
        const params = new URLSearchParams({
            client_id: appId,
            response_type: "code",
            redirect_uri: redirectUri,
            scope,
            state: Math.random().toString(36).slice(2),
            prompt: "consent",
        });
        return `${base}?${params.toString()}`;
    }

    /** 从用户粘贴的回调地址 / 纯 code 中提取授权码 */
    static extractCode(input: string): string {
        const text = (input || "").trim();
        if (!text) return "";
        if (!/^https?:\/\//i.test(text)) {
            // 直接粘贴了 code
            return text;
        }
        try {
            const url = new URL(text);
            const fromSearch = url.searchParams.get("code");
            if (fromSearch) return fromSearch;
            // 兼容 redirect_uri 中带 # 的情况，例如 ...?code=xxx&state=yyy#/login
            const hash = url.hash || "";
            const queryIndex = hash.indexOf("?");
            if (queryIndex >= 0) {
                const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
                const fromHash = hashParams.get("code");
                if (fromHash) return fromHash;
            }
        } catch (e) {
            // 退化为按 key=value 解析
        }
        const match = /[?&#]code=([^&#]+)/.exec(text);
        return match ? decodeURIComponent(match[1]) : "";
    }

    /** 用授权码换取 user_access_token */
    async exchangeCode(
        domain: string,
        appId: string,
        appSecret: string,
        code: string,
        redirectUri: string,
        scope: string
    ): Promise<FeishuUserTokens> {
        const payload = await this.requestToken(domain, {
            grant_type: "authorization_code",
            client_id: appId,
            client_secret: appSecret,
            code,
            redirect_uri: redirectUri,
        });
        this.tokens = {
            accessToken: payload.access_token,
            refreshToken: payload.refresh_token || "",
            accessExpire: Date.now() + (payload.expires_in || 7200) * 1000,
            refreshExpire: Date.now() + (payload.refresh_token_expires_in || 0) * 1000,
            scope: payload.scope || scope,
            appId,
        };
        await this.saver(this.tokens);
        return this.tokens;
    }

    /** 刷新 user_access_token */
    async refresh(domain: string, appId: string, appSecret: string): Promise<boolean> {
        if (!this.tokens?.refreshToken) return false;
        try {
            const payload = await this.requestToken(domain, {
                grant_type: "refresh_token",
                client_id: appId,
                client_secret: appSecret,
                refresh_token: this.tokens.refreshToken,
            });
            this.tokens = {
                ...this.tokens,
                accessToken: payload.access_token,
                refreshToken: payload.refresh_token || this.tokens.refreshToken,
                accessExpire: Date.now() + (payload.expires_in || 7200) * 1000,
                refreshExpire: payload.refresh_token_expires_in
                    ? Date.now() + payload.refresh_token_expires_in * 1000
                    : this.tokens.refreshExpire,
                scope: payload.scope || this.tokens.scope,
                appId,
            };
            await this.saver(this.tokens);
            return true;
        } catch (e) {
            console.warn("刷新飞书用户令牌失败:", e);
            return false;
        }
    }

    /** 获取可用的 user_access_token（必要时自动刷新） */
    async ensureAccessToken(domain: string, appId: string, appSecret: string): Promise<string> {
        if (!this.tokens?.accessToken) {
            throw new Error("尚未完成飞书用户授权，请在插件设置中打开「飞书用户授权」完成授权");
        }
        if (!this.belongsTo(appId)) {
            throw new Error("检测到应用已更换，请重新进行飞书用户授权");
        }
        // 提前 5 分钟刷新
        if (Date.now() > this.tokens.accessExpire - 5 * 60 * 1000) {
            const ok = await this.refresh(domain, appId, appSecret);
            if (!ok) {
                throw new Error("飞书用户授权已过期且无法自动刷新，请重新授权");
            }
        }
        return this.tokens.accessToken;
    }

    /** 保存授权用户信息 */
    async saveUserInfo(userName: string, openId?: string): Promise<void> {
        if (!this.tokens) return;
        this.tokens = { ...this.tokens, userName, openId };
        await this.saver(this.tokens);
    }

    /** 取消授权 */
    async clear(): Promise<void> {
        this.tokens = null;
        await this.saver(null);
    }

    /** 调用 OAuth2 令牌接口 */
    private async requestToken(domain: string, payload: Record<string, any>): Promise<any> {
        const url = `${domain}/open-apis/authen/v2/oauth/token`;
        const resp = await forwardProxy(url, {
            method: "POST",
            contentType: "application/json; charset=utf-8",
            payload,
        });
        let body: any;
        try {
            body = parseJsonBody(resp, url);
        } catch (e) {
            throw new Error(e instanceof Error ? e.message : String(e));
        }
        if (body?.error) {
            throw new Error(`飞书授权失败：${body.error}${body.error_description ? "（" + body.error_description + "）" : ""}`);
        }
        if (body?.code && body.code !== 0) {
            throw new Error(body.msg || `飞书授权失败（${body.code}）`);
        }
        if (!body?.access_token) {
            throw new Error(`飞书授权失败：响应缺少 access_token（HTTP ${resp.status}）`);
        }
        return body;
    }
}
