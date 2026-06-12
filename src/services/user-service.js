const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const usersRepo = require('../repositories/users');
const channelService = require('../channel-service');
const shopApi = require('../xinglu-shop-api');
const wxMiniApps = require('../wx-mini-apps');
const shopTokenService = require('./shop-token-service');
const { getDb } = require('../bootstrap/database');
const { ErrorCode, logError, logWarn, logInfo } = require('../error-codes');

function decryptPhoneData(sessionKey, encryptedData, iv) {
    try {
        const sessionKeyBuffer = Buffer.from(sessionKey, 'base64');
        const encryptedBuffer = Buffer.from(encryptedData, 'base64');
        const ivBuffer = Buffer.from(iv, 'base64');

        const decipher = crypto.createDecipheriv('aes-128-cbc', sessionKeyBuffer, ivBuffer);
        decipher.setAutoPadding(true);

        let decoded = decipher.update(encryptedBuffer, 'binary', 'utf8');
        decoded += decipher.final('utf8');

        return JSON.parse(decoded);
    } catch (err) {
        logError('解密手机号失败', err);
        return null;
    }
}

function formatFollowListUser(row, extra) {
    if (!row) return null;
    return {
        openid: row.wx_openid,
        nickname: row.nickname || '盒友',
        avatar: shopApi.formatUserAvatarForClient(row.avatar_url),
        followedAt: row.followed_at || row.created_at,
        ...(extra || {})
    };
}

async function login(req, body) {
    const { wxCode, encryptedData, iv } = body || {};

    if (!wxCode) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '微信登录凭证不能为空' };
    }

    const miniAppId = wxMiniApps.resolveAppIdFromRequest(req);
    const wxCreds = wxMiniApps.resolveWxCredentials(miniAppId);

    if (!wxCreds) {
        logWarn('微信登录', '未找到小程序 AppSecret 配置，使用模拟登录', {
            requestAppId: miniAppId || '(未传)',
            registeredAppIds: wxMiniApps.listRegisteredAppIds()
        });
        const openid = `wx_${Date.now()}`;
        const phone = `138${String(Math.random()).slice(2, 10)}`;
        const existingId = usersRepo.findIdByOpenid(openid);
        if (!existingId) {
            usersRepo.insertUser({
                id: uuidv4(),
                openid,
                appId: miniAppId || null,
                phone,
                nickname: '微信用户',
                avatarUrl: ''
            });
        }
        const userId = existingId || usersRepo.findIdByOpenid(openid);
        return {
            ok: true,
            data: {
                userId,
                openid,
                phone,
                token: openid
            },
            message: '登录成功（模拟模式）'
        };
    }

    logInfo('微信登录', 'jscode2session', { appId: wxCreds.appId });

    const wxRes = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: {
            appid: wxCreds.appId,
            secret: wxCreds.appSecret,
            js_code: wxCode,
            grant_type: 'authorization_code'
        },
        timeout: 10000
    });

    if (wxRes.data.errcode) {
        logError('微信登录失败', new Error(wxRes.data.errmsg), {
            errcode: wxRes.data.errcode,
            appId: wxCreds.appId
        });
        return {
            ok: false,
            error: ErrorCode.LOGIN_FAILED,
            message: `微信接口错误: ${wxRes.data.errmsg}`
        };
    }

    const openid = wxRes.data.openid;
    const sessionKey = wxRes.data.session_key;

    let phone = '';
    if (encryptedData && iv && sessionKey) {
        const phoneData = decryptPhoneData(sessionKey, encryptedData, iv);
        if (phoneData && phoneData.phoneNumber) {
            phone = phoneData.phoneNumber;
        }
    }

    const existingId = usersRepo.findIdByOpenid(openid);
    let userId;
    const nickname = phone ? `用户${phone.slice(-4)}` : '微信用户';

    if (existingId) {
        usersRepo.updateUserOnLogin(openid, phone || '', nickname, wxCreds.appId);
        userId = existingId;
    } else {
        userId = uuidv4();
        usersRepo.insertUser({
            id: userId,
            openid,
            appId: wxCreds.appId,
            phone: phone || '',
            nickname,
            avatarUrl: ''
        });
    }

    let shopSynced = false;
    const syncShop =
        phone && String(process.env.SHOP_SYNC_LOGIN || 'true').toLowerCase() !== 'false';
    if (syncShop) {
        try {
            const shopRes = await shopApi.silentLoginByMobile(phone);
            if (shopApi.isShopApiSuccess(shopRes)) {
                const p = shopApi.pickLoginData(shopRes);
                if (shopTokenService.persistShopTokenFromPayload(openid, p)) {
                    shopSynced = true;
                }
            } else {
                logWarn('商城静默登录', shopRes && (shopRes.msg || shopRes.message));
                if (String(process.env.SHOP_LOGIN_REQUIRED || '').toLowerCase() === 'true') {
                    return {
                        ok: false,
                        error: ErrorCode.MALL_API_ERROR,
                        message:
                            shopRes && (shopRes.msg || shopRes.message)
                                ? String(shopRes.msg || shopRes.message)
                                : '商城账号同步失败'
                    };
                }
            }
        } catch (shopErr) {
            logWarn('商城静默登录异常', shopErr.message || shopErr);
            if (String(process.env.SHOP_LOGIN_REQUIRED || '').toLowerCase() === 'true') {
                return {
                    ok: false,
                    error: ErrorCode.MALL_API_ERROR,
                    message: shopErr.message || '商城接口异常'
                };
            }
        }
    }

    const profileRow = usersRepo.findLoginProfile(openid);
    const loginPayload = {
        userId,
        openid,
        phone,
        token: openid,
        shopSynced,
        nickname: (profileRow && profileRow.nickname) || nickname,
        avatarUrl: shopApi.formatUserAvatarForClient((profileRow && profileRow.avatar_url) || '')
    };
    if (String(process.env.SHOP_EXPOSE_TOKEN || '').toLowerCase() === 'true') {
        loginPayload.shopToken = usersRepo.getShopToken(openid);
    }
    const boundChannel = channelService.getUserChannelId(getDb(), userId);
    loginPayload.channelId = boundChannel || channelService.DEFAULT_CHANNEL_ID;

    return { ok: true, data: loginPayload, message: '登录成功' };
}

function getFollowStats(userId) {
    const followCount = usersRepo.countFollowing(userId);
    const fansCount = usersRepo.countFollowers(userId);
    return { ok: true, data: { followCount, fansCount } };
}

function getFollowList(userId, query) {
    const type = String((query && query.type) || 'following').toLowerCase();
    const pageNum = Math.max(1, parseInt(query && query.page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(query && query.limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    if (type === 'followers') {
        const rows = usersRepo.listFollowers(userId, limitNum, offset);
        const total = usersRepo.countFollowersTotal(userId);
        const list = rows
            .map((r) =>
                formatFollowListUser(
                    {
                        wx_openid: r.wx_openid,
                        nickname: r.nickname,
                        avatar_url: r.avatar_url,
                        followed_at: r.followed_at
                    },
                    { isFollowing: !!r.is_following }
                )
            )
            .filter(Boolean);
        return { ok: true, data: { list, total, page: pageNum, limit: limitNum } };
    }

    const rows = usersRepo.listFollowing(userId, limitNum, offset);
    const total = usersRepo.countFollowingTotal(userId);
    const list = rows
        .map((r) =>
            formatFollowListUser({
                wx_openid: r.wx_openid,
                nickname: r.nickname,
                avatar_url: r.avatar_url,
                followed_at: r.followed_at
            })
        )
        .filter(Boolean);
    return { ok: true, data: { list, total, page: pageNum, limit: limitNum } };
}

function getFollowStatus(currentUserId, targetOpenid) {
    const target = usersRepo.findByOpenid(targetOpenid);
    if (!target) {
        return { ok: false, error: ErrorCode.USER_NOT_FOUND };
    }
    const isSelf = target.id === currentUserId;
    let following = false;
    if (!isSelf) {
        following = usersRepo.isFollowing(currentUserId, target.id);
    }
    return { ok: true, data: { following, isSelf, openid: target.wx_openid } };
}

function followUser(currentUser, targetOpenid) {
    const target = usersRepo.findByOpenid(targetOpenid);
    if (!target) {
        return { ok: false, error: ErrorCode.USER_NOT_FOUND };
    }
    if (target.id === currentUser.id) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '不能关注自己' };
    }
    if (usersRepo.isFollowing(currentUser.id, target.id)) {
        return { ok: true, data: { following: true }, message: '已关注' };
    }

    usersRepo.addFollow(currentUser.id, target.id);
    const followerName = currentUser.nickname || '有人';
    usersRepo.insertFollowNotification({
        id: uuidv4(),
        userId: target.id,
        type: 'follow',
        title: '新粉丝',
        content: `${followerName} 关注了你`,
        relatedId: currentUser.wx_openid
    });

    return { ok: true, data: { following: true }, message: '关注成功' };
}

function unfollowUser(currentUserId, targetOpenid) {
    const target = usersRepo.findByOpenid(targetOpenid);
    if (!target) {
        return { ok: false, error: ErrorCode.USER_NOT_FOUND };
    }
    usersRepo.removeFollow(currentUserId, target.id);
    return { ok: true, data: { following: false }, message: '已取消关注' };
}

function getProfile(openid) {
    const user = usersRepo.findProfileByOpenid(openid);
    if (!user) {
        return { ok: false, error: ErrorCode.USER_NOT_FOUND };
    }
    const boundChannel = channelService.getUserChannelId(getDb(), user.id);
    return {
        ok: true,
        data: {
            userId: user.id,
            openid: user.wx_openid,
            phone: user.phone,
            nickname: user.nickname,
            avatarUrl: shopApi.formatUserAvatarForClient(user.avatar_url),
            gender: user.gender,
            birthday: user.birthday,
            channelId: boundChannel || channelService.DEFAULT_CHANNEL_ID
        }
    };
}

function prepareProfileUpdate(openid, body) {
    const { nickname, avatarUrl, gender, birthday } = body || {};
    const updates = [];
    let avatarForCheck = null;

    if (nickname !== undefined) {
        updates.push({ field: 'nickname', value: nickname });
    }
    if (avatarUrl !== undefined) {
        if (!shopApi.isPersistedAvatarUrl(avatarUrl)) {
            return {
                ok: false,
                error: ErrorCode.INVALID_PARAMS,
                message: 'avatarUrl 须为有效的 http(s) 地址'
            };
        }
        const av = shopApi.normalizeHostedUploadUrl(String(avatarUrl).trim());
        avatarForCheck = av;
        updates.push({ field: 'avatar_url', value: av });
    }
    if (gender !== undefined) {
        updates.push({ field: 'gender', value: gender });
    }
    if (birthday !== undefined) {
        updates.push({ field: 'birthday', value: birthday });
    }

    if (updates.length === 0) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '没有要更新的字段' };
    }

    return { ok: true, updates, avatarForCheck, openid, message: '资料更新成功' };
}

function commitProfileUpdate(openid, updates) {
    usersRepo.updateProfile(openid, updates);
}

function deleteAccount(userId) {
    usersRepo.purgeUser(userId);
    return { ok: true, data: { deleted: true }, message: '账号已注销' };
}

module.exports = {
    login,
    getFollowStats,
    getFollowList,
    getFollowStatus,
    followUser,
    unfollowUser,
    getProfile,
    prepareProfileUpdate,
    commitProfileUpdate,
    deleteAccount
};
