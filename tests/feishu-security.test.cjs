const { test } = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./load-ts.cjs');

test('API and OAuth reject non-official domains before transmitting credentials', async () => {
    let requests = 0;
    const load = createLoader({ fetchSyncPost: async () => { requests++; throw new Error('unexpected request'); } });
    const { FeishuClient, trustedFeishuDomain } = load('src/libs/feishu-api.ts');
    const { FeishuAuth } = load('src/libs/feishu-auth.ts');
    assert.equal(trustedFeishuDomain('https://open.feishu.cn/'), 'https://open.feishu.cn');
    assert.equal(trustedFeishuDomain('https://open.larksuite.com'), 'https://open.larksuite.com');
    for (const domain of [
        'http://open.feishu.cn', 'https://open.feishu.cn.example.com',
        'https://open.feishu.cn@example.com', 'https://example.com',
        'https://open.feishu.cn/path', 'https://open.feishu.cn?query=1',
    ]) {
        assert.throws(() => new FeishuClient({ domain, appId: 'test', appSecret: 'test' }), /域名无效/);
        const auth = new FeishuAuth(async () => null, async () => {});
        await assert.rejects(auth.exchangeCode(domain, 'test', 'test', 'test', 'http://localhost/callback', ''), /域名无效/);
    }
    assert.equal(requests, 0);
});

test('malformed responses never expose response contents or request URLs in errors or logs', () => {
    const { parseJsonBody } = createLoader()('src/libs/feishu-api.ts');
    const logs = [];
    const original = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    try {
        assert.throws(() => parseJsonBody({ status: 502, body: 'private-response-fixture <html>' },
            'https://open.feishu.cn/test?code=private-code-fixture'), error => {
            assert.match(error.message, /HTTP 502/);
            assert.doesNotMatch(error.message, /private-|<html>|https:/);
            return true;
        });
        assert.deepEqual(logs, []);
    } finally { console.error = original; }
});

test('authorization status escapes names and scopes instead of treating them as HTML', () => {
    const { FeishuAuthDialog } = createLoader()('src/libs/feishu-auth-dialog.ts');
    const d = Object.create(FeishuAuthDialog.prototype);
    d.deps = {
        i18n: {}, getConfig: () => ({ authMode: 'user', scope: '<svg/onload=alert(1)>' }),
        auth: { isAuthorized: true, info: { userName: '<img src=x onerror=alert(1)>', scope: '' } },
    };
    d.statusEl = {}; d.revokeBtn = {};
    d.renderStatus();
    assert.doesNotMatch(d.statusEl.innerHTML, /<img|<svg/);
    assert.match(d.statusEl.innerHTML, /&lt;img/);
    assert.match(d.statusEl.innerHTML, /&lt;svg/);
});

test('sync form does not interpolate a stored root path into HTML', () => {
    const { FeishuSyncDialog } = createLoader()('src/libs/feishu-dialog.ts');
    const d = Object.create(FeishuSyncDialog.prototype);
    d.deps = { i18n: {} };
    d.options = { rootPath: '"><img src=x onerror=alert(1)>' };
    assert.doesNotMatch(d.buildContent(), /<img|onerror/);
});

test('loading and saving settings do not log application secrets', async () => {
    const { SettingUtils } = createLoader({ Setting: class {} })('src/libs/setting-utils.ts');
    const secret = 'test-secret';
    const logs = [];
    const original = console.debug;
    console.debug = (...args) => logs.push(JSON.stringify(args));
    try {
        const stored = [];
        const settings = new SettingUtils({ plugin: {
            data: {}, loadData: async () => ({ feishuAppSecret: secret }),
            saveData: async (_, data) => stored.push(data),
        } });
        settings.settings.set('feishuAppSecret', { value: '' });
        await settings.load();
        await settings.save();
        assert.equal(stored[0].feishuAppSecret, secret);
        assert.ok(logs.every(line => !line.includes(secret)));
    } finally { console.debug = original; }
});
