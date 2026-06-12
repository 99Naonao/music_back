const libraryRepo = require('../repositories/library');
const { sanitizePlayerCoverUrlForClient } = require('../utils/media-url');
const { incrementMusicPlayCount } = require('../utils/music-play-count');
const { ErrorCode } = require('../error-codes');

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

function mapFavoriteTrackRow(row) {
    const cover = row.player_cover_url ? sanitizePlayerCoverUrlForClient(row.player_cover_url) : '';
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

function recordPlayHistory(userId, body) {
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
    } = body || {};

    const mid = String(musicId || id || '').trim();
    const url = audioUrl ? String(audioUrl).trim() : '';
    if (!mid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'musicId不能为空' };
    }
    if (!url) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'audioUrl不能为空' };
    }

    libraryRepo.upsertPlayHistory(
        userId,
        {
            musicId: mid,
            title: title ? String(title).slice(0, 200) : '助眠音乐',
            audioUrl: url,
            cover: cover ? String(cover).slice(0, 500) : '',
            instrument: instrument ? String(instrument).slice(0, 64) : '',
            frequency: frequency ? String(frequency).slice(0, 64) : '',
            durationSec: Math.max(0, parseInt(durationSec, 10) || 0),
            source: source ? String(source).slice(0, 32) : 'app'
        },
        parsePlayedAtForDb(playedAt)
    );
    incrementMusicPlayCount(mid);
    return { ok: true, data: { musicId: mid } };
}

function getPlayHistory(userId, limitQuery) {
    let limit = parseInt(limitQuery, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 100;
    if (limit > 100) limit = 100;
    const { rows, total } = libraryRepo.listPlayHistory(userId, limit);
    return {
        ok: true,
        data: { list: rows.map(mapPlayHistoryRow), total, limit }
    };
}

function clearPlayHistory(userId) {
    libraryRepo.clearPlayHistory(userId);
    return { ok: true, data: null };
}

function getFavoritesCount(userId) {
    return { ok: true, data: { count: libraryRepo.countFavorites(userId) } };
}

function getFavorites(userId, limitQuery) {
    let limit = parseInt(limitQuery, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 100;
    if (limit > 100) limit = 100;
    const rows = libraryRepo.listFavorites(userId, limit);
    const list = rows.filter((r) => r.audio_url && String(r.audio_url).trim()).map(mapFavoriteTrackRow);
    return { ok: true, data: { list, total: list.length, limit } };
}

function addFavorite(userId, musicId) {
    const mid = String(musicId || '').trim();
    if (!mid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'musicId不能为空' };
    }
    if (!libraryRepo.findTrackId(mid)) {
        return { ok: false, error: ErrorCode.MUSIC_NOT_FOUND };
    }
    libraryRepo.addFavorite(userId, mid);
    return { ok: true, data: { musicId: mid, favorited: true } };
}

function removeFavorite(userId, musicId) {
    const mid = String(musicId || '').trim();
    if (!mid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'musicId不能为空' };
    }
    libraryRepo.removeFavorite(userId, mid);
    return { ok: true, data: { musicId: mid, favorited: false } };
}

function getNotifications(userId, page, limit) {
    const pageNum = Number(page);
    const limitNum = Number(limit);
    if (isNaN(pageNum) || pageNum < 1) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'page参数必须是大于0的数字' };
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'limit参数必须在1-100之间' };
    }
    const offset = (pageNum - 1) * limitNum;
    const { list, total, unread } = libraryRepo.listNotifications(userId, limitNum, offset);
    return {
        ok: true,
        data: { list, total, unread, page: pageNum, limit: limitNum },
        meta: { userId }
    };
}

function getUnreadNotificationCount(userId) {
    return { ok: true, data: { count: libraryRepo.countUnreadNotifications(userId) }, meta: { userId } };
}

function markNotificationRead(userId, id) {
    if (!id) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '通知ID不能为空' };
    }
    const result = libraryRepo.markNotificationRead(userId, id);
    if (result.changes === 0) {
        return { ok: false, error: ErrorCode.NOT_FOUND, message: '通知不存在' };
    }
    return { ok: true, data: null };
}

function markAllNotificationsRead(userId) {
    libraryRepo.markAllNotificationsRead(userId);
    return { ok: true, data: null };
}

module.exports = {
    recordPlayHistory,
    getPlayHistory,
    clearPlayHistory,
    getFavoritesCount,
    getFavorites,
    addFavorite,
    removeFavorite,
    getNotifications,
    getUnreadNotificationCount,
    markNotificationRead,
    markAllNotificationsRead
};
