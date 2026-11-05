// Load source modules with the existing TypeScript dependency; SiYuan is supplied by the host in production.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

module.exports = function createLoader(siyuan = {}) {
    const cache = new Map();
    function load(file) {
        file = path.resolve(__dirname, '..', file);
        if (cache.has(file)) return cache.get(file).exports;
        const mod = { exports: {} };
        cache.set(file, mod);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
            fileName: file,
        }).outputText;
        const localRequire = (name) => {
            if (name === 'siyuan') return siyuan;
            if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
            return require(name);
        };
        new Function('require', 'module', 'exports', code)(localRequire, mod, mod.exports);
        return mod.exports;
    }
    return load;
};
