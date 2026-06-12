/**
 * 版本化数据库迁移：读取 src/migrations/*，记录于 schema_migrations
 * 既有库（users 表已存在）首次启动时 baseline，避免重复 ALTER
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

function ensureMigrationTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);
}

function listMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((name) => /^\d+_.+\.(sql|js)$/.test(name))
        .sort();
}

function getAppliedVersions(db) {
    ensureMigrationTable(db);
    return new Set(
        db
            .prepare('SELECT version FROM schema_migrations')
            .all()
            .map((row) => row.version)
    );
}

function markApplied(db, version) {
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
}

/** 从旧版 initDatabase（内联 ALTER）升级来的库：跳过已执行过的历史 migration */
function shouldBaselineExistingDb(db) {
    const hasUsers = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get();
    if (!hasUsers) return false;

    const musicCols = db.prepare(`PRAGMA table_info(music_tracks)`).all();
    if (!musicCols.length) return false;

    // 新装库刚建表时尚无增量列；旧库经内联 ALTER 后必有 audio_duration_ms
    return musicCols.some((c) => c.name === 'audio_duration_ms');
}

function baselineExistingDatabase(db, files) {
    const applied = getAppliedVersions(db);
    if (applied.size > 0) return;
    if (!shouldBaselineExistingDb(db)) return;

    for (const file of files) {
        markApplied(db, file);
    }
    console.log(`[DB] 既有库 baseline：标记 ${files.length} 个 migration 为已应用`);
}

function runSqlMigration(db, filePath) {
    const sql = fs.readFileSync(filePath, 'utf8');
    if (sql.trim()) db.exec(sql);
}

function runJsMigration(db, filePath) {
    const mod = require(filePath);
    if (typeof mod.up !== 'function') {
        throw new Error(`Migration ${filePath} 须导出 up(db)`);
    }
    mod.up(db);
}

function runMigrations(db) {
    const files = listMigrationFiles();
    if (!files.length) return { applied: [], skipped: [] };

    ensureMigrationTable(db);
    baselineExistingDatabase(db, files);

    const applied = getAppliedVersions(db);
    const appliedNow = [];
    const skipped = [];

    for (const file of files) {
        if (applied.has(file)) {
            skipped.push(file);
            continue;
        }
        const fullPath = path.join(MIGRATIONS_DIR, file);
        console.log(`[DB] 执行 migration: ${file}`);
        if (file.endsWith('.sql')) {
            runSqlMigration(db, fullPath);
        } else if (file.endsWith('.js')) {
            runJsMigration(db, fullPath);
            delete require.cache[require.resolve(fullPath)];
        }
        markApplied(db, file);
        appliedNow.push(file);
    }

    return { applied: appliedNow, skipped };
}

module.exports = {
    runMigrations,
    listMigrationFiles,
    getAppliedVersions,
    MIGRATIONS_DIR
};
