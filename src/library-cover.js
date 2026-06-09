const path = require('path');

/** 与服务器目录一致：images/muisc_img/track1.png（可按环境变量改名） */
const LIBRARY_COVER_SUBDIR = process.env.LIBRARY_COVER_SUBDIR || 'muisc_img';

function coverRelPathFromAudioFilename(filename) {
    const stem = path.basename(String(filename || '').trim(), path.extname(filename));
    if (!stem) return '';
    return `/images/${LIBRARY_COVER_SUBDIR}/${stem}.png`;
}

function coverRelPathFromAudioUrl(audioUrl) {
    const u = String(audioUrl || '').trim();
    if (!u) return '';
    const m = u.match(/[?&]f=([^&]+)/i);
    const name = m ? decodeURIComponent(m[1]) : path.basename(u.split('?')[0]);
    return coverRelPathFromAudioFilename(name);
}

function resolveLibraryCoverRel(stored, audioUrl) {
    const raw = String(stored || '').trim();
    if (raw) {
        if (raw.startsWith('/images/')) return raw;
        if (raw.startsWith('images/')) return `/${raw}`;
        return raw;
    }
    return coverRelPathFromAudioUrl(audioUrl);
}

function toAbsoluteCoverUrl(relOrAbs, baseUrl) {
    const u = String(relOrAbs || '').trim();
    if (!u) return '';
    if (u.startsWith('http://') || u.startsWith('https://')) {
        return u.startsWith('http://') ? `https://${u.slice(7)}` : u;
    }
    const base = String(baseUrl || process.env.BASE_URL || '').replace(/\/$/, '');
    if (!base) return u.startsWith('/') ? u : `/${u}`;
    return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
}

module.exports = {
    LIBRARY_COVER_SUBDIR,
    coverRelPathFromAudioFilename,
    coverRelPathFromAudioUrl,
    resolveLibraryCoverRel,
    toAbsoluteCoverUrl
};
