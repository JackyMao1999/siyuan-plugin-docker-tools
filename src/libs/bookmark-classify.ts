/*
 * 书签自动分类（内容 -> 标签）
 *
 * 用户要的不是「书签放在哪个文件夹」，而是「这个网站是干什么的」：
 * 按域名关键词 + 标题关键词命中分类表（工具 / 网盘 / 资源 / 工作 / 电子书 /
 * 博客 / 开发 / 有趣 / 论坛 / AI / 音乐）。
 * 分类表落盘在工作区 /data/bookmarks/tag-rules.json（首次自动生成默认版），
 * 用任何编辑器改完，下次同步即生效——Docker 宿主卷里同样可见可直接改。
 */

import { getWorkspaceFileText, putWorkspaceFile } from "../api";

/** 规则文件在工作区中的位置（宿主挂载卷 data/bookmarks/ 下可见） */
export const TAG_RULES_PATH = "/data/bookmarks/tag-rules.json";
const TAG_RULES_DIR = "/data/bookmarks";
const TAG_RULES_FILE = "tag-rules.json";

/** 一个分类：命中 hosts（域名包含）或 keywords（域名+标题包含）即打上该标签 */
export interface BookmarkTagCategory {
    tag: string;
    hosts?: string[];
    keywords?: string[];
}

/**
 * 默认分类表：覆盖常见的国内外站点叫法。命中最多 3 类，按表内顺序取。
 * 顺序有讲究：AI / 开发 等特征强的在前，工具 / 资源 等泛化词在后，避免误抢。
 * 域名规则支持「全等 / .后缀 / 包含」三种写法（如 github.io、blog.、mail.）。
 */
export const DEFAULT_TAG_CATEGORIES: BookmarkTagCategory[] = [
    {
        tag: "AI",
        hosts: [
            "chatgpt.com", "openai.com", "claude.ai", "anthropic.com", "gemini.google.com", "copilot",
            "deepseek.com", "kimi.com", "moonshot.cn", "huggingface.co", "longcat", "ima.qq.com",
            "xinghuo.xfyun.cn", "tongyi.aliyun.com", "yiyan.baidu.com", "zhipu.chat", "chatglm",
            "poe.com", "perplexity.ai", "midjourney.com", "suno.com", "sora.com", "qianwen",
        ],
        keywords: ["ai", "gpt", "llm", "大模型", "智能", "机器学习", "深度学习", "扩散模型", "stable diffusion", "对话机器人"],
    },
    {
        tag: "开发",
        hosts: [
            "github.com", "gitlab", "gitee.com", "stackoverflow.com", "segmentfault.com", "juejin.cn",
            "cnblogs.com", "dev.to", "git-scm.com", "pypi.org", "npmjs.com", "maven.org", "docker.com",
            "hub.docker", "quay.io", "harbor", "rancher", "jenkins", "sonarqube", "golang.org",
            "python.org", "python-cookbook", "clang.llvm.org", "rust-lang.org", "developer.mozilla", "gcc.gnu",
            "leetcode.com", "leetcode.cn", "nowcoder.com", "csdn.net", "geeksforgeeks.org", "docs.",
            "bookstack.cn", "readthedocs.io",
        ],
        keywords: [
            "git", "github", "gitlab", "ci/cd", "gitlab-ci", "编程", "代码", "源码", "style guide", "风格指南",
            "api", "sdk", "debug", "编译", "clang", "python", "pytest", "pylint", "paramiko", "yaml",
            "教程", "手册", "文档", "docs", "reference", "算法", "刷题", "开发", "developer", "开源",
            "harbor", "rancher", "jenkins", "pandas",
        ],
    },
    {
        tag: "工作",
        hosts: ["mail.", "webmail", "alimail", "work.", "oa.", "erp.", "crm.", "jira", "confluence", "feishu.cn", "dingtalk.com", "larksuite", "wecom"],
        keywords: ["邮箱", "mail", "工作台", "控制台", "管理平台", "cas", "dashboard", "办公", "审批", "hr", "工时", "远程驾驶", "生产系统", "管理", "console"],
    },
    {
        tag: "网盘",
        hosts: [
            "pan.baidu.com", "yun.baidu.com", "quark", "115.com", "123pan", "aliyundrive", "drive.uc.cn",
            "onedrive.live", "drive.google", "dropbox", "wenshushu", "lanzou", "minio", "cloudreve", "alist", "seafile",
        ],
        keywords: ["网盘", "云盘", "文件传输", "共享文件", "cloud storage", "对象存储"],
    },
    {
        tag: "电子书",
        hosts: ["z-library", "libgen", "annas-archive", "gutenberg.org", "standard-ebooks", "dokumen.pub", "book"],
        keywords: ["电子书", "小说", "读书", "阅读", "book", "ebook", "epub", "cookbook", "图书馆", "书馆", "书库"],
    },
    {
        tag: "论坛",
        hosts: ["v2ex.com", "reddit.com", "linux.do", "sspai.com", "forum", "discuss"],
        keywords: ["论坛", "社区", "bbs", "讨论", "问答", "forum", "community"],
    },
    {
        tag: "博客",
        hosts: ["medium.com", "jianshu.com", "zhihu.com", "blog.", "github.io", "notion", "yuque", "youdao"],
        keywords: ["博客", "blog", "专栏", "文章", "链滴", "笔记", "知识管理", "wiki", "知识集"],
    },
    {
        tag: "音乐",
        hosts: ["music.163.com", "y.qq.com", "spotify", "kugou", "kuwo", "soundcloud.com", "audiomack"],
        keywords: ["音乐", "music", "歌", "fm", "电台", "播客", "podcast", "audio"],
    },
    {
        tag: "资源",
        hosts: ["archive.org", "torrent", "nyaa", "mirrors.", "npmmirror", "fonts.google", "mifaw"],
        keywords: ["资源", "素材", "下载", "镜像", "模板", "rss", "dataset", "数据集", "iconfont", "图标", "字体"],
    },
    {
        tag: "有趣",
        hosts: ["explorables.com", "neal.fun", "thispersondoesnotexist.com"],
        keywords: ["有趣", "fun", "游戏", "game", "壁纸", "wallpaper", "生成器", "沙盒", "实验", "experiment", "彩蛋"],
    },
    {
        tag: "工具",
        hosts: [
            "ventoy", "frp", "sakurafrp", "tinify", "convert", "tinywow", "remove.bg", "rime", "key-test",
            "google.", "bing.", "duckduckgo.com", "baidu.com", "translate.google", "deepl",
        ],
        keywords: ["工具", "tool", "转换", "convert", "压缩", "格式", "查询", "测试", "诊断", "翻译", "输入法", "utility", "proxy", "vpn", "机场", "clash", "节点", "加速", "梯子", "搜索"],
    },
];

/** 域名命中：全等 / 以 .xxx 结尾（github.io 这类通用后缀）/ 包含（blog. 这类带点的写法） */
function matchHost(host: string, rule: string): boolean {
    const x = rule.replace(/^(\*\.?|\.)/, "").toLowerCase();
    if (!x) return false;
    return host === x || host.endsWith("." + x) || host.includes(x);
}

/**
 * 关键词命中：纯 ASCII 词按「单词边界」匹配（防止 "ai" 误命中 mail / detail），
 * 含中文等字符的关键词直接子串匹配。
 */
function matchKeyword(keyword: string, hay: string): boolean {
    const kw = keyword.toLowerCase();
    if (/^[\x20-\x7E]+$/.test(kw) && /[a-z0-9]/.test(kw)) {
        const esc = kw
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\s+/g, "[\\s-]+");
        try {
            return new RegExp(`(^|[^a-z0-9\\u4e00-\\u9fff])${esc}([^a-z0-9\\u4e00-\\u9fff]|$)`).test(hay);
        } catch (e) {
            return hay.includes(kw);
        }
    }
    return hay.includes(kw);
}

/** 解析条目命中的分类（最多 3 个，按规则表顺序） */
export function classifyBookmark(host: string, title: string, rules: BookmarkTagCategory[]): string[] {
    const h = (host || "").toLowerCase();
    const hay = `${h} ${(title || "").toLowerCase()}`;
    const out: string[] = [];
    for (const c of rules || []) {
        const tag = (c?.tag || "").trim();
        if (!tag) continue;
        const hosts = (c.hosts || []).map((x) => String(x || "")).filter(Boolean);
        const keywords = (c.keywords || []).map((x) => String(x || "")).filter(Boolean);
        const hitHost = hosts.some((x) => matchHost(h, x));
        const hitKeyword = keywords.some((x) => matchKeyword(x, hay));
        if (hitHost || hitKeyword) {
            if (!out.includes(tag)) out.push(tag);
            if (out.length >= 3) break;
        }
    }
    return out;
}

/**
 * 读取工作区分类规则；文件不存在时写入默认模板后返回内置规则。
 * 解析失败不阻断同步：退回内置规则并在日志里说明。
 */
export async function loadTagCategories(log: (msg: string) => void): Promise<BookmarkTagCategory[]> {
    let text = "";
    try {
        text = await getWorkspaceFileText(TAG_RULES_PATH);
    } catch (e) {
        text = "";
    }
    if (text && text.trim()) {
        try {
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed) ? parsed : parsed?.categories;
            if (Array.isArray(list) && list.length) {
                return list.filter((c: any) => c && typeof c.tag === "string" && c.tag.trim());
            }
        } catch (e) {
            log(`分类规则文件解析失败（${e instanceof Error ? e.message : String(e)}），本次使用内置规则。`);
            return DEFAULT_TAG_CATEGORIES;
        }
    }
    // 首次使用：生成默认模板，方便用户直接编辑定制分类
    try {
        const template = {
            _说明: "书签自动分类规则：tag=标签名；hosts=域名包含其一即命中；keywords=域名+标题包含其一即命中。每条书签最多命中 3 类；改完保存，下次同步生效。",
            categories: DEFAULT_TAG_CATEGORIES,
        };
        await putWorkspaceFile(JSON.stringify(template, null, 4), TAG_RULES_FILE, TAG_RULES_DIR);
        log(`已生成分类规则模板 ${TAG_RULES_PATH}，可直接编辑定制分类。`);
    } catch (e) {
        log(`写入分类规则模板失败（${e instanceof Error ? e.message : String(e)}），不影响同步，使用内置规则。`);
    }
    return DEFAULT_TAG_CATEGORIES;
}
