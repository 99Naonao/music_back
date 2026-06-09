/**
 * 枕头类小程序 AppId / 名称 / bed GetAccessToken key 配置
 *
 * 智合枕：wx43c54dcd8642d95b
 * 观心枕：wxc907a3357b4d9f99
 */

const DEFAULT_BED_API_KEY = '1f3e1d08bac85daf08eca14e72cde665';

/** @type {Record<string, { name: string, bedApiKey?: string }>} */
const DEFAULT_PILLOW_APPS = {
    wx43c54dcd8642d95b: { name: '智合枕' },
    wxc907a3357b4d9f99: { name: '观心枕', bedApiKey: DEFAULT_BED_API_KEY }
};

let pillowAppsCache = null;

function loadPillowAppsConfig() {
    if (pillowAppsCache) return pillowAppsCache;

    const map = {};
    Object.keys(DEFAULT_PILLOW_APPS).forEach((appId) => {
        map[appId] = { ...DEFAULT_PILLOW_APPS[appId] };
    });

    const jsonRaw = process.env.BED_TOKEN_APP_KEYS;
    if (jsonRaw && String(jsonRaw).trim()) {
        try {
            const obj = JSON.parse(jsonRaw);
            Object.keys(obj).forEach((appId) => {
                const id = String(appId).trim();
                if (!id) return;
                const val = obj[appId];
                if (!map[id]) {
                    map[id] = { name: id };
                }
                if (typeof val === 'string' && val.trim()) {
                    map[id].bedApiKey = val.trim();
                } else if (val && typeof val === 'object') {
                    if (val.name) map[id].name = String(val.name);
                    if (val.bedApiKey || val.key) {
                        map[id].bedApiKey = String(val.bedApiKey || val.key).trim();
                    }
                }
            });
        } catch (error) {
            console.warn('[pillow-mini-apps] BED_TOKEN_APP_KEYS JSON 解析失败:', error.message);
        }
    }

    const legacyKey = process.env.BED_API_KEY;
    if (legacyKey && String(legacyKey).trim()) {
        Object.keys(map).forEach((appId) => {
            if (!map[appId].bedApiKey) {
                map[appId].bedApiKey = String(legacyKey).trim();
            }
        });
    }

    Object.keys(map).forEach((appId) => {
        if (!map[appId].bedApiKey) {
            map[appId].bedApiKey = DEFAULT_BED_API_KEY;
        }
    });

    pillowAppsCache = map;
    return map;
}

function getPillowAppConfig(appId) {
    const id = String(appId || '').trim();
    if (!id) return null;
    const map = loadPillowAppsConfig();
    return map[id] || null;
}

function getBedApiKeyForAppId(appId) {
    const cfg = getPillowAppConfig(appId);
    if (!cfg || !cfg.bedApiKey) {
        return DEFAULT_BED_API_KEY;
    }
    return cfg.bedApiKey;
}

function getAllowedAppIds() {
    return Object.keys(loadPillowAppsConfig());
}

function isAppIdAllowed(appId) {
    const id = String(appId || '').trim();
    return !!id && Object.prototype.hasOwnProperty.call(loadPillowAppsConfig(), id);
}

function getAppDisplayName(appId) {
    const cfg = getPillowAppConfig(appId);
    return (cfg && cfg.name) || appId || '';
}

function resetPillowAppsCacheForTests() {
    pillowAppsCache = null;
}

module.exports = {
    DEFAULT_BED_API_KEY,
    DEFAULT_PILLOW_APPS,
    getPillowAppConfig,
    getBedApiKeyForAppId,
    getAllowedAppIds,
    isAppIdAllowed,
    getAppDisplayName,
    resetPillowAppsCacheForTests
};
