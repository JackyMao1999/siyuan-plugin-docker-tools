const { test } = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./load-ts.cjs');
const { FeishuSyncDialog } = createLoader()('src/libs/feishu-dialog.ts');

function clientWithPages(pages, authMode = 'user') {
    const calls = [];
    const { FeishuClient } = createLoader({ fetchSyncPost: async (url, request) => {
        calls.push(request);
        const next = pages.shift();
        assert.ok(next, 'unexpected API request');
        return { code: 0, data: { status: 200, body: JSON.stringify(next), bodyEncoding: 'text' } };
    } })('src/libs/feishu-api.ts');
    const client = new FeishuClient({ domain: 'https://open.feishu.cn', appId: 'test', appSecret: 'test', authMode });
    client.setUserTokenProvider({ ensureAccessToken: async () => 'test-token' });
    return { client, calls };
}
const ok = data => ({ code: 0, data });

test('Wiki search uses v2 user API, preserves cursor/query and normalizes numeric types', async () => {
    const { client, calls } = clientWithPages([ok({ items: [
        { node_id: 'n', obj_token: 'd', obj_type: 8, space_id: 's', title: '页面', url: 'https://example.com/wiki/n' },
        { node_id: 'legacy', obj_type: 1 }, { node_id: 'future', obj_type: 999 },
    ], has_more: true, page_token: 'next' }), ok({ items: [], has_more: false })]);
    const page = await client.searchWikiNodes('');
    assert.equal(page.items[0].node_token, 'n');
    assert.equal(page.items[0].obj_type, 'docx');
    assert.equal(page.items[1].obj_type, 'doc');
    assert.equal(page.items[2].obj_type, 'unknown');
    assert.equal(page.items[0].has_child, undefined);
    await client.searchWikiNodes('装机', page.pageToken);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://open.feishu.cn/open-apis/wiki/v2/nodes/search?page_size=50');
    assert.deepEqual(calls[0].payload, { query: '' });
    assert.deepEqual(calls[1].payload, { query: '装机' });
    assert.ok(calls[1].url.endsWith('&page_token=next'));
    await assert.rejects(client.searchWikiNodes('a'.repeat(51)), /50/);
    const tenant = clientWithPages([], 'tenant');
    await assert.rejects(tenant.client.searchWikiNodes(), /用户身份/);
    assert.equal(tenant.calls.length, 0);
});

test('my_library reads all pages including empty intermediate pages; bad cursors and permission failures are explicit', async () => {
    const { client, calls } = clientWithPages([
        ok({ items: [], has_more: true, page_token: 'next' }),
        ok({ items: [{ node_token: 'n' }], has_more: false }),
    ]);
    assert.deepEqual(await client.listWikiNodes('my_library'), [{ node_token: 'n' }]);
    assert.match(calls[0].url, /\/spaces\/my_library\/nodes\?page_size=50$/);
    assert.match(calls[1].url, /page_token=next/);
    for (const pages of [
        [ok({ has_more: true })],
        [ok({ has_more: true, page_token: 'same' }), ok({ has_more: true, page_token: 'same' })],
        [{ code: 131006, msg: 'wiki space permission denied' }],
    ]) await assert.rejects(clientWithPages(pages).client.listWikiNodes('my_library'), /分页|permission denied/);
});

// Small DOM fixture: exercises the actual tree builder/collector without adding a browser library.
class Element {
    constructor() {
        this.children = []; this.dataset = {}; this.style = {}; this.className = '';
        this.classList = {
            contains: name => this.className.split(' ').includes(name),
            toggle: (name, force) => {
                const set = new Set(this.className.split(' ').filter(Boolean));
                const add = force === undefined ? !set.has(name) : force;
                if (add) set.add(name); else set.delete(name);
                this.className = [...set].join(' ');
            },
            add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false),
        };
    }
    appendChild(child) { this.children.push(child); return child; }
    set innerHTML(value) { this.children = []; this.html = value; }
    querySelector(selector) {
        const direct = selector.startsWith(':scope > ');
        const cls = selector.replace(':scope > ', '').slice(1);
        for (const child of this.children) {
            if (child.classList.contains(cls)) return child;
            if (!direct) { const found = child.querySelector(selector); if (found) return found; }
        }
        return null;
    }
}
function dialog(client, recursive = true) {
    const d = Object.create(FeishuSyncDialog.prototype);
    Object.assign(d, {
        deps: { client: { currentAuthMode: 'user', isConfigured: true, ...client }, i18n: {} },
        options: { recursive }, treeVersion: 1, destroyed: false, discovering: false,
        treeEl: new Element(), syncBtn: {}, searchInput: { value: '' }, sourceSelect: { value: 'wiki-discovery' },
        spaceNames: new Map([['known', '已知空间']]), logs: [], status: '',
        appendLog(m) { this.logs.push(m); }, setStatus(m) { this.status = m; },
    });
    return d;
}
function withDOM(fn) {
    return async () => {
        const previous = global.document;
        global.document = { createElement: () => new Element() };
        try { await fn(); } finally { global.document = previous; }
    };
}
const hit = (token = 'entry', space = 'hidden') => ({ node_token: token, obj_token: `doc-${token}`, obj_type: 'docx', space_id: space, title: token, url: `https://example.com/wiki/${token}` });
const checkbox = wrap => wrap.querySelector('.feishu-sync__checkbox');

test('discovery paginates empty pages, deduplicates and groups without requesting space roots', withDOM(async () => {
    const calls = [];
    const pages = [
        { items: [], hasMore: true, pageToken: '2' },
        { items: [hit(), hit('other', 'known')], hasMore: true, pageToken: '3' },
        { items: [hit()], hasMore: false },
    ];
    const d = dialog({ searchWikiNodes: async (query, cursor) => { calls.push([query, cursor]); return pages.shift(); } });
    await d.loadWikiDiscovery(1);
    assert.deepEqual(calls, [['', ''], ['', '2'], ['', '3']]);
    assert.equal(d.treeEl.children.length, 2);
    assert.equal(JSON.parse(checkbox(d.treeEl.children[0]).dataset.meta).kind, 'wiki-results');
    assert.equal(d.treeEl.children[0].querySelector('.feishu-sync__children').children.length, 1);
    assert.match(d.status, /2 个页面，2 个空间/);
    assert.equal(d.syncBtn.disabled, false);
}));

test('selected discovery group resolves pages and only reads their subtrees; overlapping results are deduplicated', withDOM(async () => {
    for (const recursive of [true, false]) {
        const reads = [];
        const d = dialog({
            searchWikiNodes: async () => ({ items: [hit(), hit('child'), hit('denied'), hit('next')], hasMore: false }),
            getWikiNode: async token => {
                if (token === 'denied') throw new Error('131006 permission denied');
                return { ...hit(token), has_child: token === 'entry', obj_edit_time: '123' };
            },
            listWikiNodes: async (space, parent) => {
                assert.equal(space, 'hidden'); assert.equal(parent, 'entry');
                reads.push(parent); return [{ ...hit('child'), has_child: false }];
            },
        }, recursive);
        await d.loadWikiDiscovery(1);
        checkbox(d.treeEl.children[0]).checked = true;
        const items = await d.collectSelectedItems();
        assert.deepEqual(items.map(i => i.key), ['wiki:entry', 'wiki:child', 'wiki:next']);
        assert.equal(items[0].editTime, '123');
        assert.equal(items[0].url, hit().url);
        assert.deepEqual(reads, recursive ? ['entry'] : []);
        assert.ok(d.logs.some(m => m.includes('permission denied')));
    }
}));

test('discovered page expansion resolves missing child metadata and retries failed reads', withDOM(async () => {
    let calls = 0;
    const d = dialog({
        getWikiNode: async () => {
            if (++calls === 1) throw new Error('<b>denied</b>');
            return { ...hit(), has_child: true };
        },
        listWikiNodes: async (space, parent) => {
            assert.equal(parent, 'entry'); return [hit('child')];
        },
    });
    const meta = d.searchHitToMeta(hit(), ['space']);
    const wrap = d.createNodeElement(meta, 0);
    const title = wrap.querySelector('.feishu-sync__node-title');
    title.onclick();
    await new Promise(resolve => setImmediate(resolve));
    const children = wrap.querySelector('.feishu-sync__children');
    assert.match(children.textContent, /<b>denied<\/b>/);
    assert.equal(meta.loaded, false);
    title.onclick(); title.onclick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(children.children.length, 1);
    assert.equal(calls, 2);
}));

test('discovery retains partial results on failures or repeated cursors', withDOM(async () => {
    for (const failure of ['network', 'cursor']) {
        let count = 0;
        const d = dialog({ searchWikiNodes: async () => {
            if (++count === 2 && failure === 'network') throw new Error('network timeout');
            return { items: [hit()], hasMore: true, pageToken: 'same' };
        } });
        await d.loadWikiDiscovery(1);
        assert.equal(count, 2);
        assert.equal(d.treeEl.children.length, 1);
        assert.match(d.status, /未完成.*1 个页面/);
        assert.equal(d.syncBtn.disabled, false);
    }
}));

test('stale discovery cannot update a new source or closed dialog', withDOM(async () => {
    for (const close of [false, true]) {
        let complete;
        const d = dialog({ searchWikiNodes: () => new Promise(resolve => { complete = resolve; }) });
        const pending = d.loadWikiDiscovery(1);
        if (close) d.destroyed = true; else d.treeVersion++;
        d.status = 'new source';
        complete({ items: [hit()], hasMore: true, pageToken: 'next' });
        await pending;
        assert.equal(d.status, 'new source');
        assert.equal(d.treeEl.children.length, 0);
    }
}));

test('my library source bypasses space list and tenant mode does not issue requests', withDOM(async () => {
    const reads = [];
    const d = dialog({ listWikiNodes: async (space, parent) => { reads.push([space, parent]); return [hit()]; } });
    d.sourceSelect.value = 'my-library';
    await d.loadTree();
    checkbox(d.treeEl.children[0]).checked = true;
    assert.equal((await d.collectSelectedItems()).length, 1);
    assert.deepEqual(reads, [['my_library', undefined]]);
    d.deps.client.currentAuthMode = 'tenant';
    await d.loadTree();
    assert.equal(d.treeEl.children.length, 0);
    assert.match(d.status, /用户身份/);
}));

test('recursive permission failures retain accessible siblings and finish', withDOM(async () => {
    const d = dialog({ listWikiNodes: async (space, parent) => {
        if (parent === 'entry') throw new Error('permission denied');
        return [{ ...hit(), has_child: true }, hit('next')];
    } });
    const root = d.createNodeElement({ kind: 'space', key: 's', title: '库', spaceId: 's', expandable: true, path: [] }, 0);
    checkbox(root).checked = true;
    d.treeEl.appendChild(root);
    assert.deepEqual((await d.collectSelectedItems()).map(i => i.key), ['wiki:entry', 'wiki:next']);
    assert.match(d.logs.join('\n'), /permission denied/);
}));

test('Wiki DOCX rows use document icons even when expandable, and resolved leaves lose their arrow', withDOM(async () => {
    const d = dialog({ getWikiNode: async () => ({ ...hit(), has_child: false }) });
    const leaf = d.createNodeElement(d.searchHitToMeta(hit(), []), 0);
    assert.equal(leaf.querySelector('.feishu-sync__icon').textContent, '📄');
    assert.equal(checkbox(leaf).disabled, undefined);
    leaf.querySelector('.feishu-sync__node-title').onclick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(leaf.querySelector('.feishu-sync__toggle').textContent, '');
    assert.equal(leaf.querySelector('.feishu-sync__children').classList.contains('fn__none'), true);
    assert.equal(JSON.parse(checkbox(leaf).dataset.meta).expandable, false);
    assert.equal(JSON.parse(checkbox(leaf).dataset.meta).syncable, true);

    const parent = d.createNodeElement(d.wikiNodeToMeta('space', { ...hit(), has_child: true }, []), 0);
    assert.equal(parent.querySelector('.feishu-sync__icon').textContent, '📄');
    assert.equal(parent.querySelector('.feishu-sync__toggle').textContent, '▸');
    for (const kind of ['space', 'wiki-results', 'drive-root', 'drive-folder']) {
        const group = d.createNodeElement({ kind, key: kind, title: kind, expandable: true, path: [] }, 0);
        assert.equal(group.querySelector('.feishu-sync__icon').textContent, '📁');
    }
}));
