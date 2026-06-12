/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');

const { sendMiniError } = require('../error-codes');
const {
    getDb,
    sendSuccess,
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

const WX_IMG_SEC_MAX_BYTES = 1024 * 1024;

router.post('/image', authMiddleware, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return sendMiniError(res, ErrorCode.MISSING_REQUIRED_PARAM, '请选择图片');
    }
    const diskPath = path.join(uploadDir, req.file.filename);
    if (!fs.existsSync(diskPath)) {
        logError('图片上传', new Error('写入后文件不存在'), { diskPath, uploadDir });
        return sendMiniError(res, ErrorCode.FILE_UPLOAD_FAILED, '文件写入失败');
    }

    let fileSize = 0;
    try {
        fileSize = fs.statSync(diskPath).size;
    } catch (e) {}

    if (fileSize > WX_IMG_SEC_MAX_BYTES) {
        try {
            fs.unlinkSync(diskPath);
        } catch (e) {}
        logWarn('图片上传', '超过微信 imgSecCheck 1MB 限制', {
            size: fileSize,
            filename: req.file.filename
        });
        return sendMiniError(
            res,
            ErrorCode.FILE_TOO_LARGE,
            '图片不能超过 1MB，请换一张较小的 JPG/PNG'
        );
    }

    try {
        const imgCheck = await contentSecurity.checkImageFile(diskPath);
        if (!imgCheck.pass) {
            try {
                fs.unlinkSync(diskPath);
            } catch (e) {}
            if (imgCheck.invalidMedia) {
                const hint =
                    imgCheck.reason === 'size'
                        ? '图片不能超过 1MB，请换一张较小的 JPG/PNG'
                        : '图片格式不支持，请使用 JPG 或 PNG';
                return sendMiniError(res, ErrorCode.FILE_TOO_LARGE, hint);
            }
            return sendMiniError(res, ErrorCode.CONTENT_SENSITIVE);
        }
    } catch (err) {
        try {
            fs.unlinkSync(diskPath);
        } catch (e) {}
        logError('图片内容安全检测', err);
        return sendMiniError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
    }

    const safeName = path.basename(req.file.filename);
    const imageUrl = buildPublicUploadUrl(req, safeName);
    const publicPath = getUploadPublicPathForFilename(safeName);
    logInfo('图片上传', '成功', { filename: safeName, uploadDir, imageUrl, publicPath });
    sendSuccess(res, { url: imageUrl, path: publicPath }, '上传成功');
});

router.post('/audio', authMiddleware, upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return sendMiniError(res, ErrorCode.MISSING_REQUIRED_PARAM, '请选择音频文件');
    }
    const diskPath = path.join(uploadDir, req.file.filename);
    if (!fs.existsSync(diskPath)) {
        logError('音频上传', new Error('写入后文件不存在'), { diskPath, uploadDir });
        return sendMiniError(res, ErrorCode.FILE_UPLOAD_FAILED, '文件写入失败');
    }
    const safeName = path.basename(req.file.filename);
    const audioUrl = buildPublicAudioUploadUrl(req, safeName);
    const publicPath = `/api/upload/audio/${encodeURIComponent(safeName)}`;
    logInfo('音频上传', '成功', { filename: safeName, audioUrl, publicPath });
    sendSuccess(res, { url: audioUrl, path: publicPath, audioUrl }, '上传成功');
});

module.exports = router;
