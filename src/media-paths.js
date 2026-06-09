const path = require('path');

/** 与 DB_PATH / DATA_DIR 对齐的数据根目录 */
function resolveDataDir() {
    if (process.env.DATA_DIR) {
        return path.resolve(process.env.DATA_DIR);
    }
    if (process.env.DB_PATH) {
        return path.dirname(path.resolve(process.env.DB_PATH));
    }
    return path.join(__dirname, '../data');
}

function resolveAudioDir() {
    return path.join(resolveDataDir(), 'audio');
}

/** 官方曲库 mp3 落盘目录（与 import-library.js 一致） */
function resolveLibraryAudioDir() {
    if (process.env.LIBRARY_AUDIO_DIR) {
        return path.resolve(process.env.LIBRARY_AUDIO_DIR);
    }
    return path.join(resolveDataDir(), 'audio', 'library');
}

/** 对外播放地址（走 /api/，避免 Nginx 按 .mp3 后缀静态拦截） */
function buildLibraryAudioPublicPath(filename) {
    const safe = path.basename(String(filename || '').trim());
    return `/api/music/library-audio?f=${encodeURIComponent(safe)}`;
}

/** 将库内旧路径 /audio/library/xxx.mp3 转为 API 查询形式 */
function normalizeLibraryAudioUrl(stored) {
    const u = String(stored || '').trim();
    if (!u) return '';
    if (u.includes('library-audio')) return u;
    const legacy = u.match(/\/audio\/library\/([^?#/]+)/i);
    if (legacy && legacy[1]) {
        return buildLibraryAudioPublicPath(decodeURIComponent(legacy[1]));
    }
    return u;
}

module.exports = {
    resolveDataDir,
    resolveAudioDir,
    resolveLibraryAudioDir,
    buildLibraryAudioPublicPath,
    normalizeLibraryAudioUrl
};
