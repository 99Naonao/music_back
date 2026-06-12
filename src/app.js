const path = require('path');
const fs = require('fs');
const { loadEnvFiles, ensureTimezone } = require('./bootstrap/env');

loadEnvFiles();
ensureTimezone();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isDev = NODE_ENV === 'development';
const isProd = NODE_ENV === 'production';

const { getLogger, resolveLogDir } = require('./logger');
getLogger();

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const crypto = require('crypto');
const { POINTS_TYPE } = require('./points-service');
const {
    ErrorCode,
    successResponse,
    errorResponse,
    sendError,
    sendSuccess,
    logError,
    logWarn,
    logInfo,
    formatConsoleTimestampCn,
    convertDbError
} = require('./error-codes');
const { corsOptions, logCorsConfig } = require('./config/cors');
const { createRequestLogger } = require('./middleware/request-logger');
const { getDb, getDbPath, initDatabaseConnection } = require('./bootstrap/database');
const { initDatabase } = require('./bootstrap/init-database');
const { initAppContext } = require('./utils/app-context');
const mediaUrl = require('./utils/media-url');
const uploadStorage = require('./utils/upload-storage');
const contentGuard = require('./utils/content-guard');

const { generateMusic, checkGenerationStatus, isMinimaxMockAllowed } = require('./minimax-service');
const shopApi = require('./xinglu-shop-api');
const bedAccessToken = require('./bed-access-token-service');
const wxMiniApps = require('./wx-mini-apps');
const contentSecurity = require('./content-security');
const mediaSecStore = require('./media-sec-store');
const {
    MALL_PRODUCTS: MALL_PRODUCTS_DATA,
    getMallProductById: getMallProductByIdFromStore,
    mallImageUrl
} = require('./mall-products-data');
const { getPromoCampaignsForScene } = require('./promo-data');
const channelService = require('./channel-service');
const { QRCODE_DIR } = require('./mall-qrcode');
const { getMianjiaProducts } = require('./mianjia-products-service');
const cardTemplates = require('./card-template-service');
const musicAudioStore = require('./music-audio-store');
const { resolveLibraryCoverRel, toAbsoluteCoverUrl } = require('./library-cover');
const { normalizeLibraryAudioUrl } = require('./media-paths');
const { generateBlessing, generateBlessingOffline } = require('./ai-service');
const {
    mixEffects,
    mixFinalAudio,
    probeAudioDurationSec,
    assertReferenceAudioDurationSec,
    AUDIO_DIR
} = require('./audio-mixer');

function exposeQrcodeIfEnabled(product, mallImageUrlFn) {
    const { attachVoucherUiFlags } = require('./mall-qrcode');
    return typeof attachVoucherUiFlags === 'function'
        ? attachVoucherUiFlags(product, mallImageUrlFn)
        : product;
}

function exposeQrcodeListIfEnabled(list, mallImageUrlFn) {
    const { attachVoucherUiFlagsList } = require('./mall-qrcode');
    return typeof attachVoucherUiFlagsList === 'function'
        ? attachVoucherUiFlagsList(list, mallImageUrlFn)
        : list;
}

const shopTokenService = require('./services/shop-token-service');
const pointsLedgerService = require('./services/points-ledger-service');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors(corsOptions));
logCorsConfig();
app.use(express.json());
app.use(createRequestLogger({ logInfo, logWarn, logError }));

initDatabaseConnection();
initDatabase();

if (!fs.existsSync(QRCODE_DIR)) {
    fs.mkdirSync(QRCODE_DIR, { recursive: true });
}

initAppContext({
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
    uploadDir: uploadStorage.uploadDir,
    libraryAudioDir: uploadStorage.libraryAudioDir,
    upload: uploadStorage.upload,
    ...contentGuard,
    ...mediaUrl,
    buildPublicUploadUrl: mediaUrl.buildPublicUploadUrl,
    getUploadPublicPathForFilename: mediaUrl.getUploadPublicPathForFilename,
    buildPublicAudioUploadUrl: uploadStorage.buildPublicAudioUploadUrl,
    resolveReferenceAudioProbeTarget: uploadStorage.resolveReferenceAudioProbeTarget,
    resolveHostedUploadToDisk: uploadStorage.resolveHostedUploadToDisk,
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
    persistShopTokenFromPayload: shopTokenService.persistShopTokenFromPayload,
    requireShopToken: shopTokenService.requireShopToken,
    callShopWithAutoRefresh: shopTokenService.callShopWithAutoRefresh,
    recordPointsLedger: pointsLedgerService.recordPointsLedger,
    getOrInitPoints: pointsLedgerService.getOrInitPoints,
    NODE_ENV,
    isDev,
    isProd
});

const { registerAllRoutes } = require('./routes');
registerAllRoutes(app);

app.use((err, req, res, next) => {
    logError('全局错误处理', err, { url: req.url, method: req.method, body: req.body, query: req.query });
    if (err.name === 'ValidationError') return sendError(res, ErrorCode.INVALID_FORMAT, err.message);
    if (err.name === 'UnauthorizedError') return sendError(res, ErrorCode.UNAUTHORIZED);
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return sendError(res, ErrorCode.EXTERNAL_API_TIMEOUT);
    sendError(res, ErrorCode.INTERNAL_ERROR, err.message);
});

app.use((req, res) => {
    sendError(res, ErrorCode.UNKNOWN_ERROR, '接口不存在');
});

if (require.main === module) {
    app.listen(PORT, () => {
        logInfo('系统启动', `
🌙 乐伴好眠 v2 服务器启动
🌍 运行环境: ${NODE_ENV}
📡 端口: ${PORT}
📁 数据库: ${getDbPath()}
📷 上传目录: ${uploadStorage.uploadDir}
📋 日志目录: ${resolveLogDir()}（按天 app-YYYY-MM-DD.log）
🔧 功能:
   1. 主乐器 + 白噪音时间轴
   2. AI 生成贺卡
   3. 社群分享
   4. 积分系统（对接星鹿商城 zhongshu.xinglu.shop）
  `);
    });
}

module.exports = app;
