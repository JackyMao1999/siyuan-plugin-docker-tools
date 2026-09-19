/*
 * 插件帮助内容（面向新手的分步配置向导）
 */

import { HelpTopic } from "./help-dialog";

/** 权限清单（含可选），用于一键复制到飞书后台「权限管理」批量开通 */
const FEISHU_SCOPES = [
    // 必需
    "wiki:wiki:readonly",
    "docx:document:readonly",
    "drive:drive:readonly",
    // 可选
    "board:whiteboard:node:read",
    "docs:document.content:read",
].join("\n");

/** 用户身份授权时插件默认申请的 scope（与实际授权链接保持一致） */
const USER_SCOPES = [
    "wiki:wiki:readonly",
    "docx:document:readonly",
    "drive:drive:readonly",
    "board:whiteboard:node:read",
    "offline_access",
].join(" ");

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
<li>给应用开通权限（见第 ③ 步）。用「应用（机器人）身份」时还要把应用加为目标知识库 / 文档的协作者；
若你用的是「用户身份」，则不需要加协作者，改用你自己的权限。</li>
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
            title: "③ 第二步：开通权限（机器人权限 / 用户权限）",
            keywords: "权限 scope 开通 授权 功能 wiki docx drive docs board whiteboard readonly 权限管理 发布 版本 必需 可选 机器人 用户 99991679 20027",
            html: `
<p>飞书的权限分两层，都要在开发者后台<b>先申请、再发布版本</b>：</p>
<ul>
<li><b>① 应用（机器人）权限</b>：在「权限管理 → API 权限」给应用开通，机器人身份直接就能用。</li>
<li><b>② 用户权限</b>：把同一批 scope 交给<b>你本人</b>在授权页同意，用户身份才会拿到（<b>后台没申请 → 授权页会报 20027；新增权限 → 必须重新授权，否则报 99991679</b>）。</li>
</ul>

<h4>① 应用（机器人）权限</h4>
<table class="plugin-help__table">
<thead><tr><th>权限标识</th><th>是否必需</th><th>用途</th></tr></thead>
<tbody>
<tr><td><code>wiki:wiki:readonly</code></td><td>✅ 必需</td><td>读取飞书知识库（Wiki）的空间与节点目录</td></tr>
<tr><td><code>docx:document:readonly</code></td><td>✅ 必需</td><td>读取新版文档（docx）的正文内容</td></tr>
<tr><td><code>drive:drive:readonly</code></td><td>✅ 必需</td><td>浏览云文档文件夹、下载文档中的图片与附件</td></tr>
<tr><td><code>board:whiteboard:node:read</code></td><td>⭕ 可选</td><td>把文档里的画板 / mermaid 图导出为图片</td></tr>
<tr><td><code>docs:document.content:read</code></td><td>⭕ 可选</td><td>同步旧版文档（只能取纯文本）</td></tr>
</tbody>
</table>

<h4>② 用户权限（切换「用户身份」后同步要用）</h4>
<p>插件在授权时默认申请下面这些范围，你在授权页同意即可：</p>
<table class="plugin-help__table">
<thead><tr><th>授权范围</th><th>用途</th></tr></thead>
<tbody>
<tr><td><code>wiki:wiki:readonly</code><br><code>docx:document:readonly</code><br><code>drive:drive:readonly</code></td><td>与「机器人权限」里对应的三项用途相同，只是改为用<b>你的身份</b>去读你自己的云文档与知识库</td></tr>
<tr><td><code>board:whiteboard:node:read</code></td><td>画板 / mermaid 导出为图片（同样需要后台已申请并发布该权限）</td></tr>
<tr><td><code>offline_access</code></td><td>获取 refresh_token，用来自动续期，省得反复授权</td></tr>
</tbody>
</table>
<p>⚠️ 三个容易踩的点：</p>
<ul>
<li><b>后台先申请，授权页才勾得动</b>：没申请就带着该 scope 去授权 → <code>20027 应用未申请该权限</code>。</li>
<li><b>新增权限必须重新授权</b>：后台新开通的权限不会自动进到已有令牌里 → <code>99991679 请重新授权</code>。
到「插件设置 → 飞书用户授权」点 <b>① 打开授权页面</b> 重走一次即可（授权范围会自动带上新权限）。</li>
<li><b>旧版文档要手动补一个 scope</b>：默认范围里<b>故意不含</b> <code>docs:document.content:read</code>（你没申请它会导致授权直接失败）。
真要同步旧版文档时，在授权对话框的 <b>「授权范围」输入框</b>末尾补上它再授权。</li>
</ul>

<h4>两种身份怎么选</h4>
<table class="plugin-help__table">
<thead><tr><th>对比项</th><th>应用（机器人）身份</th><th>用户身份</th></tr></thead>
<tbody>
<tr><td>能看到的内容</td><td>只有被授权给应用的知识库 / 文档</td><td>你自己有权限的全部云文档与知识库</td></tr>
<tr><td>是否要加协作者</td><td>要：把应用加入知识库成员 / 文档应用</td><td>不用：直接使用你自己的权限</td></tr>
<tr><td>要做的配置</td><td>后台开通权限 + 发布版本</td><td>后台开通权限 + 发布版本 + 完成一次用户授权</td></tr>
<tr><td>适合场景</td><td>团队 / 部门共享的知识库</td><td>同步「我自己的」空间与文档</td></tr>
</tbody>
</table>
<p><b>开通后一定要发布版本</b>：左侧 <b>版本管理与发布</b> → 创建版本 → 申请发布。（若企业开启了应用管控，需要管理员审核通过。）</p>
<pre class="plugin-help__copy-src">${FEISHU_SCOPES}</pre>
<button class="b3-button b3-button--outline plugin-help__copy">复制全部权限清单</button>
<p class="plugin-help__hint">用户身份授权时实际申请的范围：<code>${USER_SCOPES}</code></p>`,
        },
        {
            id: "grant",
            title: "④ 第三步：把文档 / 知识库授权给应用（仅机器人身份）",
            keywords: "授权 协作者 添加文档应用 机器人 成员管理 阅读权限 看不到知识库 空 用户身份",
            html: `
<p><b>这一步只对「应用（机器人）身份」需要</b>：自建应用默认只能看到“被授权”的内容，要手动把应用加进去。</p>
<ul>
<li><b>知识库（Wiki）</b>：打开目标知识库 → <b>设置</b> → <b>成员管理</b> → 添加成员，搜索你的应用名称（机器人），权限给「可阅读」。</li>
<li><b>单个云文档</b>：打开文档 → 右上角 <b>···</b> → 更多 → <b>添加文档应用</b>，选择你的应用并授予「可阅读」。</li>
</ul>
<p>如果同步时看不到任何知识空间 / 文档，基本都是这一步没做，或上一步的权限还没发布。</p>
<p>💡 用的是「用户身份」则<b>不需要</b>这一步：同步走你自己的账号权限，你在飞书里能看到的，插件就能读到（见「★ 用户身份授权」）。</p>`,
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
<tr><td>同步来源</td><td>「飞书知识库（Wiki）」按知识空间同步；「存储（云盘）」按文件夹浏览并同步；「指定链接」粘贴文档/知识库/文件夹链接直接解析后同步</td></tr>
<tr><td>知识空间</td><td>选择要同步的知识库（只在 Wiki 来源下显示）</td></tr>
<tr><td>目标笔记本 / 根路径</td><td>同步到哪个笔记本、放在该笔记本下的哪个目录</td></tr>
<tr><td>递归子文档</td><td>勾选后连同下级子文档一起同步，并保留层级结构</td></tr>
<tr><td>同步图片 / 附件 / 画板</td><td>把图片、附件下载到思源并本地化（需要 <code>drive:drive:readonly</code>）；文档里的画板 / mermaid 图会导出为图片（需要 <code>board:whiteboard:node:read</code>）</td></tr>
<tr><td>增量同步</td><td>飞书里没改动过的文档自动跳过，速度更快</td></tr>
<tr><td>添加来源</td><td>在文档开头加一行来源信息</td></tr>
</tbody>
</table>
<p><b>怎么选要同步的内容</b>：展开目录树，勾选前面的复选框即可。<br>
勾选「知识空间」或「文件夹」= 同步整个目录；也可以只勾选某一个文档。已同步过的文档会<b>原地更新</b>，不会重复创建。</p>`,
        },
        {
            id: "spaces",
            title: "⑦ 为什么「云文档」里只有我的空间？文档库 / 共享空间怎么办",
            keywords: "我的空间 共享空间 文档库 我的文档库 知识库 看不到 文件夹 token 列举 限制 folder_token 链接",
            html: `
<p>飞书的云文档分成几个<b>互相独立</b>的位置，而开放平台接口能覆盖的范围并不一样：</p>
<table class="plugin-help__table">
<thead><tr><th>位置</th><th>插件能否列出</th><th>说明</th></tr></thead>
<tbody>
<tr><td>云盘 ·「我的空间」</td><td>✅ 可以</td><td>「云文档」来源默认就是它，含子文件夹</td></tr>
<tr><td>知识库（Wiki）</td><td>✅ 可以</td><td>请把来源切换为「飞书知识库（Wiki）」</td></tr>
<tr><td>存储 · 云盘根目录</td><td>✅</td><td>来源选「存储（云盘）」，留空即浏览官方所说的「云空间根目录」</td></tr>
<tr><td>共享空间 / 任意文件夹</td><td>⚠️ 用「指定链接」</td><td>没有「列举共享空间」的接口；在浏览器打开该文件夹，复制链接粘到「指定链接」来源即可浏览并同步</td></tr>
<tr><td>「我的文档库」</td><td>❌ 暂无接口</td><td>个人页面树模块，官方标为内测；与「我的空间」是两个独立模块</td></tr>
</tbody>
</table>
<p><b>机器人（应用）身份能列出「有权限的文档」吗？</b>飞书<b>没有</b>提供「列出应用可访问的全部文档」这种接口，
只能从已知入口进入：<br>
① 来源选「飞书知识库（Wiki）」→ 可列出应用加入的<b>全部知识空间</b>及其节点；<br>
② 来源选「存储（云盘）」→ 浏览官方所说的「云空间根目录」（数组根/我的空间根）；<br>
③ 来源选「指定链接」→ 把某个文档 / 知识库节点 / 文件夹的链接粘进去，直接解析同步（<b>共享空间等没有列举接口的位置就靠它</b>）。<br>
云盘里的文件夹需要先把文件夹分享给应用（或应用所在的群），否则会提示无权限。</p>
<p><b>想同步共享空间 / 某个文件夹？</b>在浏览器里打开该文件夹，复制地址栏里的链接
（形如 <code>https://xxx.feishu.cn/drive/folder/fldcnxxxxxxxx</code>），粘贴到同步对话框的
<b>「文件夹 token / 链接」</b>输入框，回车即可浏览并同步。</p>
<p><b>想同步部门/团队的资料？</b>这类内容通常放在<b>知识库</b>里，请把来源切换为「飞书知识库（Wiki）」，
它可以直接列出你有权限的所有知识空间。</p>
<p>⚠️ 注意：「我的文档库」里的内容不会出现在「我的空间」中，因此当前无法通过开放平台接口读取。</p>`,
        },
        {
            id: "faq",
            title: "⑧ 常见问题排查",
            keywords: "失败 报错 报错 排查 401 权限 未配置 看不到 空 图片 不同步 旧版 doc 纯文本 安全 隐私 第三方 域名 换应用",
            html: `
<dl class="plugin-help__faq">
<dt>我把思源里的文档删了，重新同步却提示「跳过（内容未变化）」</dt>
<dd>插件默认按「飞书编辑时间」判断是否需要更新，删除思源文档不会改变飞书记录。现在已修复：<b>跳过前会先校验思源文档是否还存在</b>，
被删掉的会自动重新创建。你也可以用两种方式强制重来：
<ul>
<li>取消勾选「增量同步」→ 本次全部按最新内容重写；</li>
<li>点对话框右下角的 <b>「重置同步记录」</b> → 清空历史记录，之后按全新文档处理（同路径已有文档会被覆盖，不会重复创建）。</li>
</ul></dd>

<dt>同步后内容不全 / 少了一部分</dt>
<dd>按顺序排查：
<ul>
<li><b>增量同步</b>：飞书侧没改动过、之前同步过的文档会被跳过，这是正常的；关闭「增量同步」可强制全量重写。</li>
<li><b>没有勾「递归子文档」</b>：勾选目录时只会同步该目录下的直接子文档。</li>
<li><b>不支持的块</b>：多维表格、电子表格、思维笔记等无法通过接口读取正文，会写成占位提示。</li>
<li><b>图片/附件</b>：关闭「同步图片/附件」或下载失败时会留一行提示，文字不受影响。</li>
<li><b>旧版文档</b>：只能取纯文本，格式会丢，建议在飞书升级为新版文档。</li>
</ul>
每次同步都会在日志里打印 <code>校验：飞书块 N 个 → 写入 M 批，思源现有 K 个块</code>，
用它可以判断是「取少了」还是「写少了」。若差异明显，把这一行发出来即可定位。</dd>

<dt>「存储（云盘）」里看不到我的共享空间 / 文档库</dt>
<dd>这是飞书接口的限制：<b>云空间 API 只覆盖「我的空间（云空间根目录）」和「已知 token 的文件夹」</b>，
没有「列举共享空间 / 我的文档库」的接口。解决办法：
<ul>
<li>在浏览器里打开那个共享空间 / 文件夹，复制地址栏链接（形如 <code>https://xxx.feishu.cn/drive/folder/xxxx</code>），
到「指定链接」来源粘贴解析；</li>
<li>或把链接粘到「存储（云盘）」来源的「文件夹 token / 链接」输入框；</li>
<li>部门/团队沉淀的内容一般在<b>知识库</b>里，用「飞书知识库（Wiki）」来源可以直接列出。</li>
</ul></dd>

<dt>提示「请先在插件设置中配置飞书应用的 App ID 与 App Secret」</dt>
<dd>说明没填或没保存成功，回到「④ 在思源里填写配置」重新填写并点空白处保存。</dd>

<dt>打开后看不到任何知识空间 / 文档</dt>
<dd>1) 应用没有被添加为知识库成员或文档协作者（见帮助 ④）；2) 权限没有发布版本；3) 域名选错了（国内 / 国际版）。</dd>

<dt>同步报权限错误（如 401 / 无权限访问）</dt>
<dd>检查 <code>wiki:wiki:readonly</code>、<code>docx:document:readonly</code>、<code>drive:drive:readonly</code> 是否都已开通，并且应用版本已发布。</dd>

<dt>图片 / 画板（mermaid）没有同步，只留下一行提示</dt>
<dd>图片、附件通常是缺少 <code>drive:drive:readonly</code> 权限，或该素材未被授权给应用；
画板 / mermaid 图需要 <code>board:whiteboard:node:read</code> 权限（未开通时会留一行 token 提示）。文字内容不受影响。</dd>

<dt>旧版文档同步后变成纯文本</dt>
<dd>旧版文档（doc）接口只能取纯文本。建议在飞书中把文档升级为「新版文档」后再同步。</dd>

<dt>会不会把我的文档上传到第三方？</dt>
<dd>不会。请求只在你本地思源内核（network/forwardProxy 转发）与飞书服务器之间进行，使用你自己填写的应用凭据。</dd>

<dt>可以双向同步吗？</dt>
<dd>目前仅支持单向：飞书 → 思源。</dd>
</dl>`,
        },
        {
            id: "user-identity",
            title: "★ 想同步「我自己的」空间？改用用户身份授权",
            keywords: "用户身份 用户授权 user_access_token oauth 授权 我的空间 空的 机器人 重定向 redirect_uri 20027 invalid_grant 重新授权",
            html: `
<p><b>为什么「我的空间」是空的？</b>默认使用 <b>应用（机器人）身份</b>，
此时云文档的「我的空间」是<b>应用自己</b>的空间（通常为空），知识库也只能看到被邀请加入的空间。</p>
<p>要读取<b>你自己</b>的云文档和你有权限的知识库，需要切换到 <b>用户身份</b>（OAuth 授权）：</p>
<ol>
<li>飞书开发者后台 → 你的应用 → <b>开发配置 → 安全设置 → 重定向 URL</b>，
添加一个地址，例如 <code>http://localhost:8080/feishu-callback</code>（这个地址不需要真的能打开）。
<br>更省事的做法：在授权对话框里点 <b>「打开后台配置页」</b> 直达该页面，点 <b>「复制」</b> 把地址复制过去。</li>
<li>确认应用已申请 <code>wiki:wiki:readonly</code>、<code>docx:document:readonly</code>、<code>drive:drive:readonly</code>
并已发布版本（用户身份同样要先在后台申请这些权限，详见第 ③ 步）：
如需同步画板 / mermaid 图，还要申请 <code>board:whiteboard:node:read</code>；
如需同步<b>旧版文档</b>，申请 <code>docs:document.content:read</code> 后，
还要在下面第 4 步的授权对话框「授权范围」里手动补上它。</li>
<li>思源插件设置中：<b>飞书访问身份</b> 改为「用户身份」；
<b>授权回调地址</b> 填第 1 步配置的那个地址（必须<b>完全一致</b>）。</li>
<li>点击设置中的 <b>打开授权 / 授权管理</b> → 点「① 打开授权页面」在浏览器登录并同意授权。</li>
<li>授权后浏览器会跳转到一个打不开的页面（正常现象），复制<b>地址栏里的完整网址</b>（含 <code>code=</code>），
粘贴回对话框 → 点「③ 完成授权」。</li>
</ol>
<p>授权成功后，同步对话框顶部会显示「用户身份（你的名字）」，此时「我的空间」就是你自己的云文档了。</p>
<dl class="plugin-help__faq">
<dt>报错 20029「重定向 URL 有误，请联系应用管理员」</dt>
<dd>官方定义：<code>redirect_uri</code> 非法。只有两个原因：
<b>①根本没配置重定向 URL</b>；<b>②配置在了另一个应用上（App ID 不匹配）</b>。
<br>解决：到 <b>开发配置 → 安全设置 → 重定向 URL</b> 把对话框里显示的地址<b>原样</b>添加进去并保存/发布；
同时确认插件里的 App ID 就是配置该地址的那个应用。配置好后重新点「打开授权页面」。
<br>提示：若回调地址带 <code>?</code> 或 <code>#</code>，后台只需配置到它们之前的部分。</dd>
<dt>报错 99991679（提示「请重新授权」）</dt>
<dd>用户身份缺少某个权限，常见于后来新增的 <code>board:whiteboard:node:read</code>（画板 / mermaid 导出）。
用户身份下「应用开通了权限」还不够，必须由你重新授权带上该范围：
先在飞书后台「权限管理」申请该权限并<b>发布版本</b>，再到「插件设置 → 飞书用户授权」点 <b>① 打开授权页面</b> 重新走一遍授权即可
（授权对话框会自动把新权限并进授权范围）。</dd>
<dt>报错 20027</dt>
<dd>授权链接里包含了应用「没有申请」的权限。请在飞书后台补齐权限，或减少授权范围后重试。</dd>
<dt>报错 invalid_grant / 授权码无效</dt>
<dd>授权码有效期只有 5 分钟且只能用一次，请重新点「打开授权页面」再走一遍。</dd>
<dt>换了应用或授权过期</dt>
<dd>更换 App ID 后需要重新授权；授权过期会自动用 refresh_token 续期，续期失败时重新走一次授权即可。</dd>
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
