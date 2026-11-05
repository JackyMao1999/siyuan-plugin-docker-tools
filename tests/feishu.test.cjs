const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createLoader = require('./load-ts.cjs');
require('./feishu-sources.test.cjs');
require('./feishu-security.test.cjs');
const load = createLoader();
const { docxBlocksToMarkdown: parse } = load('src/libs/feishu-parser.ts');
const { splitMarkdownChunks, FeishuSync, DEFAULT_SYNC_OPTIONS } = load('src/libs/feishu-sync.ts');
const { markdownToBlockDom } = load('src/libs/siyuan-dom.ts');

const run = (content, style = {}) => ({ text_run: { content, text_element_style: style } });
const paragraph = (content, id = 'p') => ({ block_id: id, block_type: 2, text: { elements: [run(content)] } });
const sheet = { block_id: 'sheet', block_type: 30, sheet: { token: 'spreadsheet_sheetid' } };
const document = (...blocks) => [{ block_id: 'root', block_type: 1, children: blocks.map(b => b.block_id) }, ...blocks];
const formula = 'e_y(t)=y_{actual}(t)-y_{target}(t)';
const expectedMath = `$$\n${formula}\n$$`;

test('standalone formulas support normal/doubled delimiters and escaped subscripts', async () => {
    for (const text of [
        String.raw`\[ e_y(t)=y\_{actual}(t)-y\_{target}(t) \]`,
        String.raw`\\[ e_y(t)=y\_{actual}(t)-y\_{target}(t) \\]`,
        `  $$ ${formula} $$  `,
    ]) assert.equal(await parse(document(paragraph(text))), expectedMath);
});

test('formula detection joins styled runs and preserves multiline LaTeX commands', async () => {
    const block = paragraph('');
    block.text.elements = [run('\\'), run('[\\frac{a}{b}', { bold: true }), run('\n+ c\\]')];
    assert.equal(await parse(document(block)), '$$\n\\frac{a}{b}\n+ c\n$$');
});

test('incomplete delimiters and inline code stay text', async () => {
    for (const value of [
        String.raw`\[x`, String.raw`\[x\\]`, String.raw`\[ \]`, '$$$x$$$',
        '$100 和 $200',
    ]) {
        const md = await parse(document(paragraph(value)));
        assert.doesNotMatch(md, /^\$\$\n/);
    }
    const coded = paragraph('');
    coded.text.elements = [run(String.raw`\[x\]`, { inline_code: true })];
    assert.doesNotMatch(await parse(document(coded)), /^\$\$\n/);
    coded.text.elements = [run('x^2', { inline_code: true })];
    assert.equal(await parse(document(coded)), '`x^2`');
    const linked = paragraph('');
    linked.text.elements = [run(String.raw`\[x\]`, { link: { url: 'https://example.com' } })];
    assert.doesNotMatch(await parse(document(linked)), /^\$\$\n/);
    const code = { block_id: 'code', block_type: 14, code: { elements: [run('$$\nx\n$$')], style: { language: 33 } } };
    assert.equal(await parse(document(code)), '```latex\n$$\nx\n$$\n```');
});

const vx = String.raw`v_x=v\cos45^\circ`;
const vy = String.raw`v_y=v\sin45^\circ`;
const pairMath = `$$\n${vx}\n$$\n\n$$\n${vy}\n$$`;

test('adjacent bracket/dollar formulas become separate blocks, including doubled escapes', async () => {
    for (const text of [
        `\\[ ${vx} \\]\\[ ${vy} \\]`,
        `\\\\[ ${vx} \\\\]\\\\[ ${vy} \\\\]`,
        `$$${vx}$$$$${vy}$$`, `\\[${vx}\\]\n\n$$${vy}$$`,
    ]) assert.equal(await parse(document(paragraph(text))), pairMath);
});

test('text surrounding formulas keeps its ordering and styles across text runs', async () => {
    const block = paragraph('');
    block.text.elements = [
        run('前文', { bold: true }), run('\\'), run(`[ ${vx} \\]中间`, { italic: true }),
        run(`\\[${vy}\\]后文`),
    ];
    assert.equal(await parse(document(block)), `<span data-type="strong">前文</span>\n\n$$\n${vx}\n$$\n\n<span data-type="em">中间</span>\n\n$$\n${vy}\n$$\n\n后文`);
});

test('code, links and native inline equations are preserved alongside display formulas', async () => {
    const block = paragraph('');
    block.text.elements = [run(String.raw`\[code\]`, { inline_code: true }), run(' '),
        run('link', { link: { url: 'https://example.com' } }), { equation: { content: 'z' } },
        run(String.raw`\[x\]`),
    ];
    const result = await parse(document(block));
    assert.ok(result.endsWith('\n\n$$\nx\n$$'));
    assert.match(result, /\[link\]\(https:\/\/example.com\)\$z\$/);
    assert.equal((result.match(/^\$\$/gm) || []).length, 2);
    const crossed = paragraph('');
    crossed.text.elements = [run('\\['), run('x', { inline_code: true }), run('\\]')];
    assert.doesNotMatch(await parse(document(crossed)), /^\$\$/m);
});

test('malformed formula text stays literal without creating superscript markup', async () => {
    const result = await parse(document(paragraph(String.raw`\[x^2+y^2`)));
    assert.ok(result.includes(String.raw`x\^2+y\^2`));
    assert.doesNotMatch(result, /^\$\$/m);
});

test('native math blocks are block-level, inline equations remain inline', async () => {
    assert.equal(await parse(document({ block_id: 'math', block_type: 16, equation: { content: formula } })), expectedMath);
    assert.equal(await parse(document({ block_id: 'math', block_type: 16, equation: { elements: [{ equation: { content: formula } }] } })), expectedMath);
    const block = paragraph('');
    block.text.elements = [run('值为 '), { equation: { content: '2x' } }, run('。')];
    assert.equal(await parse(document(block)), '值为 $ 2x $。');
});

function listFormula(type) {
    const key = { 12: 'bullet', 13: 'ordered', 17: 'todo' }[type];
    return { block_id: 'list', block_type: type, [key]: { elements: [run(String.raw`\[x^2\]`)] } };
}

test('formulas in lists and quotes retain their container indentation', async () => {
    for (const [type, marker] of [[12, '- '], [13, '1. '], [17, '- [ ] ']]) {
        const indent = ' '.repeat(marker.length);
        assert.equal(await parse(document(listFormula(type))), `${marker}$$\n${indent}x^2\n${indent}$$`);
    }
    const quoted = { block_id: 'q', block_type: 15, quote: { elements: [run(String.raw`\[x^2\]`)] } };
    assert.equal(await parse(document(quoted)), '> $$\n> x^2\n> $$');
    const container = { block_id: 'q', block_type: 34, children: ['p'] };
    assert.equal(await parse([container, paragraph(String.raw`\[x^2\]`)]), '> $$\n> x^2\n> $$');
});

test('spreadsheet keeps empty cells/rows and zero, escapes syntax, pads ragged rows', async () => {
    const md = await parse(document(sheet), { resolveSheet: async () => [
        ['名称', '结果', '备注'], ['金额', 0, null], [],
        ['a|b', '一\n二', '<b>& [x](url) $10 _x_ \\path'],
        [false, [{ type: 'text', text: '富文本' }, { type: 'url', text: '链接' }]],
    ] });
    assert.equal(md, [
        '| 名称 | 结果 | 备注 |', '| --- | --- | --- |', '| 金额 | 0 |  |', '|  |  |  |',
        '| a\\|b | 一<br>二 | &lt;b&gt;&amp; \\[x\\](url) \\$10 \\_x\\_ \\\\path |',
        '| false | 富文本链接 |  |',
    ].join('\n'));
});

test('document table cells keep inline math and do not rewrite code, later paragraphs remain block math', async () => {
    const table = { block_id: 'table', block_type: 31, table: { cells: ['c1', 'c2'], property: { column_size: 2 } } };
    const c1 = { block_id: 'c1', block_type: 32, children: ['m'] };
    const c2 = { block_id: 'c2', block_type: 32, children: ['code'] };
    const math = { block_id: 'm', block_type: 16, equation: { content: 'x^2' } };
    const code = { block_id: 'code', block_type: 14, code: { elements: [run('$$\nx\n$$')] } };
    const blocks = [...document(table, paragraph(String.raw`\[x^2\]`)), c1, c2, math, code];
    assert.equal(await parse(blocks), '| $x^2$ | ```<br>$$<br>x<br>$$<br>``` |\n| --- | --- |\n\n$$\nx^2\n$$');
    const pair = paragraph(String.raw`\[x^2\]\[y^2\]`, 'm');
    assert.equal(await parse([...document(table), c1, c2, pair, code]), '| $x^2$ $y^2$ | ```<br>$$<br>x<br>$$<br>``` |\n| --- | --- |');
});

test('empty spreadsheet is distinguished from failed and unsupported cells', async () => {
    const logs = [];
    for (const values of [[], [[]]]) {
        assert.equal(await parse(document(sheet), { resolveSheet: async () => values, onProgress: m => logs.push(m) }), '> 电子表格为空');
    }
    assert.equal(logs.length, 0);
    const md = await parse(document(sheet), { resolveSheet: async () => [[{ image: 'token' }]], onProgress: m => logs.push(m) });
    assert.match(md, /无法转换的单元格/);
    assert.match(logs.join('\n'), /无法转换的单元格/);
});

test('sheet failures retain placeholders, log the reason and continue the document', async () => {
    for (const reason of ['403 forbidden', '99991679 re-authorization required', 'response exceeds 10M', 'network timeout']) {
        const logs = [];
        const md = await parse(document(sheet, paragraph('后续正文')), {
            resolveSheet: async () => { throw new Error(reason); }, onProgress: m => logs.push(m),
        });
        assert.match(md, /电子表格未能同步/);
        assert.match(md, /spreadsheet\\_sheetid/);
        assert.ok(md.endsWith('后续正文'));
        assert.ok(logs.some(m => m.includes(reason)));
    }
    assert.match(await parse(document(sheet)), /电子表格未能同步/);
});

function apiClient(body) {
    const calls = [];
    const apiLoad = createLoader({ fetchSyncPost: async (url, request) => {
        calls.push({ url, request });
        return { code: 0, data: { status: 200, body: JSON.stringify(body), bodyEncoding: 'text' } };
    } });
    const { FeishuClient } = apiLoad('src/libs/feishu-api.ts');
    const client = new FeishuClient({ domain: 'https://open.feishu.cn', appId: 'test', appSecret: 'test', authMode: 'user' });
    client.setUserTokenProvider({ ensureAccessToken: async () => 'test-access-token' });
    return { client, calls };
}

test('Sheets request splits the compound token and asks for computed values using existing auth', async () => {
    const { client, calls } = apiClient({ code: 0, data: { valueRange: { values: [['结果'], [42]] } } });
    assert.deepEqual(await client.getEmbeddedSheetValues('spreadsheetFixture_sheetFixture'), [['结果'], [42]]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/network/forwardProxy');
    assert.equal(calls[0].request.url, 'https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/spreadsheetFixture/values/sheetFixture?valueRenderOption=FormattedValue');
    assert.deepEqual(calls[0].request.headers, [{ Authorization: 'Bearer test-access-token' }]);
});

test('Sheets client distinguishes empty responses, malformed responses and API errors', async () => {
    for (const values of [undefined, null, []]) {
        assert.deepEqual(await apiClient({ code: 0, data: { valueRange: { values } } }).client.getEmbeddedSheetValues('token_id'), []);
    }
    for (const data of [{}, { valueRange: { values: {} } }, { valueRange: { values: [1] } }]) {
        await assert.rejects(apiClient({ code: 0, data }).client.getEmbeddedSheetValues('token_id'), /数据格式异常/);
    }
    await assert.rejects(apiClient({ code: 99991679, msg: 'permission denied' }).client.getEmbeddedSheetValues('token_id'), /permission denied/);
    const { client, calls } = apiClient({});
    for (const token of ['', 'missingSeparator', '_id', 'token_']) await assert.rejects(client.getEmbeddedSheetValues(token), /token 格式无效/);
    assert.equal(calls.length, 0);
});

test('sync fetches spreadsheets even when asset sync is disabled', async () => {
    let reads = 0;
    const sync = new FeishuSync({}, {
        getDocxBlocks: async () => document(sheet),
        getEmbeddedSheetValues: async token => { assert.equal(token, sheet.sheet.token); reads++; return [['结果'], [0]]; },
    });
    const result = await sync.buildMarkdown({ objType: 'docx', objToken: 'doc' }, { ...DEFAULT_SYNC_OPTIONS, syncAssets: false, addSource: false });
    assert.equal(reads, 1);
    assert.equal(result.markdown, '| 结果 |\n| --- |\n| 0 |');
});

test('chunking preserves multiline math and code at small limits', () => {
    for (const block of [
        '$$\nx\n\ny\n$$', '- $$\n  x\n\n  y\n  $$',
        '> $$\n> x\n\n> y\n> $$', '- [ ] $$\n      x\n\n      y\n      $$',
        '```latex\n$$\n\nx\n$$\n```',
    ]) {
        const chunks = splitMarkdownChunks(`${block}\n\n后续正文`, 1);
        assert.deepEqual(chunks, [block, '后续正文']);
    }
    assert.deepEqual(splitMarkdownChunks('价格 $100\n\n下一段', 1), ['价格 $100', '下一段']);
    const list = '- $$\n  x\n  $$\n\n  $$\n  y\n  $$';
    assert.deepEqual(splitMarkdownChunks(`${list}\n\n后续正文`, 1), [list, '后续正文']);
});

test('completed sync reloads only written open documents without stealing focus', async () => {
    const calls = [];
    const logs = [];
    const reloaded = id => ({ protyle: { block: { rootID: id } }, reload: focus => calls.push([id, focus]) });
    const syncLoad = createLoader({ getAllEditor: () => [
        { protyle: { block: { rootID: 'updated' } }, reload: () => { throw new Error('closed editor'); } },
        reloaded('updated'), reloaded('created'), reloaded('skipped'), reloaded('failed'), reloaded('unrelated'),
    ] });
    const { FeishuSync: Sync } = syncLoad('src/libs/feishu-sync.ts');
    const sync = new Sync({ saveData: async () => calls.push(['saved']) }, {});
    sync.syncItem = async item => ({ item, status: item.key, docId: item.key });
    const results = await sync.syncItems(['updated', 'created', 'skipped', 'failed'].map(key => ({ key, title: key })), {}, undefined, m => logs.push(m));
    assert.deepEqual(calls, [['saved'], ['updated', false], ['created', false]]);
    assert.deepEqual(results.map(r => r.status), ['updated', 'created', 'skipped', 'failed']);
    assert.ok(logs.some(m => m.includes('界面刷新失败')));
});

// Exercise the actual SiYuan engine when installed, without bundling its runtime into this plugin.
const lutePath = process.env.SIYUAN_LUTE_PATH || '/opt/SiYuan/resources/stage/protyle/js/lute/lute.min.js';
const katexPath = process.env.SIYUAN_KATEX_PATH || '/opt/SiYuan/resources/stage/protyle/js/katex/katex.min.js';
test('reported sqrt and percentile formulas survive conversion and render with SiYuan KaTeX', {
    skip: !fs.existsSync(lutePath) || !fs.existsSync(katexPath),
}, async () => {
    require(path.resolve(lutePath));
    const katex = require(path.resolve(katexPath));
    const lute = global.Lute.New();
    const samples = [
        String.raw`e_{end}=\sqrt{(x_a-x_t)^2+(y_a-y_t)^2}`,
        String.raw`P95=\operatorname{Percentile}_{95}(e_1,\ldots,e_N)`,
        String.raw`RMSE_v=\sqrt{\frac{1}{N}\sum_{i=1}^{N}(v_{actual,i}-v_{target,i})^2}`,
    ];
    for (const sample of samples) {
        const md = await parse(document(paragraph(`\\[ ${sample} \\]`)));
        const dom = lute.Md2BlockDOM(md);
        const content = global.Lute.UnEscapeHTMLStr(/data-content="([^"]*)"/.exec(dom)[1]);
        assert.equal(content, sample);
        const html = katex.renderToString(content, { displayMode: true, throwOnError: true, output: 'html' });
        assert.match(html, /class="katex-display"/);
        assert.doesNotMatch(html, /katex-error/);
    }
    const pairedMd = await parse(document(paragraph(`\\[ ${vx} \\]\\[ ${vy} \\]`)));
    const pairedDom = lute.Md2BlockDOM(pairedMd);
    assert.equal((pairedDom.match(/data-type="NodeMathBlock"/g) || []).length, 2);
    const formulas = [...pairedDom.matchAll(/data-content="([^"]*)"/g)].map(match => global.Lute.UnEscapeHTMLStr(match[1]));
    assert.deepEqual(formulas, [vx, vy]);
    for (const content of formulas) assert.match(katex.renderToString(content, { displayMode: true, throwOnError: true }), /katex-display/);
});
test('SiYuan Lute creates editable table and native math block DOM', { skip: !fs.existsSync(lutePath) }, async () => {
    require(path.resolve(lutePath));
    global.window = { Lute: global.Lute };
    const sources = [
        paragraph(String.raw`\\[ e_y(t)=y\_{actual}(t)-y\_{target}(t) \\]`),
        listFormula(12), listFormula(13), listFormula(17),
        { block_id: 'q', block_type: 15, quote: { elements: [run(String.raw`\[x^2\]`)] } },
    ];
    for (const source of sources) {
        const dom = markdownToBlockDom(await parse(document(source)));
        assert.match(dom, /data-type="NodeMathBlock"/);
        if (source.block_type === 2) assert.ok(dom.includes(`data-content="${formula}"`));
        if ([12, 13, 17].includes(source.block_type)) assert.match(dom, /data-type="NodeListItem"/);
        if (source.block_type === 15) assert.match(dom, /data-type="NodeBlockquote"/);
    }
    const table = markdownToBlockDom(await parse(document(sheet), { resolveSheet: async () => [['名称', '值'], ['a|b', 0], ['<b>&', '一\n二']] }));
    assert.match(table, /data-type="NodeTable"/);
    assert.match(table, /contenteditable="true"/);
    assert.match(table.replace(/<[^>]+>/g, ''), /a\|b/);
    assert.match(table, /&lt;b&gt;&amp;/);
    assert.match(table, /一<br\s*\/>二|一<br>二/);
    const malformedDom = markdownToBlockDom(await parse(document(paragraph(String.raw`\[x^2+y^2`))));
    assert.doesNotMatch(malformedDom, /data-type="sup"|NodeMathBlock/);
    for (const type of [12, 13, 17]) {
        const block = listFormula(type);
        const key = {12: 'bullet', 13: 'ordered', 17: 'todo'}[type];
        block[key].elements = [run(`\\[${vx}\\]\\[${vy}\\]`)];
        const dom = markdownToBlockDom(await parse(document(block)));
        assert.equal((dom.match(/data-type="NodeMathBlock"/g) || []).length, 2);
        assert.equal((dom.match(/data-type="NodeListItem"/g) || []).length, 1);
    }
    delete global.window;
});
