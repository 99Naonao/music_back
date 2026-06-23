/**
 * 反馈工作流：status / admin_note / handled_by / handled_at
 */
function hasColumn(db, table, column) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
}

function addColumnIfMissing(db, table, column, ddl) {
    if (!hasColumn(db, table, column)) {
        db.exec(ddl);
        console.log(`[DB migration] 已添加列 ${table}.${column}`);
    }
}

function up(db) {
    addColumnIfMissing(
        db,
        'user_feedback',
        'status',
        `ALTER TABLE user_feedback ADD COLUMN status TEXT DEFAULT 'pending'`
    );
    addColumnIfMissing(
        db,
        'user_feedback',
        'admin_note',
        `ALTER TABLE user_feedback ADD COLUMN admin_note TEXT`
    );
    addColumnIfMissing(
        db,
        'user_feedback',
        'handled_by',
        `ALTER TABLE user_feedback ADD COLUMN handled_by TEXT`
    );
    addColumnIfMissing(
        db,
        'user_feedback',
        'handled_at',
        `ALTER TABLE user_feedback ADD COLUMN handled_at DATETIME`
    );

    db.prepare(
        `UPDATE user_feedback SET status = 'pending' WHERE status IS NULL OR TRIM(status) = ''`
    ).run();
}

module.exports = { up };
