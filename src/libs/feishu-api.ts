/*
 * 飞书开放平台 API 客户端
 *
 * 说明：
 *  - 插件运行在浏览器环境中，直接请求 open.feishu.cn 会被 CORS 拦截，
 *    因此统一通过思源内核提供的 /api/network/forwardProxy 转发请求。
 *  - 使用自建应用的 tenant_access_token 进行鉴权。
 *  - 注意：内核返回的字段为小写（body / status / bodyEncoding / contentType），
 *    且 body 始终是字符串（不会自动解析 JSON），需要自行解析。
 */

import { fetchSyncPost } from "siyuan";

export const FEISHU_DOMAIN_CN = "https://open.feishu.cn";
export const FEISHU_DOMAIN_LARK = "https://open.larksuite.com";

/** forwardProxy 返回结构（已做字段兼容归一化） */
export interface ProxyResponse {
    status: number;
    contentType: string;
    /** 响应体字符串：text 时为原文，base64 编码时为 base64 字符串 */
    body: string;
    bodyEncoding: string;
    headers: Record<string, string[]>;
    url: string;
    elapsed: number;
}

export class FeishuError extends Error {
    code: number;
    constructor(code: number, msg: string) {
        super(msg || `Feishu API error (${code})`);
        this.name = "FeishuError";
        this.code = code;
    }
}

interface ProxyOptions {
    method?: string;
    headers?: Record<string, string>;
    payload?: any;
    contentType?: string;
    payloadEncoding?: string;
    /** 响应体输出编码：text（默认）| base64 | hex ... */
    responseEncoding?: string;
    timeout?: number;
}

export interface FeishuCredentials {
    domain: string;
    appId: string;
    appSecret: string;
}

export interface FeishuWikiSpace {
    space_id: string;
    name: string;
    description?: string;
    space_type?: string;
    visibility?: string;
}

export interface FeishuWikiNode {
    node_token: string;
    obj_token: string;
    obj_type: string;
    title: string;
    parent_node_token?: string;
    node_type?: string;
    origin_node_token?: string;
    origin_space_id?: string;
    has_child?: boolean;
    obj_edit_time?: string;
    obj_create_time?: string;
}

export interface FeishuDriveFile {
    token: string;
    name: string;
    type: string;
    parent_token?: string;
    url?: string;
}

export interface FeishuTextElement {
    text_run?: {
        content?: string;
        text_element_style?: {
            bold?: boolean;
            italic?: boolean;
            strikethrough?: boolean;
            underline?: boolean;
            inline_code?: boolean;
            link?: { url?: string };
        };
    };
    mention_user?: { user_id?: string; name?: string };
    mention_doc?: { token?: string; obj_type?: number; url?: string; title?: string };
    equation?: { content?: string };
    file?: { file_token?: string };
    reminder?: any;
    [key: string]: any;
}

export interface FeishuBlock {
    block_id: string;
    parent_id?: string;
    children?: string[];
    block_type: number;
    [key: string]: any;
}

/**
 * 通过思源内核转发一个 HTTP 请求
 */
async function forwardProxy(url: string, opts: ProxyOptions): Promise<ProxyResponse> {
    const headerList = Object.entries(opts.headers || {}).map(([k, v]) => ({ [k]: v }));
    const request: any = {
        url,
        method: opts.method || "GET",
        timeout: opts.timeout ?? 60000,
        headers: headerList,
        contentType: opts.contentType || "application/json",
        responseEncoding: opts.responseEncoding || "text",
    };
    // 仅在确实携带请求体时才传 payload，避免 GET 请求被塞入空 body
    if (opts.payload !== undefined) {
        request.payload = opts.payload;
        request.payloadEncoding = opts.payloadEncoding || "json";
    }
    const res: any = await fetchSyncPost("/api/network/forwardProxy", request);
    if (!res || res.code !== 0) {
        throw new Error(res?.msg ? `思源网络代理请求失败：${res.msg}` : "思源网络代理请求失败");
    }
    const data: any = res.data || {};
    // 兼容不同内核版本的字段命名（小写 / 大写）
    return {
        status: data.status ?? data.StatusCode ?? 0,
        contentType: data.contentType ?? data.BodyContentType ?? "",
        body: data.body ?? data.Body ?? "",
        bodyEncoding: data.bodyEncoding ?? data.BodyEncoding ?? "text",
        headers: data.headers || {},
        url: data.url || url,
        elapsed: data.elapsed ?? 0,
    };
}

/**
 * 解析响应体为 JSON 对象；非 JSON 时给出可读的错误信息
 */
function parseJsonBody(resp: ProxyResponse, url: string): any {
    const text = typeof resp.body === "string" ? resp.body.trim() : "";
    if (!text) {
        throw new Error(`飞书接口返回空响应 (HTTP ${resp.status || "未知"})`);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        const snippet = text.length > 300 ? text.slice(0, 300) + "..." : text;
        console.error("飞书接口非 JSON 响应:", url, text);
        throw new Error(`飞书接口返回了非 JSON 响应 (HTTP ${resp.status || "未知"})：${snippet}`);
    }
}

/** 需要重新获取 token 的错误码 */
const TOKEN_ERROR_CODES = [99991661, 99991663, 99991664, 99991665, 99991668];

export class FeishuClient {
    private domain: string;
    private appId: string;
    private appSecret: string;
    private token = "";
    private tokenExpire = 0;

    constructor(credentials: FeishuCredentials) {
        this.setCredentials(credentials);
    }

    setCredentials(credentials: FeishuCredentials) {
        const changed = credentials.appId !== this.appId || credentials.appSecret !== this.appSecret || credentials.domain !== this.domain;
        this.domain = (credentials.domain || FEISHU_DOMAIN_CN).replace(/\/+$/, "");
        this.appId = (credentials.appId || "").trim();
        this.appSecret = (credentials.appSecret || "").trim();
        if (changed) {
            this.token = "";
            this.tokenExpire = 0;
        }
    }

    get isConfigured(): boolean {
        return !!this.appId && !!this.appSecret;
    }

    private async ensureToken(force = false): Promise<string> {
        const now = Date.now();
        if (!force && this.token && now < this.tokenExpire) {
            return this.token;
        }
        if (!this.isConfigured) {
            throw new Error("请先在插件设置中填写飞书应用的 App ID 与 App Secret");
        }
        const url = `${this.domain}/open-apis/auth/v3/tenant_access_token/internal`;
        const resp = await forwardProxy(url, {
            method: "POST",
            payload: { app_id: this.appId, app_secret: this.appSecret },
        });
        const data = parseJsonBody(resp, url);
        if (!data || data.code !== 0) {
            throw new FeishuError(
                data?.code ?? -1,
                data?.msg || `获取 tenant_access_token 失败 (HTTP ${resp.status || "未知"})`
            );
        }
        this.token = data.tenant_access_token;
        // 提前 5 分钟过期
        this.tokenExpire = now + Math.max(60, (data.expire || 7200) - 300) * 1000;
        return this.token;
    }

    private buildUrl(path: string, query?: Record<string, any>): string {
        let url = `${this.domain}${path}`;
        const pairs: string[] = [];
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                if (v === undefined || v === null || v === "") continue;
                pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
            }
        }
        if (pairs.length) {
            url += (url.includes("?") ? "&" : "?") + pairs.join("&");
        }
        return url;
    }

    /**
     * 调用飞书接口并返回 data 字段
     */
    private async request(path: string, opts: {
        method?: string;
        query?: Record<string, any>;
        body?: any;
    } = {}): Promise<any> {
        const url = this.buildUrl(path, opts.query);
        const doRequest = async (token: string) => {
            return forwardProxy(url, {
                method: opts.method || "GET",
                headers: { Authorization: `Bearer ${token}` },
                contentType: "application/json; charset=utf-8",
                payload: opts.body,
            });
        };

        let token = await this.ensureToken();
        let resp = await doRequest(token);
        let body = parseJsonBody(resp, url);

        // token 失效时刷新后重试一次
        if (body && body.code && TOKEN_ERROR_CODES.includes(body.code)) {
            token = await this.ensureToken(true);
            resp = await doRequest(token);
            body = parseJsonBody(resp, url);
        }

        if (!body) {
            throw new Error(`飞书接口返回为空 (HTTP ${resp.status || "未知"})`);
        }
        if (body.code !== 0) {
            throw new FeishuError(body.code, body.msg || `飞书接口请求失败 (HTTP ${resp.status || "未知"})`);
        }
        return body.data;
    }

    /** 测试凭据是否可用 */
    async testConnection(): Promise<void> {
        await this.ensureToken(true);
    }

    /** 获取知识空间列表（自动翻页） */
    async listWikiSpaces(): Promise<FeishuWikiSpace[]> {
        const result: FeishuWikiSpace[] = [];
        let pageToken = "";
        do {
            const data = await this.request("/open-apis/wiki/v2/spaces", {
                query: { page_size: 50, page_token: pageToken },
            });
            result.push(...(data.items || []));
            pageToken = data.has_more ? data.page_token : "";
        } while (pageToken);
        return result;
    }

    /** 获取知识空间的子节点列表（自动翻页） */
    async listWikiNodes(spaceId: string, parentNodeToken?: string): Promise<FeishuWikiNode[]> {
        const result: FeishuWikiNode[] = [];
        let pageToken = "";
        do {
            const data = await this.request(`/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, {
                query: { page_size: 50, page_token: pageToken, parent_node_token: parentNodeToken },
            });
            result.push(...(data.items || []));
            pageToken = data.has_more ? data.page_token : "";
        } while (pageToken);
        return result;
    }

    /** 获取单个知识库节点信息 */
    async getWikiNode(nodeToken: string): Promise<FeishuWikiNode | null> {
        const data = await this.request("/open-apis/wiki/v2/spaces/get_node", {
            query: { token: nodeToken, obj_type: "wiki" },
        });
        return data?.node || null;
    }

    /** 获取某个文件夹下的文件列表（自动翻页），folderToken 为空时表示根目录 */
    async listDriveFiles(folderToken: string): Promise<FeishuDriveFile[]> {
        const result: FeishuDriveFile[] = [];
        let pageToken = "";
        do {
            const data = await this.request("/open-apis/drive/v1/files", {
                query: { page_size: 50, page_token: pageToken, folder_token: folderToken || undefined, order_by: "EditedTime", direction: "DESC" },
            });
            result.push(...(data.files || []));
            pageToken = data.has_more ? data.next_page_token : "";
        } while (pageToken);
        return result;
    }

    /** 获取新版文档的文档信息（标题等） */
    async getDocxDocument(documentId: string): Promise<any> {
        const data = await this.request(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`);
        return data?.document;
    }

    /** 获取新版文档的全部块（自动翻页） */
    async getDocxBlocks(documentId: string): Promise<FeishuBlock[]> {
        const result: FeishuBlock[] = [];
        let pageToken = "";
        do {
            const data = await this.request(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`, {
                query: { page_size: 500, page_token: pageToken, document_revision_id: -1 },
            });
            result.push(...(data.items || []));
            pageToken = data.has_more ? data.page_token : "";
        } while (pageToken);
        return result;
    }

    /** 新版文档纯文本内容（降级方案） */
    async getDocxRawContent(documentId: string): Promise<string> {
        const data = await this.request(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`);
        return data?.content || "";
    }

    /** 旧版文档纯文本内容 */
    async getDocRawContent(docToken: string): Promise<string> {
        const data = await this.request(`/open-apis/doc/v2/${encodeURIComponent(docToken)}/raw_content`);
        return data?.content || "";
    }

    /** 下载素材（图片/附件），返回 base64 数据 */
    async downloadMedia(fileToken: string): Promise<{ base64: string; contentType: string }> {
        const token = await this.ensureToken();
        const url = this.buildUrl(`/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`);
        const resp = await forwardProxy(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            contentType: "application/octet-stream",
            timeout: 120000,
            responseEncoding: "base64",
        });
        if (resp.status >= 400) {
            throw new Error(`下载飞书素材失败 (HTTP ${resp.status})`);
        }
        if (!resp.body) {
            throw new Error("下载飞书素材失败：响应内容为空");
        }
        return { base64: resp.body, contentType: resp.contentType || "application/octet-stream" };
    }
}
