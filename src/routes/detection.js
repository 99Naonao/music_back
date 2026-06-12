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

router.get('/token', async (req, res) => {
    const appId = wxMiniApps.resolveAppIdFromRequest(req);
    const version = req.headers.version || req.headers['Version'] || '1';
    const appName = bedAccessToken.getAppDisplayName(appId);
    try {
        if (!bedAccessToken.isAppIdAllowed(appId)) {
            logWarn('设备访问令牌', 'AppId 不在白名单', { appId, appName, version });
            return res.status(200).json({
                code: 0,
                msg: '不支持的小程序 AppId',
                data: null
            });
        }
        const forceRefresh = String(req.query.forceRefresh || req.query.refresh || '') === '1';
        const result = await bedAccessToken.getAccessToken(appId, { forceRefresh });
        return res.status(200).json({
            code: 1,
            msg: '获取成功',
            data: {
                access_token: result.token,
                expires_at: result.expiresAtText,
                expires_in: result.expiresInSec,
                token_type: 'Bearer',
                app_id: appId,
                app_name: result.appName || appName
            }
        });
    } catch (err) {
        logError('设备访问令牌', err, { appId, version });
        return res.status(200).json({
            code: 0,
            msg: err.message || '获取设备token失败',
            data: null
        });
    }
});

module.exports = router;
