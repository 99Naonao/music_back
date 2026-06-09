/**
 * 多微信小程序 AppID / AppSecret 配置
 *
 * 支持三种配置方式（优先级从高到低）：
 * 1. WX_MINI_APPS JSON：{"wxAppId1":"secret1","wxAppId2":"secret2"}
 * 2. WX_APP_ID_MUSIC + WX_APP_SECRET_MUSIC、WX_APP_ID_SLEEP + WX_APP_SECRET_SLEEP
 *    WX_APP_ID_ZHIHEZHEN + WX_APP_SECRET_ZHIHEZHEN（智合枕 wx43c54dcd8642d95b）
 *    WX_APP_ID_GUANXINZHEN + WX_APP_SECRET_GUANXINZHEN（观心枕 wxc907a3357b4d9f99）
 * 3. 兼容旧版单应用：WX_APP_ID + WX_APP_SECRET
 *
 * WX_DEFAULT_APP_ID：未传 X-WX-App-Id 时使用的默认小程序（建议 music 的 AppID）
 */

const HEADER_APP_ID = 'x-wx-app-id';

let registryCache = null;

function loadRegistry() {
    if (registryCache) return registryCache;

    const map = new Map();

    const jsonRaw = process.env.WX_MINI_APPS;
    if (jsonRaw && String(jsonRaw).trim()) {
        try {
            const obj = JSON.parse(jsonRaw);
            Object.keys(obj).forEach((appId) => {
                const secret = obj[appId];
                if (appId && secret) map.set(String(appId).trim(), String(secret).trim());
            });
        } catch (e) {
            console.warn('[wx-mini-apps] WX_MINI_APPS JSON 解析失败:', e.message);
        }
    }

    const pairs = [
        ['WX_APP_ID_MUSIC', 'WX_APP_SECRET_MUSIC'],
        ['WX_APP_ID_SLEEP', 'WX_APP_SECRET_SLEEP'],
        ['WX_APP_ID_ZHIHEZHEN', 'WX_APP_SECRET_ZHIHEZHEN'],
        ['WX_APP_ID_GUANXINZHEN', 'WX_APP_SECRET_GUANXINZHEN'],
    ];
    pairs.forEach(([idKey, secretKey]) => {
        const appId = process.env[idKey];
        const secret = process.env[secretKey];
        if (appId && secret) map.set(String(appId).trim(), String(secret).trim());
    });

    const legacyId = process.env.WX_APP_ID;
    const legacySecret = process.env.WX_APP_SECRET;
    if (legacyId && legacySecret && !map.has(String(legacyId).trim())) {
        map.set(String(legacyId).trim(), String(legacySecret).trim());
    }

    registryCache = map;
    return map;
}

function getDefaultAppId() {
    const explicit = process.env.WX_DEFAULT_APP_ID;
    if (explicit && String(explicit).trim()) return String(explicit).trim();

    if (process.env.WX_APP_ID_MUSIC) return String(process.env.WX_APP_ID_MUSIC).trim();
    if (process.env.WX_APP_ID) return String(process.env.WX_APP_ID).trim();

    const map = loadRegistry();
    return map.size ? map.keys().next().value : '';
}

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveAppIdFromRequest(req) {
    const headerId = req.headers[HEADER_APP_ID] || req.headers['X-WX-App-Id'];
    const bodyId = req.body && req.body.appId;
    const candidate = (headerId || bodyId || '').toString().trim();
    if (candidate) return candidate;
    return getDefaultAppId();
}

/**
 * @param {string} [appId]
 * @returns {{ appId: string, appSecret: string } | null}
 */
function resolveWxCredentials(appId) {
    const map = loadRegistry();
    const id = (appId || getDefaultAppId() || '').trim();
    if (!id) return null;
    const secret = map.get(id);
    if (!secret) return null;
    return { appId: id, appSecret: secret };
}

function listRegisteredAppIds() {
    return Array.from(loadRegistry().keys());
}

function resetRegistryCacheForTests() {
    registryCache = null;
}

module.exports = {
    HEADER_APP_ID,
    resolveAppIdFromRequest,
    resolveWxCredentials,
    getDefaultAppId,
    listRegisteredAppIds,
    resetRegistryCacheForTests,
};
