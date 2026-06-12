/**
 * Phase 0/1 refactor: extract app.legacy.js into modular files.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../src');
const LEGACY = path.join(SRC, 'app.legacy.js');

const lines = fs.readFileSync(LEGACY, 'utf8').split('\n');
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

function write(rel, content) {
    const fp = path.join(SRC, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content.replace(/\r\n/g, '\n').trimEnd() + '\n');
    return fp;
}

function toRouter(code, prefix) {
    const esc = prefix.replace(/\//g, '\\/');
    let out = code.replace(/\bapp\.(get|post|put|delete|patch|all)\(/g, 'router.$1(');
    out = out.replace(new RegExp(`router\\.(get|post|put|delete|patch|all)\\(['"\`]${esc}`, 'g'), "router.$1('");
    return out;
}

const CTX_DESTRUCT = `const {
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
const db = getDb();`;

function routeModule(body, opts = {}) {
    const { auth = true, optional = false } = opts;
    let imports = "const express = require('express');\nconst router = express.Router();\nconst ctx = require('../utils/app-context');\n";
    if (auth) imports += "const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');\n";
    return `/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
${imports}
${CTX_DESTRUCT}

${body}

module.exports = router;
`;
}

// init-database.js
write('bootstrap/init-database.js', `const { getDb } = require('./database');
const cardTemplates = require('../card-template-service');
const mediaSecStore = require('../media-sec-store');
const channelService = require('../channel-service');

function initDatabase() {
    const db = getDb();
${slice(777, 1209)}
}

module.exports = { initDatabase };
`);

// media-url.js
write('utils/media-url.js', `${slice(148, 344)}

module.exports = {
    getApiBaseUrl,
    buildMusicCoverQueryUrl,
    buildPublicUploadUrl,
    getUploadPublicPathForFilename,
    migrateLegacyCoverUrlToMusicCover,
    normalizePublicCoverUrl,
    isDevToolTempMediaUrl,
    sanitizeCommunityImageUrlForClient,
    sanitizeCommunityImagesForClient,
    sanitizePlayerCoverUrlForClient,
    sanitizeCardShareImageForClient,
    isOurHostedUploadUrl
};
`);

// upload-storage.js
write('utils/upload-storage.js', `const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { logWarn, logError, sendError, ErrorCode } = require('../error-codes');
const musicAudioStore = require('../music-audio-store');
const { resolveLibraryAudioDir } = require('../media-paths');
const { getApiBaseUrl } = require('./media-url');

const uploadDir = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '../../data/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const libraryAudioDir = resolveLibraryAudioDir();
if (!fs.existsSync(libraryAudioDir)) {
    fs.mkdirSync(libraryAudioDir, { recursive: true });
}

${slice(346, 516)}

const UPLOAD_SERVE_PREFIXES = ['/api/upload/image/', '/api/upload/file/', '/api/upload/audio/', '/upload/file/'];

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        let ext = path.extname(file.originalname || '');
        if (!ext && file.mimetype) {
            const mimeExt = {
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/webp': '.webp',
                'image/gif': '.gif',
                'audio/mpeg': '.mp3',
                'audio/mp3': '.mp3',
                'audio/wav': '.wav',
                'audio/x-wav': '.wav',
                'audio/mp4': '.m4a',
                'audio/x-m4a': '.m4a',
                'audio/aac': '.aac'
            };
            ext = mimeExt[file.mimetype] || (file.fieldname === 'audio' ? '.mp3' : '.jpg');
        }
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage });

const mallImagesDir = path.join(__dirname, '../../images');
const cardImagesDir = path.join(mallImagesDir, 'card');
if (!fs.existsSync(mallImagesDir)) {
    fs.mkdirSync(mallImagesDir, { recursive: true });
}
if (!fs.existsSync(cardImagesDir)) {
    fs.mkdirSync(cardImagesDir, { recursive: true });
}

function buildPublicAudioUploadUrl(req, filename) {
    const base = getApiBaseUrl(req);
    const encoded = encodeURIComponent(path.basename(filename));
    return \`\${base}/api/upload/audio/\${encoded}\`;
}

module.exports = {
    uploadDir,
    libraryAudioDir,
    mallImagesDir,
    cardImagesDir,
    upload,
    resolveUploadDiskPath,
    resolveReferenceAudioProbeTarget,
    resolveHostedUploadToDisk,
    pickUploadFilenameFromReq,
    sendUploadFileByName,
    sendMusicCoverFile,
    sendMusicAudioFile,
    sendLibraryAudioFile,
    UPLOAD_SERVE_PREFIXES,
    buildPublicAudioUploadUrl
};
`);

// content-guard.js
write('utils/content-guard.js', `const crypto = require('crypto');
const { ErrorCode, sendError, logError, logWarn, logInfo } = require('../error-codes');
const contentSecurity = require('../content-security');
const mediaSecStore = require('../media-sec-store');
const { getDb } = require('../bootstrap/database');
const { getApiBaseUrl } = require('./media-url');
const { uploadDir } = require('./upload-storage');

${slice(648, 750)}

module.exports = {
    blockIfContentUnsafe,
    blockIfImagesUnsafe,
    blockIfHostedImageUnsafe,
    scheduleAudioMediaCheck,
    verifyWechatMsgSignature
};
`);

// middleware/auth.js
write('middleware/auth.js', `const { ErrorCode, sendError } = require('../error-codes');
const { getDb } = require('../bootstrap/database');

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, ErrorCode.UNAUTHORIZED, '缺少有效的认证凭证');
    }
    const token = authHeader.slice(7);
    const user = getDb().prepare(
        'SELECT id, wx_openid, nickname, shop_token, shop_sn FROM users WHERE wx_openid = ?'
    ).get(token);
    if (!user) {
        return sendError(res, ErrorCode.UNAUTHORIZED, '登录已过期，请重新登录');
    }
    req.user = user;
    next();
}

function optionalAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const user = getDb().prepare(
            'SELECT id, wx_openid, nickname, shop_token, shop_sn FROM users WHERE wx_openid = ?'
        ).get(token);
        if (user) req.user = user;
    }
    next();
}

module.exports = { authMiddleware, optionalAuthMiddleware };
`);

// health
write('routes/health.js', routeModule(toRouter(slice(1217, 1229), '/')));

// music + generation helpers
write('routes/music.js', routeModule(toRouter(slice(1231, 1702), '/api/music') + '\n\n' + slice(4629, 4879)));

// card — gift-inbox before /:cardId
const cardBody =
    slice(1799, 1831) +
    '\n\n' +
    toRouter(slice(1834, 1917), '/api/card') +
    '\n\n' +
    toRouter(slice(1947, 2199), '/api/card') +
    '\n\n' +
    toRouter(slice(1748, 1797), '/api/card') +
    '\n\n' +
    toRouter(slice(1704, 1746), '/api/card') +
    '\n\n' +
    toRouter(slice(1919, 1945), '/api/card');
write('routes/card.js', routeModule(cardBody));

// community
write(
    'routes/community.js',
    routeModule(
        slice(2252, 2474) +
            '\n\n' +
            toRouter(slice(2201, 2250) + '\n\n' + slice(2476, 2996), '/api/community') +
            '\n\n' +
            slice(3083, 3099) +
            '\n\n' +
            toRouter(slice(3102, 3165), '/api/community')
    )
);

write('routes/feedback.js', routeModule(toRouter(slice(2998, 3081), '/api/feedback')));

write(
    'routes/upload.js',
    routeModule(
        `function buildPublicAudioUploadUrl(req, filename) {
    const base = getApiBaseUrl(req);
    const encoded = encodeURIComponent(path.basename(filename));
    return \`\${base}/api/upload/audio/\${encoded}\`;
}

` + toRouter(slice(3167, 3220), '/api/upload')
    )
);

write(
    'routes/library.js',
    routeModule(
        slice(3223, 3259) +
            '\n\n' +
            slice(3376, 3398) +
            '\n\n' +
            toRouter(slice(3262, 3601), '/api')
    )
);

// user
write(
    'routes/user.js',
    routeModule(
        slice(3611, 3629) +
            '\n\n' +
            `function findUserByOpenid(openid) {
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

` +
            slice(3967, 4023) +
            '\n\n' +
            toRouter(slice(3631, 4089), '/api/user')
    )
);

write(
    'routes/shop.js',
    routeModule(
        slice(4092, 4207) +
            '\n\n' +
            toRouter(slice(4210, 4345), '/api/shop')
    )
);

write(
    'routes/branding.js',
    routeModule(
        toRouter(
            slice(4348, 4358) +
                '\n\n' +
                slice(4361, 4369) +
                '\n\n' +
                slice(4372, 4385) +
                '\n\n' +
                slice(4388, 4405),
            '/api'
        )
    )
);

write('routes/mall.js', routeModule(toRouter(slice(4408, 4424), '/api/mall')));
write('routes/detection.js', routeModule(toRouter(slice(4430, 4465), '/api/detection')));
write('routes/mianjia.js', routeModule(toRouter(slice(4468, 4476), '/api/mianjia')));

write(
    'routes/tasks.js',
    routeModule(slice(4479, 4503) + '\n\n' + toRouter(slice(4506, 4626), '/api/tasks'))
);

write(
    'routes/points.js',
    routeModule(slice(4910, 4917) + '\n\n' + toRouter(slice(4919, 5123), '/api/points'))
);

// ai.js — blessing router + extra mounts
write(
    'routes/ai.js',
    `/**
 * AI 祝福语、音乐生成、音频混音
 */
const express = require('express');
const ctx = require('../utils/app-context');
${CTX_DESTRUCT}

const blessingRouter = express.Router();
${toRouter(slice(4884, 4906), '/api/ai')}

function registerAiRoutes(app) {
    app.use('/api/ai', blessingRouter);
    ${toRouter(slice(5125, 5192), '/api/music').replace(/router\./g, 'app.')}
    ${toRouter(slice(5206, 5252), '/api/audio').replace(/router\./g, 'app.')}
}

module.exports = { registerAiRoutes, blessingRouter };
`
);

write('routes/wechat.js', routeModule(toRouter(slice(5333, 5351), '/api/wechat')));

// media
write(
    'routes/media.js',
    `const express = require('express');
const path = require('path');
const fs = require('fs');
const { QRCODE_DIR } = require('../mall-qrcode');
const { ErrorCode, sendError, logWarn } = require('../error-codes');
const {
    uploadDir,
    libraryAudioDir,
    sendUploadFileByName,
    sendMusicCoverFile,
    sendMusicAudioFile,
    sendLibraryAudioFile,
    mallImagesDir
} = require('../utils/upload-storage');
const { AUDIO_DIR } = require('../audio-mixer');

function registerMediaRoutes(app) {
${slice(518, 585).replace(/^/gm, '    ')}
    if (!fs.existsSync(QRCODE_DIR)) {
        fs.mkdirSync(QRCODE_DIR, { recursive: true });
    }
${slice(5254, 5304).replace(/^/gm, '    ')}
}

module.exports = { registerMediaRoutes };
`
);

write(
    'routes/index.js',
    `const { registerMediaRoutes } = require('./media');
const { registerAiRoutes } = require('./ai');

function registerAllRoutes(app) {
    registerMediaRoutes(app);
    registerAiRoutes(app);

    app.use('/', require('./health'));
    app.use('/api/music', require('./music'));
    app.use('/api/card', require('./card'));
    app.use('/api/community', require('./community'));
    app.use('/api/feedback', require('./feedback'));
    app.use('/api/upload', require('./upload'));
    app.use('/api', require('./library'));
    app.use('/api/user', require('./user'));
    app.use('/api/shop', require('./shop'));
    app.use('/api', require('./branding'));
    app.use('/api/mall', require('./mall'));
    app.use('/api/detection', require('./detection'));
    app.use('/api/mianjia', require('./mianjia'));
    app.use('/api/tasks', require('./tasks'));
    app.use('/api/points', require('./points'));
    app.use('/api/wechat', require('./wechat'));
}

module.exports = { registerAllRoutes };
`
);

// new app.js
write(
    'app.js',
    `const path = require('path');
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
const { registerAllRoutes } = require('./routes');

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

function requireShopToken(req, res) {
    const t = req.user.shop_token;
    if (!t) {
        sendError(res, ErrorCode.MALL_API_ERROR, '未同步商城账号，请使用手机号完成微信授权登录');
        return null;
    }
    return t;
}

function isShopAutoRefreshOnTimeoutEnabled() {
    return String(process.env.SHOP_AUTO_REFRESH_ON_TIMEOUT || 'true').toLowerCase() !== 'false';
}

function persistShopTokenFromPayload(userKey, p, options = {}) {
    const db = getDb();
    const { by = 'openid', mergeProfile = true } = options;
    if (!p || !p.token) return false;
    if (by === 'id') {
        db.prepare('UPDATE users SET shop_token = ?, shop_sn = ? WHERE id = ?').run(p.token, p.sn || null, userKey);
    } else {
        db.prepare('UPDATE users SET shop_token = ?, shop_sn = ? WHERE wx_openid = ?').run(p.token, p.sn || null, userKey);
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
            logWarn(context, 'shop_token 刷新失败：静默登录未成功', { openid, msg: shopApi.getShopApiMessage(shopRes) });
            return null;
        }
        const p = shopApi.pickLoginData(shopRes);
        if (!persistShopTokenFromPayload(userId, p, { by: 'id', mergeProfile: false })) {
            logWarn(context, 'shop_token 刷新失败：响应无 token', { openid });
            return null;
        }
        user.shop_token = p.token;
        user.shop_sn = p.sn || null;
        logInfo('商城登录', 'shop_token 已刷新', { openid, context, sn: p.sn || null, refreshedAt: new Date().toISOString() });
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

function recordPointsLedger(userId, signedPoints, type, description) {
    const db = getDb();
    db.prepare('INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)').run(
        uuidv4(),
        userId,
        signedPoints,
        type,
        description != null ? String(description) : ''
    );
}

function getOrInitPoints(userId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM user_points WHERE user_id = ?').get(userId);
    if (!row) {
        db.prepare('INSERT INTO user_points (user_id, points, total_points) VALUES (?, 0, 0)').run(userId);
        return { points: 0, total_points: 0 };
    }
    return row;
}

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
    persistShopTokenFromPayload,
    requireShopToken,
    callShopWithAutoRefresh,
    recordPointsLedger,
    getOrInitPoints,
    NODE_ENV,
    isDev,
    isProd
});

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

app.listen(PORT, () => {
    logInfo('系统启动', \`
🌙 乐伴好眠 v2 服务器启动
🌍 运行环境: \${NODE_ENV}
📡 端口: \${PORT}
📁 数据库: \${getDbPath()}
📷 上传目录: \${uploadStorage.uploadDir}
📋 日志目录: \${resolveLogDir()}（按天 app-YYYY-MM-DD.log）
🔧 功能:
   1. 主乐器 + 白噪音时间轴
   2. AI 生成贺卡
   3. 社群分享
   4. 积分系统（对接星鹿商城 zhongshu.xinglu.shop）
  \`);
});

module.exports = app;
`
);

console.log('Phase 1 refactor files written.');
