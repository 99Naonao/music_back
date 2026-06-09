/**
 * 微信 media_check_async 任务记录与回调处理
 */
const { logInfo, logWarn, logError } = require('./error-codes');

function ensureMediaSecTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS media_sec_tasks (
            trace_id TEXT PRIMARY KEY,
            media_type INTEGER NOT NULL,
            media_url TEXT,
            ref_type TEXT,
            ref_id TEXT,
            openid TEXT,
            status TEXT DEFAULT 'pending',
            is_risky INTEGER,
            extra_info TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_media_sec_ref ON media_sec_tasks(ref_type, ref_id);
    `);
}

function insertTask(db, row) {
    db.prepare(
        `INSERT OR REPLACE INTO media_sec_tasks
         (trace_id, media_type, media_url, ref_type, ref_id, openid, status, is_risky, extra_info, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, datetime('now', 'localtime'))`
    ).run(
        row.trace_id,
        row.media_type,
        row.media_url || '',
        row.ref_type || '',
        row.ref_id || '',
        row.openid || ''
    );
}

function applyRiskyCallback(db, payload, handlers) {
    const traceId = String(payload.trace_id || payload.TraceId || '').trim();
    if (!traceId) {
        logWarn('内容安全回调', '缺少 trace_id', payload);
        return false;
    }
    const isrisky = Number(payload.isrisky ?? payload.isRisky ?? 0);
    const statusCode = Number(payload.status_code ?? payload.statusCode ?? 0);
    const extra = payload.extra_info_json != null ? String(payload.extra_info_json) : '';

    const row = db.prepare('SELECT * FROM media_sec_tasks WHERE trace_id = ?').get(traceId);
    if (!row) {
        logWarn('内容安全回调', '未知 trace_id', { traceId });
        return false;
    }

    db.prepare(
        `UPDATE media_sec_tasks SET status = ?, is_risky = ?, extra_info = ?, updated_at = datetime('now', 'localtime')
         WHERE trace_id = ?`
    ).run(statusCode === 0 ? 'done' : 'error', isrisky, extra.slice(0, 2000), traceId);

    if (isrisky === 1 && row.ref_type && row.ref_id) {
        const handler = handlers && handlers[row.ref_type];
        if (typeof handler === 'function') {
            try {
                handler(db, row, payload);
            } catch (err) {
                logError('内容安全回调处理', err, { traceId, ref_type: row.ref_type });
            }
        }
        logInfo('内容安全回调', '多媒体违规', {
            traceId,
            ref_type: row.ref_type,
            ref_id: row.ref_id,
            media_type: row.media_type
        });
    }

    return true;
}

function onMusicTrackRisky(db, row) {
    db.prepare(`UPDATE music_tracks SET status = 'sec_blocked', audio_url = NULL WHERE id = ?`).run(
        row.ref_id
    );
}

function onCardShareRisky(db, row) {
    db.prepare(`UPDATE card_shares SET audio_url = '' WHERE id = ?`).run(row.ref_id);
}

const DEFAULT_HANDLERS = {
    music_track: onMusicTrackRisky,
    card_share: onCardShareRisky
};

module.exports = {
    ensureMediaSecTable,
    insertTask,
    applyRiskyCallback,
    onMusicTrackRisky,
    onCardShareRisky,
    DEFAULT_HANDLERS
};
