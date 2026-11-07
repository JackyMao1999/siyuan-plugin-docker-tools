const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const vm = require('node:vm');
const createLoader = require('./load-ts.cjs');
const { FeishuOAuthCallback, parseOAuthCallback, createOAuthState } = createLoader()('src/libs/feishu-oauth-callback.ts');
const browserUri = 'https://notes.example/plugins/test/feishu-callback.html';
const state = 'test-state';

function tokenFixture() {
    const requests = [];
    let saved;
    const load = createLoader({ fetchSyncPost: async (path, request) => {
        assert.equal(path, '/api/network/forwardProxy');
        requests.push(request);
        return { code: 0, data: { status: 200, body: JSON.stringify({ access_token: 'access-fixture', expires_in: 7200 }) } };
    } });
    const { FeishuAuth, DEFAULT_USER_SCOPE } = load('src/libs/feishu-auth.ts');
    const auth = new FeishuAuth(async () => null, async value => { saved = value; });
    return { auth, requests, scope: DEFAULT_USER_SCOPE, saved: () => saved };
}

async function freePort() {
    const server = http.createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

function get(url, headers = {}, agent) {
    return new Promise((resolve, reject) => {
        http.get(url, { headers, agent }, res => {
            let text = '';
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
        }).on('error', reject);
    });
}

test('callback rejects foreign origins, paths, state, duplicate parameters and denied consent', () => {
    const valid = `${browserUri}?code=fixture&state=${state}`;
    assert.equal(parseOAuthCallback(valid, browserUri, state), 'fixture');
    for (const href of [valid.replace('notes.example', 'evil.example'), valid.replace('.html', '.html/extra'),
        valid.replace(state, 'other'), valid + '&code=second', valid + '&state=second', valid + '#fragment',
        `${browserUri}?state=${state}`, `${browserUri}?state=${state}&error=access_denied`]) {
        assert.throws(() => parseOAuthCallback(href, browserUri, state));
    }
});

test('desktop HTTP callback exchanges/saves tokens once, rejects mismatches and releases its port', async t => {
    const oldWindow = global.window;
    global.window = { require, crypto: require('node:crypto').webcrypto };
    t.after(() => { if (oldWindow === undefined) delete global.window; else global.window = oldWindow; });
    assert.match(createOAuthState(), /^[a-f0-9]{64}$/);
    assert.notEqual(createOAuthState(), createOAuthState());
    const uri = `http://127.0.0.1:${await freePort()}/feishu-callback`;
    const fixture = tokenFixture();
    const errors = [];
    const callback = new FeishuOAuthCallback(uri, state,
        code => fixture.auth.exchangeCode('https://open.feishu.cn', 'app', 'secret', code, uri, fixture.scope),
        message => errors.push(message));
    t.after(() => callback.stop());
    await callback.start(true, '');
    assert.equal((await get(`${uri}?code=fixture&state=wrong`)).status, 400);
    assert.equal((await get(`${uri}?code=fixture&state=${state}`, { host: 'evil.example' })).status, 400);
    assert.equal(fixture.requests.length, 0);
    const result = await get(`${uri}?code=fixture&state=${state}`);
    assert.equal(result.status, 200);
    assert.match(result.text, /授权成功/);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.doesNotMatch(result.text, /fixture|secret/);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].payload.code, 'fixture');
    assert.equal(fixture.requests[0].payload.redirect_uri, uri);
    assert.equal(fixture.saved().accessToken, 'access-fixture');
    assert.deepEqual(errors, []);
    await assert.rejects(callback.complete(`${uri}?code=fixture&state=${state}`), /已结束/);
    const replacement = http.createServer();
    await new Promise((resolve, reject) => replacement.once('error', reject).listen(Number(new URL(uri).port), '127.0.0.1', resolve));
    await new Promise(resolve => replacement.close(resolve));
});

test('browser callback page delivers result and displays success only after token storage', { timeout: 5000 }, async t => {
    const fixture = tokenFixture();
    const errors = [];
    const callback = new FeishuOAuthCallback(browserUri, state,
        code => fixture.auth.exchangeCode('https://open.feishu.cn', 'app', 'secret', code, browserUri, fixture.scope),
        message => errors.push(message));
    t.after(() => callback.stop());
    await callback.start(false, browserUri);
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    let historyPath;
    const element = { set textContent(value) {
        assert.ok(fixture.saved(), 'success must wait for persistence');
        finish(value);
    } };
    let pagehide;
    const context = {
        window: { location: { href: `${browserUri}?code=browser-code&state=${state}`, pathname: new URL(browserUri).pathname },
            addEventListener: (_, fn) => { pagehide = fn; } },
        document: { getElementById: () => element }, history: { replaceState: (_, __, path) => { historyPath = path; } },
        URL, BroadcastChannel, setInterval, clearInterval, setTimeout, clearTimeout,
    };
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../public/feishu-callback.js'), 'utf8'), context);
    t.after(() => pagehide?.());
    assert.match(await finished, /授权成功/);
    assert.equal(historyPath, new URL(browserUri).pathname);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].payload.code, 'browser-code');
    assert.deepEqual(errors, []);
});

test('failed exchanges are reported and cannot be replayed; stopped attempts never exchange', async () => {
    let calls = 0;
    const errors = [];
    const callback = new FeishuOAuthCallback(browserUri, state, async () => { calls++; throw new Error('exchange failed'); }, message => errors.push(message));
    await callback.start(false, browserUri);
    const url = `${browserUri}?code=fixture&state=${state}`;
    await assert.rejects(callback.complete(url), /exchange failed/);
    await assert.rejects(callback.complete(url), /已结束/);
    assert.equal(calls, 1);
    assert.deepEqual(errors, ['exchange failed']);
    const cancelled = new FeishuOAuthCallback(browserUri, state, async () => { calls++; }, () => {});
    await cancelled.start(false, browserUri);
    cancelled.stop();
    await assert.rejects(cancelled.complete(url), /已结束/);
    assert.equal(calls, 1);
});

test('default scopes omit offline access and tokens without refresh stay usable until expiry', async () => {
    const fixture = tokenFixture();
    assert.ok(!fixture.scope.split(' ').includes('offline_access'));
    const url = new URL(fixture.auth.buildAuthorizeUrl('https://open.feishu.cn', 'app', browserUri, fixture.scope, state));
    assert.equal(url.searchParams.get('state'), state);
    assert.equal(url.searchParams.get('scope'), fixture.scope);
    await fixture.auth.exchangeCode('https://open.feishu.cn', 'app', 'secret', 'fixture', browserUri, fixture.scope);
    fixture.auth.info.accessExpire = Date.now() + 60000;
    assert.equal(await fixture.auth.ensureAccessToken('https://open.feishu.cn', 'app', 'secret'), 'access-fixture');
    fixture.auth.info.accessExpire = Date.now() - 1;
    await assert.rejects(fixture.auth.ensureAccessToken('https://open.feishu.cn', 'app', 'secret'), /重新授权/);
    assert.equal(fixture.requests.length, 1);
});

test('dialog excludes historical offline access without rewriting the saved callback', async t => {
    const oldWindow = global.window;
    global.window = { location: { origin: 'https://notes.example' } };
    t.after(() => { if (oldWindow === undefined) delete global.window; else global.window = oldWindow; });
    for (const frontend of ['desktop', 'browser-desktop']) {
        const { FeishuAuthDialog } = createLoader({ getFrontend: () => frontend })('src/libs/feishu-auth-dialog.ts');
        const dialog = Object.create(FeishuAuthDialog.prototype);
        dialog.deps = { pluginName: 'test', auth: { info: { scope: 'wiki:wiki:readonly offline_access docs:document.content:read' } },
            getConfig: () => ({ scope: 'wiki:wiki:readonly docx:document:readonly' }) };
        dialog.scopeInput = { value: '' };
        const savedUri = frontend === 'desktop' ? 'http://127.0.0.1:18999/custom-callback' : browserUri;
        dialog.redirectInput = { value: savedUri };
        dialog.renderStatus = () => {};
        dialog.renderChecklist = () => {};
        dialog.missingGrantedScopes = () => [];
        await dialog.init();
        assert.doesNotMatch(dialog.scopeInput.value, /offline_access/);
        assert.match(dialog.scopeInput.value, /docs:document.content:read/);
        assert.match(dialog.scopeInput.value, /docx:document:readonly/);
        assert.equal(dialog.redirectInput.value, savedUri);
        global.window.location.origin = 'http://127.0.0.1:19999';
        await dialog.init();
        assert.equal(dialog.redirectInput.value, savedUri);
    }
});

test('desktop denied consent closes listener and reports failure without exchanging', async t => {
    const oldWindow = global.window;
    global.window = { require };
    t.after(() => { if (oldWindow === undefined) delete global.window; else global.window = oldWindow; });
    const uri = `http://127.0.0.1:${await freePort()}/feishu-callback`;
    const errors = [];
    let calls = 0;
    const callback = new FeishuOAuthCallback(uri, state, async () => { calls++; }, message => errors.push(message));
    t.after(() => callback.stop());
    await callback.start(true, '');
    assert.equal((await get(`${uri}?state=${state}&error=access_denied`)).status, 400);
    assert.equal(calls, 0);
    assert.match(errors[0], /已取消/);
    await assert.rejects(callback.complete(`${uri}?state=${state}&code=fixture`), /已结束/);
});

test('desktop rejects the SiYuan port before attempting to open a listener', async t => {
    const { usesSiYuanPort } = createLoader()('src/libs/feishu-oauth-callback.ts');
    const origin = 'http://127.0.0.1:6806';
    assert.equal(usesSiYuanPort('http://localhost:6806/', origin), true);
    assert.equal(usesSiYuanPort('http://127.0.0.1:6806/feishu-callback', origin), true);
    assert.equal(usesSiYuanPort('http://127.0.0.1:18879/feishu-callback', origin), false);
    assert.equal(usesSiYuanPort('http://127.0.0.1:6806/', 'null'), false);
    const oldWindow = global.window;
    global.window = { location: { origin }, require: () => { throw new Error('must not open a socket'); } };
    t.after(() => { if (oldWindow === undefined) delete global.window; else global.window = oldWindow; });
    const callback = new FeishuOAuthCallback('http://localhost:6806/', state, async () => {}, () => {});
    await assert.rejects(callback.start(true, ''), /6806 正由思源使用/);
});

test('legacy migration uses a fixed desktop address and preserves a configured independent port', () => {
    const { migrateDesktopRedirectUri, DESKTOP_REDIRECT_URI } = createLoader()('src/libs/feishu-oauth-callback.ts');
    for (const port of [6806, 6807, 12345]) {
        const origin = `http://127.0.0.1:${port}`;
        assert.equal(migrateDesktopRedirectUri(`${origin}/`, origin), DESKTOP_REDIRECT_URI);
        assert.equal(migrateDesktopRedirectUri('http://127.0.0.1:6806/', origin), DESKTOP_REDIRECT_URI);
        assert.equal(migrateDesktopRedirectUri('', origin), DESKTOP_REDIRECT_URI);
        assert.equal(migrateDesktopRedirectUri(`${origin}/plugins/test/feishu-callback.html`, origin), DESKTOP_REDIRECT_URI);
        assert.equal(migrateDesktopRedirectUri('http://127.0.0.1:18999/custom-callback', origin), 'http://127.0.0.1:18999/custom-callback');
    }
});


test('re-authorizing after logout does not reuse a previous attempt through browser keep-alive', async t => {
    const oldWindow = global.window;
    global.window = { require };
    t.after(() => { if (oldWindow === undefined) delete global.window; else global.window = oldWindow; });
    const uri = `http://127.0.0.1:${await freePort()}/feishu-callback`;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    t.after(() => agent.destroy());
    const fixture = tokenFixture();
    const { FeishuAuthDialog } = createLoader({ showMessage: () => {} })('src/libs/feishu-auth-dialog.ts');
    const errors = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        const nonce = `state-${attempt}`;
        const callback = new FeishuOAuthCallback(uri, nonce,
            code => fixture.auth.exchangeCode('https://open.feishu.cn', 'app', 'secret', code, uri, fixture.scope),
            message => errors.push(message));
        t.after(() => callback.stop());
        await callback.start(true, '');
        if (attempt > 0) {
            const stale = await get(`${uri}?code=old-fixture&state=state-${attempt - 1}`, {}, agent);
            assert.equal(stale.status, 400);
            assert.equal(fixture.requests.length, attempt, 'stale callbacks must never exchange tokens');
        }
        const response = await get(`${uri}?code=fixture-${attempt}&state=${nonce}`, {}, agent);
        assert.equal(response.status, 200, `attempt ${attempt}: ${response.text}`);
        assert.equal(response.headers.connection, 'close');
        assert.equal(fixture.requests.length, attempt + 1);
        // Cover closing/reopening the dialog as well as clicking Logout in the same dialog.
        if (attempt >= 3) {
            const dialog = Object.create(FeishuAuthDialog.prototype);
            dialog.callback = callback;
            dialog.codeInput = { value: 'old manual callback' };
            dialog.deps = { auth: fixture.auth };
            dialog.appendLog = dialog.renderStatus = () => {};
            await dialog.handleRevoke();
            assert.equal(dialog.callback, null);
            assert.equal(dialog.codeInput.value, '');
        } else {
            await fixture.auth.clear();
        }
        assert.equal(fixture.saved(), null);
    }
    assert.deepEqual(errors, []);
});
