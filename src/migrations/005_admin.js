/**
 * 运营后台：admin 账号、Session、审计日志
 */
function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'operator',
            partner_channel_id TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            last_login_at DATETIME,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
            id TEXT PRIMARY KEY,
            admin_user_id TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            ip TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_user_id TEXT,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            detail_json TEXT,
            ip TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(admin_user_id, expires_at)'
    );
    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC)'
    );
}

module.exports = { up };
