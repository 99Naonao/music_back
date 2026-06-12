const { getDb } = require('../bootstrap/database');
const { sendError, logWarn, logInfo, ErrorCode } = require('../error-codes');
const shopApi = require('../xinglu-shop-api');

function isShopAutoRefreshOnTimeoutEnabled() {
    return String(process.env.SHOP_AUTO_REFRESH_ON_TIMEOUT || 'true').toLowerCase() !== 'false';
}

function persistShopTokenFromPayload(userKey, p, options = {}) {
    const db = getDb();
    const { by = 'openid', mergeProfile = true } = options;
    if (!p || !p.token) return false;
    if (by === 'id') {
        db.prepare('UPDATE users SET shop_token = ?, shop_sn = ? WHERE id = ?').run(
            p.token,
            p.sn || null,
            userKey
        );
    } else {
        db.prepare('UPDATE users SET shop_token = ?, shop_sn = ? WHERE wx_openid = ?').run(
            p.token,
            p.sn || null,
            userKey
        );
    }
    if (mergeProfile && by === 'openid') {
        const nick = p.nickname || null;
        const av = p.avatar ? shopApi.normalizeHostedUploadUrl(String(p.avatar).trim()) : null;
        db.prepare(
            'UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url) WHERE wx_openid = ?'
        ).run(nick, av, userKey);
    }
    return true;
}

async function refreshShopTokenForUser(user, context = '商城接口') {
    const db = getDb();
    const openid = user && user.wx_openid;
    const userId = user && user.id;
    if (!userId) {
        logWarn(context, 'shop_token 刷新失败：无效用户', { openid });
        return null;
    }
    const row = db.prepare('SELECT phone FROM users WHERE id = ?').get(userId);
    const phone = row && row.phone ? String(row.phone).trim() : '';
    if (!phone) {
        logWarn(context, 'shop_token 刷新失败：用户未绑定手机号', { openid });
        return null;
    }
    try {
        const shopRes = await shopApi.silentLoginByMobile(phone);
        if (!shopApi.isShopApiSuccess(shopRes)) {
            logWarn(context, 'shop_token 刷新失败：静默登录未成功', {
                openid,
                msg: shopApi.getShopApiMessage(shopRes)
            });
            return null;
        }
        const p = shopApi.pickLoginData(shopRes);
        if (!persistShopTokenFromPayload(userId, p, { by: 'id', mergeProfile: false })) {
            logWarn(context, 'shop_token 刷新失败：响应无 token', { openid });
            return null;
        }
        user.shop_token = p.token;
        user.shop_sn = p.sn || null;
        logInfo('商城登录', 'shop_token 已刷新', {
            openid,
            context,
            sn: p.sn || null,
            refreshedAt: new Date().toISOString()
        });
        return p.token;
    } catch (err) {
        logWarn(context, 'shop_token 刷新异常', { openid, message: err.message });
        return null;
    }
}

async function callShopWithAutoRefresh(user, shopToken, callFn, context) {
    let token = shopToken;
    let data = await callFn(token);
    if (shopApi.isShopApiSuccess(data)) return { data, shopToken: token };
    if (!isShopAutoRefreshOnTimeoutEnabled() || !shopApi.isShopLoginTimeoutPayload(data)) {
        return { data, shopToken: token };
    }
    const newToken = await refreshShopTokenForUser(user, context);
    if (!newToken) return { data, shopToken: token };
    token = newToken;
    data = await callFn(token);
    return { data, shopToken: token };
}

function requireShopToken(req, res) {
    const t = req.user && req.user.shop_token;
    if (!t) {
        sendError(res, ErrorCode.MALL_API_ERROR, '未同步商城账号，请使用手机号完成微信授权登录');
        return null;
    }
    return t;
}

module.exports = {
    isShopAutoRefreshOnTimeoutEnabled,
    persistShopTokenFromPayload,
    refreshShopTokenForUser,
    callShopWithAutoRefresh,
    requireShopToken
};
