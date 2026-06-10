/**
 * 手动初始化/更新渠道配置（无可视化后台时使用）
 * 用法：node scripts/seed-channels.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const channelService = require('../src/channel-service');

const projectRoot = path.join(__dirname, '..');
const dbPath =
    process.env.DB_PATH ||
    path.join(projectRoot, 'data', 'sleep_music_v2.db');

const db = new Database(dbPath);
channelService.initChannelModule(db);
channelService.syncChannel1BrandingDesign(db);
console.log('[seed-channels] 完成 · channel_1 深眠驿站 v2');
console.log('[seed-channels] 素材：images/branding/channel_1/{splash,logo,share-card}.png');
db.close();
