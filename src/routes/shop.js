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

router.get('/centre', authMiddleware, async (req, res) => {
    const st = requireShopToken(req, res);
    if (!st) return;
    const openid = req.user && req.user.wx_openid;
    try {
        const { data } = await callShopWithAutoRefresh(
            req.user,
            st,
            (tok) => shopApi.getUserCentre(tok),
            '商城个人中心'
        );
        if (shopApi.isShopApiSuccess(data)) {
            const raw = data.data !== undefined ? data.data : data;
            const centre = shopApi.normalizeCentrePayload(raw);
            const avatar = shopApi.pickAvatarFromCentre(centre);
            if (openid) {
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
            logInfo('商城个人中心', '星鹿 User/centre 成功', {
                openid,
                user_integral: centre && centre.user_integral,
                nickname: centre && centre.nickname,
                mobile: centre && centre.mobile ? '(已设置)' : '(未设置)',
                sn: centre && centre.sn,
                avatar: avatar ? avatar : '(未设置)',
                hasAvatar: !!avatar
            });
            return sendSuccess(res, centre);
        }
        const mallMsg = shopApi.getShopApiMessage(data) || '商城接口失败';
        logWarn('商城个人中心', mallMsg, {
            openid,
            shopCode: data && data.code,
            timeout: shopApi.isShopLoginTimeoutPayload(data)
        });
        return sendError(res, ErrorCode.MALL_API_ERROR, mallMsg);
    } catch (err) {
        logError('商城个人中心', err, { openid });
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message);
    }
});

/** 修改用户信息 → POST /shopapi/User/setInfo */
router.post('/setInfo', authMiddleware, async (req, res) => {
    const st = requireShopToken(req, res);
    if (!st) return;
    const { field, value } = req.body || {};
    if (!field || String(field).trim() === '') {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'field 不能为空');
    }
    if (String(field).trim().toLowerCase() === 'avatar' && !shopApi.isPersistedAvatarUrl(value)) {
        return sendError(
            res,
            ErrorCode.INVALID_PARAMS,
            '头像须为已上传的 http(s) 地址，请勿提交微信临时路径'
        );
    }
    const fieldLower = String(field).trim().toLowerCase();
    if (fieldLower === 'avatar' && shopApi.isPersistedAvatarUrl(value)) {
        const av = shopApi.normalizeHostedUploadUrl(String(value).trim());
        if (await blockIfHostedImageUnsafe(res, av, req, 'avatar')) {
            return;
        }
    }
    if (fieldLower === 'nickname' && value != null && String(value).trim()) {
        if (
            await blockIfContentUnsafe(res, req.user.wx_openid, [
                { content: String(value).trim(), scene: contentSecurity.SCENE.PROFILE, field: 'nickname' }
            ])
        ) {
            return;
        }
    }
    try {
        const { data } = await callShopWithAutoRefresh(
            req.user,
            st,
            (tok) => shopApi.setUserInfo(tok, field, value),
            '商城修改资料'
        );
        if (shopApi.isShopApiSuccess(data)) {
            const openid = req.user.wx_openid;
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
            return sendSuccess(res, data.data !== undefined ? data.data : null, (data && data.msg) || '操作成功');
        }
        return sendError(res, ErrorCode.MALL_API_ERROR, (data && (data.msg || data.message)) || '修改失败');
    } catch (err) {
        logError('商城修改资料', err);
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message);
    }
});

/** 第三方消耗积分 → POST /shopapi/User/thirdDeduct */
router.post('/thirdDeduct', authMiddleware, async (req, res) => {
    const st = requireShopToken(req, res);
    if (!st) return;
    const { deduct_user_integral, association_sn } = req.body || {};
    const n = Number(deduct_user_integral);
    if (!deduct_user_integral || Number.isNaN(n) || n <= 0) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'deduct_user_integral 须为大于 0 的数字');
    }
    try {
        const { data } = await callShopWithAutoRefresh(
            req.user,
            st,
            (tok) => shopApi.thirdDeduct(tok, n, association_sn),
            '商城扣积分'
        );
        if (shopApi.isShopApiSuccess(data)) {
            const remark = (req.body && req.body.remark != null && String(req.body.remark).trim()) || '';
            recordPointsLedger(req.user.id, -n, 'shop_exchange', remark || '积分商城兑换');
            return sendSuccess(res, data.data !== undefined ? data.data : null, (data && data.msg) || '扣除成功');
        }
        return sendError(res, ErrorCode.MALL_API_ERROR, (data && (data.msg || data.message)) || '扣积分失败');
    } catch (err) {
        logError('商城扣积分', err);
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message);
    }
});

module.exports = router;
