const fs = require('fs');

/**
 * 元数据提取工具
 * 支持从 CommonJS 模块、Class 模块、k6 ES Module 脚本中提取插件元数据
 */

/**
 * 从 CommonJS 模块提取 meta
 * @param {string} filePath
 * @returns {object|null}
 */
function extractMetaFromCommonJS(filePath) {
    try {
        delete require.cache[require.resolve(filePath)];
        const mod = require(filePath);
        if (mod && mod.meta) {
            return normalizeMeta(mod.meta);
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 从 Class 模块提取 static meta
 * @param {string} filePath
 * @returns {object|null}
 */
function extractMetaFromClass(filePath) {
    try {
        delete require.cache[require.resolve(filePath)];
        const Mod = require(filePath);
        if (Mod && Mod.meta) {
            return normalizeMeta(Mod.meta);
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 从 k6 ES Module 脚本中正则提取 export const meta = {...}
 * @param {string} filePath
 * @returns {object|null}
 */
function extractMetaFromK6Script(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // 匹配 export const meta = { ... };
        const match = content.match(/export\s+const\s+meta\s*=\s*(\{[\s\S]*?\});/);
        if (!match) return null;
        // 安全解析：使用 new Function 而非 JSON.parse，因为元数据可能包含单引号、无引号 key 等
        const meta = new Function('return ' + match[1])();
        return normalizeMeta(meta);
    } catch (e) {
        return null;
    }
}

/**
 * 规范化 meta 对象，确保必要字段存在
 * @param {object} meta
 * @returns {object}
 */
function normalizeMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    return {
        name: meta.name || '',
        displayName: meta.displayName || meta.name || '',
        description: meta.description || '',
        category: meta.category || '',
        params: Array.isArray(meta.params) ? meta.params : [],
        targets: Array.isArray(meta.targets) ? meta.targets : [],
        ...meta
    };
}

module.exports = {
    extractMetaFromCommonJS,
    extractMetaFromClass,
    extractMetaFromK6Script,
    normalizeMeta
};
