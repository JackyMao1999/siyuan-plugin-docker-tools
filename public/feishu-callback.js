(() => {
    const href = window.location.href;
    const params = new URL(href).searchParams;
    const state = params.get("state");
    const status = document.getElementById("status");
    // Keep the authorization code out of history and any subsequent navigation.
    history.replaceState(null, "", window.location.pathname);
    if (!state || (!params.has("code") && !params.has("error"))) {
        status.textContent = "没有收到授权结果，请回到思源重新打开授权页面。";
        return;
    }
    if (typeof BroadcastChannel === "undefined") {
        status.textContent = "当前浏览器不支持自动回传，请使用较新的浏览器重新授权。";
        return;
    }
    const channel = new BroadcastChannel("siyuan-feishu-oauth");
    const send = () => channel.postMessage({ type: "callback", state, href });
    const interval = setInterval(send, 500);
    const stop = () => { clearInterval(interval); clearTimeout(timeout); channel.close(); };
    const timeout = setTimeout(() => {
        status.textContent = "未收到思源确认。请保持同一浏览器中的思源授权窗口打开，然后重新授权。";
        stop();
    }, 120000);
    channel.onmessage = ({ data }) => {
        if (data?.type !== "result" || data.state !== state) return;
        status.textContent = data.ok
            ? "授权成功，令牌已保存。请关闭此页面并返回思源。"
            : "授权未完成。请返回思源查看提示并重新授权。";
        stop();
    };
    window.addEventListener("pagehide", stop, { once: true });
    send();
})();
