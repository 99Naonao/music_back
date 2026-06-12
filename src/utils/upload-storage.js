const fs = require('fs');
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
    return `${base}/api/upload/audio/${encoded}`;
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
