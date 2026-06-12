const { getDb } = require('../bootstrap/database');
const shopApi = require('../xinglu-shop-api');
const { logInfo, logWarn, ErrorCode } = require('../error-codes');
const { callShopWithAutoRefresh } = require('./shop-token-service');

function syncUserProfileFromCentre(db, openid, centre, avatar) {
    if (!openid) return;
    if (avatar) {
        db.prepare('UPDATE users SET avatar_url = ? WHERE wx_openid = ?').run(avatar, openid);
    }
    if (centre.nickname != null && String(centre.nickname).trim()) {
        db.prepare('UPDATE users SET nickname = ? WHERE wx_openid = ?').run(
            String(centre.nickname).trim(),
            openid
        );
    }
}

async function getUserCentre(user, shopToken) {
    const openid = user && user.wx_openid;
    const db = getDb();
    const { data } = await callShopWithAutoRefresh(
        user,
        shopToken,
        (tok) => shopApi.getUserCentre(tok),
        '商城个人中心'
    );
    if (shopApi.isShopApiSuccess(data)) {
        const raw = data.data !== undefined ? data.data : data;
        const centre = shopApi.normalizeCentrePayload(raw);
        const avatar = shopApi.pickAvatarFromCentre(centre);
        syncUserProfileFromCentre(db, openid, centre, avatar);
        logInfo('商城个人中心', '星鹿 User/centre 成功', {
            openid,
            user_integral: centre && centre.user_integral,
            nickname: centre && centre.nickname,
            mobile: centre && centre.mobile ? '(已设置)' : '(未设置)',
            sn: centre && centre.sn,
            avatar: avatar ? avatar : '(未设置)',
            hasAvatar: !!avatar
        });
        return { ok: true, data: centre };
    }
    const mallMsg = shopApi.getShopApiMessage(data) || '商城接口失败';
    logWarn('商城个人中心', mallMsg, {
        openid,
        shopCode: data && data.code,
        timeout: shopApi.isShopLoginTimeoutPayload(data)
    });
    return { ok: false, error: ErrorCode.MALL_API_ERROR, message: mallMsg };
}

async function setUserInfo(user, shopToken, field, value) {
    const db = getDb();
    const { data } = await callShopWithAutoRefresh(
        user,
        shopToken,
        (tok) => shopApi.setUserInfo(tok, field, value),
        '商城修改资料'
    );
    if (shopApi.isShopApiSuccess(data)) {
        const openid = user.wx_openid;
        const fieldLower = String(field).trim().toLowerCase();
        if (fieldLower === 'avatar' && shopApi.isPersistedAvatarUrl(value)) {
            const av = shopApi.normalizeHostedUploadUrl(String(value).trim());
            db.prepare('UPDATE users SET avatar_url = ? WHERE wx_openid = ?').run(av, openid);
        } else if (fieldLower === 'nickname' && value != null && String(value).trim()) {
            db.prepare('UPDATE users SET nickname = ? WHERE wx_openid = ?').run(
                String(value).trim(),
                openid
            );
        }
        return {
            ok: true,
            data: data.data !== undefined ? data.data : null,
            message: (data && data.msg) || '操作成功'
        };
    }
    return {
        ok: false,
        error: ErrorCode.MALL_API_ERROR,
        message: (data && (data.msg || data.message)) || '修改失败'
    };
}

async function thirdDeduct(user, shopToken, deductIntegral, associationSn, remark) {
    const n = Number(deductIntegral);
    const { data } = await callShopWithAutoRefresh(
        user,
        shopToken,
        (tok) => shopApi.thirdDeduct(tok, n, associationSn),
        '商城扣积分'
    );
    if (shopApi.isShopApiSuccess(data)) {
        return {
            ok: true,
            data: data.data !== undefined ? data.data : null,
            message: (data && data.msg) || '扣除成功',
            ledger: {
                userId: user.id,
                points: -n,
                type: 'shop_exchange',
                description: remark || '积分商城兑换'
            }
        };
    }
    return {
        ok: false,
        error: ErrorCode.MALL_API_ERROR,
        message: (data && (data.msg || data.message)) || '扣积分失败'
    };
}

module.exports = {
    getUserCentre,
    setUserInfo,
    thirdDeduct
};
