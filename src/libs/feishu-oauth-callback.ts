/** Receive OAuth results without exposing app credentials to the callback page. */
export const DESKTOP_REDIRECT_URI = "http://127.0.0.1:18879/feishu-callback";
export const OAUTH_CHANNEL = "siyuan-feishu-oauth";
const TIMEOUT = 10 * 60 * 1000;

export function browserRedirectUri(pluginName: string): string {
    return new URL(`/plugins/${encodeURIComponent(pluginName)}/feishu-callback.html`, window.location.origin).href;
}

/** Desktop OAuth needs its own port, even when localhost and 127.0.0.1 differ in the URL. */
export function usesSiYuanPort(redirectUri: string, origin: string): boolean {
    try {
        const target = new URL(redirectUri);
        const current = new URL(origin);
        const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
        const port = (url: URL) => url.port || (url.protocol === "https:" ? "443" : "80");
        return ["http:", "https:"].includes(current.protocol) && port(target) === port(current) &&
            (target.hostname === current.hostname || (loopback.has(target.hostname) && loopback.has(current.hostname)));
    } catch {
        return false;
    }
}

/** One-time migration of the old shared setting; never recompute a saved desktop callback on startup. */
export function migrateDesktopRedirectUri(legacy: string, origin: string): string {
    try {
        const url = new URL(legacy);
        if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
            url.port && !url.username && !url.password && !url.search && !url.hash &&
            url.pathname !== "/" && !url.pathname.startsWith("/plugins/") && !usesSiYuanPort(legacy, origin) &&
            legacy !== "http://localhost:8080/feishu-callback") return legacy;
    } catch { /* Missing or invalid legacy value: use the fixed desktop default. */ }
    return DESKTOP_REDIRECT_URI;
}

export function createOAuthState(): string {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export function parseOAuthCallback(href: string, redirectUri: string, state: string): string {
    const url = new URL(href);
    const expected = new URL(redirectUri);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash ||
        url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) {
        throw new Error("授权回调与本次请求不匹配，请重新打开授权页面");
    }
    if (url.searchParams.has("error")) throw new Error("飞书授权未完成或已取消，请重新授权");
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.getAll("code").length !== 1) throw new Error("授权回调缺少有效的 code");
    return code;
}

/** One attempt per dialog. Stop listeners on completion, timeout, dialog close or plugin unload. */
export class FeishuOAuthCallback {
    private cleanup: () => void = () => {};
    private timer: ReturnType<typeof setTimeout>;
    private stopped = false;
    private consumed = false;

    constructor(
        private redirectUri: string,
        private state: string,
        private exchange: (code: string) => Promise<void>,
        private reportError: (message: string) => void,
    ) {}

    async start(desktop: boolean, browserUri: string): Promise<void> {
        if (this.stopped) throw new Error("本次授权已结束，请重新打开授权页面");
        const target = new URL(this.redirectUri);
        if (desktop) {
            if (usesSiYuanPort(this.redirectUri, window.location?.origin || "")) {
                throw new Error(`回调端口 ${target.port || "80"} 正由思源使用，不能再用于桌面授权监听。请点击「使用推荐回调地址」，并将新地址添加到飞书后台。`);
            }
            if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
                target.username || target.password || target.search || target.hash || !target.port) {
                throw new Error("桌面版自动授权需要带端口的本机 HTTP 回调地址，请点击「使用推荐回调地址」");
            }
            const nodeRequire = (window as any).require;
            if (!nodeRequire) throw new Error("当前桌面环境无法监听回调，请使用浏览器版授权或手动回填");
            const http: typeof import("http") = nodeRequire("http");
            const sockets = new Set<import("net").Socket>();
            const activeSockets = new Set<import("net").Socket>();
            const server = http.createServer(async (req, res) => {
                activeSockets.add(req.socket);
                res.once("finish", () => {
                    activeSockets.delete(req.socket);
                    if (this.stopped) req.socket.end();
                });
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.setHeader("Cache-Control", "no-store");
                res.setHeader("Referrer-Policy", "no-referrer");
                res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
                // The port will be reused by another attempt with a new state. A browser must
                // not reuse this server's existing socket after server.close() stops listening.
                res.setHeader("Connection", "close");
                if (this.stopped) {
                    res.writeHead(410).end("此授权页面已过期，请返回思源重新打开授权页面。");
                    return;
                }
                // Reject foreign Host headers and paths before processing a code.
                if (req.method !== "GET" || req.headers.host !== target.host || !req.url?.startsWith("/")) {
                    res.writeHead(400).end("无效的授权回调");
                    return;
                }
                const received = new URL(req.url, target.origin);
                const href = received.href;
                try {
                    parseOAuthCallback(href, this.redirectUri, this.state);
                } catch {
                    res.writeHead(400).end("授权未完成或回调不匹配。请返回思源重试。");
                    if (received.origin === target.origin && received.pathname === target.pathname &&
                        received.searchParams.getAll("state").length === 1 && received.searchParams.get("state") === this.state &&
                        received.searchParams.has("error")) {
                        this.reportError("飞书授权未完成或已取消，请重新授权");
                        this.stop();
                    }
                    return;
                }
                try {
                    await this.complete(href);
                    res.end("<!doctype html><meta charset=utf-8><title>飞书授权成功</title><p>授权成功，令牌已保存。请关闭此页面并返回思源。</p>");
                } catch {
                    res.writeHead(400).end("授权失败。请返回思源查看提示并重新授权。");
                }
            });
            server.on("connection", socket => {
                sockets.add(socket);
                socket.once("close", () => { sockets.delete(socket); activeSockets.delete(socket); });
            });
            this.cleanup = () => {
                server.close();
                // Close idle/preconnected sockets too. Let the active callback flush its
                // success/error response; Connection: close and the finish handler end it.
                for (const socket of sockets) {
                    if (!activeSockets.has(socket)) socket.destroy();
                }
            };
            await new Promise<void>((resolve, reject) => {
                server.once("error", (error: NodeJS.ErrnoException) => {
                    const reason = error.code === "EADDRINUSE" ? "端口已被占用" :
                        ["EACCES", "EPERM"].includes(error.code) ? "系统不允许监听此端口" : "监听失败";
                    reject(new Error(`授权回调端口 ${target.port}：${reason}（${error.code || "未知错误"}）。请使用独立的本机端口，并在飞书后台登记完整回调地址。`));
                });
                server.listen(Number(target.port), target.hostname === "[::1]" ? "::1" : "127.0.0.1", resolve);
            });
            if (this.stopped) { this.cleanup(); return; }
        } else {
            if (this.redirectUri !== browserUri) {
                throw new Error("浏览器版自动授权需要插件回调页面，请点击「使用推荐回调地址」并在飞书后台添加该地址");
            }
            const channel = new BroadcastChannel(OAUTH_CHANNEL);
            this.cleanup = () => channel.close();
            channel.onmessage = async ({ data }) => {
                if (data?.type !== "callback" || data.state !== this.state || typeof data.href !== "string" || this.consumed) return;
                try {
                    // Ignore malformed messages without consuming the current attempt.
                    parseOAuthCallback(data.href, this.redirectUri, this.state);
                } catch {
                    channel.postMessage({ type: "result", state: this.state, ok: false });
                    this.reportError("飞书授权未完成或回调不匹配，请重新授权");
                    this.stop();
                    return;
                }
                try {
                    await this.complete(data.href, false);
                    channel.postMessage({ type: "result", state: this.state, ok: true });
                } catch {
                    channel.postMessage({ type: "result", state: this.state, ok: false });
                } finally {
                    this.stop();
                }
            };
        }
        this.timer = setTimeout(() => {
            this.reportError("等待飞书授权超时，请重新打开授权页面");
            this.stop();
        }, TIMEOUT);
    }

    /** Also used by the manual fallback, so replay/state checks cannot be bypassed by a pasted URL. */
    async complete(href: string, stop = true): Promise<void> {
        if (this.stopped || this.consumed) throw new Error("本次授权已结束，请重新打开授权页面");
        const code = parseOAuthCallback(href, this.redirectUri, this.state);
        this.consumed = true;
        clearTimeout(this.timer);
        try {
            await this.exchange(code);
        } catch (e) {
            this.reportError(e instanceof Error ? e.message : "令牌交换失败，请重新授权");
            throw e;
        } finally {
            if (stop) this.stop();
        }
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        clearTimeout(this.timer);
        this.cleanup();
    }
}
