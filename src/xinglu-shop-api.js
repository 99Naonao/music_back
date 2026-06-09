/**
 * 星鹿商城 / zhongshu.xinglu.shop 开放接口（文档：music/login.txt 等）
 * 成功响应示例 code === 1
 */

const axios = require('axios');
const FormData = require('form-data');

function baseUrl() {
    return (process.env.SHOP_API_BASE || 'https://zhongshu.xinglu.shop').replace(/\/+$/, '');
}

function versionHeader() {
    return process.env.SHOP_API_VERSION || '1';
}

function headersVersionOnly() {
    return { version: versionHeader() };
}

function headersWithShopToken(shopToken) {
    const h = { version: versionHeader() };
    if (shopToken) {
        h.token = shopToken;
    }
    return h;
}

function isShopApiSuccess(payload) {
    if (!payload || payload.code === undefined || payload.code === null) return false;
    return Number(payload.code) === 1;
}

function getShopApiMessage(payload) {
    if (!payload || typeof payload !== 'object') return '';
    return String(payload.msg || payload.message || '').trim();
}

/** 星鹿 token 失效时常见文案（如「登录超时，请重新登录」） */
function isShopLoginTimeoutMessage(msg) {
    const s = String(msg || '').trim();
    if (!s) return false;
    return /登录超时|请重新登录|登录已过期|token.*过期|token.*失效/i.test(s);
}

function isShopLoginTimeoutPayload(payload) {
    return isShopLoginTimeoutMessage(getShopApiMessage(payload));
}

/**
 * 第三方订单号 association_sn：yyyyMMddHHmmss（14 位数字，Asia/Shanghai）
 */
function formatShopAssociationSn(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(date);
    const g = (t) => (parts.find((p) => p.type === t) || {}).value || '00';
    return `${g('year')}${g('month')}${g('day')}${g('hour')}${g('minute')}${g('second')}`;
}

/** 客户端传入须为 14 位数字；否则由服务端按上海时间生成 */
function normalizeShopAssociationSn(clientSn) {
    const s = clientSn != null ? String(clientSn).trim() : '';
    if (/^\d{14}$/.test(s)) {
        return s;
    }
    return formatShopAssociationSn();
}

/**
 * 手机号静默注册登录 POST multipart mobile
 */
async function silentLoginByMobile(mobile) {
    const form = new FormData();
    form.append('mobile', String(mobile).trim());
    const url = `${baseUrl()}/shopapi/Login/silentLoginByMobile`;
    const res = await axios.post(url, form, {
        headers: {
            ...form.getHeaders(),
            ...headersVersionOnly()
        },
        timeout: Number(process.env.SHOP_API_TIMEOUT_MS || 20000)
    });
    return res.data;
}

/** GET 所有商品列表（goods.txt / shopapi/Detection/getGoodsLists，无需登录） */
async function getGoodsLists() {
    const url = `${baseUrl()}/shopapi/Detection/getGoodsLists`;
    const res = await axios.get(url, {
        headers: headersVersionOnly(),
        timeout: Number(process.env.SHOP_API_TIMEOUT_MS || 20000)
    });
    return res.data;
}

/** GET 个人中心（积分 user_integral 等） */
async function getUserCentre(shopToken) {
    const url = `${baseUrl()}/shopapi/User/centre`;
    const res = await axios.get(url, {
        headers: headersWithShopToken(shopToken),
        timeout: Number(process.env.SHOP_API_TIMEOUT_MS || 20000)
    });
    return res.data;
}

/** POST x-www-form-urlencoded field + value */
async function setUserInfo(shopToken, field, value) {
    const params = new URLSearchParams();
    params.append('field', String(field));
    params.append('value', value === undefined || value === null ? '' : String(value));
    const url = `${baseUrl()}/shopapi/User/setInfo`;
    const res = await axios.post(url, params.toString(), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...headersWithShopToken(shopToken)
        },
        timeout: Number(process.env.SHOP_API_TIMEOUT_MS || 20000)
    });
    return res.data;
}

/**
 * POST multipart /shopapi/User/thirdDeduct
 * - deduct_user_integral：变动积分数量
 * - association_sn：必填；格式 yyyyMMddHHmmss（未传或格式不对则服务端生成）
 * - action：可选；1 减少（默认，可不传）、2 增加（文档：music/score.txt）
 */
async function postThirdIntegral(shopToken, amount, associationSn, action) {
    const form = new FormData();
    form.append('deduct_user_integral', String(Number(amount)));
    form.append('association_sn', normalizeShopAssociationSn(associationSn));
    const a = action != null ? String(action) : '1';
    if (a === '2') {
        form.append('action', '2');
    }
    const url = `${baseUrl()}/shopapi/User/thirdDeduct`;
    const res = await axios.post(url, form, {
        headers: {
            ...form.getHeaders(),
            ...headersWithShopToken(shopToken)
        },
        timeout: Number(process.env.SHOP_API_TIMEOUT_MS || 20000)
    });
    return res.data;
}

/** 第三方增加积分（与扣除同一接口，传 action=2） */
async function thirdGrantIntegral(shopToken, grantAmount, associationSn) {
    return postThirdIntegral(shopToken, grantAmount, associationSn, '2');
}

/** POST multipart 扣除积分（减少，默认不传 action） */
async function thirdDeduct(shopToken, deductUserIntegral, associationSn) {
    return postThirdIntegral(shopToken, deductUserIntegral, associationSn, '1');
}

function pickLoginData(payload) {
    const d = payload && payload.data;
    if (!d || typeof d !== 'object') return null;
    return {
        token: d.token,
        sn: d.sn,
        nickname: d.nickname,
        avatar: pickAvatarFromCentre(d),
        mobile: d.mobile,
        source_password: d.source_password
    };
}

function isPersistedAvatarUrl(url) {
    const s = String(url || '').trim();
    if (!s) return false;
    const lower = s.toLowerCase();
    if (lower.startsWith('wxfile://')) return false;
    if (lower.includes('/__tmp__/')) return false;
    if (lower.startsWith('http://tmp/') || lower.startsWith('https://tmp/')) return false;
    if (!/^https?:\/\//i.test(s)) return false;
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(s)) return false;
    return true;
}

function isShopOssAvatarUrl(url) {
    const lower = String(url || '').trim().toLowerCase();
    return lower.includes('oss.zsyl.cc/') || lower.includes('zhongshu.xinglu.shop/');
}

function isOurApiHost(origin) {
    try {
        const base = (process.env.BASE_URL || '').replace(/\/$/, '');
        if (!base) return false;
        const apiHost = new URL(base).host.toLowerCase();
        return new URL(origin).host.toLowerCase() === apiHost;
    } catch (_) {
        return false;
    }
}

function repairMangledAvatarUrl(url) {
    const u = String(url || '').trim();
    if (!u) return u;
    const ossWrong = u.match(/^(https?:\/\/oss\.zsyl\.cc)\/api\/upload\/file\/(.+)$/i);
    if (ossWrong) {
        try {
            const rest = decodeURIComponent(ossWrong[2]);
            return `${ossWrong[1]}/uploads/${rest}`;
        } catch (_) {
            /* keep */
        }
    }
    const apiWrong = u.match(/^(https?:\/\/[^/]+)\/api\/upload\/file\/(.+)$/i);
    if (apiWrong && /%2f/i.test(apiWrong[2])) {
        try {
            const flat = decodeURIComponent(apiWrong[2]).split('/').filter(Boolean).pop();
            if (flat) return `${apiWrong[1]}/api/upload/file/${flat}`;
        } catch (_) {
            /* keep */
        }
    }
    return u;
}

function normalizeHostedUploadUrl(url) {
    let trimmed = repairMangledAvatarUrl(String(url || '').trim());
    if (!trimmed) return trimmed;
    if (/^https?:\/\/oss\.zsyl\.cc\/uploads\//i.test(trimmed)) {
        return trimmed;
    }
    return trimmed.replace(
        /^(https?:\/\/[^/]+)(\/uploads\/[^?#]+)$/i,
        (full, origin, uploadsPath) => {
            if (!isOurApiHost(origin)) return full;
            const rel = uploadsPath.replace(/^\/uploads\//, '');
            const flat = rel.split('/').filter(Boolean).pop() || rel;
            return `${origin}/api/upload/file/${encodeURIComponent(flat)}`;
        }
    );
}

/** 星鹿个人中心/登录：头像字段名不统一时归一为 avatar */
function pickAvatarFromCentre(centre) {
    if (!centre || typeof centre !== 'object') return '';
    const candidates = [
        centre.avatar,
        centre.avatar_url,
        centre.avatarUrl,
        centre.headimgurl,
        centre.head_img,
        centre.headImg
    ];
    for (const v of candidates) {
        if (v != null && String(v).trim() && isPersistedAvatarUrl(v)) {
            return normalizeHostedUploadUrl(String(v).trim());
        }
    }
    return '';
}

/** 社群/评论接口返回前统一头像 URL */
function formatUserAvatarForClient(avatarUrl) {
    if (!avatarUrl || !isPersistedAvatarUrl(avatarUrl)) return '';
    return normalizeHostedUploadUrl(String(avatarUrl).trim());
}

/** 透传前补全 avatar，便于小程序统一读 centre.avatar */
function normalizeCentrePayload(centre) {
    if (!centre || typeof centre !== 'object') return centre;
    const avatar = pickAvatarFromCentre(centre);
    return { ...centre, avatar: avatar ? normalizeHostedUploadUrl(avatar) : avatar };
}

module.exports = {
    baseUrl,
    isShopApiSuccess,
    getShopApiMessage,
    isShopLoginTimeoutMessage,
    isShopLoginTimeoutPayload,
    silentLoginByMobile,
    getGoodsLists,
    getUserCentre,
    setUserInfo,
    thirdDeduct,
    thirdGrantIntegral,
    formatShopAssociationSn,
    normalizeShopAssociationSn,
    pickLoginData,
    isPersistedAvatarUrl,
    isShopOssAvatarUrl,
    repairMangledAvatarUrl,
    normalizeHostedUploadUrl,
    pickAvatarFromCentre,
    normalizeCentrePayload,
    formatUserAvatarForClient
};
