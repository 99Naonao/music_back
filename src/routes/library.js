/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const { incrementMusicPlayCount } = require('../utils/music-play-count');

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

router.post('/play-history', authMiddleware, (req, res) => {
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
router.get('/play-history', authMiddleware, (req, res) => {
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

router.get('/favorites/count', authMiddleware, (req, res) => {
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

router.get('/favorites', authMiddleware, (req, res) => {
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

router.post('/favorites/:musicId', authMiddleware, (req, res) => {
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

router.delete('/favorites/:musicId', authMiddleware, (req, res) => {
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
router.delete('/play-history', authMiddleware, (req, res) => {
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
router.get('/notifications', authMiddleware, (req, res) => {
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
router.get('/notifications/unread-count', authMiddleware, (req, res) => {
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
router.put('/notifications/:id/read', authMiddleware, (req, res) => {
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
router.put('/notifications/read-all', authMiddleware, (req, res) => {
    const userId = req.user.id;

    try {
        db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
        sendSuccess(res, null, '全部标记为已读');
    } catch (err) {
        logError('标记全部已读', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

module.exports = router;
