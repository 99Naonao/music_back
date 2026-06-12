#!/usr/bin/env node
/**
 * 独立执行数据库迁移（部署前可跑：node scripts/migrate.js）
 */
const path = require('path');

require('../src/bootstrap/env').loadEnvFiles();

const { initDatabaseConnection, getDbPath } = require('../src/bootstrap/database');
const { runMigrations } = require('../src/bootstrap/run-migrations');

initDatabaseConnection();
const db = require('../src/bootstrap/database').getDb();

console.log('[migrate] 数据库:', getDbPath());
const result = runMigrations(db);
console.log('[migrate] 新应用:', result.applied.length ? result.applied.join(', ') : '(无)');
console.log('[migrate] 已跳过:', result.skipped.length);
