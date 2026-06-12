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

router.get('/branding', (req, res) => {
    try {
        const channelRaw = req.query && (req.query.channel || req.query.channelId);
        const channelId = channelService.normalizeChannelId(channelRaw);
        const payload = channelService.getBrandingForChannel(db, channelId);
        return sendSuccess(res, payload, '操作成功');
    } catch (err) {
        logError('渠道 branding', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/channel-theme-presets', (req, res) => {
    try {
        const list = channelService.channelThemePresets.listChannelThemePresets();
        return sendSuccess(res, { presets: list }, '操作成功');
    } catch (err) {
        logError('渠道主题预设', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/user/channel-bind', authMiddleware, (req, res) => {
    try {
        const channelRaw = (req.body && (req.body.channel || req.body.channelId)) || '';
        const source = (req.body && req.body.source) || 'client';
        const result = channelService.bindUserChannel(db, req.user.id, channelRaw, source);
        return sendSuccess(res, result, '渠道已绑定');
    } catch (err) {
        if (err && err.code === 'CHANNEL_INVALID') {
            return sendError(res, ErrorCode.INVALID_PARAMS, err.message);
        }
        logError('渠道绑定', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/promo/active', (req, res) => {
    const scene = req.query && req.query.scene ? String(req.query.scene) : '';
    const channelRaw = req.query && (req.query.channel || req.query.channelId);
    const channelId = channelService.normalizeChannelId(channelRaw);
    const list = getPromoCampaignsForScene(scene, channelId);
    return sendSuccess(res, { list }, '操作成功');
});

/** 运营弹窗埋点（可选，当前仅记日志） */
router.post('/promo/event', (req, res) => {
    const body = req.body || {};
    if (body.promoId && body.action) {
        logInfo('promo/event', `${body.promoId} ${body.action}`, {
            scene: body.scene || ''
        });
    }
    return sendSuccess(res, null, '操作成功');
});

module.exports = router;
