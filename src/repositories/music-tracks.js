const { getDb } = require('../bootstrap/database');

function findById(id) {
    return getDb().prepare('SELECT * FROM music_tracks WHERE id = ?').get(id);
}

function getStatus(id) {
    const row = getDb().prepare('SELECT status FROM music_tracks WHERE id = ?').get(id);
    return row ? String(row.status || '').toLowerCase() : '';
}

function isCancelled(id) {
    return getStatus(id) === 'cancelled';
}

function setStatusIfNotCancelled(id, status) {
    return getDb()
        .prepare(`UPDATE music_tracks SET status = ? WHERE id = ? AND status != 'cancelled'`)
        .run(status, id).changes;
}

function setStatus(id, status) {
    getDb().prepare(`UPDATE music_tracks SET status = ? WHERE id = ?`).run(status, id);
}

function insertTrack(row) {
    getDb()
        .prepare(
            `INSERT INTO music_tracks (id, user_id, title, main_instrument, frequency, duration, bpm, source_channel)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            row.id,
            row.userId,
            row.title,
            row.mainInstrument,
            row.frequency,
            row.duration,
            row.bpm,
            row.sourceChannel
        );
}

function updateVoiceUrl(musicId, voiceUrl) {
    getDb().prepare('UPDATE music_tracks SET voice_url = ? WHERE id = ?').run(voiceUrl, musicId);
}

function updateReferenceAudioUrl(musicId, url) {
    getDb().prepare('UPDATE music_tracks SET reference_audio_url = ? WHERE id = ?').run(url, musicId);
}

function insertSoundEffect(effect) {
    getDb()
        .prepare(
            `INSERT INTO sound_effects (id, music_id, effect_type, start_time, end_time, volume)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
            effect.id,
            effect.musicId,
            effect.type,
            effect.startTime,
            effect.endTime,
            effect.volume
        );
}

function listSoundEffects(musicId) {
    return getDb()
        .prepare('SELECT * FROM sound_effects WHERE music_id = ? ORDER BY start_time')
        .all(musicId);
}

function findInternalUserIdByOpenid(openid) {
    const row = getDb().prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
    return row ? row.id : null;
}

function countCompletedByUserId(userId) {
    const row = getDb()
        .prepare(
            `SELECT COUNT(*) AS c FROM music_tracks
             WHERE user_id = ?
               AND status = 'completed'
               AND audio_url IS NOT NULL
               AND TRIM(audio_url) != ''`
        )
        .get(userId);
    return row ? row.c : 0;
}

function listCompletedByUserId(userId, limit = 50) {
    return getDb()
        .prepare(
            `SELECT id, title, main_instrument, frequency, bpm, duration, audio_url, audio_duration_ms,
                player_cover_url, status, created_at, COALESCE(play_count, 0) AS play_count
             FROM music_tracks
             WHERE user_id = ?
               AND status = 'completed'
               AND audio_url IS NOT NULL
               AND TRIM(audio_url) != ''
             ORDER BY created_at DESC
             LIMIT ?`
        )
        .all(userId, limit);
}

function updateAudioUrl(musicId, audioUrl) {
    getDb().prepare('UPDATE music_tracks SET audio_url = ? WHERE id = ?').run(audioUrl, musicId);
}

function completeTrack(musicId, publicUrl, audioDurationMs) {
    return getDb()
        .prepare(
            `UPDATE music_tracks SET status = ?, audio_url = ?, audio_duration_ms = ? WHERE id = ? AND status != 'cancelled'`
        )
        .run('completed', publicUrl, audioDurationMs, musicId).changes;
}

function getVoiceUrl(musicId) {
    const row = getDb().prepare('SELECT voice_url FROM music_tracks WHERE id = ?').get(musicId);
    return row && row.voice_url ? row.voice_url : '';
}

function findTrackOwnerOpenid(musicId) {
    return getDb()
        .prepare(
            `SELECT u.wx_openid FROM users u
             INNER JOIN music_tracks t ON t.user_id = u.id WHERE t.id = ?`
        )
        .get(musicId);
}

function deleteTrack(musicId) {
    const db = getDb();
    const tx = db.transaction((id) => {
        db.prepare('DELETE FROM sound_effects WHERE music_id = ?').run(id);
        db.prepare('UPDATE community_posts SET music_id = NULL WHERE music_id = ?').run(id);
        db.prepare('DELETE FROM greeting_cards WHERE music_id = ?').run(id);
        db.prepare('DELETE FROM card_shares WHERE music_id = ?').run(id);
        db.prepare('DELETE FROM music_tracks WHERE id = ?').run(id);
    });
    tx(musicId);
}

function updateTitle(musicId, title) {
    getDb().prepare('UPDATE music_tracks SET title = ? WHERE id = ?').run(title, musicId);
}

function updatePlayerCover(musicId, coverUrl) {
    getDb().prepare('UPDATE music_tracks SET player_cover_url = ? WHERE id = ?').run(coverUrl || null, musicId);
}

function listSystemLibrary(category, page, limit) {
    const db = getDb();
    let sql = `SELECT id, title, description, main_instrument as instrument, frequency, bpm, duration,
            audio_duration_ms, audio_url, player_cover_url, COALESCE(play_count, 0) AS play_count, created_at
         FROM music_tracks
         WHERE user_id = 'system' AND status = 'completed'
           AND COALESCE(library_enabled, 1) != 0`;
    const params = [];

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

    sql += ` ORDER BY COALESCE(library_sort_order, 0) DESC, created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, (page - 1) * limit);

    const tracks = db.prepare(sql).all(...params);
    const countRow = db
        .prepare(
            `SELECT COUNT(*) as total FROM music_tracks WHERE user_id = 'system' AND status = 'completed'`
        )
        .get();
    return { tracks, total: countRow.total };
}

function findSystemTrackForPlay(musicId) {
    return getDb()
        .prepare(
            `SELECT id, COALESCE(play_count, 0) AS play_count FROM music_tracks
             WHERE id = ? AND user_id = 'system' AND status = 'completed'`
        )
        .get(musicId);
}

function getPlayCount(musicId) {
    const row = getDb()
        .prepare(`SELECT COALESCE(play_count, 0) AS play_count FROM music_tracks WHERE id = ?`)
        .get(musicId);
    return row ? row.play_count : 0;
}

module.exports = {
    findById,
    getStatus,
    isCancelled,
    setStatusIfNotCancelled,
    setStatus,
    insertTrack,
    updateVoiceUrl,
    updateReferenceAudioUrl,
    insertSoundEffect,
    listSoundEffects,
    findInternalUserIdByOpenid,
    countCompletedByUserId,
    listCompletedByUserId,
    updateAudioUrl,
    completeTrack,
    getVoiceUrl,
    findTrackOwnerOpenid,
    deleteTrack,
    updateTitle,
    updatePlayerCover,
    listSystemLibrary,
    findSystemTrackForPlay,
    getPlayCount
};
