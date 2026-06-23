const { getDb } = require('../bootstrap/database');

function upsertPlayHistory(userId, payload, playedAtDb) {
    const db = getDb();
    const sourceChannel = payload.sourceChannel || null;
    if (playedAtDb) {
        db.prepare(`
            INSERT INTO play_history (user_id, music_id, title, audio_url, cover, instrument, frequency, duration_sec, source, source_channel, played_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, music_id) DO UPDATE SET
                title = excluded.title,
                audio_url = excluded.audio_url,
                cover = excluded.cover,
                instrument = excluded.instrument,
                frequency = excluded.frequency,
                duration_sec = excluded.duration_sec,
                source = excluded.source,
                source_channel = excluded.source_channel,
                played_at = excluded.played_at
        `).run(
            userId,
            payload.musicId,
            payload.title,
            payload.audioUrl,
            payload.cover,
            payload.instrument,
            payload.frequency,
            payload.durationSec,
            payload.source,
            sourceChannel,
            playedAtDb
        );
    } else {
        db.prepare(`
            INSERT INTO play_history (user_id, music_id, title, audio_url, cover, instrument, frequency, duration_sec, source, source_channel, played_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
            ON CONFLICT(user_id, music_id) DO UPDATE SET
                title = excluded.title,
                audio_url = excluded.audio_url,
                cover = excluded.cover,
                instrument = excluded.instrument,
                frequency = excluded.frequency,
                duration_sec = excluded.duration_sec,
                source = excluded.source,
                source_channel = excluded.source_channel,
                played_at = datetime('now', 'localtime')
        `).run(
            userId,
            payload.musicId,
            payload.title,
            payload.audioUrl,
            payload.cover,
            payload.instrument,
            payload.frequency,
            payload.durationSec,
            payload.source,
            sourceChannel
        );
    }
}

function listPlayHistory(userId, limit) {
    const db = getDb();
    const rows = db
        .prepare(
            `SELECT music_id, title, audio_url, cover, instrument, frequency, duration_sec, source, played_at
             FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?`
        )
        .all(userId, limit);
    const countRow = db.prepare('SELECT COUNT(*) as total FROM play_history WHERE user_id = ?').get(userId);
    return { rows, total: countRow.total };
}

function clearPlayHistory(userId) {
    getDb().prepare('DELETE FROM play_history WHERE user_id = ?').run(userId);
}

function countFavorites(userId) {
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM user_favorites WHERE user_id = ?').get(userId);
    return row ? row.c : 0;
}

function getCommunityPostStats(userId) {
    const row = getDb()
        .prepare(
            `SELECT COUNT(*) AS postsCount, COALESCE(SUM(likes), 0) AS totalLikesReceived
             FROM community_posts WHERE user_id = ?`
        )
        .get(userId);
    return {
        postsCount: row ? row.postsCount || 0 : 0,
        totalLikesReceived: row ? row.totalLikesReceived || 0 : 0
    };
}

function listFavorites(userId, limit) {
    return getDb()
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
        .all(userId, limit);
}

function findTrackId(musicId) {
    return getDb().prepare('SELECT id FROM music_tracks WHERE id = ?').get(musicId);
}

function addFavorite(userId, musicId) {
    getDb()
        .prepare(
            `INSERT INTO user_favorites (user_id, music_id, created_at)
             VALUES (?, ?, datetime('now', 'localtime'))
             ON CONFLICT(user_id, music_id) DO NOTHING`
        )
        .run(userId, musicId);
}

function removeFavorite(userId, musicId) {
    getDb().prepare('DELETE FROM user_favorites WHERE user_id = ? AND music_id = ?').run(userId, musicId);
}

function listNotifications(userId, limit, offset) {
    const db = getDb();
    const list = db
        .prepare(
            `SELECT id, type, title, content, related_id, read, created_at
             FROM notifications WHERE user_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`
        )
        .all(userId, limit, offset);
    const countRow = db.prepare('SELECT COUNT(*) as total FROM notifications WHERE user_id = ?').get(userId);
    const unreadRow = db
        .prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0')
        .get(userId);
    return { list, total: countRow.total, unread: unreadRow.count };
}

function countUnreadNotifications(userId) {
    const row = getDb()
        .prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0')
        .get(userId);
    return row.count;
}

function markNotificationRead(userId, id) {
    return getDb()
        .prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
        .run(id, userId);
}

function markAllNotificationsRead(userId) {
    getDb().prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
}

module.exports = {
    upsertPlayHistory,
    listPlayHistory,
    clearPlayHistory,
    countFavorites,
    getCommunityPostStats,
    listFavorites,
    findTrackId,
    addFavorite,
    removeFavorite,
    listNotifications,
    countUnreadNotifications,
    markNotificationRead,
    markAllNotificationsRead
};
