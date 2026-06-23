/**
 * 日聚合：写入 daily_channel_stats（宝塔计划任务建议每日 01:00 执行）
 *
 *   node scripts/aggregate-daily-stats.js
 *   node scripts/aggregate-daily-stats.js 2026-06-01
 */
const path = require('path');

require('../src/bootstrap/env').loadEnvFiles();

const { initDatabaseConnection, getDb } = require('../src/bootstrap/database');
const { initDatabase } = require('../src/bootstrap/init-database');
const channelAnalytics = require('../src/services/channel-analytics-service');

function main() {
    initDatabaseConnection();
    initDatabase();
    const db = getDb();

    const argDate = process.argv[2];
    const statDate = argDate || null;
    const result = channelAnalytics.aggregateDailyStats(db, statDate);

    console.log('[aggregate-daily-stats] 完成', JSON.stringify(result, null, 2));
}

main();
