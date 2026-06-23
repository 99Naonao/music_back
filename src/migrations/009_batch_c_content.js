/**
 * 批次 C：曲库上下架/排序、首页 Banner
 */
function hasColumn(db, table, column) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
}

function addColumnIfMissing(db, table, column, ddl) {
    if (!hasColumn(db, table, column)) {
        db.exec(ddl);
    }
}

function up(db) {
    addColumnIfMissing(
        db,
        'music_tracks',
        'library_enabled',
        `ALTER TABLE music_tracks ADD COLUMN library_enabled INTEGER DEFAULT 1`
    );
    addColumnIfMissing(
        db,
        'music_tracks',
        'library_sort_order',
        `ALTER TABLE music_tracks ADD COLUMN library_sort_order INTEGER DEFAULT 0`
    );

    db.exec(`
        CREATE TABLE IF NOT EXISTS home_banners (
            id TEXT PRIMARY KEY,
            title TEXT,
            image_url TEXT NOT NULL,
            link_path TEXT,
            link_type TEXT DEFAULT 'navigateTo',
            sort_order INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            channel_ids_json TEXT,
            start_at TEXT,
            end_at TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_home_banners_enabled ON home_banners(enabled, sort_order)'
    );
}

module.exports = { up };
