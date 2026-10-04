/*
 * 插件部署脚本：构建并安装到本地思源工作区 / Docker 宿主目录 / 远程主机
 *
 * 用法示例：
 *   node scripts/deploy.js                                  # 构建 + 部署到自动检测的本地工作区
 *   node scripts/deploy.js --ws /home/kai/SiYuan            # 指定本地工作区路径
 *   node scripts/deploy.js --no-build                       # 跳过构建，用现有 dist/
 *   node scripts/deploy.js --dir /opt/siyuan/data/plugins --container siyuan
 *                                                           # 部署到宿主机挂载目录（Docker），并重启容器
 *   node scripts/deploy.js --remote kai@192.168.1.10 --dir /opt/siyuan/data/plugins --container siyuan
 *                                                           # scp/ssh 部署到远程 Docker 主机（用 package.zip）
 *
 * 说明：
 *   - 本地/挂载目录模式：先删除旧的插件目录再整体拷贝 dist/，避免残留废弃文件
 *   - 远程模式：上传仓库根目录的 package.zip（构建时自动生成），远端 unzip
 *   - --container 在 --dir/--remote 下生效，部署完成后执行 docker restart
 */
import fs from 'fs';
import os from 'os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { log, error, getSiYuanDir, chooseTarget } from './utils.js';

const SHELL = process.platform === 'win32';

// ------------------------------ 参数 ------------------------------

function parseArgs(argv) {
    const opts = { build: true, ws: '', dir: '', remote: '', container: '' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--no-build') opts.build = false;
        else if (a === '--ws') opts.ws = argv[++i] || '';
        else if (a === '--dir') opts.dir = argv[++i] || '';
        else if (a === '--remote') opts.remote = argv[++i] || '';
        else if (a === '--container') opts.container = argv[++i] || '';
        else if (a === '-h' || a === '--help') {
            console.log(`用法: node scripts/deploy.js [--no-build] [--ws <工作区路径>] [--dir <data/plugins 目录>] [--remote user@host] [--container <容器名>]`);
            process.exit(0);
        } else {
            error(`未知参数: ${a}（用 --help 查看用法）`);
            process.exit(1);
        }
    }
    return opts;
}

// ------------------------------ 基础工具 ------------------------------

function run(cmd, args, cwd) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', shell: SHELL, cwd });
    return r.status === 0;
}

function readPluginMeta() {
    const file = fs.existsSync('./plugin.json') ? './plugin.json' : path.join('..', 'plugin.json');
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!meta?.name) {
        error('Failed! plugin.json 里缺少 name');
        process.exit(1);
    }
    return meta;
}

/** SiYuan 没在运行时，从桌面端的 workspace.json 配置里读工作区路径 */
function readWorkspaceConf() {
    const home = os.homedir();
    const candidates = [
        path.join(home, '.config', 'siyuan', 'workspace.json'), // Linux
        path.join(home, 'Library', 'Application Support', 'siyuan', 'workspace.json'), // macOS
        process.env.APPDATA ? path.join(process.env.APPDATA, 'siyuan', 'workspace.json') : '', // Windows
    ];
    for (const p of candidates) {
        if (!p || !fs.existsSync(p)) continue;
        try {
            const list = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (Array.isArray(list) && list.length) return list;
        } catch {
            // 忽略解析失败，继续下一个候选
        }
    }
    return [];
}

/** 定位本地「data/plugins」目录：--dir 优先；其次运行中的内核 API；再次桌面配置 */
async function resolveLocalPluginsDir(opts) {
    if (opts.dir) return opts.dir;
    if (opts.ws) return path.join(opts.ws, 'data', 'plugins');

    const workspaces = await getSiYuanDir();
    if (workspaces && workspaces.length) {
        if (workspaces.length === 1) return `${workspaces[0].path}/data/plugins`;
        return await chooseTarget(workspaces); // 多工作区：交互选择
    }

    const fromConf = readWorkspaceConf();
    if (fromConf.length) {
        log(`\t内核 API 不可达，改用桌面端配置里的默认工作区`);
        return path.join(fromConf[0], 'data', 'plugins');
    }
    error('Failed! 找不到 SiYuan 工作区：启动思源后重试，或用 --ws / --dir 指定路径');
    process.exit(1);
}

// ------------------------------ 部署 ------------------------------

function build() {
    log('>>> npm run build ...');
    if (!run('npm', ['run', 'build'])) {
        error('构建失败');
        process.exit(1);
    }
}

function deployLocal(pluginsDir, meta) {
    if (!fs.existsSync('./dist')) {
        error('Failed! 未找到 dist/，请先构建（去掉 --no-build）');
        process.exit(1);
    }
    const target = path.join(pluginsDir, meta.name);
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        log(`已清理旧版本: ${target}`);
    }
    fs.cpSync('./dist', target, { recursive: true });
    log(`>>> 部署完成: ${target}  (v${meta.version})`);
    log('    回到思源：Ctrl+P 命令面板 →「重载界面」（或重启思源）生效');
}

function deployRemote(opts, meta) {
    const zip = './package.zip';
    if (!fs.existsSync(zip)) {
        error('Failed! 未找到 package.zip，请先构建');
        process.exit(1);
    }
    if (!opts.dir) {
        error('Failed! 远程模式必须用 --dir 指定远端 data/plugins 目录（容器挂载卷里的路径）');
        process.exit(1);
    }
    const remoteTmp = `/tmp/${meta.name}-${Date.now()}.zip`;
    const target = `${opts.dir.replace(/\/+$/, '')}/${meta.name}`;

    log(`>>> 上传 package.zip 到 ${opts.remote} ...`);
    if (!run('scp', [zip, `${opts.remote}:${remoteTmp}`])) {
        error('scp 上传失败');
        process.exit(1);
    }

    log(`>>> 远端解压到 ${target} ...`);
    const sh = [
        `mkdir -p '${target}'`,
        `rm -rf '${target}'/*`,
        `unzip -oq '${remoteTmp}' -d '${target}' || { echo '远端缺少 unzip 命令'; exit 1; }`,
        `rm -f '${remoteTmp}'`,
    ].join(' && ');
    if (!run('ssh', [opts.remote, sh])) {
        error('远端解压失败');
        process.exit(1);
    }

    if (opts.container) {
        log(`>>> 重启容器 ${opts.container} ...`);
        if (!run('ssh', [opts.remote, `docker restart ${opts.container}`])) {
            error('docker restart 失败（容器名/权限？）');
            process.exit(1);
        }
        log('    浏览器里刷新思源页面即可看到新版本');
    } else {
        log(`>>> 远程部署完成（未指定 --container，如需生效请手动重启思源）`);
    }
}

// ------------------------------ 入口 ------------------------------

const opts = parseArgs(process.argv.slice(2));
const meta = readPluginMeta();

if (opts.build) build();
if (!fs.existsSync('./dist')) {
    error('Failed! 未找到 dist/，请先构建（去掉 --no-build）');
    process.exit(1);
}

if (opts.remote) {
    deployRemote(opts, meta);
} else {
    const pluginsDir = await resolveLocalPluginsDir(opts);
    deployLocal(pluginsDir, meta);
    if (opts.container) {
        log(`>>> 重启容器 ${opts.container} ...`);
        if (!run('docker', ['restart', opts.container])) {
            error('docker restart 失败（容器名/权限？）');
            process.exit(1);
        }
    }
}
