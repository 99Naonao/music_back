const { getDb, logWarn } = require('./app-context');

/** 作品被播放一次（含重复播放） */
function incrementMusicPlayCount(musicId) {
    const mid = String(musicId || '').trim();
    if (!mid) return;
    try {
        const db = getDb();
        const row = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(mid);
        if (!row) return;
        db.prepare(
            `UPDATE music_tracks SET play_count = COALESCE(play_count, 0) + 1 WHERE id = ?`
        ).run(mid);
    } catch (e) {
        logWarn('累计播放次数', e.message || '失败', { musicId: mid });
    }
}

module.exports = { incrementMusicPlayCount };
