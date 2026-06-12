const { getDb } = require('../bootstrap/database');

const SHARE_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isShareUuid(id) {
    const s = id != null ? String(id).trim() : '';
    return s !== '' && SHARE_UUID_RE.test(s);
}

function findShareById(shareId) {
    return getDb().prepare('SELECT * FROM card_shares WHERE id = ?').get(shareId);
}

function findShareSenderMeta(shareId) {
    return getDb().prepare('SELECT id, sender_id FROM card_shares WHERE id = ?').get(shareId);
}

function insertShare(row) {
    getDb()
        .prepare(
            `INSERT INTO card_shares (
                id, music_id, sender_id, recipient, message, template, template_id,
                music_instrument, music_frequency, music_bpm, cover_image, audio_url,
                artist_bg_image, saved_to_library, source_channel
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            row.id,
            row.musicId,
            row.senderId,
            row.recipient,
            row.message || '',
            row.template,
            row.templateId,
            row.musicInstrument || '',
            row.musicFrequency || '',
            row.musicBpm || 60,
            row.coverImage || '',
            row.audioUrl || '',
            row.artistBgImage || '',
            row.savedToLibrary != null ? row.savedToLibrary : 0,
            row.sourceChannel || null
        );
}

function listSavedSharesBySender(userId, limit) {
    return getDb()
        .prepare(
            `SELECT id, music_id, recipient, message, template, template_id,
                    music_instrument, music_frequency, music_bpm,
                    cover_image, audio_url, artist_bg_image, created_at
             FROM card_shares
             WHERE sender_id = ? AND COALESCE(saved_to_library, 0) = 1
             ORDER BY datetime(created_at) DESC
             LIMIT ?`
        )
        .all(userId, limit);
}

function findMusicTrackForShare(musicId) {
    return getDb()
        .prepare(
            `SELECT title, player_cover_url, audio_url, audio_duration_ms, duration,
                    main_instrument, frequency, bpm
             FROM music_tracks WHERE id = ?`
        )
        .get(musicId);
}

function upsertGiftInbox(userId, shareId, senderId) {
    getDb()
        .prepare(
            `INSERT INTO card_gift_inbox (user_id, share_id, sender_id, first_opened_at, last_opened_at)
             VALUES (?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
             ON CONFLICT(user_id, share_id) DO UPDATE SET
               last_opened_at = datetime('now', 'localtime'),
               sender_id = excluded.sender_id`
        )
        .run(userId, shareId, senderId || null);
}

function listGiftInboxRows(userId, limit) {
    return getDb()
        .prepare(
            `SELECT i.share_id, i.sender_id, i.first_opened_at, i.last_opened_at,
                    s.recipient, s.message, s.music_id, s.cover_image, s.artist_bg_image,
                    s.created_at AS shared_at,
                    m.title AS work_title, m.player_cover_url
             FROM card_gift_inbox i
             INNER JOIN card_shares s ON s.id = i.share_id
             LEFT JOIN music_tracks m ON m.id = s.music_id
             WHERE i.user_id = ?
             ORDER BY datetime(i.last_opened_at) DESC
             LIMIT ?`
        )
        .all(userId, limit);
}

function deleteGiftInboxItem(userId, shareId) {
    return getDb()
        .prepare('DELETE FROM card_gift_inbox WHERE user_id = ? AND share_id = ?')
        .run(userId, shareId);
}

module.exports = {
    isShareUuid,
    findShareById,
    findShareSenderMeta,
    insertShare,
    listSavedSharesBySender,
    findMusicTrackForShare,
    upsertGiftInbox,
    listGiftInboxRows,
    deleteGiftInboxItem
};
