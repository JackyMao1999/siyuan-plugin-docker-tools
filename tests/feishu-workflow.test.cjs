const { test } = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./load-ts.cjs');

function pluginFixture() {
    const load = createLoader({ Plugin: class {}, showMessage: () => {} });
    const syncDialogs = [];
    const authDialogs = [];
    load('src/libs/feishu-dialog.ts').FeishuSyncDialog = class { constructor(deps) { syncDialogs.push(deps); } };
    load('src/libs/feishu-auth-dialog.ts').FeishuAuthDialog = class {
        constructor(deps) { authDialogs.push(deps); }
        destroy() {}
    };
    const Plugin = load('src/index.ts').default;
    const plugin = new Plugin();
    plugin.i18n = {};
    plugin.feishuClient = { setCredentials() {} };
    plugin.getFeishuCredentials = () => ({ domain: 'https://open.feishu.cn', appId: 'test', appSecret: 'test', authMode: 'user' });
    const settings = new Map();
    plugin.settingUtils = { get: key => settings.get(key), set: (key, value) => settings.set(key, value), save: async () => {} };
    const saved = [];
    plugin.saveData = async (file, value) => saved.push({ file, value });
    return { plugin, syncDialogs, authDialogs, settings, saved };
}

test('user sync opens authorization when tokens are missing or unusable and resumes after success', async () => {
    for (const reason of ['尚未授权', '授权已过期', '应用已更换']) {
        const { plugin, syncDialogs, authDialogs } = pluginFixture();
        let authorized = false;
        plugin.feishuAuth = { ensureAccessToken: async () => {
            if (!authorized) throw new Error(reason);
            return 'token';
        } };
        await plugin.openFeishuSync();
        assert.equal(syncDialogs.length, 0);
        assert.equal(authDialogs.length, 1);
        // A settings/status change alone (including Logout) must not open sync.
        authDialogs[0].onChanged();
        assert.equal(syncDialogs.length, 0);
        authorized = true;
        authDialogs[0].onAuthorized();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(syncDialogs.length, 1);
        assert.equal(authDialogs.length, 1);
    }
});

test('valid user and app identity open sync without prompting for user authorization', async () => {
    const { plugin, syncDialogs, authDialogs } = pluginFixture();
    plugin.feishuAuth = { ensureAccessToken: async () => 'token' };
    await plugin.openFeishuSync();
    plugin.getFeishuCredentials = () => ({ appId: 'test', appSecret: 'test', authMode: 'tenant' });
    plugin.feishuAuth.ensureAccessToken = async () => { throw new Error('app identity must not request a user token'); };
    await plugin.openFeishuSync();
    assert.equal(syncDialogs.length, 2);
    assert.equal(authDialogs.length, 0);
});

test('four sync settings default on, respect saved false, and persist changes from the sync dialog', async () => {
    const { plugin, settings, saved } = pluginFixture();
    const keys = [['recursive', 'feishuRecursive'], ['syncAssets', 'feishuAssets'],
        ['incremental', 'feishuIncremental'], ['addSource', 'feishuAddSource']];
    let options = plugin.getFeishuSyncOptions();
    for (const [option] of keys) assert.equal(options[option], true);
    for (const [, key] of keys) settings.set(key, false);
    options = plugin.getFeishuSyncOptions();
    for (const [option] of keys) assert.equal(options[option], false);
    options.recursive = options.syncAssets = options.addSource = true;
    await plugin.saveFeishuOptions(options);
    assert.equal(settings.get('feishuRecursive'), true);
    assert.equal(settings.get('feishuAssets'), true);
    assert.equal(settings.get('feishuAddSource'), true);
    assert.equal(settings.get('feishuIncremental'), false);
    assert.deepEqual(plugin.getFeishuSyncOptions(), options);
    assert.equal(saved[0].file, 'feishu-sync-config.json');
});

test('repeated sync overwrites the same document and incremental mode skips unchanged content', async () => {
    const requests = [];
    const load = createLoader({ fetchSyncPost: async (url, data) => {
        requests.push({ url, data });
        let response;
        if (url === '/api/query/sql') response = data.stmt.includes('count(*)') ? [{ cnt: 2 }] : [{ id: 'existing-doc' }];
        else if (url === '/api/block/getChildBlocks') response = [{ id: 'old-block' }];
        else if (url === '/api/block/deleteBlock') response = [];
        else if (url === '/api/block/appendBlock') response = [{ doOperations: [] }];
        else throw new Error(`Unexpected request: ${url}`);
        return { code: 0, data: response };
    } });
    load('src/libs/siyuan-dom.ts').markdownToBlockDom = () => '';
    const { FeishuSync, DEFAULT_SYNC_OPTIONS } = load('src/libs/feishu-sync.ts');
    const sync = new FeishuSync({}, {});
    sync.buildMarkdown = async () => ({ markdown: 'replacement content', blockCount: 1 });
    const options = { ...DEFAULT_SYNC_OPTIONS, notebook: 'notebook' };
    const item = { key: 'wiki-token', objToken: 'doc-token', title: 'Document', path: [], editTime: '1' };
    const first = await sync.syncItem(item, options);
    assert.equal(first.status, 'updated');
    assert.equal(first.docId, 'existing-doc');
    assert.equal((await sync.syncItem(item, options)).status, 'skipped');
    assert.equal((await sync.syncItem({ ...item, editTime: '2' }, options)).status, 'updated');
    assert.equal((await sync.syncItem({ ...item, editTime: '2' }, { ...options, incremental: false })).status, 'updated');
    assert.equal(requests.filter(r => r.url === '/api/block/deleteBlock').length, 3);
    assert.equal(requests.filter(r => r.url === '/api/block/appendBlock').length, 3);
    assert.equal(requests.filter(r => r.url === '/api/filetree/createDocWithMd').length, 0);
});

test('authorized sync windows omit the authorization entry', () => {
    const { FeishuSyncDialog } = createLoader()('src/libs/feishu-dialog.ts');
    const dialog = Object.create(FeishuSyncDialog.prototype);
    dialog.deps = { i18n: {}, isAuthorized: () => true };
    assert.doesNotMatch(dialog.buildContent(), /id="feishu-auth-btn"/);
    dialog.deps.isAuthorized = () => false;
    assert.match(dialog.buildContent(), /id="feishu-auth-btn"/);
});

test('top menu retains Feishu sync without a standalone authorization entry', () => {
    const items = [];
    const load = createLoader({ Plugin: class {}, adaptHotkey: value => value, Menu: class {
        addItem(item) { items.push(item); }
        addSeparator() {}
        open() {}
    } });
    const Plugin = load('src/index.ts').default;
    const plugin = new Plugin();
    plugin.i18n = { feishuSync: 'Feishu Sync', feishuAuthMenu: 'Feishu Authorization' };
    plugin.showPrintMenu({ right: 0, bottom: 0 });
    assert.equal(items.filter(item => item.label === 'Feishu Sync').length, 1);
    assert.equal(items.filter(item => item.label === 'Feishu Authorization').length, 0);
});

test('sync collects current settings without option checkboxes and preserves its selected destination', () => {
    const { FeishuSyncDialog } = createLoader()('src/libs/feishu-dialog.ts');
    const dialog = Object.create(FeishuSyncDialog.prototype);
    let settings = { recursive: true, syncAssets: true, incremental: true, addSource: true, notebook: 'old', rootPath: '/old' };
    dialog.deps = { i18n: {}, getOptions: () => ({ ...settings }) };
    dialog.options = { ...settings };
    dialog.notebookSelect = { value: 'selected-notebook' };
    dialog.rootPathInput = { value: '/selected-root' };
    assert.doesNotMatch(dialog.buildContent(), /id="feishu-(recursive|assets|incremental|source-note)"/);
    settings = { ...settings, recursive: false, incremental: false, boardImageWidth: 640 };
    dialog.collectOptions();
    assert.deepEqual(dialog.options, { ...settings, notebook: 'selected-notebook', rootPath: '/selected-root' });
});
