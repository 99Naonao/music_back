/**
 * 从 images/card-templates.json 同步贺卡模板到数据库
 * 用法：node scripts/sync-card-templates.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const cardTemplates = require('../src/card-template-service');

const DB_PATH = path.join(__dirname, '../data/sleep_music_v2.db');
const db = new Database(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS card_template_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS card_templates (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        image_file TEXT NOT NULL,
        cover_url TEXT NOT NULL,
        bg_image_url TEXT NOT NULL,
        gradient_template INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
`);

const result = cardTemplates.syncCardTemplatesFromManifest(db);
console.log('完成', result);
db.close();
