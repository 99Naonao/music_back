const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let db = null;
let dbPath = null;

function getDataDir() {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
}

function getDbPath() {
    if (!dbPath) {
        dbPath = process.env.DB_PATH || path.join(getDataDir(), 'sleep_music_v2.db');
    }
    return dbPath;
}

function initDatabaseConnection() {
    if (!db) {
        db = new Database(getDbPath());
        try {
            db.pragma('journal_mode = WAL');
            db.pragma('busy_timeout = 5000');
        } catch (e) {
            console.warn('[DB] WAL/busy_timeout 设置失败:', e.message);
        }
    }
    return db;
}

function getDb() {
    return db || initDatabaseConnection();
}

function resetDatabaseConnection() {
    if (db) {
        try {
            db.close();
        } catch (e) {
            /* ignore */
        }
    }
    db = null;
    dbPath = null;
}

module.exports = { getDb, getDbPath, initDatabaseConnection, getDataDir, resetDatabaseConnection };
