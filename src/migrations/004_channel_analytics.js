/**
 * 分渠道埋点：play_history.source_channel、biz_events、daily 聚合表
 */
function hasTable(db, table) {
    return !!db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
}

function hasColumn(db, table, column) {
    if (!hasTable(db, table)) return false;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
}

function addColumnIfMissing(db, table, column, ddl) {
    if (!hasTable(db, table)) {
        console.warn(`[DB migration] 跳过 ${table}.${column}（表不存在）`);
        return;
    }
    if (!hasColumn(db, table, column)) {
        db.exec(ddl);
        console.log(`[DB migration] 已添加列 ${table}.${column}`);
    }
}

function up(db) {
    addColumnIfMissing(
        db,
        'play_history',
        'source_channel',
        `ALTER TABLE play_history ADD COLUMN source_channel TEXT`
    );
    addColumnIfMissing(
        db,
        'greeting_cards',
        'source_channel',
        `ALTER TABLE greeting_cards ADD COLUMN source_channel TEXT`
    );
    addColumnIfMissing(
        db,
        'music_tracks',
        'source_channel',
        `ALTER TABLE music_tracks ADD COLUMN source_channel TEXT`
    );
    addColumnIfMissing(
        db,
        'card_shares',
        'source_channel',
        `ALTER TABLE card_shares ADD COLUMN source_channel TEXT`
    );

    db.exec(`
        CREATE TABLE IF NOT EXISTS biz_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            channel_id TEXT NOT NULL DEFAULT 'default',
            user_id TEXT,
            visitor_key TEXT,
            payload_json TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_active_visitors (
            stat_date DATE NOT NULL,
            channel_id TEXT NOT NULL,
            visitor_key TEXT NOT NULL,
            user_id TEXT,
            PRIMARY KEY (stat_date, channel_id, visitor_key)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_channel_stats (
            stat_date DATE NOT NULL,
            channel_id TEXT NOT NULL,
            dau INTEGER DEFAULT 0,
            new_bindings INTEGER DEFAULT 0,
            music_completed INTEGER DEFAULT 0,
            cards_created INTEGER DEFAULT 0,
            PRIMARY KEY (stat_date, channel_id)
        )
    `);

    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_biz_events_type_date ON biz_events(event_type, created_at)'
    );
    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_biz_events_channel_date ON biz_events(channel_id, created_at)'
    );
    if (hasColumn(db, 'music_tracks', 'source_channel')) {
        db.exec(
            'CREATE INDEX IF NOT EXISTS idx_music_tracks_source_status ON music_tracks(source_channel, status, created_at)'
        );
    }
    if (hasTable(db, 'card_shares') && hasColumn(db, 'card_shares', 'source_channel')) {
        db.exec(
            'CREATE INDEX IF NOT EXISTS idx_card_shares_source_created ON card_shares(source_channel, created_at)'
        );
    }
}

module.exports = { up };
