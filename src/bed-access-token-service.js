/**
 * bed.qssmart.cn GetAccessToken（SOAP）
 * 智合枕 / 观心枕 按 AppId 使用各自的 bed API key，服务端缓存 24 小时有效令牌
 * @see https://bed.qssmart.cn/CustomerAPIService.asmx?op=GetAccessToken
 */

const axios = require('axios');
const { logInfo } = require('./error-codes');
const pillowMiniApps = require('./pillow-mini-apps');

const BED_SOAP_URL = process.env.BED_SOAP_URL || 'https://bed.qssmart.cn/CustomerAPIService.asmx';
const BED_SOAP_USERNAME = process.env.BED_SOAP_USERNAME || 'customerapi';
const BED_SOAP_PASSWORD = process.env.BED_SOAP_PASSWORD || 'pA2@G8zQ';
const TOKEN_FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** @type {Map<string, { token: string, expiresAt: number, expiresAtText: string }>} */
const cacheByAppId = new Map();

function parseExpiresAt(expiresAt) {
    if (expiresAt == null || expiresAt === '') return null;
    if (typeof expiresAt === 'number') {
        return expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
    }
    const normalized = String(expiresAt).trim().replace(/-/g, '/');
    const ms = Date.parse(normalized);
    return Number.isNaN(ms) ? null : ms;
}

function formatExpiresAtText(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isCacheValid(entry) {
    if (!entry || !entry.token) return false;
    return Date.now() < entry.expiresAt - TOKEN_REFRESH_BUFFER_MS;
}

async function fetchAccessTokenFromBed(appId) {
    const bedApiKey = pillowMiniApps.getBedApiKeyForAppId(appId);
    const method = 'GetAccessToken';
    const dataObj = { key: bedApiKey };
    const postXml =
        "<?xml version='1.0' encoding='utf-8'?>" +
        "<soap:Envelope xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:xsd='http://www.w3.org/2001/XMLSchema' xmlns:soap='http://schemas.xmlsoap.org/soap/envelope/'>" +
        '<soap:Header>' +
        "<MXSoapHeader xmlns='http://bed.cn/'>" +
        `<Username>${BED_SOAP_USERNAME}</Username>` +
        `<Password>${BED_SOAP_PASSWORD}</Password>` +
        '</MXSoapHeader>' +
        '</soap:Header>' +
        '<soap:Body>' +
        `<${method} xmlns='http://bed.cn/'>` +
        `<dataJson>${JSON.stringify(dataObj)}</dataJson>` +
        `</${method}>` +
        '</soap:Body>' +
        '</soap:Envelope>';

    const res = await axios.post(BED_SOAP_URL, postXml, {
        headers: {
            'content-type': 'text/xml; charset=utf-8',
            SOAPAction: `http://bed.cn/${method}`
        },
        timeout: Number(process.env.BED_SOAP_TIMEOUT_MS || 20000),
        responseType: 'text',
        validateStatus: () => true
    });

    if (res.status !== 200) {
        throw new Error(`GetAccessToken HTTP ${res.status}`);
    }

    const xml = typeof res.data === 'string' ? res.data : String(res.data || '');
    const resultPattern = new RegExp(`<${method}Result>([\\s\\S]*?)<\\/${method}Result>`);
    const match = xml.match(resultPattern);
    if (!match || !match[1]) {
        throw new Error('GetAccessToken 响应格式异常');
    }

    let body;
    try {
        body = JSON.parse(match[1]);
    } catch (error) {
        throw new Error('GetAccessToken 数据解析失败');
    }

    if (!body || body.ret !== 0) {
        throw new Error((body && body.msg) || 'GetAccessToken 失败');
    }

    const token = body.data && body.data.token;
    if (!token) {
        throw new Error('GetAccessToken 未返回 token');
    }

    const expiresAt = parseExpiresAt(body.data.expires_at) || (Date.now() + TOKEN_FALLBACK_TTL_MS);
    const expiresAtText = body.data.expires_at || formatExpiresAtText(expiresAt);

    return {
        token,
        expiresAt,
        expiresAtText,
        expiresInSec: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
        raw: body
    };
}

/**
 * 获取访问令牌（按 AppId 缓存，各小程序使用各自 bed key）
 * @param {string} appId
 * @param {{ forceRefresh?: boolean }} [options]
 */
async function getAccessToken(appId, options = {}) {
    const id = String(appId || '').trim();
    if (!id) {
        throw new Error('AppId 不能为空');
    }
    if (!pillowMiniApps.isAppIdAllowed(id)) {
        throw new Error('不支持的小程序 AppId');
    }

    const appName = pillowMiniApps.getAppDisplayName(id);
    const { forceRefresh = false } = options;
    const cached = cacheByAppId.get(id);
    if (!forceRefresh && isCacheValid(cached)) {
        logInfo('bed-token', '使用缓存访问令牌', {
            appId: id,
            appName,
            expiresAt: cached.expiresAtText
        });
        return {
            ...cached,
            appName,
            expiresInSec: Math.max(0, Math.floor((cached.expiresAt - Date.now()) / 1000)),
            fromCache: true
        };
    }

    logInfo('bed-token', '请求 GetAccessToken', {
        appId: id,
        appName,
        forceRefresh
    });
    const fresh = await fetchAccessTokenFromBed(id);
    const entry = {
        token: fresh.token,
        expiresAt: fresh.expiresAt,
        expiresAtText: fresh.expiresAtText
    };
    cacheByAppId.set(id, entry);
    logInfo('bed-token', 'GetAccessToken 成功', {
        appId: id,
        appName,
        tokenLength: fresh.token.length,
        expiresAt: fresh.expiresAtText
    });
    return {
        ...entry,
        appName,
        expiresInSec: fresh.expiresInSec,
        fromCache: false,
        raw: fresh.raw
    };
}

function clearAccessTokenCache(appId) {
    if (appId) {
        cacheByAppId.delete(String(appId).trim());
        return;
    }
    cacheByAppId.clear();
}

module.exports = {
    getAccessToken,
    isAppIdAllowed: pillowMiniApps.isAppIdAllowed,
    getAllowedAppIds: pillowMiniApps.getAllowedAppIds,
    getAppDisplayName: pillowMiniApps.getAppDisplayName,
    clearAccessTokenCache,
    fetchAccessTokenFromBed
};
