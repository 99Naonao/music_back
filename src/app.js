const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

// 环境变量：.env → .env.{NODE_ENV} → 宝塔未设 NODE_ENV 时补读 .env.production（仅填空项）
function loadEnvFiles() {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const baseEnv = path.join(projectRoot, '.env');
    if (fs.existsSync(baseEnv)) {
        dotenv.config({ path: baseEnv });
    }
    const envSpecific = path.join(projectRoot, `.env.${nodeEnv}`);
    if (fs.existsSync(envSpecific)) {
        dotenv.config({ path: envSpecific, override: true });
    } else if (!fs.existsSync(baseEnv)) {
        dotenv.config();
    }
    const prodEnv = path.join(projectRoot, '.env.production');
    if (fs.existsSync(prodEnv)) {
        if (nodeEnv === 'production') {
            dotenv.config({ path: prodEnv, override: true });
        } else {
            const parsed = dotenv.parse(fs.readFileSync(prodEnv, 'utf8'));
            Object.keys(parsed).forEach((key) => {
                const cur = process.env[key];
                if (cur == null || String(cur).trim() === '') {
                    process.env[key] = parsed[key];
                }
            });
        }
    }
}

loadEnvFiles();
// 未设置 TZ 时默认东八区，避免 SQLite datetime('now','localtime') 与系统感知不一致；也可用环境变量 TZ 覆盖
if (!process.env.TZ) {
    process.env.TZ = 'Asia/Shanghai';
}
const NODE_ENV = process.env.NODE_ENV || 'development';
const isDev = NODE_ENV === 'development';
const isProd = NODE_ENV === 'production';

const { getLogger, resolveLogDir } = require('./logger');
getLogger();

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
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
const multer = require('multer');
const crypto = require('crypto');

const {
    generateMusic,
    checkGenerationStatus,
    isMinimaxMockAllowed
} = require('./minimax-service');
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
const {
    QRCODE_DIR,
    attachVoucherUiFlags,
    attachVoucherUiFlagsList,
    getMallClientConfig
} = require('./mall-qrcode');

function exposeQrcodeIfEnabled(product, mallImageUrlFn) {
    return typeof attachVoucherUiFlags === 'function'
        ? attachVoucherUiFlags(product, mallImageUrlFn)
        : product;
}

function exposeQrcodeListIfEnabled(list, mallImageUrlFn) {
    return typeof attachVoucherUiFlagsList === 'function'
        ? attachVoucherUiFlagsList(list, mallImageUrlFn)
        : list;
}
const { getMianjiaProducts } = require('./mianjia-products-service');
const cardTemplates = require('./card-template-service');
const musicAudioStore = require('./music-audio-store');
const { createRequestLogger } = require('./middleware/request-logger');
const { resolveLibraryCoverRel, toAbsoluteCoverUrl } = require('./library-cover');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 跨域配置
app.use(cors(corsOptions));
logCorsConfig();

app.use(express.json());

// 请求日志：/api 全量结构化；业务 code 从 res.json 捕获；静态目录默认不记
app.use(
    createRequestLogger({
        logInfo,
        logWarn,
        logError
    })
);

const {
    resolveLibraryAudioDir,
    normalizeLibraryAudioUrl
} = require('./media-paths');

// 上传文件目录（生产建议在 .env 设 UPLOAD_DIR 为绝对路径并持久化）
const uploadDir = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '../data/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 官方曲库音频目录（与 DB_PATH 同级的 data/audio/library）
const libraryAudioDir = resolveLibraryAudioDir();
if (!fs.existsSync(libraryAudioDir)) {
    fs.mkdirSync(libraryAudioDir, { recursive: true });
}

function getApiBaseUrl(req) {
    return (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

/**
 * 对外图片 URL（小程序 <image> 直接访问）。
 * - api / cover（默认）：/api/music/cover?f={file} — 路径不以 .png 结尾，避免 Nginx 静态图规则拦截
 * - image / file：旧路径（线上易 404）
 * - uploads：/uploads/{file} — 需 Nginx alias
 */
function buildMusicCoverQueryUrl(base, filename) {
    const safeName = path.basename(filename);
    const encoded = encodeURIComponent(safeName);
    return `${base}/api/music/cover?f=${encoded}`;
}

function buildPublicUploadUrl(req, filename) {
    const base = getApiBaseUrl(req);
    const mode = String(process.env.UPLOAD_PUBLIC_PATH || 'api').toLowerCase();
    const safeName = path.basename(filename);
    const encoded = encodeURIComponent(safeName);
    if (mode === 'uploads') {
        return `${base}/uploads/${encoded}`;
    }
    if (mode === 'file') {
        return `${base}/api/upload/file/${encoded}`;
    }
    if (mode === 'image') {
        return `${base}/api/upload/image/${encoded}`;
    }
    return buildMusicCoverQueryUrl(base, safeName);
}

function getUploadPublicPathForFilename(filename) {
    const safeName = path.basename(filename);
    const encoded = encodeURIComponent(safeName);
    const mode = String(process.env.UPLOAD_PUBLIC_PATH || 'api').toLowerCase();
    if (mode === 'uploads') return `/uploads/${encoded}`;
    if (mode === 'file') return `/api/upload/file/${encoded}`;
    if (mode === 'image') return `/api/upload/image/${encoded}`;
    return `/api/music/cover?f=${encoded}`;
}

function migrateLegacyCoverUrlToMusicCover(urlStr) {
    const raw = String(urlStr || '').trim();
    if (!raw) return '';
    if (/\/api\/music\/cover\?/i.test(raw)) return raw;

    const toQuery = (filePart) => {
        const name = decodeURIComponent(String(filePart || '').split('?')[0]);
        if (!name) return raw;
        const enc = encodeURIComponent(path.basename(name));
        if (/^https?:\/\//i.test(raw)) {
            const origin = raw.match(/^https?:\/\/[^/]+/i);
            return origin ? `${origin[0]}/api/music/cover?f=${enc}` : `/api/music/cover?f=${enc}`;
        }
        return `/api/music/cover?f=${enc}`;
    };

    const pathMatch = raw.match(
        /\/api\/(?:upload\/(?:file|image)|music\/cover)\/([^?#]+)/i
    );
    if (pathMatch) return toQuery(pathMatch[1]);

    return raw;
}

function normalizePublicCoverUrl(urlStr) {
    const raw = migrateLegacyCoverUrlToMusicCover(urlStr);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (!base) return raw;
    return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

/** 开发者工具/模拟器临时图，不可给客户端 <image> 使用 */
function isDevToolTempMediaUrl(urlStr) {
    const raw = String(urlStr || '').trim();
    if (!raw) return true;
    const lower = raw.toLowerCase();
    if (lower.startsWith('wxfile://')) return true;
    if (lower.includes('/__tmp__/')) return true;
    if (lower.startsWith('http://tmp/') || lower.startsWith('https://tmp/')) return true;
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(raw) && !isOurHostedUploadUrl(raw)) {
        return true;
    }
    return false;
}

/** 社群帖子配图：去掉 __tmp__ / 本机临时 http，保留已上传的公网地址 */
function sanitizeCommunityImageUrlForClient(urlStr) {
    const raw = String(urlStr || '').trim();
    if (!raw || isDevToolTempMediaUrl(raw)) return '';
    if (/^https?:\/\//i.test(raw)) {
        if (isOurHostedUploadUrl(raw)) {
            try {
                const u = new URL(raw);
                return `${u.origin}${u.pathname}${u.search}`;
            } catch (_) {
                return raw;
            }
        }
        if (/oss\.zsyl\.cc/i.test(raw) || /xinglu\.shop/i.test(raw)) return raw;
        return '';
    }
    if (raw.startsWith('/api/upload/') && isOurHostedUploadUrl(raw)) {
        return normalizePublicCoverUrl(raw);
    }
    return '';
}

function sanitizeCommunityImagesForClient(images) {
    if (!images) return [];
    let list = images;
    if (typeof list === 'string') {
        try {
            list = JSON.parse(list);
        } catch (_) {
            return [];
        }
    }
    if (!Array.isArray(list)) return [];
    return list.map((u) => sanitizeCommunityImageUrlForClient(u)).filter(Boolean);
}

/** 返回给客户端的封面：去掉开发者工具 __tmp__、wxfile、本机未托管 http */
function sanitizePlayerCoverUrlForClient(urlStr) {
    const raw = String(urlStr || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower.startsWith('wxfile://') || lower.includes('/__tmp__/')) return '';
    if (lower.startsWith('http://tmp/') || lower.startsWith('https://tmp/')) return '';
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(raw) && !isOurHostedUploadUrl(raw)) {
        return '';
    }
    const migrated = migrateLegacyCoverUrlToMusicCover(raw);
    if (!migrated || !isOurHostedUploadUrl(migrated)) return '';
    return normalizePublicCoverUrl(migrated);
}

function isOurHostedUploadUrl(urlStr) {
    const raw = String(urlStr || '').trim();
    if (!raw) return false;
    if (!/^https?:\/\//i.test(raw)) {
        return (
            raw.startsWith('/api/music/cover') ||
            raw.startsWith('/api/upload/file/') ||
            raw.startsWith('/api/upload/image/') ||
            raw.startsWith('/uploads/') ||
            raw.startsWith('/images/')
        );
    }
    try {
        const u = new URL(raw);
        const p = u.pathname;
        if (p === '/api/music/cover' || p.endsWith('/api/music/cover')) {
            return !!(u.searchParams.get('f') || u.searchParams.get('file'));
        }
        if (
            p.includes('/api/music/cover/') ||
            p.includes('/api/upload/file/') ||
            p.includes('/api/upload/image/') ||
            p.includes('/uploads/') ||
            p.startsWith('/images/')
        ) {
            return true;
        }
        const base = (process.env.BASE_URL || '').replace(/\/$/, '');
        if (base) {
            try {
                const baseHost = new URL(base).host;
                if (u.host === baseHost && (p.startsWith('/api/upload/') || p.includes('/api/music/cover'))) {
                    return true;
                }
            } catch (_) {
                /* ignore */
            }
        }
        return false;
    } catch (_) {
        return false;
    }
}

function resolveUploadDiskPath(filenameParam) {
    const safe = path.basename(decodeURIComponent(String(filenameParam || '')));
    if (!safe) return null;
    const filePath = path.join(uploadDir, safe);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(uploadDir))) return null;
    return { safe, filePath: resolved };
}

/**
 * 参考音乐校验/探测：上传文件走磁盘，官方曲库走 library 目录，其余走公网 URL 供 ffprobe
 */
function resolveReferenceAudioProbeTarget(urlOrPath) {
    const raw = String(urlOrPath || '').trim();
    if (!raw) return null;

    if (!/^https?:\/\//i.test(raw) && fs.existsSync(raw)) {
        return raw;
    }

    const uploadDisk = resolveHostedUploadToDisk(raw);
    if (uploadDisk && fs.existsSync(uploadDisk)) {
        return uploadDisk;
    }

    let libFilename = '';
    if (/library-audio/i.test(raw)) {
        try {
            const q = raw.includes('?') ? raw.split('?')[1] : '';
            const params = new URLSearchParams(q);
            const f = params.get('f');
            if (f) libFilename = decodeURIComponent(f);
        } catch (_) {
            const m = raw.match(/[?&]f=([^&]+)/i);
            if (m) libFilename = decodeURIComponent(m[1]);
        }
    }
    if (!libFilename) {
        const legacy = raw.match(/\/audio\/library\/([^?#/]+)/i);
        if (legacy && legacy[1]) {
            libFilename = decodeURIComponent(legacy[1]);
        }
    }
    if (libFilename) {
        const safe = path.basename(libFilename);
        const fp = path.join(libraryAudioDir, safe);
        const root = path.resolve(libraryAudioDir) + path.sep;
        if (path.resolve(fp).startsWith(root) && fs.existsSync(fp)) {
            return fp;
        }
        logWarn('参考音乐', '曲库文件不存在', {
            libraryAudioDir,
            filename: safe,
            filePath: fp
        });
    }

    if (/^https?:\/\//i.test(raw)) {
        return raw;
    }

    const base = String(process.env.BASE_URL || process.env.API_PUBLIC_URL || '').replace(
        /\/$/,
        ''
    );
    if (base && raw.startsWith('/')) {
        return `${base}${raw}`;
    }

    return null;
}

/** 将本服务上传 URL 解析为磁盘绝对路径（图片/音频） */
function resolveHostedUploadToDisk(urlOrPath) {
    const raw = String(urlOrPath || '').trim();
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw) && fs.existsSync(raw)) return raw;

    let filename = '';
    try {
        const pathPart = raw.split('?')[0];
        const prefixes = [
            '/api/upload/audio/',
            '/api/upload/image/',
            '/api/upload/file/',
            '/uploads/'
        ];
        for (const prefix of prefixes) {
            const idx = pathPart.indexOf(prefix);
            if (idx !== -1) {
                filename = decodeURIComponent(pathPart.slice(idx + prefix.length));
                break;
            }
        }
        if (!filename && /^https?:\/\//i.test(raw)) {
            const u = new URL(raw);
            for (const prefix of UPLOAD_SERVE_PREFIXES) {
                const idx = u.pathname.indexOf(prefix);
                if (idx !== -1) {
                    filename = decodeURIComponent(u.pathname.slice(idx + prefix.length));
                    break;
                }
            }
        }
        if (!filename) filename = path.basename(pathPart);
    } catch (_) {
        filename = path.basename(String(raw).split('?')[0]);
    }
    const hit = resolveUploadDiskPath(filename);
    return hit && fs.existsSync(hit.filePath) ? hit.filePath : null;
}

const UPLOAD_SERVE_PREFIXES = ['/api/upload/image/', '/api/upload/file/', '/api/upload/audio/', '/upload/file/'];

function pickUploadFilenameFromReq(req) {
    const rawPath = String(req.originalUrl || req.url || '').split('?')[0];
    for (const prefix of UPLOAD_SERVE_PREFIXES) {
        const idx = rawPath.indexOf(prefix);
        if (idx !== -1) {
            const name = rawPath.slice(idx + prefix.length);
            if (name) return decodeURIComponent(name);
        }
    }
    if (req.params.basename != null && req.params.ext != null) {
        return `${req.params.basename}.${req.params.ext}`;
    }
    if (req.params.filename != null) {
        return String(req.params.filename);
    }
    return '';
}

function sendUploadFileByName(req, res) {
    const requested = pickUploadFilenameFromReq(req);
    const hit = resolveUploadDiskPath(requested);
    if (!hit || !fs.existsSync(hit.filePath)) {
        logWarn('读取上传图', '文件不存在', { uploadDir, requested, path: req.originalUrl });
        return res.status(404).end();
    }
    return res.sendFile(hit.filePath, (err) => {
        if (err) {
            logError('读取上传图', err, { uploadDir, file: hit.safe });
            if (!res.headersSent) res.status(500).end();
        }
    });
}

/** 作品封面图：?f= 查询参数，避免 URL 以 .png 结尾被 Nginx 静态规则抢走 */
function sendMusicCoverFile(req, res) {
    const rawName =
        req.query.f ||
        req.query.file ||
        req.params.filename ||
        pickUploadFilenameFromReq(req);
    const hit = resolveUploadDiskPath(rawName);
    if (!hit || !fs.existsSync(hit.filePath)) {
        logWarn('读取作品封面图', '文件不存在', {
            uploadDir,
            filename: rawName,
            path: req.originalUrl
        });
        return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    return res.sendFile(hit.filePath, (err) => {
        if (err) {
            logError('读取作品封面图', err, { uploadDir, file: hit.safe });
            if (!res.headersSent) res.status(500).end();
        }
    });
}

app.get('/api/music/cover', sendMusicCoverFile);
app.get('/api/music/cover/:filename', sendMusicCoverFile);

/** 作品音频：?f=audio-{musicId}.mp3，避免路径以 .mp3 结尾被 Nginx 静态规则拦截 */
function sendMusicAudioFile(req, res) {
    const rawName = req.query.f || req.query.file || '';
    const hit = musicAudioStore.resolveMusicAudioDiskPath(uploadDir, rawName);
    if (!hit || !fs.existsSync(hit.filePath)) {
        logWarn('读取作品音频', '文件不存在', {
            uploadDir,
            filename: rawName,
            path: req.originalUrl
        });
        return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.sendFile(hit.filePath, (err) => {
        if (err) {
            logError('读取作品音频', err, { uploadDir, file: hit.safe });
            if (!res.headersSent) res.status(500).end();
        }
    });
}

app.get('/api/music/audio', sendMusicAudioFile);

/** 官方曲库：?f=track1.mp3，路径无 .mp3 后缀，避免 Nginx 静态规则 404 */
function sendLibraryAudioFile(req, res) {
    const rawName = req.query.f || req.query.file || '';
    const safe = path.basename(String(rawName || '').trim());
    if (!safe) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '文件名不能为空');
    }
    const filePath = path.join(libraryAudioDir, safe);
    const libraryRoot = path.resolve(libraryAudioDir) + path.sep;
    if (!path.resolve(filePath).startsWith(libraryRoot)) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '非法文件路径');
    }
    if (!fs.existsSync(filePath)) {
        logWarn('读取官方曲库音频', '文件不存在', {
            libraryAudioDir,
            filename: safe,
            filePath,
            path: req.originalUrl
        });
        return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.sendFile(filePath, (err) => {
        if (err) {
            logError('读取官方曲库音频', err, { libraryAudioDir, file: safe });
            if (!res.headersSent) res.status(500).end();
        }
    });
}

app.get('/api/music/library-audio', sendLibraryAudioFile);

app.get(/^\/api\/upload\/file\/.+/, sendUploadFileByName);
app.get(/^\/api\/upload\/image\/.+/, sendUploadFileByName);
app.get(/^\/api\/upload\/audio\/.+/, sendUploadFileByName);
/** Nginx 把 /api 前缀剥掉时的兜底 */
app.get(/^\/upload\/file\/.+/, sendUploadFileByName);
app.get(/^\/upload\/image\/.+/, sendUploadFileByName);
app.get(/^\/upload\/audio\/.+/, sendUploadFileByName);
app.use('/uploads', express.static(uploadDir));

/** 商城等固定配图目录：部署时在项目根下建 images/，访问 https://域名/images/文件名 */
const mallImagesDir = path.join(__dirname, '..', 'images');
const cardImagesDir = path.join(mallImagesDir, 'card');
if (!fs.existsSync(mallImagesDir)) {
    fs.mkdirSync(mallImagesDir, { recursive: true });
}
if (!fs.existsSync(cardImagesDir)) {
    fs.mkdirSync(cardImagesDir, { recursive: true });
}
if (!fs.existsSync(QRCODE_DIR)) {
    fs.mkdirSync(QRCODE_DIR, { recursive: true });
}
app.use('/images', express.static(mallImagesDir));

// multer 配置（保留原始文件扩展名）
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

// 鉴权中间件（保护敏感接口）
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, ErrorCode.UNAUTHORIZED, '缺少有效的认证凭证');
    }
    const token = authHeader.slice(7);
    const user = db.prepare(
        'SELECT id, wx_openid, nickname, shop_token, shop_sn FROM users WHERE wx_openid = ?'
    ).get(token);
    if (!user) {
        return sendError(res, ErrorCode.UNAUTHORIZED, '登录已过期，请重新登录');
    }
    req.user = user;
    next();
}

/** @returns {Promise<boolean>} true 表示已拦截并写响应 */
async function blockIfContentUnsafe(res, openid, items) {
    try {
        const check = await contentSecurity.checkTexts(openid, items);
        if (!check.pass) {
            logWarn('内容安全', '拦截', {
                openid: openid ? String(openid).slice(0, 8) + '…' : '',
                field: check.field || '',
                suggest: check.suggest || '',
                segment: check.segment || ''
            });
            sendError(res, ErrorCode.CONTENT_SENSITIVE);
            return true;
        }
        if (check.skipped) {
            logWarn('内容安全', '已跳过检测（SKIP_CONTENT_SEC_CHECK 或未配置微信密钥）', {
                field: (items || []).map((i) => i.field).filter(Boolean).join(',') || undefined
            });
        }
        return false;
    } catch (err) {
        logError('内容安全检测', err);
        sendError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
        return true;
    }
}

/** @returns {Promise<boolean>} true 表示已拦截并写响应 */
async function blockIfImagesUnsafe(res, urls, req) {
    try {
        const baseUrl = req ? getApiBaseUrl(req) : process.env.BASE_URL || '';
        for (const url of (urls || []).filter(Boolean).slice(0, 9)) {
            const check = await contentSecurity.checkHostedImage(url, { uploadDir, baseUrl });
            if (!check.pass) {
                logWarn('内容安全', '图片拦截', { url: String(url).slice(0, 120) });
                sendError(res, ErrorCode.CONTENT_SENSITIVE);
                return true;
            }
        }
        return false;
    } catch (err) {
        logError('图片内容安全检测', err);
        sendError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
        return true;
    }
}

/** 单张托管/公网图片（头像、封面等） */
async function blockIfHostedImageUnsafe(res, imageUrl, req, field) {
    if (!imageUrl || !String(imageUrl).trim()) return false;
    try {
        const check = await contentSecurity.checkHostedImage(imageUrl, {
            uploadDir,
            baseUrl: getApiBaseUrl(req)
        });
        if (!check.pass) {
            logWarn('内容安全', '图片拦截', { field, url: String(imageUrl).slice(0, 120) });
            sendError(res, ErrorCode.CONTENT_SENSITIVE);
            return true;
        }
        return false;
    } catch (err) {
        logError('图片内容安全', err, { field });
        sendError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
        return true;
    }
}

/** 提交音频异步审核（结果经消息推送回调，见 /api/wechat/msg-push） */
async function scheduleAudioMediaCheck(openid, audioUrl, refType, refId) {
    if (!openid || !audioUrl || !String(audioUrl).trim()) return;
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    try {
        const r = await contentSecurity.checkAudioUrlAsync(
            openid,
            contentSecurity.SCENE.SOCIAL,
            audioUrl,
            baseUrl
        );
        if (r.skipped || !r.submitted || !r.trace_id) return;
        mediaSecStore.insertTask(db, {
            trace_id: r.trace_id,
            media_type: contentSecurity.MEDIA_TYPE.AUDIO,
            media_url: contentSecurity.toAbsoluteMediaUrl(audioUrl, baseUrl),
            ref_type: refType,
            ref_id: refId,
            openid
        });
        logInfo('内容安全', '音频异步任务已提交', {
            trace_id: r.trace_id,
            ref_type: refType,
            ref_id: refId
        });
    } catch (err) {
        logError('音频内容安全提交', err, { ref_type: refType, ref_id: refId });
    }
}

function verifyWechatMsgSignature(token, timestamp, nonce, signature) {
    if (!token || !signature) return false;
    const arr = [String(token), String(timestamp || ''), String(nonce || '')].sort();
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
    return hash === String(signature);
}

/** 有 token 则解析用户，无 token 仍放行（用于关注流等） */
function optionalAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const user = db.prepare(
            'SELECT id, wx_openid, nickname, shop_token, shop_sn FROM users WHERE wx_openid = ?'
        ).get(token);
        if (user) req.user = user;
    }
    next();
}

// 确保数据目录存在
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据库（优先使用环境变量 DB_PATH）
const dbPath = process.env.DB_PATH || path.join(dataDir, 'sleep_music_v2.db');
const db = new Database(dbPath);

// 创建表结构
function initDatabase() {
    // 用户表
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            wx_openid TEXT UNIQUE,
            phone TEXT,
            nickname TEXT,
            avatar_url TEXT,
            gender TEXT,
            birthday TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // 官方曲库占位用户（music_tracks.user_id 外键）
    db.prepare(
        `INSERT OR IGNORE INTO users (id, nickname) VALUES ('system', '官方曲库')`
    ).run();

    // 音乐作品表
    db.exec(`
        CREATE TABLE IF NOT EXISTS music_tracks (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            main_instrument TEXT,
            frequency TEXT,
            duration INTEGER,
            bpm INTEGER,
            audio_url TEXT,
            status TEXT DEFAULT 'generating',
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 白噪音时间轴表
    db.exec(`
        CREATE TABLE IF NOT EXISTS sound_effects (
            id TEXT PRIMARY KEY,
            music_id TEXT,
            effect_type TEXT,
            start_time INTEGER,
            end_time INTEGER,
            volume REAL DEFAULT 0.5,
            use_reference_music INTEGER DEFAULT 0,
            reference_audio_url TEXT,
            FOREIGN KEY (music_id) REFERENCES music_tracks(id)
        )
    `);

    try {
        const seCols = db.prepare(`PRAGMA table_info(sound_effects)`).all();
        const seNames = new Set(seCols.map((c) => c.name));
        if (!seNames.has('use_reference_music')) {
            db.exec(`ALTER TABLE sound_effects ADD COLUMN use_reference_music INTEGER DEFAULT 0`);
            console.log('[DB] 已添加列 sound_effects.use_reference_music');
        }
        if (!seNames.has('reference_audio_url')) {
            db.exec(`ALTER TABLE sound_effects ADD COLUMN reference_audio_url TEXT`);
            console.log('[DB] 已添加列 sound_effects.reference_audio_url');
        }
    } catch (seMigrateErr) {
        console.warn('[DB] sound_effects 迁移:', seMigrateErr.message);
    }

    // 贺卡表
    db.exec(`
        CREATE TABLE IF NOT EXISTS greeting_cards (
            id TEXT PRIMARY KEY,
            music_id TEXT,
            sender_id TEXT,
            recipient_name TEXT,
            message TEXT,
            template_style TEXT,
            share_url TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (music_id) REFERENCES music_tracks(id),
            FOREIGN KEY (sender_id) REFERENCES users(id)
        )
    `);

    // 社群帖子表
    db.exec(`
        CREATE TABLE IF NOT EXISTS community_posts (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            content TEXT,
            images TEXT,
            topic TEXT,
            music_id TEXT,
            likes INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (music_id) REFERENCES music_tracks(id)
        )
    `);

    // 社群评论表
    db.exec(`
        CREATE TABLE IF NOT EXISTS community_comments (
            id TEXT PRIMARY KEY,
            post_id TEXT,
            user_id TEXT,
            content TEXT,
            parent_id TEXT,
            reply_to_user_id TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (post_id) REFERENCES community_posts(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 点赞记录表（防止重复点赞）
    db.exec(`
        CREATE TABLE IF NOT EXISTS community_likes (
            post_id TEXT,
            user_id TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (post_id, user_id),
            FOREIGN KEY (post_id) REFERENCES community_posts(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS community_comment_likes (
            comment_id TEXT,
            user_id TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (comment_id, user_id),
            FOREIGN KEY (comment_id) REFERENCES community_comments(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 贺卡分享表（用于小程序卡片分享）
    db.exec(`
        CREATE TABLE IF NOT EXISTS card_shares (
            id TEXT PRIMARY KEY,
            music_id TEXT,
            sender_id TEXT,
            recipient TEXT,
            message TEXT,
            template INTEGER DEFAULT 1,
            music_instrument TEXT,
            music_frequency TEXT,
            music_bpm INTEGER,
            cover_image TEXT,
            audio_url TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // 贺卡模板分类（清单来自 images/card-templates.json，启动时同步）
    db.exec(`
        CREATE TABLE IF NOT EXISTS card_template_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1
        )
    `);

    // 贺卡模板（PNG 置于项目根 images/，由 manifest 登记文件名）
    db.exec(`
        CREATE TABLE IF NOT EXISTS card_templates (
            id TEXT PRIMARY KEY,
            category_id TEXT NOT NULL,
            name TEXT NOT NULL,
            image_file TEXT NOT NULL,
            cover_url TEXT NOT NULL,
            bg_image_url TEXT NOT NULL,
            gradient_template INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (category_id) REFERENCES card_template_categories(id)
        )
    `);

    // 用户积分表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_points (
            user_id TEXT PRIMARY KEY,
            points INTEGER DEFAULT 0,
            total_points INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 积分变动记录表
    db.exec(`
        CREATE TABLE IF NOT EXISTS points_history (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            points INTEGER,
            type TEXT,
            description TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 每日任务领取记录（自然日，上海时区）
    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_task_claims (
            user_id TEXT NOT NULL,
            task_key TEXT NOT NULL,
            claim_date TEXT NOT NULL,
            points INTEGER NOT NULL,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (user_id, task_key, claim_date),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 通知表
    db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT,
            content TEXT,
            related_id TEXT,
            read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 用户关注关系
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_follows (
            follower_id TEXT NOT NULL,
            following_id TEXT NOT NULL,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (follower_id, following_id),
            FOREIGN KEY (follower_id) REFERENCES users(id),
            FOREIGN KEY (following_id) REFERENCES users(id)
        )
    `);

    // 用户意见反馈（小程序帮助中心提交）
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_feedback (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            wx_openid TEXT,
            nickname TEXT,
            feedback_type TEXT NOT NULL,
            content TEXT NOT NULL,
            contact TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 用户收藏的作品
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_favorites (
            user_id TEXT NOT NULL,
            music_id TEXT NOT NULL,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (user_id, music_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 播放记录（每用户每首曲目一条，重复播放更新 played_at）
    db.exec(`
        CREATE TABLE IF NOT EXISTS play_history (
            user_id TEXT NOT NULL,
            music_id TEXT NOT NULL,
            title TEXT,
            audio_url TEXT NOT NULL,
            cover TEXT,
            instrument TEXT,
            frequency TEXT,
            duration_sec INTEGER DEFAULT 0,
            source TEXT,
            played_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (user_id, music_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    try {
        const cols = db.prepare(`PRAGMA table_info(music_tracks)`).all();
        const musicTrackColNames = new Set(cols.map((c) => c.name));
        if (!musicTrackColNames.has('audio_duration_ms')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN audio_duration_ms INTEGER`);
            console.log('[DB] 已添加列 music_tracks.audio_duration_ms（MiniMax 成片时长 ms）');
        }
        if (!musicTrackColNames.has('player_cover_url')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN player_cover_url TEXT`);
            console.log('[DB] 已添加列 music_tracks.player_cover_url（播放器封面，与贺卡无关）');
        }
        if (!musicTrackColNames.has('play_count')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN play_count INTEGER DEFAULT 0`);
            console.log('[DB] 已添加列 music_tracks.play_count（累计播放次数）');
            try {
                db.exec(`
                    UPDATE music_tracks SET play_count = COALESCE((
                        SELECT COUNT(*) FROM play_history h WHERE h.music_id = music_tracks.id
                    ), 0)
                    WHERE COALESCE(play_count, 0) = 0
                `);
                console.log('[DB] 已用 play_history 条数回填 play_count（历史下限）');
            } catch (backfillErr) {
                console.warn('[DB] play_count 回填:', backfillErr.message);
            }
        }
        if (!musicTrackColNames.has('voice_url')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN voice_url TEXT`);
            console.log('[DB] 已添加列 music_tracks.voice_url（用户人声音轨）');
        }
        if (!musicTrackColNames.has('reference_audio_url')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN reference_audio_url TEXT`);
            console.log('[DB] 已添加列 music_tracks.reference_audio_url（MiniMax 参考音乐）');
        }
        if (!musicTrackColNames.has('description')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN description TEXT`);
            console.log('[DB] 已添加列 music_tracks.description（曲库释义等）');
        }
    } catch (migrateErr) {
        console.warn('[DB] music_tracks 迁移 audio_duration_ms:', migrateErr.message);
    }

    try {
        const ccCols = db.prepare(`PRAGMA table_info(community_comments)`).all();
        const ccNames = new Set(ccCols.map((c) => c.name));
        if (!ccNames.has('parent_id')) {
            db.exec(`ALTER TABLE community_comments ADD COLUMN parent_id TEXT`);
            console.log('[DB] 已添加列 community_comments.parent_id（楼中楼）');
        }
        if (!ccNames.has('reply_to_user_id')) {
            db.exec(`ALTER TABLE community_comments ADD COLUMN reply_to_user_id TEXT`);
            console.log('[DB] 已添加列 community_comments.reply_to_user_id（被回复用户）');
        }
        if (!ccNames.has('likes')) {
            db.exec(`ALTER TABLE community_comments ADD COLUMN likes INTEGER DEFAULT 0`);
            console.log('[DB] 已添加列 community_comments.likes（评论点赞数）');
        }
    } catch (migrateCcErr) {
        console.warn('[DB] community_comments 楼中楼字段迁移:', migrateCcErr.message);
    }

    try {
        const ensureUserCol = (name, ddl) => {
            const cols = db.prepare(`PRAGMA table_info(users)`).all();
            if (!cols.some((c) => c.name === name)) {
                db.exec(ddl);
                console.log(`[DB] 已添加列 users.${name}`);
            }
        };
        ensureUserCol('shop_token', `ALTER TABLE users ADD COLUMN shop_token TEXT`);
        ensureUserCol('shop_sn', `ALTER TABLE users ADD COLUMN shop_sn TEXT`);
        ensureUserCol('wx_app_id', `ALTER TABLE users ADD COLUMN wx_app_id TEXT`);
    } catch (migrateShopErr) {
        console.warn('[DB] users 商城字段迁移:', migrateShopErr.message);
    }

    try {
        const cols = db.prepare(`PRAGMA table_info(card_shares)`).all();
        const names = new Set(cols.map((c) => c.name));
        if (!names.has('artist_bg_image')) {
            db.exec(`ALTER TABLE card_shares ADD COLUMN artist_bg_image TEXT`);
            console.log('[DB] 已添加列 card_shares.artist_bg_image（贺卡背景模板图）');
        }
        if (!names.has('template_id')) {
            db.exec(`ALTER TABLE card_shares ADD COLUMN template_id TEXT`);
            console.log('[DB] 已添加列 card_shares.template_id（官方贺卡模板 ID）');
        }
        if (!names.has('saved_to_library')) {
            db.exec(`ALTER TABLE card_shares ADD COLUMN saved_to_library INTEGER DEFAULT 0`);
            console.log('[DB] 已添加列 card_shares.saved_to_library（用户手动保存到作品库）');
        }
    } catch (migrateCardErr) {
        console.warn('[DB] card_shares 迁移 artist_bg_image:', migrateCardErr.message);
    }

    try {
        const tplCols = db.prepare(`PRAGMA table_info(card_templates)`).all();
        const tplNames = new Set(tplCols.map((c) => c.name));
        if (!tplNames.has('text_layout')) {
            db.exec(`ALTER TABLE card_templates ADD COLUMN text_layout TEXT`);
            console.log('[DB] 已添加列 card_templates.text_layout（贺卡文字区 JSON）');
        }
        if (!tplNames.has('chars_per_line')) {
            db.exec(`ALTER TABLE card_templates ADD COLUMN chars_per_line INTEGER`);
            console.log('[DB] 已添加列 card_templates.chars_per_line（祝福语每行字数）');
        }
    } catch (migrateTplLayoutErr) {
        console.warn('[DB] card_templates 迁移 text_layout:', migrateTplLayoutErr.message);
    }

    try {
        cardTemplates.syncCardTemplatesFromManifest(db);
    } catch (syncTplErr) {
        console.warn('[DB] 贺卡模板同步:', syncTplErr.message);
    }

    try {
        mediaSecStore.ensureMediaSecTable(db);
    } catch (mediaSecErr) {
        console.warn('[DB] media_sec_tasks:', mediaSecErr.message);
    }

    try {
        channelService.initChannelModule(db);
    } catch (channelErr) {
        console.warn('[DB] 渠道换皮表:', channelErr.message);
    }

    console.log('[DB] 数据库初始化完成');
}

// 初始化数据库
initDatabase();


// 健康检查
app.get('/health', (req, res) => {
    const now = new Date();
    sendSuccess(
        res,
        {
            status: 'ok',
            version: '2.0',
            timestamp: now.toISOString(),
            timestampCST: formatConsoleTimestampCn(now)
        },
        '服务运行正常'
    );
});

app.post('/api/music/create', authMiddleware, async (req, res) => {
    try {
        const {
            title,
            mainInstrument,
            frequency,
            duration,
            bpm,
            soundEffects,
            userPrompt,
            moodLabel,
            sceneLabels,
            voiceUrl,
            referenceAudioUrl
        } = req.body;
        const userId = req.user.id;

        // 参数校验
        if (!mainInstrument) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '乐器类型不能为空');
        }
        if (!frequency) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '脑波频率不能为空');
        }
        if (!bpm || isNaN(Number(bpm))) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'BPM参数无效');
        }

        const openid = req.user.wx_openid;
        if (
            await blockIfContentUnsafe(res, openid, [
                { content: title, scene: contentSecurity.SCENE.PROFILE, field: 'title' },
                { content: userPrompt, scene: contentSecurity.SCENE.SOCIAL, field: 'userPrompt' }
            ])
        ) {
            return;
        }

        const musicId = uuidv4();

        // 保存音乐基本信息
        try {
            const sourceChannel = channelService.resolveSourceChannel(db, req);
            const stmt = db.prepare(`INSERT INTO music_tracks (id, user_id, title, main_instrument, frequency, duration, bpm, source_channel)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(
                musicId,
                userId,
                title || '未命名作品',
                mainInstrument,
                frequency,
                duration || 180,
                bpm,
                sourceChannel
            );
        } catch (err) {
            logError('创建音乐-数据库插入', err, { musicId, userId });
            return sendError(res, convertDbError(err), err.message);
        }

        const voiceUrlRaw = voiceUrl != null ? String(voiceUrl).trim() : '';
        logInfo('创建音乐', '人声音轨', {
            musicId,
            hasVoiceTrack: !!voiceUrlRaw,
            voiceUrl: voiceUrlRaw || null
        });
        if (voiceUrlRaw) {
            try {
                db.prepare('UPDATE music_tracks SET voice_url = ? WHERE id = ?').run(
                    voiceUrlRaw,
                    musicId
                );
            } catch (err) {
                logWarn('保存人声音轨地址', err.message || '失败', { musicId });
            }
        }

        const referenceAudioUrlRaw =
            referenceAudioUrl != null ? String(referenceAudioUrl).trim() : '';
        if (referenceAudioUrlRaw) {
            try {
                const refProbeTarget = resolveReferenceAudioProbeTarget(referenceAudioUrlRaw);
                if (!refProbeTarget) {
                    return sendError(
                        res,
                        ErrorCode.INVALID_PARAMS,
                        '参考音乐地址无效或曲库/上传文件不存在（须 6 秒～6 分钟可访问音频）'
                    );
                }
                const refDur = await probeAudioDurationSec(refProbeTarget);
                assertReferenceAudioDurationSec(refDur);
                db.prepare('UPDATE music_tracks SET reference_audio_url = ? WHERE id = ?').run(
                    referenceAudioUrlRaw,
                    musicId
                );
                logInfo('创建音乐', '参考音乐', {
                    musicId,
                    referenceAudioUrl: referenceAudioUrlRaw,
                    durationSec: refDur
                });
            } catch (err) {
                const msg = err && err.message ? err.message : '参考音乐校验失败';
                return sendError(res, ErrorCode.INVALID_PARAMS, msg);
            }
        }

        // 保存白噪音时间轴
        if (soundEffects && soundEffects.length > 0) {
            const insertEffect = db.prepare(`
                INSERT INTO sound_effects (id, music_id, effect_type, start_time, end_time, volume)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            soundEffects.forEach((effect) => {
                try {
                    insertEffect.run(
                        uuidv4(),
                        musicId,
                        effect.type,
                        effect.startTime,
                        effect.endTime,
                        effect.volume || 0.5
                    );
                } catch (err) {
                    logWarn('插入白噪音失败', err.message, { musicId, effect });
                }
            });
        }

        // 异步生成音频
        generateMusicAudio(musicId, mainInstrument, frequency, duration, bpm, soundEffects, {
            userPrompt,
            moodLabel,
            sceneLabels,
            voiceUrl: voiceUrlRaw,
            hasVoiceTrack: !!voiceUrlRaw,
            referenceAudioUrl: referenceAudioUrlRaw
        });

        sendSuccess(res, {
            musicId,
            status: 'generating',
            estimatedTime: 30
        }, '音乐创建成功，正在生成中');
    } catch (error) {
        logError('创建音乐', error, req.body);
        sendError(res, ErrorCode.MUSIC_CREATE_FAILED, error.message);
    }
});

app.get('/api/music/:musicId/status', async (req, res) => {
    const { musicId } = req.params;

    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }

    try {
        const stmt = db.prepare('SELECT * FROM music_tracks WHERE id = ?');
        const track = stmt.get(musicId);

        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }

        const effectsStmt = db.prepare('SELECT * FROM sound_effects WHERE music_id = ? ORDER BY start_time');
        const effects = effectsStmt.all(musicId);

        const playerCover = sanitizePlayerCoverUrlForClient(track.player_cover_url);
        const base = { ...track, player_cover_url: playerCover || null };
        const enriched = await musicAudioStore.enrichTrackAudio(uploadDir, base);
        if (enriched.audio_url && enriched.audio_url !== track.audio_url) {
            try {
                db.prepare('UPDATE music_tracks SET audio_url = ? WHERE id = ?').run(
                    enriched.audio_url,
                    musicId
                );
            } catch (dbErr) {
                logWarn('更新作品本地音频地址', dbErr.message || '失败', { musicId });
            }
        }
        sendSuccess(res, {
            ...enriched,
            soundEffects: effects
        });
    } catch (err) {
        logError('查询音乐状态', err, { musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/music/user/:userId', async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '用户ID不能为空');
    }

    try {
        // userId 是 wx_openid，需要先查询对应的 users.id
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(userId);
        if (!user) {
            return sendSuccess(res, []);
        }

        // 与小程序「我的作品」一致：只列出已生成完成且有音频的成片（不含失败/进行中记录）
        const stmt = db.prepare(`SELECT id, title, main_instrument, frequency, bpm, duration, audio_url, audio_duration_ms, player_cover_url, status, created_at,
            COALESCE(play_count, 0) AS play_count
         FROM music_tracks
         WHERE user_id = ?
           AND status = 'completed'
           AND audio_url IS NOT NULL
           AND TRIM(audio_url) != ''
         ORDER BY created_at DESC
         LIMIT 50`);
        const rows = stmt.all(user.id);
        const tracks = await Promise.all(
            rows.map(async (row) => {
                const base = {
                    ...row,
                    player_cover_url: sanitizePlayerCoverUrlForClient(row.player_cover_url) || null
                };
                const enriched = await musicAudioStore.enrichTrackAudio(uploadDir, base);
                if (enriched.audio_url && enriched.audio_url !== row.audio_url) {
                    try {
                        db.prepare('UPDATE music_tracks SET audio_url = ? WHERE id = ?').run(
                            enriched.audio_url,
                            row.id
                        );
                    } catch (dbErr) {
                        logWarn('更新作品本地音频地址', dbErr.message || '失败', {
                            musicId: row.id
                        });
                    }
                }
                return enriched;
            })
        );

        sendSuccess(res, tracks);
    } catch (err) {
        logError('获取用户作品列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.delete('/api/music/:musicId', authMiddleware, (req, res) => {
    const { musicId } = req.params;
    const userId = req.user.id;

    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }

    try {
        const track = db.prepare('SELECT id, user_id FROM music_tracks WHERE id = ?').get(musicId);
        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }
        if (track.user_id !== userId) {
            return sendError(res, ErrorCode.FORBIDDEN);
        }

        const delTx = db.transaction(() => {
            db.prepare('DELETE FROM sound_effects WHERE music_id = ?').run(musicId);
            db.prepare('UPDATE community_posts SET music_id = NULL WHERE music_id = ?').run(musicId);
            db.prepare('DELETE FROM greeting_cards WHERE music_id = ?').run(musicId);
            db.prepare('DELETE FROM card_shares WHERE music_id = ?').run(musicId);
            db.prepare('DELETE FROM music_tracks WHERE id = ?').run(musicId);
        });
        delTx();

        sendSuccess(res, { deleted: true }, '已删除');
    } catch (err) {
        logError('删除音乐作品', err, { musicId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 修改作品名称 */
app.put('/api/music/:musicId/title', authMiddleware, async (req, res) => {
    const { musicId } = req.params;
    const userId = req.user.id;
    const titleRaw = req.body && req.body.title != null ? String(req.body.title).trim() : '';

    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }
    if (!titleRaw) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '作品名称不能为空');
    }
    if (titleRaw.length > 48) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '作品名称不能超过 48 个字符');
    }

    if (
        await blockIfContentUnsafe(res, req.user.wx_openid, [
            { content: titleRaw, scene: contentSecurity.SCENE.PROFILE, field: 'title' }
        ])
    ) {
        return;
    }

    try {
        const track = db.prepare('SELECT id, user_id FROM music_tracks WHERE id = ?').get(musicId);
        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }
        if (track.user_id !== userId) {
            return sendError(res, ErrorCode.FORBIDDEN);
        }

        db.prepare('UPDATE music_tracks SET title = ? WHERE id = ?').run(titleRaw, musicId);
        logInfo('作品名称', '已更新', { musicId, userId, title: titleRaw });
        sendSuccess(res, { title: titleRaw }, '名称已保存');
    } catch (err) {
        logError('更新作品名称', err, { musicId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 作品播放器封面（仅播放器 / mini 条，不写入贺卡） */
app.put('/api/music/:musicId/player-cover', authMiddleware, async (req, res) => {
    const { musicId } = req.params;
    const userId = req.user.id;
    const coverUrlRaw = req.body && req.body.coverUrl != null ? String(req.body.coverUrl).trim() : '';

    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }

    let coverUrl = '';
    if (coverUrlRaw) {
        if (!/^https?:\/\//i.test(coverUrlRaw)) {
            return sendError(res, ErrorCode.INVALID_PARAMS, '封面须为 http(s) 地址');
        }
        const lowerRaw = coverUrlRaw.toLowerCase();
        if (
            lowerRaw.includes('/__tmp__/') ||
            lowerRaw.startsWith('wxfile://') ||
            (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(coverUrlRaw) &&
                !isOurHostedUploadUrl(coverUrlRaw))
        ) {
            return sendError(
                res,
                ErrorCode.INVALID_PARAMS,
                '封面须先上传到本服务，不能使用本地临时路径'
            );
        }
        if (!isOurHostedUploadUrl(coverUrlRaw)) {
            return sendError(
                res,
                ErrorCode.INVALID_PARAMS,
                '封面须为本服务上传的图片（/api/music/cover?f= 或 /uploads/）'
            );
        }
        coverUrl = migrateLegacyCoverUrlToMusicCover(normalizePublicCoverUrl(coverUrlRaw));
        if (await blockIfHostedImageUnsafe(res, coverUrl, req, 'coverUrl')) {
            return;
        }
    }

    try {
        const track = db.prepare('SELECT id, user_id FROM music_tracks WHERE id = ?').get(musicId);
        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }
        if (track.user_id !== userId) {
            return sendError(res, ErrorCode.FORBIDDEN);
        }

        db.prepare('UPDATE music_tracks SET player_cover_url = ? WHERE id = ?').run(
            coverUrl || null,
            musicId
        );

        logInfo('作品播放器封面', '已更新', { musicId, userId, hasCover: !!coverUrl });
        sendSuccess(res, { player_cover_url: coverUrl || null }, '封面已保存');
    } catch (err) {
        logError('更新作品播放器封面', err, { musicId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/music/library', (req, res) => {
    const { category, page = 1, limit = 50 } = req.query;

    try {
        const apiBase = getApiBaseUrl(req);
        let sql = `SELECT id, title, description, main_instrument as instrument, frequency, bpm, duration,
            audio_duration_ms, audio_url, player_cover_url, COALESCE(play_count, 0) AS play_count, created_at
         FROM music_tracks
         WHERE user_id = 'system' AND status = 'completed'`;
        const params = [];

        // 按分类关键词过滤
        if (category && category !== '全部') {
            sql += ` AND (
                title LIKE ? OR
                description LIKE ? OR
                main_instrument LIKE ? OR
                frequency LIKE ?
            )`;
            const like = `%${category}%`;
            params.push(like, like, like, like);
        }

        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(Number(limit), (Number(page) - 1) * Number(limit));

        const stmt = db.prepare(sql);
        const tracks = stmt.all(...params);

        // 统计总数
        const countSql = `SELECT COUNT(*) as total FROM music_tracks WHERE user_id = 'system' AND status = 'completed'`;
        const countRow = db.prepare(countSql).get();

        sendSuccess(res, {
            list: tracks.map(t => {
                const ms = t.audio_duration_ms;
                let durationSec = 0;
                if (ms != null && Number(ms) > 0) {
                    durationSec = Math.max(1, Math.ceil(Number(ms) / 1000));
                } else if (t.duration != null && Number(t.duration) > 0) {
                    durationSec = Math.floor(Number(t.duration));
                }
                const coverRel = resolveLibraryCoverRel(t.player_cover_url, t.audio_url);
                const coverUrl = toAbsoluteCoverUrl(coverRel, apiBase);
                return {
                    ...t,
                    duration: durationSec,
                    audioUrl: normalizeLibraryAudioUrl(t.audio_url),
                    description: t.description || '',
                    coverUrl,
                    plays: Math.max(0, Math.floor(Number(t.play_count) || 0))
                };
            }),
            total: countRow.total
        });
    } catch (err) {
        logError('获取曲库列表', err);
        sendError(res, convertDbError(err), err.message);
    }
});

/** 官方曲库播放计数（无需登录；仅 system 曲库 id） */
app.post('/api/music/library/play', (req, res) => {
    const mid = String((req.body && req.body.musicId) || '').trim();
    if (!mid) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'musicId不能为空');
    }
    try {
        const row = db.prepare(
            `SELECT id, COALESCE(play_count, 0) AS play_count FROM music_tracks
             WHERE id = ? AND user_id = 'system' AND status = 'completed'`
        ).get(mid);
        if (!row) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND, '曲库曲目不存在');
        }
        incrementMusicPlayCount(mid);
        const updated = db.prepare(
            `SELECT COALESCE(play_count, 0) AS play_count FROM music_tracks WHERE id = ?`
        ).get(mid);
        sendSuccess(res, {
            musicId: mid,
            plays: Math.max(0, Math.floor(Number(updated && updated.play_count) || 0))
        });
    } catch (err) {
        logError('曲库播放计数', err, { musicId: mid });
        sendError(res, convertDbError(err), err.message);
    }
});

app.post('/api/card/create', async (req, res) => {
    const {
        musicId,
        senderId,
        recipientName,
        message,
        templateStyle
    } = req.body;

    // 参数校验
    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }
    if (!recipientName || recipientName.trim().length === 0) {
        return sendError(res, ErrorCode.RECIPIENT_EMPTY);
    }

    if (
        await blockIfContentUnsafe(res, null, [
            { content: recipientName, scene: contentSecurity.SCENE.SOCIAL, field: 'recipientName' },
            { content: message, scene: contentSecurity.SCENE.SOCIAL, field: 'message' }
        ])
    ) {
        return;
    }

    const cardId = uuidv4();
    const shareUrl = `${req.protocol}://${req.get('host')}/card/${cardId}`;

    try {
        const stmt = db.prepare(`INSERT INTO greeting_cards (id, music_id, sender_id, recipient_name, message, template_style, share_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(cardId, musicId, senderId || null, recipientName, message || '', templateStyle || 'default', shareUrl);

        sendSuccess(res, {
            cardId,
            shareUrl
        }, '贺卡创建成功');
    } catch (err) {
        logError('创建贺卡', err, { musicId, senderId });
        sendError(res, ErrorCode.CARD_CREATE_FAILED, err.message);
    }
});

app.get('/api/card/template-categories', (req, res) => {
    try {
        sendSuccess(res, cardTemplates.listCategories(db));
    } catch (err) {
        logError('获取贺卡分类', err);
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/card/templates', (req, res) => {
    const { category, page, limit } = req.query;
    try {
        const data = cardTemplates.listTemplates(db, { category, page, limit });
        sendSuccess(res, data);
    } catch (err) {
        logError('获取贺卡模板列表', err, { category });
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/card/templates/:templateId', (req, res) => {
    const { templateId } = req.params;
    if (!templateId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '模板ID不能为空');
    }
    try {
        const tpl = cardTemplates.getTemplateById(db, templateId);
        if (!tpl) {
            return sendError(res, ErrorCode.CARD_TEMPLATE_INVALID);
        }
        sendSuccess(res, tpl);
    } catch (err) {
        logError('获取贺卡模板详情', err, { templateId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.post('/api/card/templates/sync', (req, res) => {
    const secret = process.env.CARD_TEMPLATE_SYNC_SECRET;
    if (secret && req.headers['x-sync-secret'] !== secret) {
        return sendError(res, ErrorCode.FORBIDDEN, '同步密钥无效');
    }
    try {
        const result = cardTemplates.syncCardTemplatesFromManifest(db);
        sendSuccess(res, result, '贺卡模板已同步');
    } catch (err) {
        logError('同步贺卡模板', err);
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/card/:cardId', (req, res) => {
    const { cardId } = req.params;

    if (!cardId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '贺卡ID不能为空');
    }

    try {
        const stmt = db.prepare(`SELECT c.*, m.title as music_title, m.audio_url, m.main_instrument, m.frequency
         FROM greeting_cards c
         JOIN music_tracks m ON c.music_id = m.id
         WHERE c.id = ?`);
        const card = stmt.get(cardId);

        if (!card) {
            return sendError(res, ErrorCode.CARD_NOT_FOUND);
        }

        sendSuccess(res, card);
    } catch (err) {
        logError('获取贺卡详情', err, { cardId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.post('/api/card/share', authMiddleware, async (req, res) => {
    const {
        musicId,
        recipient,
        message,
        template,
        templateId,
        musicInstrument,
        musicFrequency,
        musicBpm,
        coverImage,
        audioUrl,
        artistBgImage,
        savedToLibrary
    } = req.body;
    const senderId = req.user.id;
    const savedToLib = savedToLibrary === true || savedToLibrary === 1 || savedToLibrary === '1' ? 1 : 0;

    logInfo('贺卡分享', 'POST 创建请求', {
        senderId,
        musicId: musicId || '',
        templateId: templateId || '',
        recipient: recipient ? String(recipient).slice(0, 20) : '',
        hasCover: !!(coverImage && String(coverImage).trim()),
        hasAudio: !!(audioUrl && String(audioUrl).trim())
    });

    // 参数校验
    if (!musicId) {
        logWarn('贺卡分享', '创建失败：缺少 musicId', { senderId });
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }
    if (!recipient || recipient.trim().length === 0) {
        logWarn('贺卡分享', '创建失败：收件人为空', { senderId, musicId });
        return sendError(res, ErrorCode.RECIPIENT_EMPTY);
    }

    if (
        await blockIfContentUnsafe(res, req.user.wx_openid, [
            { content: recipient, scene: contentSecurity.SCENE.SOCIAL, field: 'recipient' },
            { content: message, scene: contentSecurity.SCENE.SOCIAL, field: 'message' }
        ])
    ) {
        logWarn('贺卡分享', '创建失败：内容安全未通过', { senderId, musicId });
        return;
    }

    const coverRaw = coverImage != null ? String(coverImage).trim() : '';
    if (coverRaw && (await blockIfHostedImageUnsafe(res, coverRaw, req, 'coverImage'))) {
        logWarn('贺卡分享', '创建失败：封面图安全未通过', { senderId, musicId });
        return;
    }

    const resolved = cardTemplates.resolveTemplateForShare(db, {
        templateId,
        template,
        artistBgImage
    });
    if (resolved.error === 'INVALID_TEMPLATE') {
        logWarn('贺卡分享', '创建失败：模板无效', {
            senderId,
            musicId,
            templateId: templateId || '',
            template
        });
        return sendError(res, ErrorCode.CARD_TEMPLATE_INVALID);
    }

    const shareId = uuidv4();
    const sourceChannel = channelService.resolveSourceChannel(db, req);

    try {
        const stmt = db.prepare(`INSERT INTO card_shares (id, music_id, sender_id, recipient, message, template, template_id, music_instrument, music_frequency, music_bpm, cover_image, audio_url, artist_bg_image, saved_to_library, source_channel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(
            shareId,
            musicId,
            senderId,
            recipient,
            message || '',
            resolved.template,
            resolved.templateId,
            musicInstrument || '',
            musicFrequency || '',
            musicBpm || 60,
            coverImage || '',
            audioUrl || '',
            resolved.artistBgImage,
            savedToLib,
            sourceChannel
        );

        if (audioUrl && String(audioUrl).trim()) {
            scheduleAudioMediaCheck(req.user.wx_openid, audioUrl, 'card_share', shareId);
        }

        logInfo('贺卡分享', 'POST 创建成功', {
            shareId,
            senderId,
            musicId,
            templateId: resolved.templateId || ''
        });
        sendSuccess(res, { shareId, templateId: resolved.templateId }, '分享创建成功');
    } catch (err) {
        logError('创建贺卡分享', err, { musicId, senderId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/card/shares/mine', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    try {
        const rows = db
            .prepare(
                `SELECT id, music_id, recipient, message, template, template_id,
                        music_instrument, music_frequency, music_bpm,
                        cover_image, audio_url, artist_bg_image, created_at
                 FROM card_shares
                 WHERE sender_id = ? AND COALESCE(saved_to_library, 0) = 1
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?`
            )
            .all(userId, limitNum);

        const list = rows.map((r) => ({
            shareId: r.id,
            musicId: r.music_id,
            recipient: r.recipient,
            message: r.message,
            template: r.template,
            templateId: r.template_id || '',
            musicInstrument: r.music_instrument,
            musicFrequency: r.music_frequency,
            musicBpm: r.music_bpm,
            coverImage: r.cover_image,
            audioUrl: r.audio_url,
            artistBgImage: r.artist_bg_image || '',
            createdAt: r.created_at
        }));

        sendSuccess(res, list);
    } catch (err) {
        logError('获取我的贺卡列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/card/share/:shareId', (req, res) => {
    const { shareId } = req.params;

    if (!shareId) {
        logWarn('贺卡分享', 'GET 失败：shareId 为空');
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '分享ID不能为空');
    }

    logInfo('贺卡分享', 'GET 详情请求', { shareId });

    try {
        const stmt = db.prepare('SELECT * FROM card_shares WHERE id = ?');
        const share = stmt.get(shareId);

        if (!share) {
            logWarn('贺卡分享', 'GET 未找到', { shareId });
            return sendError(res, ErrorCode.SHARE_NOT_FOUND);
        }

        let templateCategoryId = ''
        let textLayout = null
        let charsPerLine = null
        if (share.template_id) {
            const tpl = cardTemplates.getTemplateById(db, share.template_id);
            if (tpl) {
                templateCategoryId = tpl.categoryId || ''
                textLayout = tpl.textLayout || null
                charsPerLine = tpl.charsPerLine != null ? tpl.charsPerLine : null
            }
        }

        let workTitle = ''
        let musicCoverUrl = ''
        if (share.music_id) {
            try {
                const track = db
                    .prepare(
                        `SELECT title, player_cover_url, audio_url, audio_duration_ms, duration,
                                main_instrument, frequency, bpm
                         FROM music_tracks WHERE id = ?`
                    )
                    .get(share.music_id)
                if (track) {
                    workTitle = track.title || ''
                    musicCoverUrl =
                        sanitizePlayerCoverUrlForClient(track.player_cover_url) || ''
                    if (!share.audio_url && track.audio_url) {
                        share.audio_url = track.audio_url
                    }
                }
            } catch (trackErr) {
                logWarn('获取分享贺卡关联曲目', trackErr, { shareId, musicId: share.music_id })
            }
        }

        logInfo('贺卡分享', 'GET 成功', {
            shareId,
            musicId: share.music_id,
            senderId: share.sender_id,
            recipient: share.recipient ? String(share.recipient).slice(0, 20) : '',
            workTitle: workTitle || '',
            hasMusicCover: !!musicCoverUrl
        });
        sendSuccess(res, {
            shareId: share.id,
            musicId: share.music_id,
            senderId: share.sender_id,
            recipient: share.recipient,
            message: share.message,
            template: share.template,
            templateId: share.template_id || '',
            templateCategoryId,
            textLayout,
            charsPerLine,
            workTitle,
            musicCoverUrl,
            musicInfo: {
                instrument: share.music_instrument,
                frequency: share.music_frequency,
                bpm: share.music_bpm
            },
            coverImage: share.cover_image,
            audioUrl: share.audio_url,
            artistBgImage: share.artist_bg_image || '',
            createdAt: share.created_at
        });
    } catch (err) {
        logError('获取贺卡分享详情', err, { shareId });
        sendError(res, convertDbError(err), err.message);
    }
});


app.post('/api/community/post', authMiddleware, async (req, res) => {
    const { title, content, images, topic, musicId } = req.body;
    const userId = req.user.id;

    // 参数校验
    if (!content || content.trim().length === 0) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '帖子内容不能为空'));
    }
    if (content.length > 2000) {
        return res.status(400).json(errorResponse(ErrorCode.INVALID_FORMAT, '帖子内容不能超过2000字'));
    }

    const safeImages = sanitizeCommunityImagesForClient(images);
    if (await blockIfContentUnsafe(res, req.user.wx_openid, [
        { content: title, scene: contentSecurity.SCENE.FORUM, field: 'title' },
        { content: content, scene: contentSecurity.SCENE.FORUM, field: 'content' },
        { content: topic, scene: contentSecurity.SCENE.FORUM, field: 'topic' }
    ])) {
        return;
    }
    if (safeImages.length && (await blockIfImagesUnsafe(res, safeImages, req))) {
        return;
    }

    const postId = uuidv4();
    const imagesJson = safeImages.length ? JSON.stringify(safeImages) : null;

    try {
        const stmt = db.prepare(`INSERT INTO community_posts (id, user_id, title, content, images, topic, music_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`);
        stmt.run(postId, userId, title || '', content, imagesJson, topic || '', musicId || null);

        logInfo('盒友圈发帖', '发布成功', {
            postId,
            userId,
            nickname: req.user.nickname || '',
            topic: topic || '',
            title: (title || '').slice(0, 40),
            contentPreview: content.slice(0, 80),
            contentLength: content.length,
            imageCount: safeImages.length,
            musicId: musicId || null
        });

        res.json(successResponse({ postId }, '发布成功'));
    } catch (err) {
        logError('发布帖子', err, { userId, title, topic });
        res.status(500).json(errorResponse(ErrorCode.POST_CREATE_FAILED, err.message));
    }
});

function withCommunityAuthorAvatar(row) {
    if (!row || typeof row !== 'object') return row;
    return {
        ...row,
        avatar: shopApi.formatUserAvatarForClient(row.avatar)
    };
}

function formatCommunityPostRow(post) {
    if (!post || typeof post !== 'object') return post;
    let images = [];
    if (post.images) {
        try {
            images = typeof post.images === 'string' ? JSON.parse(post.images) : post.images;
        } catch (_) {
            images = [];
        }
    }
    const liveComments =
        post.live_comments != null ? Number(post.live_comments) : null;
    const liveLikes = post.live_likes != null ? Number(post.live_likes) : null;
    return withCommunityAuthorAvatar({
        ...post,
        comments: liveComments != null && !Number.isNaN(liveComments) ? liveComments : post.comments || 0,
        likes: liveLikes != null && !Number.isNaN(liveLikes) ? liveLikes : post.likes || 0,
        images: sanitizeCommunityImagesForClient(images),
        music_cover_url: sanitizePlayerCoverUrlForClient(post.music_cover_url) || null
    });
}

function findUserByOpenid(openid) {
    const oid = openid != null ? String(openid).trim() : '';
    if (!oid) return null;
    return db.prepare('SELECT id, wx_openid, nickname, avatar_url FROM users WHERE wx_openid = ?').get(oid);
}

const LEGACY_REPLY_PREFIX_RE = /^回复\s*@([^：:]+)[：:]\s*/;

function stripLegacyReplyPrefix(content) {
    if (!content || typeof content !== 'string') return '';
    return content.replace(LEGACY_REPLY_PREFIX_RE, '');
}

function resolveCommentRootId(commentId, byId) {
    let id = commentId;
    const seen = new Set();
    while (id && !seen.has(id)) {
        seen.add(id);
        const row = byId.get(id);
        if (!row || !row.parent_id) return id;
        id = row.parent_id;
    }
    return commentId;
}

function loadReplyToUserMap(userIds) {
    const map = new Map();
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return map;
    const placeholders = ids.map(() => '?').join(',');
    const users = db
        .prepare(`SELECT id, wx_openid, nickname FROM users WHERE id IN (${placeholders})`)
        .all(...ids);
    users.forEach((u) => map.set(u.id, u));
    return map;
}

function formatCommunityCommentRow(row, replyToMap, likeMeta) {
    const base = withCommunityAuthorAvatar(row);
    const replyTo = row.reply_to_user_id ? replyToMap.get(row.reply_to_user_id) : null;
    const meta = likeMeta && likeMeta.get(row.id);
    return {
        id: base.id,
        post_id: base.post_id,
        user_id: base.user_id,
        content: stripLegacyReplyPrefix(base.content),
        created_at: base.created_at,
        name: base.name,
        avatar: base.avatar,
        openid: base.openid,
        parent_id: base.parent_id || null,
        reply_to_openid: replyTo ? replyTo.wx_openid : null,
        reply_to_name: replyTo ? replyTo.nickname || '盒友' : null,
        likes: meta ? meta.likes : Math.max(0, Number(row.likes) || 0),
        isLiked: !!(meta && meta.isLiked)
    };
}

function loadCommentLikeMeta(commentIds, viewerUserId) {
    const map = new Map();
    const ids = [...new Set((commentIds || []).filter(Boolean))];
    ids.forEach((id) => map.set(id, { likes: 0, isLiked: false }));
    if (!ids.length) return map;

    const placeholders = ids.map(() => '?').join(',');
    const countRows = db
        .prepare(
            `SELECT comment_id, COUNT(*) AS c FROM community_comment_likes WHERE comment_id IN (${placeholders}) GROUP BY comment_id`
        )
        .all(...ids);
    countRows.forEach((r) => {
        const prev = map.get(r.comment_id) || { likes: 0, isLiked: false };
        map.set(r.comment_id, { ...prev, likes: r.c });
    });

    const rows = db
        .prepare(`SELECT id, COALESCE(likes, 0) AS likes FROM community_comments WHERE id IN (${placeholders})`)
        .all(...ids);
    rows.forEach((r) => {
        const prev = map.get(r.id) || { likes: 0, isLiked: false };
        const stored = Math.max(0, Number(r.likes) || 0);
        map.set(r.id, {
            ...prev,
            likes: Math.max(prev.likes, stored)
        });
    });

    if (viewerUserId) {
        const likedRows = db
            .prepare(
                `SELECT comment_id FROM community_comment_likes WHERE user_id = ? AND comment_id IN (${placeholders})`
            )
            .all(viewerUserId, ...ids);
        likedRows.forEach((r) => {
            const prev = map.get(r.comment_id) || { likes: 0, isLiked: false };
            map.set(r.comment_id, { ...prev, isLiked: true });
        });
    }
    return map;
}

/** 评论排序：点赞数降序，相同则按发表时间升序 */
function sortCommentsByLikes(comments) {
    return [...(comments || [])].sort((a, b) => {
        const la = Math.max(0, Number(a.likes) || 0);
        const lb = Math.max(0, Number(b.likes) || 0);
        if (lb !== la) return lb - la;
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
}

function buildCommunityCommentTree(rows, viewerUserId) {
    if (!rows || !rows.length) return [];
    const replyToMap = loadReplyToUserMap(rows.map((r) => r.reply_to_user_id));
    const likeMeta = loadCommentLikeMeta(
        rows.map((r) => r.id),
        viewerUserId
    );
    const byId = new Map();
    for (const row of rows) {
        const c = formatCommunityCommentRow(row, replyToMap, likeMeta);
        byId.set(c.id, { ...c, replies: [] });
    }
    const roots = [];
    for (const c of byId.values()) {
        if (!c.parent_id) {
            roots.push(c);
            continue;
        }
        const rootId = resolveCommentRootId(c.parent_id, byId);
        const root = byId.get(rootId);
        if (root && root.id !== c.id) root.replies.push(c);
        else roots.push(c);
    }
    const sortedRoots = sortCommentsByLikes(roots);
    sortedRoots.forEach((r) => {
        r.replies = sortCommentsByLikes(r.replies);
    });
    return sortedRoots;
}

function deleteCommentLikesByIds(commentIds) {
    const ids = [...new Set((commentIds || []).filter(Boolean))];
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM community_comment_likes WHERE comment_id IN (${placeholders})`).run(...ids);
}

function countCommentDescendants(commentId) {
    const ids = [commentId];
    let queue = [commentId];
    while (queue.length) {
        const pid = queue.shift();
        const children = db.prepare('SELECT id FROM community_comments WHERE parent_id = ?').all(pid);
        for (const ch of children) {
            ids.push(ch.id);
            queue.push(ch.id);
        }
    }
    return ids;
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

/** 帖子列表用实时统计（避免 community_posts.comments/likes 与真实数据不一致） */
const COMMUNITY_POST_LIVE_COMMENTS_SQL = `(SELECT COUNT(*) FROM community_comments cc WHERE cc.post_id = p.id)`;
const COMMUNITY_POST_LIVE_LIKES_SQL = `(SELECT COUNT(*) FROM community_likes cl WHERE cl.post_id = p.id)`;

function resolveCommunityPostsOrderBy(feedType, sort) {
    const sortType = String(sort || '').toLowerCase();
    if (sortType === 'time' || sortType === 'latest') {
        return 'p.created_at DESC';
    }
    if (sortType === 'comments') {
        return `live_comments DESC, live_likes DESC, p.created_at DESC`;
    }
    if (sortType === 'likes') {
        return `live_likes DESC, live_comments DESC, p.created_at DESC`;
    }
    if (feedType === 'latest' || feedType === 'following') {
        return 'p.created_at DESC';
    }
    return `live_likes DESC, live_comments DESC, p.created_at DESC`;
}

app.get('/api/community/posts', optionalAuthMiddleware, (req, res) => {
    const { page = 1, limit = 20, topic, feed = 'recommend', sort } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const feedType = String(feed || 'recommend').toLowerCase();

    if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json(errorResponse(ErrorCode.INVALID_PARAMS, 'page参数必须是大于0的数字'));
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return res.status(400).json(errorResponse(ErrorCode.INVALID_PARAMS, 'limit参数必须在1-100之间'));
    }

    const offset = (pageNum - 1) * limitNum;

    try {
        if (feedType === 'following' && !req.user) {
            return res.json(successResponse([]));
        }

        let query = `SELECT p.*,
            ${COMMUNITY_POST_LIVE_COMMENTS_SQL} AS live_comments,
            ${COMMUNITY_POST_LIVE_LIKES_SQL} AS live_likes,
            u.nickname as author, u.avatar_url as avatar, u.wx_openid as openid,
            m.title as music_title, m.audio_url as music_audio_url,
            m.audio_duration_ms as music_audio_duration_ms, m.duration as music_duration_sec,
            m.player_cover_url as music_cover_url, m.main_instrument as music_instrument
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         LEFT JOIN music_tracks m ON p.music_id = m.id`;
        const params = [];
        const where = [];

        if (topic && topic !== 'undefined' && topic !== '') {
            where.push('p.topic = ?');
            params.push(topic);
        }

        if (feedType === 'following') {
            where.push(
                'p.user_id IN (SELECT following_id FROM user_follows WHERE follower_id = ?)'
            );
            params.push(req.user.id);
        }

        if (where.length) {
            query += ` WHERE ${where.join(' AND ')}`;
        }

        query += ` ORDER BY ${resolveCommunityPostsOrderBy(feedType, sort)}`;
        query += ` LIMIT ? OFFSET ?`;
        params.push(limitNum, offset);

        const posts = db.prepare(query).all(...params);

        const formattedPosts = posts.map(formatCommunityPostRow);

        res.json(successResponse(formattedPosts));
    } catch (err) {
        logError('获取社群帖子列表', err, { page, limit, topic, feed });
        res.status(500).json(errorResponse(ErrorCode.DB_QUERY_ERROR, err.message));
    }
});

app.get('/api/community/post/:id', (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空'));
    }

    try {
        const stmt = db.prepare(`SELECT p.*, u.nickname as author, u.avatar_url as avatar, u.wx_openid as openid
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.id = ?`);
        const post = stmt.get(id);

        if (!post) {
            return res.status(404).json(errorResponse(ErrorCode.POST_NOT_FOUND));
        }

        res.json(successResponse(formatCommunityPostRow(post)));
    } catch (err) {
        logError('获取帖子详情', err, { postId: id });
        res.status(500).json(errorResponse(ErrorCode.DB_QUERY_ERROR, err.message));
    }
});

app.post('/api/community/post/:id/like', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空'));
    }

    // 检查帖子是否存在
    const postStmt = db.prepare('SELECT id FROM community_posts WHERE id = ?');
    const post = postStmt.get(id);
    if (!post) {
        return res.status(404).json(errorResponse(ErrorCode.POST_NOT_FOUND));
    }

    try {
        // 检查是否已点赞
        const checkStmt = db.prepare('SELECT * FROM community_likes WHERE post_id = ? AND user_id = ?');
        const existing = checkStmt.get(id, userId);

        if (existing) {
            // 取消点赞
            const deleteStmt = db.prepare('DELETE FROM community_likes WHERE post_id = ? AND user_id = ?');
            deleteStmt.run(id, userId);

            const updateStmt = db.prepare('UPDATE community_posts SET likes = likes - 1 WHERE id = ?');
            updateStmt.run(id);

            res.json(successResponse({ liked: false }, '取消点赞成功'));
        } else {
            // 点赞
            const insertStmt = db.prepare('INSERT INTO community_likes (post_id, user_id) VALUES (?, ?)');
            insertStmt.run(id, userId);

            const updateStmt = db.prepare('UPDATE community_posts SET likes = likes + 1 WHERE id = ?');
            updateStmt.run(id);

            // 发送点赞通知给帖主
            try {
                const post = db.prepare('SELECT user_id, content FROM community_posts WHERE id = ?').get(id);
                if (post && post.user_id !== userId) {
                    const notifId = uuidv4();
                    const title = post.content ? post.content.substring(0, 20) + '...' : '你的帖子';
                    db.prepare(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
                        VALUES (?, ?, ?, ?, ?, ?)`)
                        .run(notifId, post.user_id, 'like', title, '有人赞了你的帖子', id);
                }
            } catch (e) {
                logWarn('发送点赞通知失败', e.message);
            }

            res.json(successResponse({ liked: true }, '点赞成功'));
        }
    } catch (err) {
        logError('点赞操作', err, { postId: id, userId });
        res.status(500).json(errorResponse(ErrorCode.LIKE_FAILED, err.message));
    }
});

app.post('/api/community/post/:id/comment', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { content, replyToOpenid, parentId } = req.body;
    const userId = req.user.id;

    if (!id) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空'));
    }
    const text = content != null ? String(content).trim() : '';
    if (!text) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '评论内容不能为空'));
    }
    if (text.length > 500) {
        return res.status(400).json(errorResponse(ErrorCode.INVALID_FORMAT, '评论内容不能超过500字'));
    }

    if (
        await blockIfContentUnsafe(res, req.user.wx_openid, [
            { content: text, scene: contentSecurity.SCENE.COMMENT, field: 'content' }
        ])
    ) {
        return;
    }

    const postStmt = db.prepare('SELECT id FROM community_posts WHERE id = ?');
    const post = postStmt.get(id);
    if (!post) {
        return res.status(404).json(errorResponse(ErrorCode.POST_NOT_FOUND));
    }

    let parent_id = null;
    let reply_to_user_id = null;
    const parentIdTrim = parentId != null ? String(parentId).trim() : '';
    if (parentIdTrim) {
        const parent = db
            .prepare('SELECT id, post_id, user_id FROM community_comments WHERE id = ?')
            .get(parentIdTrim);
        if (!parent || parent.post_id !== id) {
            return res
                .status(400)
                .json(errorResponse(ErrorCode.INVALID_PARAMS, '回复的评论不存在或不属于该帖'));
        }
        parent_id = parentIdTrim;
        const replyOid = replyToOpenid != null ? String(replyToOpenid).trim() : '';
        if (replyOid) {
            const replyUser = findUserByOpenid(replyOid);
            if (replyUser) reply_to_user_id = replyUser.id;
        } else {
            reply_to_user_id = parent.user_id;
        }
    }

    const commentId = uuidv4();

    try {
        const insertStmt = db.prepare(`INSERT INTO community_comments
            (id, post_id, user_id, content, parent_id, reply_to_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`);
        insertStmt.run(commentId, id, userId, text, parent_id, reply_to_user_id);

        const updateStmt = db.prepare('UPDATE community_posts SET comments = comments + 1 WHERE id = ?');
        updateStmt.run(id);

        try {
            const postRow = db.prepare('SELECT user_id, content FROM community_posts WHERE id = ?').get(id);
            const snippet = text.substring(0, 50);
            const notified = new Set();

            if (postRow && postRow.user_id !== userId) {
                const notifId = uuidv4();
                const title = postRow.content ? postRow.content.substring(0, 20) + '...' : '你的帖子';
                db.prepare(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
                    VALUES (?, ?, ?, ?, ?, ?)`)
                    .run(notifId, postRow.user_id, 'comment', title, snippet, id);
                notified.add(postRow.user_id);
            }

            if (reply_to_user_id && reply_to_user_id !== userId && !notified.has(reply_to_user_id)) {
                const notifId = uuidv4();
                db.prepare(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
                    VALUES (?, ?, ?, ?, ?, ?)`)
                    .run(notifId, reply_to_user_id, 'comment', '有人回复了你', snippet, id);
            }
        } catch (e) {
            logWarn('发送评论通知失败', e.message);
        }

        res.json(successResponse({ commentId }, '评论成功'));
    } catch (err) {
        logError('发布评论', err, { postId: id, userId });
        res.status(500).json(errorResponse(ErrorCode.COMMENT_CREATE_FAILED, err.message));
    }
});

app.get('/api/community/post/:id/comments', optionalAuthMiddleware, (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const viewerUserId = req.user ? req.user.id : null;

    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空');
    }

    // 分页参数校验
    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
        return sendError(res, ErrorCode.PAGE_PARAM_ERROR, 'page参数必须是大于0的数字');
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return sendError(res, ErrorCode.PAGE_PARAM_ERROR, 'limit参数必须在1-100之间');
    }

    const offset = (pageNum - 1) * limitNum;
    const fetchLimit = Math.min(limitNum * 20, 500);

    try {
        const stmt = db.prepare(`SELECT c.*, u.nickname as name, u.avatar_url as avatar, u.wx_openid as openid
         FROM community_comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.post_id = ?
         ORDER BY c.created_at ASC
         LIMIT ?`);
        const allRows = stmt.all(id, fetchLimit);
        const tree = buildCommunityCommentTree(allRows, viewerUserId);
        const list = tree.slice(offset, offset + limitNum);

        sendSuccess(res, { list, total: tree.length });
    } catch (err) {
        logError('获取评论列表', err, { postId: id, page, limit });
        sendError(res, convertDbError(err), err.message);
    }
});

app.post('/api/community/post/:postId/comment/:commentId/like', authMiddleware, (req, res) => {
    const { postId, commentId } = req.params;
    const userId = req.user.id;

    if (!postId || !commentId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '参数不能为空');
    }

    try {
        const comment = db
            .prepare('SELECT id, post_id, user_id FROM community_comments WHERE id = ?')
            .get(commentId);
        if (!comment || comment.post_id !== postId) {
            return sendError(res, ErrorCode.NOT_FOUND, '评论不存在');
        }

        const existing = db
            .prepare('SELECT 1 AS ok FROM community_comment_likes WHERE comment_id = ? AND user_id = ?')
            .get(commentId, userId);

        if (existing) {
            db.prepare('DELETE FROM community_comment_likes WHERE comment_id = ? AND user_id = ?').run(
                commentId,
                userId
            );
            const prev = db
                .prepare('SELECT COALESCE(likes, 0) AS likes FROM community_comments WHERE id = ?')
                .get(commentId);
            const nextLikes = Math.max(0, (prev?.likes || 0) - 1);
            db.prepare('UPDATE community_comments SET likes = ? WHERE id = ?').run(nextLikes, commentId);
            return sendSuccess(res, { liked: false, likes: nextLikes }, '取消点赞成功');
        }

        db.prepare('INSERT INTO community_comment_likes (comment_id, user_id) VALUES (?, ?)').run(
            commentId,
            userId
        );
        db.prepare('UPDATE community_comments SET likes = COALESCE(likes, 0) + 1 WHERE id = ?').run(commentId);
        const row = db.prepare('SELECT COALESCE(likes, 0) AS likes FROM community_comments WHERE id = ?').get(
            commentId
        );

        if (comment.user_id !== userId) {
            try {
                const notifId = uuidv4();
                db.prepare(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
                    VALUES (?, ?, ?, ?, ?, ?)`)
                    .run(notifId, comment.user_id, 'like', '评论获赞', '有人赞了你的评论', postId);
            } catch (e) {
                logWarn('评论点赞通知失败', e.message);
            }
        }

        sendSuccess(res, { liked: true, likes: row ? row.likes : 1 }, '点赞成功');
    } catch (err) {
        logError('评论点赞', err, { postId, commentId, userId });
        sendError(res, ErrorCode.LIKE_FAILED, err.message);
    }
});

app.get('/api/community/post/:id/liked', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空');
    }

    try {
        const stmt = db.prepare('SELECT * FROM community_likes WHERE post_id = ? AND user_id = ?');
        const row = stmt.get(id, userId);
        sendSuccess(res, { liked: !!row });
    } catch (err) {
        logError('检查点赞状态', err, { postId: id, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/community/stats', (req, res) => {
    try {
        const postCount = db.prepare('SELECT COUNT(*) as count FROM community_posts').get().count;
        const commentCount = db.prepare('SELECT COUNT(*) as count FROM community_comments').get().count;
        const userCount = db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM community_posts').get().count;

        sendSuccess(res, { postCount, commentCount, userCount });
    } catch (err) {
        logError('获取社区统计', err);
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/community/user/:userId/posts', (req, res) => {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'page参数必须是大于0的数字');
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'limit参数必须在1-100之间');
    }

    const offset = (pageNum - 1) * limitNum;

    try {
        // userId 是 wx_openid，需要先查询对应的 users.id
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(userId);
        if (!user) {
            return sendSuccess(res, { list: [], total: 0, totalLikesReceived: 0 });
        }

        const total = db
            .prepare('SELECT COUNT(*) as c FROM community_posts WHERE user_id = ?')
            .get(user.id).c;

        /** 该用户所有帖子获赞之和（与 community_posts.likes 一致） */
        const totalLikesReceived = db
            .prepare(
                'SELECT COALESCE(SUM(likes), 0) AS s FROM community_posts WHERE user_id = ?'
            )
            .get(user.id).s;

        const stmt = db.prepare(`SELECT p.*, u.nickname as author, u.avatar_url as avatar
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.user_id = ?
         ORDER BY p.created_at DESC LIMIT ? OFFSET ?`);
        const posts = stmt.all(user.id, limitNum, offset);

        const formattedPosts = posts.map(formatCommunityPostRow);

        sendSuccess(res, {
            list: formattedPosts,
            total,
            totalLikesReceived
        });
    } catch (err) {
        logError('获取用户帖子列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/community/rankings', (req, res) => {
    const { type = 'likes', limit = 10 } = req.query;
    const limitNum = Number(limit);

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'limit参数必须在1-50之间');
    }

    let orderBy = 'p.likes DESC';
    if (type === 'comments') orderBy = 'p.comments DESC';
    else if (type === 'latest') orderBy = 'p.created_at DESC';

    try {
        const stmt = db.prepare(`SELECT p.*, u.nickname as author, u.avatar_url as avatar
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         ORDER BY ${orderBy}
         LIMIT ?`);
        const posts = stmt.all(limitNum);

        const formattedPosts = posts.map(formatCommunityPostRow);

        sendSuccess(res, formattedPosts);
    } catch (err) {
        logError('获取热门排行', err, { type });
        sendError(res, convertDbError(err), err.message);
    }
});

app.delete('/api/community/post/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空');
    }

    try {
        const post = db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(id);
        if (!post) {
            return sendError(res, ErrorCode.POST_NOT_FOUND);
        }
        if (post.user_id !== userId) {
            return sendError(res, ErrorCode.FORBIDDEN, '无权删除该帖子');
        }

        purgeCommunityPostById(id);

        sendSuccess(res, null, '帖子删除成功');
    } catch (err) {
        logError('删除帖子', err, { postId: id, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.delete('/api/community/post/:postId/comment/:commentId', authMiddleware, (req, res) => {
    const { postId, commentId } = req.params;
    const userId = req.user.id;

    if (!postId || !commentId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '参数不能为空');
    }

    try {
        const comment = db.prepare('SELECT user_id, post_id FROM community_comments WHERE id = ?').get(commentId);
        if (!comment) {
            return sendError(res, ErrorCode.NOT_FOUND, '评论不存在');
        }

        const post = db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(postId);
        const isCommentAuthor = comment.user_id === userId;
        const isPostAuthor = post && post.user_id === userId;

        if (!isCommentAuthor && !isPostAuthor) {
            return sendError(res, ErrorCode.FORBIDDEN, '无权删除该评论');
        }

        const toDelete = countCommentDescendants(commentId);
        const placeholders = toDelete.map(() => '?').join(',');
        deleteCommentLikesByIds(toDelete);
        db.prepare(`DELETE FROM community_comments WHERE id IN (${placeholders})`).run(...toDelete);
        const postRow = db.prepare('SELECT comments FROM community_posts WHERE id = ?').get(postId);
        const nextCount = Math.max(0, (postRow?.comments || 0) - toDelete.length);
        db.prepare('UPDATE community_posts SET comments = ? WHERE id = ?').run(nextCount, postId);

        sendSuccess(res, { deleted: toDelete.length }, '评论删除成功');
    } catch (err) {
        logError('删除评论', err, { commentId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 意见反馈：登录用户关联账号，未登录也可提交 */
app.post('/api/feedback', optionalAuthMiddleware, async (req, res) => {
    const body = req.body || {};
    const feedbackType = String(body.type || body.feedbackType || '其他').trim().slice(0, 32);
    const content = String(body.content || '').trim();
    const contact = String(body.contact || '').trim().slice(0, 128);

    if (!content) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '反馈内容不能为空');
    }
    if (content.length > 2000) {
        return sendError(res, ErrorCode.INVALID_FORMAT, '反馈内容不能超过2000字');
    }

    const feedbackOpenid = req.user ? req.user.wx_openid : null;
    if (
        await blockIfContentUnsafe(res, feedbackOpenid, [
            { content, scene: contentSecurity.SCENE.COMMENT, field: 'content' },
            { content: contact, scene: contentSecurity.SCENE.PROFILE, field: 'contact' }
        ])
    ) {
        return;
    }

    const id = uuidv4();
    let userId = null;
    let wxOpenid = '';
    let nickname = '';

    if (req.user) {
        userId = req.user.id;
        const u = db.prepare('SELECT wx_openid, nickname FROM users WHERE id = ?').get(userId);
        if (u) {
            wxOpenid = u.wx_openid || '';
            nickname = u.nickname || '';
        }
    }

    try {
        db.prepare(
            `INSERT INTO user_feedback (id, user_id, wx_openid, nickname, feedback_type, content, contact, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`
        ).run(id, userId, wxOpenid, nickname, feedbackType, content, contact || null);

        logInfo('意见反馈', '新提交', {
            id,
            userId,
            wxOpenid: wxOpenid ? wxOpenid.slice(0, 8) + '…' : '',
            feedbackType,
            contentPreview: content.slice(0, 80)
        });

        sendSuccess(res, { id }, '反馈已提交');
    } catch (err) {
        logError('保存意见反馈', err, { userId, feedbackType });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 管理端查看反馈列表（需配置 FEEDBACK_ADMIN_SECRET，请求带 ?secret=） */
app.get('/api/feedback', (req, res) => {
    const secret = String(process.env.FEEDBACK_ADMIN_SECRET || '').trim();
    const given = String(req.query.secret || '').trim();
    if (!secret || given !== secret) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权查看反馈列表');
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    try {
        const total = db.prepare('SELECT COUNT(*) AS c FROM user_feedback').get().c;
        const list = db
            .prepare(
                `SELECT id, user_id, wx_openid, nickname, feedback_type, content, contact, created_at
                 FROM user_feedback ORDER BY created_at DESC LIMIT ? OFFSET ?`
            )
            .all(limit, offset);
        sendSuccess(res, { list, total, page, limit });
    } catch (err) {
        logError('查询意见反馈', err);
        sendError(res, convertDbError(err), err.message);
    }
});

function getCommunityAdminSecret() {
    return String(process.env.COMMUNITY_ADMIN_SECRET || process.env.FEEDBACK_ADMIN_SECRET || '').trim();
}

function isCommunityAdminRequest(req) {
    const secret = getCommunityAdminSecret();
    const given = String(
        (req.query && req.query.secret) || req.headers['x-admin-secret'] || ''
    ).trim();
    return !!(secret && given && given === secret);
}

function purgeCommunityPostById(postId) {
    db.prepare('DELETE FROM community_likes WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM community_posts WHERE id = ?').run(postId);
}

/** 管理端：按关键词查帖（?secret= &q=成人） */
app.get('/api/community/admin/posts', (req, res) => {
    if (!isCommunityAdminRequest(req)) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权操作');
    }

    const q = String(req.query.q || req.query.keyword || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    try {
        let rows;
        if (q) {
            const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
            rows = db
                .prepare(
                    `SELECT p.id, p.title, p.content, p.topic, p.created_at, u.nickname AS author
                     FROM community_posts p
                     LEFT JOIN users u ON p.user_id = u.id
                     WHERE p.content LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\'
                     ORDER BY p.created_at DESC
                     LIMIT ?`
                )
                .all(like, like, limit);
        } else {
            rows = db
                .prepare(
                    `SELECT p.id, p.title, p.content, p.topic, p.created_at, u.nickname AS author
                     FROM community_posts p
                     LEFT JOIN users u ON p.user_id = u.id
                     ORDER BY p.created_at DESC
                     LIMIT ?`
                )
                .all(limit);
        }
        sendSuccess(res, { list: rows, count: rows.length });
    } catch (err) {
        logError('管理端查帖', err, { q });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 管理端：删除任意帖子（?secret=） */
app.delete('/api/community/admin/post/:id', (req, res) => {
    if (!isCommunityAdminRequest(req)) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权操作');
    }

    const { id } = req.params;
    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空');
    }

    try {
        const post = db.prepare('SELECT id FROM community_posts WHERE id = ?').get(id);
        if (!post) {
            return sendError(res, ErrorCode.POST_NOT_FOUND);
        }
        purgeCommunityPostById(id);
        logInfo('管理端删帖', '已删除', { postId: id });
        sendSuccess(res, { postId: id }, '帖子已删除');
    } catch (err) {
        logError('管理端删帖', err, { postId: id });
        sendError(res, convertDbError(err), err.message);
    }
});

app.post('/api/upload/image', authMiddleware, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '请选择图片');
    }
    const diskPath = path.join(uploadDir, req.file.filename);
    if (!fs.existsSync(diskPath)) {
        logError('图片上传', new Error('写入后文件不存在'), { diskPath, uploadDir });
        return sendError(res, ErrorCode.FILE_UPLOAD_FAILED, '文件写入失败');
    }

    try {
        const imgCheck = await contentSecurity.checkImageFile(diskPath);
        if (!imgCheck.pass) {
            try {
                fs.unlinkSync(diskPath);
            } catch (e) {}
            return sendError(res, ErrorCode.CONTENT_SENSITIVE);
        }
    } catch (err) {
        try {
            fs.unlinkSync(diskPath);
        } catch (e) {}
        logError('图片内容安全检测', err);
        return sendError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
    }

    const safeName = path.basename(req.file.filename);
    const imageUrl = buildPublicUploadUrl(req, safeName);
    const publicPath = getUploadPublicPathForFilename(safeName);
    logInfo('图片上传', '成功', { filename: safeName, uploadDir, imageUrl, publicPath });
    sendSuccess(res, { url: imageUrl, path: publicPath }, '上传成功');
});

function buildPublicAudioUploadUrl(req, filename) {
    const base = getApiBaseUrl(req);
    const encoded = encodeURIComponent(path.basename(filename));
    return `${base}/api/upload/audio/${encoded}`;
}

app.post('/api/upload/audio', authMiddleware, upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '请选择音频文件');
    }
    const diskPath = path.join(uploadDir, req.file.filename);
    if (!fs.existsSync(diskPath)) {
        logError('音频上传', new Error('写入后文件不存在'), { diskPath, uploadDir });
        return sendError(res, ErrorCode.FILE_UPLOAD_FAILED, '文件写入失败');
    }
    const safeName = path.basename(req.file.filename);
    const audioUrl = buildPublicAudioUploadUrl(req, safeName);
    const publicPath = `/api/upload/audio/${encodeURIComponent(safeName)}`;
    logInfo('音频上传', '成功', { filename: safeName, audioUrl, publicPath });
    sendSuccess(res, { url: audioUrl, path: publicPath, audioUrl }, '上传成功');
});


function mapPlayHistoryRow(row) {
    return {
        id: row.music_id,
        musicId: row.music_id,
        title: row.title || '助眠音乐',
        audioUrl: row.audio_url,
        cover: row.cover || '',
        instrument: row.instrument || '',
        frequency: row.frequency || '',
        durationSec: row.duration_sec || 0,
        source: row.source || 'app',
        playedAt: row.played_at
    };
}

function parsePlayedAtForDb(iso) {
    if (!iso || typeof iso !== 'string') return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 作品被播放一次（含重复播放） */
function incrementMusicPlayCount(musicId) {
    const mid = String(musicId || '').trim();
    if (!mid) return;
    try {
        const row = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(mid);
        if (!row) return;
        db.prepare(
            `UPDATE music_tracks SET play_count = COALESCE(play_count, 0) + 1 WHERE id = ?`
        ).run(mid);
    } catch (e) {
        logWarn('累计播放次数', e.message || '失败', { musicId: mid });
    }
}

// 上报 / 更新一条播放记录
app.post('/api/play-history', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const {
        musicId,
        id,
        title,
        audioUrl,
        cover,
        instrument,
        frequency,
        durationSec,
        source,
        playedAt
    } = req.body || {};

    const mid = String(musicId || id || '').trim();
    const url = audioUrl ? String(audioUrl).trim() : '';
    if (!mid) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'musicId不能为空');
    }
    if (!url) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'audioUrl不能为空');
    }

    const playedAtDb = parsePlayedAtForDb(playedAt);

    try {
        if (playedAtDb) {
            db.prepare(`
                INSERT INTO play_history (user_id, music_id, title, audio_url, cover, instrument, frequency, duration_sec, source, played_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, music_id) DO UPDATE SET
                    title = excluded.title,
                    audio_url = excluded.audio_url,
                    cover = excluded.cover,
                    instrument = excluded.instrument,
                    frequency = excluded.frequency,
                    duration_sec = excluded.duration_sec,
                    source = excluded.source,
                    played_at = excluded.played_at
            `).run(
                userId,
                mid,
                title ? String(title).slice(0, 200) : '助眠音乐',
                url,
                cover ? String(cover).slice(0, 500) : '',
                instrument ? String(instrument).slice(0, 64) : '',
                frequency ? String(frequency).slice(0, 64) : '',
                Math.max(0, parseInt(durationSec, 10) || 0),
                source ? String(source).slice(0, 32) : 'app',
                playedAtDb
            );
        } else {
            db.prepare(`
                INSERT INTO play_history (user_id, music_id, title, audio_url, cover, instrument, frequency, duration_sec, source, played_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                ON CONFLICT(user_id, music_id) DO UPDATE SET
                    title = excluded.title,
                    audio_url = excluded.audio_url,
                    cover = excluded.cover,
                    instrument = excluded.instrument,
                    frequency = excluded.frequency,
                    duration_sec = excluded.duration_sec,
                    source = excluded.source,
                    played_at = datetime('now', 'localtime')
            `).run(
                userId,
                mid,
                title ? String(title).slice(0, 200) : '助眠音乐',
                url,
                cover ? String(cover).slice(0, 500) : '',
                instrument ? String(instrument).slice(0, 64) : '',
                frequency ? String(frequency).slice(0, 64) : '',
                Math.max(0, parseInt(durationSec, 10) || 0),
                source ? String(source).slice(0, 32) : 'app'
            );
        }
        incrementMusicPlayCount(mid);
        sendSuccess(res, { musicId: mid }, '已记录');
    } catch (err) {
        logError('上报播放记录', err, { userId, musicId: mid });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

// 获取播放记录列表
app.get('/api/play-history', authMiddleware, (req, res) => {
    const userId = req.user.id;
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 100;
    if (limit > 100) limit = 100;

    try {
        const rows = db.prepare(`
            SELECT music_id, title, audio_url, cover, instrument, frequency, duration_sec, source, played_at
            FROM play_history
            WHERE user_id = ?
            ORDER BY played_at DESC
            LIMIT ?
        `).all(userId, limit);

        const countRow = db.prepare('SELECT COUNT(*) as total FROM play_history WHERE user_id = ?').get(userId);

        sendSuccess(res, {
            list: rows.map(mapPlayHistoryRow),
            total: countRow.total,
            limit
        });
    } catch (err) {
        logError('获取播放记录', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

function mapFavoriteTrackRow(row) {
    const cover = row.player_cover_url
        ? sanitizePlayerCoverUrlForClient(row.player_cover_url)
        : '';
    const ms = row.audio_duration_ms;
    let durationSec = 0;
    if (ms != null && Number(ms) > 0) {
        durationSec = Math.max(1, Math.ceil(Number(ms) / 1000));
    } else if (row.duration != null && Number(row.duration) > 0) {
        durationSec = Math.floor(Number(row.duration));
    }
    return {
        id: row.music_id,
        musicId: row.music_id,
        title: row.title || '助眠音乐',
        audioUrl: row.audio_url || '',
        cover,
        instrument: row.main_instrument || '',
        frequency: row.frequency || '',
        durationSec,
        favoritedAt: row.created_at
    };
}

app.get('/api/favorites/count', authMiddleware, (req, res) => {
    try {
        const row = db
            .prepare('SELECT COUNT(*) AS c FROM user_favorites WHERE user_id = ?')
            .get(req.user.id);
        sendSuccess(res, { count: row ? row.c : 0 });
    } catch (err) {
        logError('获取收藏数量', err, { userId: req.user.id });
        sendError(res, convertDbError(err), err.message);
    }
});

app.get('/api/favorites', authMiddleware, (req, res) => {
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 100;
    if (limit > 100) limit = 100;

    try {
        const rows = db
            .prepare(
                `SELECT f.music_id, f.created_at,
                    t.title, t.main_instrument, t.frequency, t.duration, t.audio_url,
                    t.audio_duration_ms, t.player_cover_url, t.status
                 FROM user_favorites f
                 LEFT JOIN music_tracks t ON t.id = f.music_id
                 WHERE f.user_id = ?
                 ORDER BY f.created_at DESC
                 LIMIT ?`
            )
            .all(req.user.id, limit);

        const list = rows
            .filter((r) => r.audio_url && String(r.audio_url).trim())
            .map(mapFavoriteTrackRow);

        sendSuccess(res, { list, total: list.length, limit });
    } catch (err) {
        logError('获取收藏列表', err, { userId: req.user.id });
        sendError(res, convertDbError(err), err.message);
    }
});

app.post('/api/favorites/:musicId', authMiddleware, (req, res) => {
    const musicId = String(req.params.musicId || '').trim();
    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'musicId不能为空');
    }

    const track = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(musicId);
    if (!track) {
        return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
    }

    try {
        db.prepare(
            `INSERT INTO user_favorites (user_id, music_id, created_at)
             VALUES (?, ?, datetime('now', 'localtime'))
             ON CONFLICT(user_id, music_id) DO NOTHING`
        ).run(req.user.id, musicId);
        sendSuccess(res, { musicId, favorited: true }, '已收藏');
    } catch (err) {
        logError('添加收藏', err, { userId: req.user.id, musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

app.delete('/api/favorites/:musicId', authMiddleware, (req, res) => {
    const musicId = String(req.params.musicId || '').trim();
    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'musicId不能为空');
    }

    try {
        db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND music_id = ?').run(
            req.user.id,
            musicId
        );
        sendSuccess(res, { musicId, favorited: false }, '已取消收藏');
    } catch (err) {
        logError('取消收藏', err, { userId: req.user.id, musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

// 清空播放记录
app.delete('/api/play-history', authMiddleware, (req, res) => {
    const userId = req.user.id;
    try {
        db.prepare('DELETE FROM play_history WHERE user_id = ?').run(userId);
        sendSuccess(res, null, '已清空');
    } catch (err) {
        logError('清空播放记录', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});


// 获取通知列表
app.get('/api/notifications', authMiddleware, (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'page参数必须是大于0的数字');
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'limit参数必须在1-100之间');
    }

    const offset = (pageNum - 1) * limitNum;

    try {
        const list = db.prepare(`
            SELECT id, type, title, content, related_id, read, created_at
            FROM notifications
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(userId, limitNum, offset);

        const countRow = db.prepare('SELECT COUNT(*) as total FROM notifications WHERE user_id = ?').get(userId);
        const unreadRow = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0').get(userId);

        sendSuccess(res, {
            list,
            total: countRow.total,
            unread: unreadRow.count,
            page: pageNum,
            limit: limitNum
        });
        logInfo('通知列表', '查询成功', {
            userId,
            openid: req.user.wx_openid,
            page: pageNum,
            limit: limitNum,
            total: countRow.total,
            unread: unreadRow.count,
            listCount: list.length
        });
    } catch (err) {
        logError('获取通知列表', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

// 获取未读通知数量
app.get('/api/notifications/unread-count', authMiddleware, (req, res) => {
    const userId = req.user.id;

    try {
        const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0').get(userId);
        sendSuccess(res, { count: row.count });
        logInfo('未读通知数', '查询成功', {
            userId,
            openid: req.user.wx_openid,
            count: row.count
        });
    } catch (err) {
        logError('获取未读通知数', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

// 标记单条通知已读
app.put('/api/notifications/:id/read', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '通知ID不能为空');
    }

    try {
        const stmt = db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?');
        const result = stmt.run(id, userId);

        if (result.changes === 0) {
            return sendError(res, ErrorCode.NOT_FOUND, '通知不存在');
        }

        sendSuccess(res, null, '已标记为已读');
    } catch (err) {
        logError('标记通知已读', err, { notifId: id, userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

// 标记全部通知已读
app.put('/api/notifications/read-all', authMiddleware, (req, res) => {
    const userId = req.user.id;

    try {
        db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
        sendSuccess(res, null, '全部标记为已读');
    } catch (err) {
        logError('标记全部已读', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});


/**
 * 解密微信手机号加密数据
 * @param {string} sessionKey - 微信 session_key
 * @param {string} encryptedData - 加密数据
 * @param {string} iv - 初始向量
 * @returns {Object|null} 解密后的数据
 */
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

app.post('/api/user/login', async (req, res) => {
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

app.get('/api/user/follow/stats', authMiddleware, (req, res) => {
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

app.get('/api/user/follow/list', authMiddleware, (req, res) => {
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

app.get('/api/user/:openid/follow-status', authMiddleware, (req, res) => {
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

app.post('/api/user/follow', authMiddleware, (req, res) => {
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

app.delete('/api/user/follow/:openid', authMiddleware, (req, res) => {
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

app.get('/api/user/profile', authMiddleware, (req, res) => {
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

app.put('/api/user/profile', authMiddleware, async (req, res) => {
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

app.delete('/api/user/account', authMiddleware, (req, res) => {
    const uid = req.user.id;
    try {
        purgeUserAccount(uid);
        sendSuccess(res, { deleted: true }, '账号已注销');
    } catch (err) {
        logError('注销用户', err, { uid });
        sendError(res, ErrorCode.ACCOUNT_DELETE_FAILED, err.message);
    }
});


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

/** 将星鹿静默登录结果写入 users.shop_token（登录与超时刷新共用） */
function persistShopTokenFromPayload(userKey, p, options = {}) {
    const { by = 'openid', mergeProfile = true } = options;
    if (!p || !p.token) return false;
    if (by === 'id') {
        db.prepare(`UPDATE users SET shop_token = ?, shop_sn = ? WHERE id = ?`).run(
            p.token,
            p.sn || null,
            userKey
        );
    } else {
        db.prepare(`UPDATE users SET shop_token = ?, shop_sn = ? WHERE wx_openid = ?`).run(
            p.token,
            p.sn || null,
            userKey
        );
    }
    if (mergeProfile && by === 'openid') {
        const nick = p.nickname || null;
        const av = p.avatar ? shopApi.normalizeHostedUploadUrl(String(p.avatar).trim()) : null;
        db.prepare(
            `UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url) WHERE wx_openid = ?`
        ).run(nick, av, userKey);
    }
    return true;
}

/** 商城 token 过期时用已绑定手机号静默登录并更新 shop_token */
async function refreshShopTokenForUser(user, context = '商城接口') {
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

/**
 * 调用星鹿接口；若返回登录超时且用户有手机号，则静默刷新 shop_token 后重试一次
 * @returns {{ data: object, shopToken: string }}
 */
async function callShopWithAutoRefresh(user, shopToken, callFn, context) {
    let token = shopToken;
    let data = await callFn(token);
    if (shopApi.isShopApiSuccess(data)) {
        return { data, shopToken: token };
    }
    if (!isShopAutoRefreshOnTimeoutEnabled() || !shopApi.isShopLoginTimeoutPayload(data)) {
        return { data, shopToken: token };
    }
    const newToken = await refreshShopTokenForUser(user, context);
    if (!newToken) {
        return { data, shopToken: token };
    }
    token = newToken;
    data = await callFn(token);
    return { data, shopToken: token };
}

/** 写入积分明细（本库；用于小程序展示；星鹿侧余额以商城为准） */
function recordPointsLedger(userId, signedPoints, type, description) {
    const id = uuidv4();
    db.prepare('INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)').run(
        id,
        userId,
        signedPoints,
        type,
        description != null ? String(description) : ''
    );
}

/** 个人中心（含 user_integral 等）→ GET /shopapi/User/centre */
app.get('/api/shop/centre', authMiddleware, async (req, res) => {
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
app.post('/api/shop/setInfo', authMiddleware, async (req, res) => {
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
app.post('/api/shop/thirdDeduct', authMiddleware, async (req, res) => {
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

/** 渠道换皮配置（公开，小程序冷启动拉取） */
app.get('/api/branding', (req, res) => {
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

/** 渠道外观主题预设目录（14 套，不含官方晨雾/眠夜） */
app.get('/api/channel-theme-presets', (req, res) => {
    try {
        const list = channelService.channelThemePresets.listChannelThemePresets();
        return sendSuccess(res, { presets: list }, '操作成功');
    } catch (err) {
        logError('渠道主题预设', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

/** 登录用户绑定渠道（Storage 与后端对齐，用于换机/统计） */
app.post('/api/user/channel-bind', authMiddleware, (req, res) => {
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

/** 运营弹窗活动列表（小程序 promo-scheduler 拉取） */
app.get('/api/promo/active', (req, res) => {
    const scene = req.query && req.query.scene ? String(req.query.scene) : '';
    const channelRaw = req.query && (req.query.channel || req.query.channelId);
    const channelId = channelService.normalizeChannelId(channelRaw);
    const list = getPromoCampaignsForScene(scene, channelId);
    return sendSuccess(res, { list }, '操作成功');
});

/** 运营弹窗埋点（可选，当前仅记日志） */
app.post('/api/promo/event', (req, res) => {
    const body = req.body || {};
    if (body.promoId && body.action) {
        logInfo('promo/event', `${body.promoId} ${body.action}`, {
            scene: body.scene || ''
        });
    }
    return sendSuccess(res, null, '操作成功');
});

/** 积分商城商品列表（无需登录；小程序优先拉取，图片 URL 由后台维护） */
app.get('/api/mall/config', (req, res) => {
    return sendSuccess(res, getMallClientConfig(), '操作成功');
});

/** 积分商城商品列表（无需登录；小程序优先拉取，图片 URL 由后台维护） */
app.get('/api/mall/products', (req, res) => {
    return sendSuccess(res, exposeQrcodeListIfEnabled(MALL_PRODUCTS_DATA, mallImageUrl), '操作成功');
});

/** 单个商品详情（用于详情页校验 id） */
app.get('/api/mall/product/:id', (req, res) => {
    const p = getMallProductByIdFromStore(req.params.id);
    if (!p) {
        return sendError(res, ErrorCode.MALL_PRODUCT_NOT_FOUND);
    }
    return sendSuccess(res, exposeQrcodeIfEnabled(p, mallImageUrl), '操作成功');
});

/**
 * 智合枕 / 观心枕 WebSocket 访问令牌（bed GetAccessToken，24h 有效，服务端缓存）
 * 兼容 token.txt：GET + header version；响应 code === 1，data.access_token
 */
app.get('/api/detection/token', async (req, res) => {
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

/** 眠家 / 眠加产品推荐（无需登录；数据来自 goods.txt 同源 getGoodsLists） */
app.get('/api/mianjia/products', async (req, res) => {
    try {
        const list = exposeQrcodeListIfEnabled(await getMianjiaProducts(), mallImageUrl);
        return sendSuccess(res, list, '操作成功');
    } catch (e) {
        console.error('[mianjia/products]', e);
        return sendError(res, ErrorCode.INTERNAL_ERROR, '获取商品列表失败');
    }
});

/** 自然日 YYYY-MM-DD（Asia/Shanghai） */
function cnTodayDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${d}`;
}

const DAILY_TASK_KEYS = new Set(['sign_in', 'create_music', 'share_work']);
const DAILY_TASK_POINTS = { sign_in: 1, create_music: 10, share_work: 3 };
const DAILY_TASK_LABELS = { sign_in: '每日签到', create_music: '创作音乐', share_work: '分享作品' };

function hasDailyClaim(userId, taskKey, claimDate) {
    const row = db
        .prepare(
            `SELECT 1 AS ok FROM daily_task_claims WHERE user_id = ? AND task_key = ? AND claim_date = ?`
        )
        .get(userId, taskKey, claimDate);
    return !!(row && row.ok);
}

/** GET 今日任务进度（仅三个任务） */
app.get('/api/tasks/daily', authMiddleware, (req, res) => {
    try {
        const claimDate = cnTodayDate();
        const userId = req.user.id;
        const rows = db
            .prepare(`SELECT task_key FROM daily_task_claims WHERE user_id = ? AND claim_date = ?`)
            .all(userId, claimDate);
        const done = new Set(rows.map((r) => r.task_key));
        const tasks = [
            {
                taskKey: 'sign_in',
                icon: '签到',
                name: '每日签到',
                desc: '每日签到一次',
                points: DAILY_TASK_POINTS.sign_in,
                completed: done.has('sign_in')
            },
            {
                taskKey: 'create_music',
                icon: '音乐',
                name: '创作音乐',
                desc: '今日完成一首助眠音乐生成',
                points: DAILY_TASK_POINTS.create_music,
                completed: done.has('create_music')
            },
            {
                taskKey: 'share_work',
                icon: '分享',
                name: '分享作品',
                desc: '今日向好友转发分享贺卡',
                points: DAILY_TASK_POINTS.share_work,
                completed: done.has('share_work')
            }
        ];
        sendSuccess(res, { date: claimDate, tasks });
    } catch (err) {
        logError('每日任务状态', err);
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

/** POST 领取单个每日任务积分（服务端校验次数；默认走星鹿发放接口） */
app.post('/api/tasks/daily/claim', authMiddleware, async (req, res) => {
    const { taskKey } = req.body || {};
    if (!taskKey || !DAILY_TASK_KEYS.has(taskKey)) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'taskKey 须为 sign_in | create_music | share_work');
    }
    const points = DAILY_TASK_POINTS[taskKey];
    const userId = req.user.id;
    const claimDate = cnTodayDate();

    if (hasDailyClaim(userId, taskKey, claimDate)) {
        return sendSuccess(
            res,
            { taskKey, points: 0, claimDate, alreadyClaimed: true },
            '今日该任务已完成'
        );
    }

    const mode = (process.env.TASK_POINTS_MODE || 'shop').toLowerCase();

    if (mode === 'local') {
        try {
            getOrInitPoints(userId);
            db.prepare(
                `UPDATE user_points SET points = points + ?, total_points = total_points + ?, updated_at = datetime('now', 'localtime') WHERE user_id = ?`
            ).run(points, points, userId);
            const historyId = uuidv4();
            db.prepare(
                `INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)`
            ).run(historyId, userId, points, `daily_${taskKey}`, `每日任务 ${claimDate}`);
            db.prepare(
                `INSERT INTO daily_task_claims (user_id, task_key, claim_date, points) VALUES (?, ?, ?, ?)`
            ).run(userId, taskKey, claimDate, points);
            const updated = db.prepare('SELECT points FROM user_points WHERE user_id = ?').get(userId);
            return sendSuccess(
                res,
                { taskKey, points, claimDate, channel: 'local', currentPoints: updated.points },
                '领取成功'
            );
        } catch (err) {
            logError('每日任务本地积分', err);
            return sendError(res, ErrorCode.POINTS_ADD_FAILED, err.message);
        }
    }

    const st = requireShopToken(req, res);
    if (!st) return;

    try {
        const { data } = await callShopWithAutoRefresh(
            req.user,
            st,
            (tok) => shopApi.thirdGrantIntegral(tok, points),
            '商城发放积分'
        );
        if (!shopApi.isShopApiSuccess(data)) {
            return sendError(
                res,
                ErrorCode.MALL_API_ERROR,
                (data && (data.msg || data.message)) || '商城发放积分失败'
            );
        }
        db.prepare(`INSERT INTO daily_task_claims (user_id, task_key, claim_date, points) VALUES (?, ?, ?, ?)`).run(
            userId,
            taskKey,
            claimDate,
            points
        );
        recordPointsLedger(
            userId,
            points,
            `daily_${taskKey}`,
            DAILY_TASK_LABELS[taskKey] || taskKey
        );
        return sendSuccess(res, { taskKey, points, claimDate, channel: 'shop' }, (data && data.msg) || '领取成功');
    } catch (err) {
        logError('每日任务商城积分', err);
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message || '商城接口异常');
    }
});


/** 生成完成后：下载音频到本机并写入可长期播放的 URL */
async function completeMusicTrackWithAudio(musicId, remoteUrl, audioDurationMs) {
    let publicUrl = String(remoteUrl || '').trim();
    if (!publicUrl) return;

    try {
        const localUrl = await musicAudioStore.persistMusicAudioFromRemote(
            uploadDir,
            musicId,
            publicUrl
        );
        if (localUrl) publicUrl = localUrl;
    } catch (e) {
        logWarn('音频落盘', '失败，暂存外链', { musicId, message: e.message });
    }

    try {
        const row = db.prepare('SELECT voice_url FROM music_tracks WHERE id = ?').get(musicId);
        const voiceDisk =
            row && row.voice_url ? resolveHostedUploadToDisk(row.voice_url) : null;
        const musicLocalPath = musicAudioStore.getLocalAudioFilePath(uploadDir, musicId);
        if (voiceDisk && musicLocalPath && fs.existsSync(musicLocalPath)) {
            const mixedPath = await mixFinalAudio({
                musicUrl: musicLocalPath,
                voiceFile: voiceDisk,
                volumes: { music: 0.82, voice: 0.58 }
            });
            if (mixedPath && fs.existsSync(mixedPath)) {
                fs.copyFileSync(mixedPath, musicLocalPath);
                try {
                    fs.unlinkSync(mixedPath);
                } catch (_) {
                    /* ignore */
                }
                const mixedPublic = musicAudioStore.buildMusicAudioPublicUrl(musicId);
                if (mixedPublic) publicUrl = mixedPublic;
                logInfo('人声混音', '已完成', { musicId });
            }
        }
    } catch (mixErr) {
        logWarn('人声混音', mixErr.message || '失败，保留纯音乐', { musicId });
    }

    const ms =
        audioDurationMs != null && Number.isFinite(Number(audioDurationMs))
            ? Math.round(Number(audioDurationMs))
            : null;
    try {
        db.prepare(
            `UPDATE music_tracks SET status = ?, audio_url = ?, audio_duration_ms = ? WHERE id = ?`
        ).run('completed', publicUrl, ms, musicId);
        logInfo('作品音频', '已就绪', {
            musicId,
            hosted: musicAudioStore.isSelfHostedMusicAudioUrl(publicUrl)
        });

        const owner = db
            .prepare(
                `SELECT u.wx_openid FROM users u
                 INNER JOIN music_tracks t ON t.user_id = u.id WHERE t.id = ?`
            )
            .get(musicId);
        if (owner && owner.wx_openid) {
            scheduleAudioMediaCheck(owner.wx_openid, publicUrl, 'music_track', musicId);
        }
    } catch (err) {
        logError('写入作品音频', err, { musicId });
    }
}

// 生成音乐音频：生产环境（NODE_ENV=production）默认禁止 mock 与示例音
async function generateMusicAudio(
    musicId,
    instrument,
    frequency,
    duration,
    bpm,
    soundEffects,
    promptExtras = {}
) {
    const musicService = process.env.MUSIC_SERVICE || 'minimax';

    if (musicService === 'minimax') {
        try {
            const result = await generateMusic({
                instrument,
                frequency,
                bpm,
                userId: 'system',
                durationSeconds: duration != null ? Number(duration) : 180,
                soundEffects: Array.isArray(soundEffects) ? soundEffects : [],
                userPrompt: promptExtras.userPrompt,
                moodLabel: promptExtras.moodLabel,
                sceneLabels: promptExtras.sceneLabels,
                hasVoiceTrack: !!(promptExtras && promptExtras.hasVoiceTrack),
                referenceAudioUrl:
                    promptExtras && promptExtras.referenceAudioUrl
                        ? promptExtras.referenceAudioUrl
                        : ''
            });

            if (!result || result.success !== true) {
                console.error('[generateMusicAudio] MiniMax 不可用:', result && result.error);
                try {
                    db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?').run('failed', musicId);
                } catch (err) {
                    console.error('[DB] 更新失败状态:', err);
                }
                return;
            }

            if (result.audioUrl) {
                await completeMusicTrackWithAudio(
                    musicId,
                    result.audioUrl,
                    result.audioDurationMs
                );
                console.log(`[Music Generated] ${musicId}: persisted`);
                return;
            }

            if (result.jobId) {
                pollMinimaxStatus(musicId, result.jobId);
                return;
            }

            console.error('[generateMusicAudio] MiniMax 返回无 audioUrl/jobId');
            try {
                db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?').run('failed', musicId);
            } catch (err) {
                console.error('[DB] 更新失败状态:', err);
            }
            return;
        } catch (error) {
            console.error('[generateMusicAudio] MiniMax 调用失败:', error);
            try {
                db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?').run('failed', musicId);
            } catch (err) {
                console.error('[DB] 更新失败状态:', err);
            }
            return;
        }
    }

    if (!isMinimaxMockAllowed()) {
        try {
            db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?').run('failed', musicId);
        } catch (err) {
            console.error('[DB] 更新失败状态:', err);
        }
        console.warn('[generateMusicAudio] 非 minimax 服务且禁止 mock，已标记 failed:', musicId);
        return;
    }

    const sampleUrls = {
        guqin: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        piano: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        handpan: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
        cello: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3'
    };

    const audioUrl = sampleUrls[instrument] || sampleUrls.guqin;

    setTimeout(() => {
        completeMusicTrackWithAudio(musicId, audioUrl, null).catch((err) => {
            console.error('[DB] Mock 音频落盘失败:', err);
        });
    }, 5000);
}

// 轮询 MiniMax 生成状态（每 3s；默认 120 次≈6 分钟，合成常超过 3 分钟可调 MINIMAX_POLL_MAX_ATTEMPTS）
function pollMinimaxStatus(musicId, jobId) {
    let attempts = 0;
    const maxAttempts = parseInt(process.env.MINIMAX_POLL_MAX_ATTEMPTS || '120', 10) || 120;

    const interval = setInterval(async () => {
        attempts++;
        try {
            const status = await checkGenerationStatus(jobId);

            if (status.success === false) {
                clearInterval(interval);
                try {
                    const stmt = db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?');
                    stmt.run('failed', musicId);
                } catch (err) {
                    console.error('[DB] 更新失败状态失败:', err);
                }
                console.warn(
                    `[Music Generation Failed] ${musicId}（状态查询失败）:`,
                    status.error || ''
                );
                return;
            }

            if (status.status === 'completed') {
                clearInterval(interval);
                let audioUrl = status.audioUrl;
                if (!audioUrl) {
                    if (!isMinimaxMockAllowed()) {
                        try {
                            const stmt = db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?');
                            stmt.run('failed', musicId);
                        } catch (err) {
                            console.error('[DB] 更新失败状态失败:', err);
                        }
                        console.warn(`[Music Generation Failed] ${musicId}（completed 但无音频 URL）`);
                        return;
                    }
                    audioUrl = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
                }
                await completeMusicTrackWithAudio(
                    musicId,
                    audioUrl,
                    status.audioDurationMs
                );
                console.log(`[Music Generated] ${musicId}: persisted`);
                return;
            } else if (status.status === 'failed') {
                clearInterval(interval);
                try {
                    const stmt = db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?');
                    stmt.run('failed', musicId);
                } catch (err) {
                    console.error('[DB] 更新失败状态失败:', err);
                }
                console.log(`[Music Generation Failed] ${musicId}`);
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                try {
                    const stmt = db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?');
                    stmt.run('timeout', musicId);
                } catch (err) {
                    console.error('[DB] 更新超时状态失败:', err);
                }
                console.warn(
                    `[Music Generation Timeout] musicId=${musicId} jobId=${jobId} ` +
                        `已轮询 ${maxAttempts} 次（约 ${maxAttempts * 3}s），数据库已标记 status=timeout。可调 MINIMAX_POLL_MAX_ATTEMPTS`
                );
            }
        } catch (error) {
            console.error(
                `[pollMinimaxStatus] 单次查询异常（不中断轮询，下次继续） musicId=${musicId} jobId=${jobId}:`,
                error.message || error
            );
        }
    }, 3000);
}


const { generateBlessing, generateBlessingOffline } = require('./ai-service');

app.post('/api/ai/generate-blessing', async (req, res) => {
    const { recipient, relationship } = req.body;

    if (!recipient || recipient.trim().length === 0) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '收件人姓名不能为空');
    }

    try {
        const blessing = await generateBlessing(recipient, relationship || '朋友');
        sendSuccess(res, {
            blessing,
            source: 'deepseek'
        }, '祝福语生成成功');
    } catch (error) {
        logError('AI生成祝福语', error, { recipient, relationship });
        // 降级到本地模板
        const fallback = generateBlessingOffline(recipient);
        sendSuccess(res, {
            blessing: fallback,
            source: 'offline'
        }, 'AI服务暂不可用，已使用本地模板');
    }
});


// 获取或初始化用户积分
function getOrInitPoints(userId) {
    const row = db.prepare('SELECT * FROM user_points WHERE user_id = ?').get(userId);
    if (!row) {
        db.prepare('INSERT INTO user_points (user_id, points, total_points) VALUES (?, 0, 0)').run(userId);
        return { points: 0, total_points: 0 };
    }
    return row;
}

app.get('/api/points/:openid', authMiddleware, (req, res) => {
    const { openid } = req.params;

    if (!openid) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '用户openid不能为空');
    }
    if (openid !== req.user.wx_openid) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权查看其他用户的积分');
    }

    try {
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }
        const pointsData = getOrInitPoints(user.id);
        sendSuccess(res, {
            points: pointsData.points,
            totalPoints: pointsData.total_points
        });
    } catch (err) {
        logError('获取用户积分', err, { openid });
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

app.post('/api/points/add', authMiddleware, (req, res) => {
    const { points, type, description } = req.body;
    const openid = req.user.wx_openid;

    if (!points || isNaN(Number(points)) || Number(points) <= 0) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '积分数量必须是大于0的数字');
    }
    if (!type) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '积分类型不能为空');
    }

    const pointsNum = Number(points);

    try {
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }

        getOrInitPoints(user.id);

        db.prepare("UPDATE user_points SET points = points + ?, total_points = total_points + ?, updated_at = datetime('now', 'localtime') WHERE user_id = ?")
            .run(pointsNum, pointsNum, user.id);

        const historyId = uuidv4();
        db.prepare('INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)')
            .run(historyId, user.id, pointsNum, type, description || '');

        const updated = db.prepare('SELECT points, total_points FROM user_points WHERE user_id = ?').get(user.id);
        sendSuccess(res, {
            currentPoints: updated.points,
            addedPoints: pointsNum
        }, '积分添加成功');
    } catch (err) {
        logError('增加积分', err, { openid, points, type });
        sendError(res, ErrorCode.POINTS_ADD_FAILED, err.message);
    }
});

app.post('/api/points/deduct', authMiddleware, (req, res) => {
    const { points, type, description } = req.body;
    const openid = req.user.wx_openid;

    if (!points || isNaN(Number(points)) || Number(points) <= 0) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '积分数量必须是大于0的数字');
    }
    if (!type) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '积分类型不能为空');
    }

    const pointsNum = Number(points);

    try {
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }

        getOrInitPoints(user.id);

        const current = db.prepare('SELECT points FROM user_points WHERE user_id = ?').get(user.id);
        if (!current || current.points < pointsNum) {
            return sendError(res, ErrorCode.INSUFFICIENT_POINTS);
        }

        db.prepare("UPDATE user_points SET points = points - ?, updated_at = datetime('now', 'localtime') WHERE user_id = ?")
            .run(pointsNum, user.id);

        const historyId = uuidv4();
        db.prepare('INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)')
            .run(historyId, user.id, -pointsNum, type, description || '');

        const updated = db.prepare('SELECT points FROM user_points WHERE user_id = ?').get(user.id);
        sendSuccess(res, {
            currentPoints: updated.points,
            deductedPoints: pointsNum
        }, '积分扣除成功');
    } catch (err) {
        logError('扣除积分', err, { openid, points, type });
        sendError(res, ErrorCode.POINTS_DEDUCT_FAILED, err.message);
    }
});

app.get('/api/points/:openid/history', authMiddleware, (req, res) => {
    const { openid } = req.params;
    const { page = 1, limit = 20, kind: kindQuery } = req.query;

    if (!openid) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '用户openid不能为空');
    }
    if (openid !== req.user.wx_openid) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权查看其他用户的积分记录');
    }

    const kindRaw = (kindQuery != null ? String(kindQuery) : 'all').toLowerCase();
    let kind = 'all';
    if (kindRaw === 'income' || kindRaw === 'expense') {
        kind = kindRaw;
    } else if (kindRaw !== 'all' && kindRaw !== '') {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'kind 须为 all、income 或 expense');
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
        return sendError(res, ErrorCode.PAGE_PARAM_ERROR, 'page参数必须是大于0的数字');
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return sendError(res, ErrorCode.PAGE_PARAM_ERROR, 'limit参数必须在1-100之间');
    }

    const offset = (pageNum - 1) * limitNum;

    let pointsCond = '';
    if (kind === 'income') {
        pointsCond = ' AND points > 0';
    } else if (kind === 'expense') {
        pointsCond = ' AND points < 0';
    }

    try {
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }

        const list = db.prepare(`
            SELECT * FROM points_history
            WHERE user_id = ?${pointsCond}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(user.id, limitNum, offset);

        const countRow = db
            .prepare(`SELECT COUNT(*) as total FROM points_history WHERE user_id = ?${pointsCond}`)
            .get(user.id);

        const sums = db
            .prepare(
                `SELECT
                    COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 0 END), 0) AS totalIncome,
                    COALESCE(SUM(CASE WHEN points < 0 THEN -points ELSE 0 END), 0) AS totalExpense
                FROM points_history WHERE user_id = ?`
            )
            .get(user.id);

        sendSuccess(res, {
            list,
            total: countRow.total,
            page: pageNum,
            limit: limitNum,
            kind,
            summary: {
                totalIncome: sums.totalIncome,
                totalExpense: sums.totalExpense
            }
        });
        logInfo('积分明细', '查询成功', {
            openid,
            userId: user.id,
            kind,
            page: pageNum,
            limit: limitNum,
            total: countRow.total,
            listCount: list.length,
            totalIncome: sums.totalIncome,
            totalExpense: sums.totalExpense
        });
    } catch (err) {
        logError('获取积分记录', err, { openid, page, limit });
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

app.get('/api/points/config', (req, res) => {
    sendSuccess(res, POINTS_TYPE);
});


app.post("/api/music/generate", async (req, res) => {
    const { userId, instrument, frequency, bpm, duration: bodyDuration, soundEffects: bodySoundEffects } =
        req.body;

    // 参数校验
    if (!instrument) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '乐器类型不能为空');
    }
    if (!frequency) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '脑波频率不能为空');
    }
    if (!bpm || isNaN(Number(bpm))) {
        return sendError(res, ErrorCode.INVALID_MUSIC_PARAMS, 'BPM参数无效');
    }

    const musicId = uuidv4();

    try {
        const stmt = db.prepare('INSERT INTO music_tracks (id, user_id, main_instrument, frequency, bpm, status) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(musicId, userId || "anonymous", instrument, frequency, bpm, "generating");
    } catch (err) {
        logError('插入音乐记录', err, { musicId, userId });
        return sendError(res, convertDbError(err), err.message);
    }

    try {
        const result = await generateMusic({
            instrument,
            frequency,
            bpm,
            userId: userId || "anonymous",
            durationSeconds:
                bodyDuration != null && !Number.isNaN(Number(bodyDuration))
                    ? Number(bodyDuration)
                    : undefined,
            soundEffects: Array.isArray(bodySoundEffects) ? bodySoundEffects : []
        });

        if (result.success) {
            sendSuccess(res, {
                musicId: musicId,
                jobId: result.jobId,
                status: result.status,
                estimatedTime: result.estimatedTime,
                mock: result.mock || false
            }, '音乐生成任务已创建');
        } else {
            // 更新数据库状态为失败
            try {
                const updateStmt = db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?');
                updateStmt.run('failed', musicId);
            } catch (dbErr) {
                logWarn('更新音乐失败状态', dbErr.message);
            }
            sendError(res, ErrorCode.MUSIC_GENERATION_FAILED, '外部API调用失败');
        }
    } catch (error) {
        logError('生成音乐', error, { musicId, instrument, frequency });
        // 更新数据库状态为失败
        try {
            const updateStmt = db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?');
            updateStmt.run('failed', musicId);
        } catch (dbErr) {
            logWarn('更新音乐失败状态', dbErr.message);
        }
        sendError(res, ErrorCode.MUSIC_GENERATION_FAILED, error.message);
    }
});

// 注：查询音乐状态由上方第2个路由统一处理，无需重复定义



const {
    mixEffects,
    mixFinalAudio,
    probeAudioDurationSec,
    assertReferenceAudioDurationSec,
    AUDIO_DIR
} = require('./audio-mixer');

app.post("/api/audio/mix-effects", async (req, res) => {
    const { effects, duration } = req.body;

    // 参数校验
    if (!effects || !Array.isArray(effects)) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'effects参数必须是数组');
    }
    if (effects.length === 0) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'effects数组不能为空');
    }

    try {
        const outputFile = await mixEffects(effects, duration || 180);
        sendSuccess(res, {
            filePath: outputFile,
            url: `/audio/${path.basename(outputFile)}`
        }, '白噪音合成成功');
    } catch (error) {
        logError('合成白噪音', error, { effects, duration });
        sendError(res, ErrorCode.AUDIO_MIX_FAILED, error.message);
    }
});

app.post("/api/audio/mix-final", async (req, res) => {
    const { musicUrl, effectsFile, voiceFile, volumes } = req.body;

    // 参数校验
    if (!musicUrl && !effectsFile && !voiceFile) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '至少需要提供一条音轨');
    }

    try {
        const outputFile = await mixFinalAudio({
            musicUrl,
            effectsFile,
            voiceFile,
            volumes
        });
        sendSuccess(res, {
            filePath: outputFile,
            url: `/audio/${path.basename(outputFile)}`
        }, '音频混音成功');
    } catch (error) {
        logError('三轨混音', error, { musicUrl, effectsFile, voiceFile });
        sendError(res, ErrorCode.AUDIO_MIX_FAILED, error.message);
    }
});

app.get("/audio/:filename", (req, res) => {
    const { filename } = req.params;

    if (!filename) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '文件名不能为空');
    }

    // 安全检查：防止目录遍历攻击
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(AUDIO_DIR, sanitizedFilename);

    // 确保文件路径在允许的目录内
    if (!filePath.startsWith(AUDIO_DIR)) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '非法文件路径');
    }

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        sendError(res, ErrorCode.FILE_NOT_FOUND);
    }
});

app.get("/audio/library/:filename", (req, res) => {
    const { filename } = req.params;

    if (!filename) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '文件名不能为空');
    }

    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(libraryAudioDir, sanitizedFilename);
    const libraryRoot = path.resolve(libraryAudioDir) + path.sep;

    if (!path.resolve(filePath).startsWith(libraryRoot)) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '非法文件路径');
    }

    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.sendFile(filePath);
    } else {
        logWarn('读取官方曲库音频(旧路径)', '文件不存在', {
            libraryAudioDir,
            filename: sanitizedFilename,
            filePath,
            hint: '请使用 /api/music/library-audio?f='
        });
        sendError(res, ErrorCode.FILE_NOT_FOUND);
    }
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
    logError('全局错误处理', err, {
        url: req.url,
        method: req.method,
        body: req.body,
        query: req.query
    });

    // 根据错误类型返回不同的错误码
    if (err.name === 'ValidationError') {
        return sendError(res, ErrorCode.INVALID_FORMAT, err.message);
    }
    if (err.name === 'UnauthorizedError') {
        return sendError(res, ErrorCode.UNAUTHORIZED);
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return sendError(res, ErrorCode.EXTERNAL_API_TIMEOUT);
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, err.message);
});

/**
 * 微信消息推送（media_check_async 结果 Event=wxa_media_check）
 * 公众平台配置 URL：https://你的域名/api/wechat/msg-push ，Token=WX_MSG_TOKEN
 */
app.all('/api/wechat/msg-push', (req, res) => {
    const token = String(process.env.WX_MSG_TOKEN || '').trim();

    if (req.method === 'GET') {
        const { signature, timestamp, nonce, echostr } = req.query;
        if (token && verifyWechatMsgSignature(token, timestamp, nonce, signature)) {
            return res.send(String(echostr || ''));
        }
        return res.status(403).send('forbidden');
    }

    const body = req.body || {};
    const event = String(body.Event || body.event || '').toLowerCase();
    if (event === 'wxa_media_check') {
        mediaSecStore.applyRiskyCallback(db, body, mediaSecStore.DEFAULT_HANDLERS);
    }

    res.send('success');
});

// 404 处理
app.use((req, res) => {
    sendError(res, ErrorCode.UNKNOWN_ERROR, '接口不存在');
});

// 启动服务器
app.listen(PORT, () => {
    logInfo('系统启动', `
🌙 乐伴好眠 v2 服务器启动
🌍 运行环境: ${NODE_ENV}
📡 端口: ${PORT}
📁 数据库: ${dbPath}
📷 上传目录: ${uploadDir}
📋 日志目录: ${resolveLogDir()}（按天 app-YYYY-MM-DD.log）
🔧 功能:
   1. 主乐器 + 白噪音时间轴
   2. AI 生成贺卡
   3. 社群分享
   4. 积分系统（对接星鹿商城 zhongshu.xinglu.shop）
  `);
});
