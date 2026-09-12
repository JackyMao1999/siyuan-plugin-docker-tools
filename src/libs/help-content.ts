/*
 * 插件帮助内容（面向新手的分步配置向导）
 */

import { HelpTopic } from "./help-dialog";

const FEISHU_SCOPES = [
    "wiki:wiki:readonly",
    "docx:document:readonly",
    "drive:drive:readonly",
    "docs:document:readonly",
].join("\n");

const LINK_STYLE = 'style="color:var(--b3-theme-primary);text-decoration:underline;"';

/** 飞书知识库同步相关帮助 */
export function getFeishuHelpTopics(): HelpTopic[] {
    return [
        {
            id: "quick-start",
            title: "① 三步跑通「飞书知识库同步」",
            keywords: "快速开始 入门 新手 怎么用 步骤 feishu 飞书 同步",
            html: `
<ol>
<li>在飞书开放平台创建「企业自建应用」，拿到 <code>App ID</code> 和 <code>App Secret</code>。</li>
<li>给应用开通下面 4 个权限，并把应用（机器人）添加为目标知识库 / 文档的协作者。</li>
<li>回到思源：<b>插件设置</b> → 填写 <code>飞书 App ID</code> / <code>飞书 App Secret</code> → 顶栏插件图标 → <b>飞书知识库同步</b>。</li>
</ol>
<p>同步方向只有一个：<b>飞书 → 思源</b>，不会修改飞书里的内容。</p>`,
        },
        {
            id: "create-app",
            title: "② 第一步：创建飞书应用，拿到 App ID / App Secret",
            keywords: "创建 应用 自建应用 App ID App Secret 凭证 cli_ 开发者后台 open.feishu.cn 国际版 lark",
            html: `
<ol>
<li>用浏览器打开
<a href="https://open.feishu.cn/app" target="_blank" ${LINK_STYLE}>飞书开放平台 · 开发者后台</a>
（国际版 Lark 用
<a href="https://open.larksuite.com/app" target="_blank" ${LINK_STYLE}>open.larksuite.com/app</a>），用飞书账号登录。</li>
<li>点击 <b>创建企业自建应用</b>，填写应用名称（例如「思源同步」）和图标后创建。</li>
<li>进入应用 → 左侧 <b>凭证与基础信息</b>，复制：
<ul>
<li><b>App ID</b>：形如 <code>cli_xxxxxxxxxxxxxxxx</code></li>
<li><b>App Secret</b>：一串字母数字</li>
</ul>
</li>
</ol>
<p>⚠️ App Secret 相当于密码，只保存在你自己的思源里，不要发给别人。</p>`,
        },
        {
            id: "scopes",
            title: "③ 第二步：开通权限（飞书需要开通哪些功能）",
            keywords: "权限 scope 开通 授权 功能 wiki docx drive docs readonly 权限管理 发布 版本 必需 可选",
            html: `
<p>进入应用 → 左侧 <b>权限管理</b>，搜索下面的权限名称并勾选，然后点击「批量开通 / 确定」。</p>
<table class="plugin-help__table">
<thead><tr><th>权限标识</th><th>是否必需</th><th>用途</th></tr></thead>
<tbody>
<tr><td><code>wiki:wiki:readonly</code></td><td>✅ 必需</td><td>读取飞书知识库（Wiki）的空间与节点目录</td></tr>
<tr><td><code>docx:document:readonly</code></td><td>✅ 必需</td><td>读取新版文档（docx）的正文内容</td></tr>
<tr><td><code>drive:drive:readonly</code></td><td>✅ 必需</td><td>浏览云文档文件夹、下载文档中的图片与附件</td></tr>
<tr><td><code>docs:document.content:read</code></td><td>⭕ 可选</td><td>同步旧版文档（只能取纯文本）</td></tr>
</tbody>
</table>
<p><b>开通后一定要发布版本</b>：左侧 <b>版本管理与发布</b> → 创建版本 → 申请发布。（若企业开启了应用管控，需要管理员审核通过。）</p>
<pre class="plugin-help__copy-src">${FEISHU_SCOPES}</pre>
<button class="b3-button b3-button--outline plugin-help__copy">复制权限清单</button>`,
        },
        {
            id: "grant",
            title: "④ 第三步：把文档 / 知识库授权给应用",
            keywords: "授权 协作者 添加文档应用 机器人 成员管理 阅读权限 看不到知识库 空",
            html: `
<p>自建应用默认只能看到“被授权”的内容，需要手动把应用加进去：</p>
<ul>
<li><b>知识库（Wiki）</b>：打开目标知识库 → <b>设置</b> → <b>成员管理</b> → 添加成员，搜索你的应用名称（机器人），权限给「可阅读」。</li>
<li><b>单个云文档</b>：打开文档 → 右上角 <b>···</b> → 更多 → <b>添加文档应用</b>，选择你的应用并授予「可阅读」。</li>
</ul>
<p>如果同步时看不到任何知识空间 / 文档，基本都是这一步没做，或上一步的权限还没发布。</p>`,
        },
        {
            id: "siyuan-settings",
            title: "⑤ 第四步：在思源里填写配置",
            keywords: "思源 设置 插件设置 飞书域名 App ID App Secret 保存 输入框 失焦 lark 国际版",
            html: `
<ol>
<li>思源 → <b>设置</b> → <b>集市 / 插件</b> → 找到本插件 → 打开设置。</li>
<li><b>飞书域名</b>：国内版选「飞书 (feishu.cn)」；国际版 Lark 选「Lark (larksuite.com)」。</li>
<li><b>飞书 App ID</b>：粘贴 <code>cli_</code> 开头的内容。</li>
<li><b>飞书 App Secret</b>：粘贴密钥。</li>
</ol>
<p>💡 输入完成后<b>点击输入框以外的空白处</b>（或按回车）才会保存。保存后建议关闭设置面板再重新打开，确认内容还在。</p>`,
        },
        {
            id: "how-to-sync",
            title: "⑥ 开始同步：界面里每个选项是什么意思",
            keywords: "同步 操作 选项 说明 来源 知识库 云文档 空间 目标笔记本 根路径 递归 图片 附件 增量 来源信息 勾选",
            html: `
<p>点击顶栏插件图标 → <b>飞书知识库同步</b>（快捷键 <code>Ctrl+Alt+F</code>）。</p>
<table class="plugin-help__table">
<thead><tr><th>选项</th><th>说明</th></tr></thead>
<tbody>
<tr><td>同步来源</td><td>「飞书知识库（Wiki）」按知识空间同步；「飞书云文档」按文件夹同步</td></tr>
<tr><td>知识空间</td><td>选择要同步的知识库（只在 Wiki 来源下显示）</td></tr>
<tr><td>目标笔记本 / 根路径</td><td>同步到哪个笔记本、放在该笔记本下的哪个目录</td></tr>
<tr><td>递归子文档</td><td>勾选后连同下级子文档一起同步，并保留层级结构</td></tr>
<tr><td>同步图片 / 附件</td><td>把图片、附件下载到思源并本地化（需要 <code>drive:drive:readonly</code>）</td></tr>
<tr><td>增量同步</td><td>飞书里没改动过的文档自动跳过，速度更快</td></tr>
<tr><td>添加来源</td><td>在文档开头加一行来源信息</td></tr>
</tbody>
</table>
<p><b>怎么选要同步的内容</b>：展开目录树，勾选前面的复选框即可。<br>
勾选「知识空间」或「文件夹」= 同步整个目录；也可以只勾选某一个文档。已同步过的文档会<b>原地更新</b>，不会重复创建。</p>`,
        },
        {
            id: "faq",
            title: "⑦ 常见问题排查",
            keywords: "失败 报错 报错 排查 401 权限 未配置 看不到 空 图片 不同步 旧版 doc 纯文本 安全 隐私 第三方 域名 换应用",
            html: `
<dl class="plugin-help__faq">
<dt>提示「请先在插件设置中配置飞书应用的 App ID 与 App Secret」</dt>
<dd>说明没填或没保存成功，回到「④ 在思源里填写配置」重新填写并点空白处保存。</dd>

<dt>打开后看不到任何知识空间 / 文档</dt>
<dd>1) 应用没有被添加为知识库成员或文档协作者（见帮助 ④）；2) 权限没有发布版本；3) 域名选错了（国内 / 国际版）。</dd>

<dt>同步报权限错误（如 401 / 无权限访问）</dt>
<dd>检查 <code>wiki:wiki:readonly</code>、<code>docx:document:readonly</code>、<code>drive:drive:readonly</code> 是否都已开通，并且应用版本已发布。</dd>

<dt>图片没有同步，只留下一行提示</dt>
<dd>通常是缺少 <code>drive:drive:readonly</code> 权限，或该图片未被授权给应用。文字内容不受影响。</dd>

<dt>旧版文档同步后变成纯文本</dt>
<dd>旧版文档（doc）接口只能取纯文本。建议在飞书中把文档升级为「新版文档」后再同步。</dd>

<dt>会不会把我的文档上传到第三方？</dt>
<dd>不会。请求只在你本地思源内核（network/forwardProxy 转发）与飞书服务器之间进行，使用你自己填写的应用凭据。</dd>

<dt>可以双向同步吗？</dt>
<dd>目前仅支持单向：飞书 → 思源。</dd>
</dl>`,
        },
    ];
}

/** PDF 导出与打印相关帮助 */
export function getExportHelpTopics(): HelpTopic[] {
    return [
        {
            id: "export-how",
            title: "文档导出 PDF / 打印怎么用",
            keywords: "pdf 导出 打印 使用 快捷键 Ctrl+Alt+P Ctrl+Alt+D 顶栏 菜单",
            html: `
<ol>
<li>在思源中打开要导出的文档。</li>
<li>点击顶栏插件图标 → 选择 <b>打印文档</b>（快捷键 <code>Ctrl+Alt+P</code>）或 <b>导出 PDF</b>（快捷键 <code>Ctrl+Alt+D</code>）。</li>
</ol>
<p>导出失败时请打开 <b>开发者工具控制台</b> 查看具体日志。</p>`,
        },
        {
            id: "export-options",
            title: "导出设置项说明",
            keywords: "页面大小 方向 边距 字体 字号 行高 代码字号 目录 页眉 页脚 自定义 CSS 导出方式 DOM 克隆 Markdown",
            html: `
<table class="plugin-help__table">
<thead><tr><th>设置项</th><th>说明</th></tr></thead>
<tbody>
<tr><td>页面大小 / 方向</td><td>A4、Letter 等纸张尺寸，以及纵向 / 横向</td></tr>
<tr><td>上 / 下 / 左 / 右边距</td><td>单位为毫米（mm）</td></tr>
<tr><td>字体 / 字号 / 行高</td><td>正文字体名称（可逗号分隔多个）、字号（pt）、行距比例</td></tr>
<tr><td>代码字号</td><td>代码块使用的字体大小</td></tr>
<tr><td>显示目录 / 页眉 / 页脚</td><td>在文档开头生成目录、页眉显示标题、页脚显示页码</td></tr>
<tr><td>自定义 CSS</td><td>覆盖默认打印样式，适合微调排版</td></tr>
<tr><td>导出方式</td><td><b>DOM 克隆</b>：与编辑器显示一致；<b>Markdown 转换</b>：基于 Markdown 重新排版</td></tr>
</tbody>
</table>`,
        },
    ];
}
