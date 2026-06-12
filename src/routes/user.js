/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');

const {
    getDb,
    sendError,
    sendSuccess,
    successResponse,
    errorResponse,
    ErrorCode,
    logError,
    logWarn,
    logInfo,
    convertDbError,
    formatConsoleTimestampCn,
    uuidv4,
    axios,
    crypto,
    path,
    fs,
    contentSecurity,
    shopApi,
    wxMiniApps,
    channelService,
    cardTemplates,
    musicAudioStore,
    mediaSecStore,
    uploadDir,
    libraryAudioDir,
    upload,
    blockIfContentUnsafe,
    blockIfImagesUnsafe,
    blockIfHostedImageUnsafe,
    scheduleAudioMediaCheck,
    verifyWechatMsgSignature,
    getApiBaseUrl,
    buildPublicUploadUrl,
    getUploadPublicPathForFilename,
    buildPublicAudioUploadUrl,
    migrateLegacyCoverUrlToMusicCover,
    normalizePublicCoverUrl,
    sanitizePlayerCoverUrlForClient,
    sanitizeCardShareImageForClient,
    sanitizeCommunityImagesForClient,
    isOurHostedUploadUrl,
    resolveReferenceAudioProbeTarget,
    resolveHostedUploadToDisk,
    normalizeLibraryAudioUrl,
    resolveLibraryCoverRel,
    toAbsoluteCoverUrl,
    generateMusic,
    checkGenerationStatus,
    isMinimaxMockAllowed,
    generateBlessing,
    generateBlessingOffline,
    mixEffects,
    mixFinalAudio,
    probeAudioDurationSec,
    assertReferenceAudioDurationSec,
    AUDIO_DIR,
    MALL_PRODUCTS_DATA,
    getMallProductByIdFromStore,
    mallImageUrl,
    exposeQrcodeIfEnabled,
    exposeQrcodeListIfEnabled,
    getPromoCampaignsForScene,
    getMianjiaProducts,
    POINTS_TYPE,
    bedAccessToken,
    persistShopTokenFromPayload,
    requireShopToken,
    callShopWithAutoRefresh,
    recordPointsLedger,
    getOrInitPoints
} = ctx;
const db = getDb();

function decryptPhoneData(sessionKey, encryptedData, iv) {
    try {
        const sessionKeyBuffer = Buffer.from(sessionKey, 'base64');
        const encryptedBuffer = Buffer.from(encryptedData, 'base64');
        const ivBuffer = Buffer.from(iv, 'base64');

        const decipher = crypto.createDecipheriv('aes-128-cbc', sessionKeyBuffer, ivBuffer);
        decipher.setAutoPadding(true);

        let decoded = decipher.update(encryptedBuffer, 'binary', 'utf8');
        decoded += decipher.final('utf8');

        const data = JSON.parse(decoded);
        return data;
    } catch (err) {
        logError('解密手机号失败', err);
        return null;
    }
}

function findUserByOpenid(openid) {
    const oid = openid != null ? String(openid).trim() : '';
    if (!oid) return null;
    return db.prepare('SELECT id, wx_openid, nickname, avatar_url FROM users WHERE wx_openid = ?').get(oid);
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

function purgeUserAccount(internalUserId) {
    const tx = db.transaction((uid) => {
        const trackIds = db.prepare('SELECT id FROM music_tracks WHERE user_id = ?').all(uid).map((r) => r.id);

        for (const tid of trackIds) {
            db.prepare('UPDATE community_posts SET music_id = NULL WHERE music_id = ?').run(tid);
        }

        /** 先扣减他人帖子的评论数，再删本人发表的评论（与详情删评论逻辑一致） */
        const myCommentPosts = db.prepare('SELECT post_id FROM community_comments WHERE user_id = ?').all(uid);
        for (const row of myCommentPosts) {
            db.prepare(
                `UPDATE community_posts SET comments = CASE WHEN comments > 0 THEN comments - 1 ELSE 0 END WHERE id = ?`
            ).run(row.post_id);
        }
        db.prepare('DELETE FROM community_comments WHERE user_id = ?').run(uid);

        /** 先扣减他人帖子的点赞数，再删本人在 community_likes 中的点赞记录（与取消点赞一致） */
        const myLikePosts = db.prepare('SELECT post_id FROM community_likes WHERE user_id = ?').all(uid);
        for (const row of myLikePosts) {
            db.prepare(
                `UPDATE community_posts SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id = ?`
            ).run(row.post_id);
        }
        db.prepare('DELETE FROM community_likes WHERE user_id = ?').run(uid);

        const myPostIds = db.prepare('SELECT id FROM community_posts WHERE user_id = ?').all(uid).map((r) => r.id);
        for (const pid of myPostIds) {
            db.prepare('DELETE FROM community_likes WHERE post_id = ?').run(pid);
            db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(pid);
        }
        db.prepare('DELETE FROM community_posts WHERE user_id = ?').run(uid);

        for (const tid of trackIds) {
            db.prepare('DELETE FROM sound_effects WHERE music_id = ?').run(tid);
            db.prepare('DELETE FROM greeting_cards WHERE music_id = ?').run(tid);
            db.prepare('DELETE FROM card_shares WHERE music_id = ?').run(tid);
        }
        db.prepare('DELETE FROM music_tracks WHERE user_id = ?').run(uid);

        db.prepare('DELETE FROM greeting_cards WHERE sender_id = ?').run(uid);
        db.prepare('DELETE FROM card_shares WHERE sender_id = ?').run(uid);

        db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM play_history WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM user_favorites WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM user_follows WHERE follower_id = ? OR following_id = ?').run(uid, uid);
        db.prepare('DELETE FROM points_history WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM user_points WHERE user_id = ?').run(uid);

        const delUser = db.prepare('DELETE FROM users WHERE id = ?').run(uid);
        if (delUser.changes !== 1) {
            throw new Error('用户记录未删除（可能已不存在）');
        }
    });
    tx(internalUserId);
}

router.post('/login', async (req, res) => {
    const { wxCode, encryptedData, iv } = req.body;

    if (!wxCode) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '微信登录凭证不能为空');
    }

    const miniAppId = wxMiniApps.resolveAppIdFromRequest(req);
    const wxCreds = wxMiniApps.resolveWxCredentials(miniAppId);

    try {
        // 模拟登录模式（未配置任何小程序密钥时）
        if (!wxCreds) {
            logWarn('微信登录', '未找到小程序 AppSecret 配置，使用模拟登录', {
                requestAppId: miniAppId || '(未传)',
                registeredAppIds: wxMiniApps.listRegisteredAppIds()
            });
            const openid = `wx_${Date.now()}`;
            const phone = `138${String(Math.random()).slice(2, 10)}`;
            const existing = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
            if (!existing) {
                const userId = uuidv4();
                db.prepare('INSERT INTO users (id, wx_openid, wx_app_id, phone, nickname, avatar_url) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(userId, openid, miniAppId || null, phone, '微信用户', '');
            }
            return sendSuccess(res, { userId: existing ? existing.id : db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid).id, openid, phone, token: openid }, '登录成功（模拟模式）');
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
            return sendError(res, ErrorCode.LOGIN_FAILED, `微信接口错误: ${wxRes.data.errmsg}`);
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

        const existing = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        let userId;
        if (existing) {
            db.prepare('UPDATE users SET phone = ?, nickname = ?, wx_app_id = ? WHERE wx_openid = ?')
                .run(
                    phone || '',
                    phone ? `用户${phone.slice(-4)}` : '微信用户',
                    wxCreds.appId,
                    openid
                );
            userId = existing.id;
        } else {
            userId = uuidv4();
            db.prepare(
                'INSERT INTO users (id, wx_openid, wx_app_id, phone, nickname, avatar_url) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(
                userId,
                openid,
                wxCreds.appId,
                phone || '',
                phone ? `用户${phone.slice(-4)}` : '微信用户',
                ''
            );
        }

        /** 星鹿商城：解密手机号后静默注册，token 入库（header token 供后续商城接口） */
        let shopSynced = false;
        const syncShop =
            phone &&
            String(process.env.SHOP_SYNC_LOGIN || 'true').toLowerCase() !== 'false';
        if (syncShop) {
            try {
                const shopRes = await shopApi.silentLoginByMobile(phone);
                if (shopApi.isShopApiSuccess(shopRes)) {
                    const p = shopApi.pickLoginData(shopRes);
                    if (persistShopTokenFromPayload(openid, p)) {
                        shopSynced = true;
                    }
                } else {
                    logWarn('商城静默登录', shopRes && (shopRes.msg || shopRes.message));
                    if (String(process.env.SHOP_LOGIN_REQUIRED || '').toLowerCase() === 'true') {
                        return sendError(
                            res,
                            ErrorCode.MALL_API_ERROR,
                            shopRes && (shopRes.msg || shopRes.message)
                                ? String(shopRes.msg || shopRes.message)
                                : '商城账号同步失败'
                        );
                    }
                }
            } catch (shopErr) {
                logWarn('商城静默登录异常', shopErr.message || shopErr);
                if (String(process.env.SHOP_LOGIN_REQUIRED || '').toLowerCase() === 'true') {
                    return sendError(res, ErrorCode.MALL_API_ERROR, shopErr.message || '商城接口异常');
                }
            }
        }

        const profileRow = db
            .prepare('SELECT nickname, avatar_url FROM users WHERE wx_openid = ?')
            .get(openid);
        const loginPayload = {
            userId,
            openid,
            phone,
            token: openid,
            shopSynced,
            nickname: (profileRow && profileRow.nickname) || (phone ? `用户${phone.slice(-4)}` : '微信用户'),
            avatarUrl: shopApi.formatUserAvatarForClient(
                (profileRow && profileRow.avatar_url) || ''
            )
        };
        if (String(process.env.SHOP_EXPOSE_TOKEN || '').toLowerCase() === 'true') {
            const row = db.prepare('SELECT shop_token FROM users WHERE wx_openid = ?').get(openid);
            loginPayload.shopToken = row && row.shop_token ? row.shop_token : null;
        }
        const boundChannel = channelService.getUserChannelId(db, userId);
        loginPayload.channelId = boundChannel || channelService.DEFAULT_CHANNEL_ID;
        sendSuccess(res, loginPayload, '登录成功');
    } catch (err) {
        logError('用户登录', err, { wxCode });
        sendError(res, ErrorCode.LOGIN_FAILED, err.message);
    }
});

router.get('/follow/stats', authMiddleware, (req, res) => {
    const userId = req.user.id;
    try {
        const followCount = db
            .prepare('SELECT COUNT(*) as c FROM user_follows WHERE follower_id = ?')
            .get(userId).c;
        const fansCount = db
            .prepare('SELECT COUNT(*) as c FROM user_follows WHERE following_id = ?')
            .get(userId).c;
        sendSuccess(res, { followCount, fansCount });
    } catch (err) {
        logError('关注统计', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.get('/follow/list', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const type = String(req.query.type || 'following').toLowerCase();
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    try {
        if (type === 'followers') {
            const rows = db
                .prepare(
                    `SELECT u.wx_openid, u.nickname, u.avatar_url, f.created_at as followed_at,
                    EXISTS(
                        SELECT 1 FROM user_follows f2
                        WHERE f2.follower_id = ? AND f2.following_id = u.id
                    ) as is_following
                 FROM user_follows f
                 JOIN users u ON f.follower_id = u.id
                 WHERE f.following_id = ?
                 ORDER BY f.created_at DESC
                 LIMIT ? OFFSET ?`
                )
                .all(userId, userId, limitNum, offset);
            const total = db
                .prepare('SELECT COUNT(*) as c FROM user_follows WHERE following_id = ?')
                .get(userId).c;
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
            return sendSuccess(res, { list, total, page: pageNum, limit: limitNum });
        }

        const rows = db
            .prepare(
                `SELECT u.wx_openid, u.nickname, u.avatar_url, f.created_at as followed_at
             FROM user_follows f
             JOIN users u ON f.following_id = u.id
             WHERE f.follower_id = ?
             ORDER BY f.created_at DESC
             LIMIT ? OFFSET ?`
            )
            .all(userId, limitNum, offset);
        const total = db
            .prepare('SELECT COUNT(*) as c FROM user_follows WHERE follower_id = ?')
            .get(userId).c;
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
        sendSuccess(res, { list, total, page: pageNum, limit: limitNum });
    } catch (err) {
        logError('关注列表', err, { userId, type });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.get('/:openid/follow-status', authMiddleware, (req, res) => {
    const target = findUserByOpenid(req.params.openid);
    if (!target) {
        return sendError(res, ErrorCode.USER_NOT_FOUND);
    }
    const isSelf = target.id === req.user.id;
    let following = false;
    if (!isSelf) {
        const row = db
            .prepare(
                'SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?'
            )
            .get(req.user.id, target.id);
        following = !!row;
    }
    sendSuccess(res, { following, isSelf, openid: target.wx_openid });
});

router.post('/follow', authMiddleware, (req, res) => {
    const { openid } = req.body || {};
    const target = findUserByOpenid(openid);
    if (!target) {
        return sendError(res, ErrorCode.USER_NOT_FOUND);
    }
    if (target.id === req.user.id) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '不能关注自己');
    }
    try {
        const exists = db
            .prepare(
                'SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?'
            )
            .get(req.user.id, target.id);
        if (exists) {
            return sendSuccess(res, { following: true }, '已关注');
        }
        db.prepare(
            'INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)'
        ).run(req.user.id, target.id);

        const notifId = uuidv4();
        const followerName = req.user.nickname || '有人';
        db.prepare(
            `INSERT INTO notifications (id, user_id, type, title, content, related_id)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
            notifId,
            target.id,
            'follow',
            '新粉丝',
            `${followerName} 关注了你`,
            req.user.wx_openid
        );

        sendSuccess(res, { following: true }, '关注成功');
    } catch (err) {
        logError('关注用户', err, { follower: req.user.id, target: target.id });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.delete('/follow/:openid', authMiddleware, (req, res) => {
    const target = findUserByOpenid(req.params.openid);
    if (!target) {
        return sendError(res, ErrorCode.USER_NOT_FOUND);
    }
    try {
        db.prepare(
            'DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?'
        ).run(req.user.id, target.id);
        sendSuccess(res, { following: false }, '已取消关注');
    } catch (err) {
        logError('取消关注', err, { follower: req.user.id, target: target.id });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.get('/profile', authMiddleware, (req, res) => {
    try {
        const user = db.prepare('SELECT id, wx_openid, phone, nickname, avatar_url, gender, birthday FROM users WHERE wx_openid = ?').get(req.user.wx_openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }
        const boundChannel = channelService.getUserChannelId(db, user.id);
        sendSuccess(res, {
            userId: user.id,
            openid: user.wx_openid,
            phone: user.phone,
            nickname: user.nickname,
            avatarUrl: shopApi.formatUserAvatarForClient(user.avatar_url),
            gender: user.gender,
            birthday: user.birthday,
            channelId: boundChannel || channelService.DEFAULT_CHANNEL_ID
        });
    } catch (err) {
        logError('获取用户资料', err);
        sendError(res, convertDbError(err), err.message);
    }
});

/**
 * 服务端注销用户：删除该用户在库中的帖子、点赞、评论、作品、积分、通知等，最后删除 users 行。
 * 需在 authMiddleware 之后调用，仅删除 req.user.id 对应账号。
 */
function purgeUserAccount(internalUserId) {
    const tx = db.transaction((uid) => {
        const trackIds = db.prepare('SELECT id FROM music_tracks WHERE user_id = ?').all(uid).map((r) => r.id);

        for (const tid of trackIds) {
            db.prepare('UPDATE community_posts SET music_id = NULL WHERE music_id = ?').run(tid);
        }

        /** 先扣减他人帖子的评论数，再删本人发表的评论（与详情删评论逻辑一致） */
        const myCommentPosts = db.prepare('SELECT post_id FROM community_comments WHERE user_id = ?').all(uid);
        for (const row of myCommentPosts) {
            db.prepare(
                `UPDATE community_posts SET comments = CASE WHEN comments > 0 THEN comments - 1 ELSE 0 END WHERE id = ?`
            ).run(row.post_id);
        }
        db.prepare('DELETE FROM community_comments WHERE user_id = ?').run(uid);

        /** 先扣减他人帖子的点赞数，再删本人在 community_likes 中的点赞记录（与取消点赞一致） */
        const myLikePosts = db.prepare('SELECT post_id FROM community_likes WHERE user_id = ?').all(uid);
        for (const row of myLikePosts) {
            db.prepare(
                `UPDATE community_posts SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id = ?`
            ).run(row.post_id);
        }
        db.prepare('DELETE FROM community_likes WHERE user_id = ?').run(uid);

        const myPostIds = db.prepare('SELECT id FROM community_posts WHERE user_id = ?').all(uid).map((r) => r.id);
        for (const pid of myPostIds) {
            db.prepare('DELETE FROM community_likes WHERE post_id = ?').run(pid);
            db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(pid);
        }
        db.prepare('DELETE FROM community_posts WHERE user_id = ?').run(uid);

        for (const tid of trackIds) {
            db.prepare('DELETE FROM sound_effects WHERE music_id = ?').run(tid);
            db.prepare('DELETE FROM greeting_cards WHERE music_id = ?').run(tid);
            db.prepare('DELETE FROM card_shares WHERE music_id = ?').run(tid);
        }
        db.prepare('DELETE FROM music_tracks WHERE user_id = ?').run(uid);

        db.prepare('DELETE FROM greeting_cards WHERE sender_id = ?').run(uid);
        db.prepare('DELETE FROM card_shares WHERE sender_id = ?').run(uid);

        db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM play_history WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM user_favorites WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM user_follows WHERE follower_id = ? OR following_id = ?').run(uid, uid);
        db.prepare('DELETE FROM points_history WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM user_points WHERE user_id = ?').run(uid);

        const delUser = db.prepare('DELETE FROM users WHERE id = ?').run(uid);
        if (delUser.changes !== 1) {
            throw new Error('用户记录未删除（可能已不存在）');
        }
    });
    tx(internalUserId);
}

router.put('/profile', authMiddleware, async (req, res) => {
    const { nickname, avatarUrl, gender, birthday } = req.body;
    const userId = req.user.id;

    try {
        const updates = [];
        const params = [];

        if (nickname !== undefined) {
            const nick = String(nickname).trim();
            if (
                await blockIfContentUnsafe(res, req.user.wx_openid, [
                    { content: nick, scene: contentSecurity.SCENE.PROFILE, field: 'nickname' }
                ])
            ) {
                return;
            }
            updates.push('nickname = ?');
            params.push(nickname);
        }
        if (avatarUrl !== undefined) {
            if (!shopApi.isPersistedAvatarUrl(avatarUrl)) {
                return sendError(res, ErrorCode.INVALID_PARAMS, 'avatarUrl 须为有效的 http(s) 地址');
            }
            const av = shopApi.normalizeHostedUploadUrl(String(avatarUrl).trim());
            if (av && (await blockIfHostedImageUnsafe(res, av, req, 'avatarUrl'))) {
                return;
            }
            updates.push('avatar_url = ?');
            params.push(av);
        }
        if (gender !== undefined) {
            updates.push('gender = ?');
            params.push(gender);
        }
        if (birthday !== undefined) {
            updates.push('birthday = ?');
            params.push(birthday);
        }

        if (updates.length === 0) {
            return sendError(res, ErrorCode.INVALID_PARAMS, '没有要更新的字段');
        }

        params.push(userId);
        const stmt = db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE wx_openid = ?`);
        stmt.run(...params);

        sendSuccess(res, null, '资料更新成功');
    } catch (err) {
        logError('更新用户资料', err, { userId, nickname, avatarUrl, gender, birthday });
        sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/account', authMiddleware, (req, res) => {
    const uid = req.user.id;
    try {
        purgeUserAccount(uid);
        sendSuccess(res, { deleted: true }, '账号已注销');
    } catch (err) {
        logError('注销用户', err, { uid });
        sendError(res, ErrorCode.ACCOUNT_DELETE_FAILED, err.message);
    }
});

module.exports = router;
