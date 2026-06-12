const path = require('path');

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

/** 贺卡分享图（自定义相册 / 模板底图）返回给客户端的绝对 https 地址 */
function sanitizeCardShareImageForClient(req, urlStr) {
    const raw = String(urlStr || '').trim();
    if (!raw) return '';
    const hosted = sanitizePlayerCoverUrlForClient(raw);
    if (hosted) return hosted;
    if (/^https:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) {
        return `${getApiBaseUrl(req)}${raw}`;
    }
    return raw;
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
