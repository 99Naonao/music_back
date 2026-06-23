#!/usr/bin/env node
/**
 * 服务器排查 502：node scripts/diagnose-startup.js
 * 逐步检查文件、迁移、模块加载、端口监听。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');

function ok(msg) {
    console.log(`  ✓ ${msg}`);
}
function fail(msg) {
    console.log(`  ✗ ${msg}`);
}
function section(title) {
    console.log(`\n=== ${title} ===`);
}

const REQUIRED_FILES = [
    'src/app.js',
    'src/admin/index.js',
    'src/admin/routes/stats.js',
    'src/admin/routes/auth.js',
    'src/admin/routes/channels.js',
    'src/services/admin-stats-service.js',
    'src/services/channel-analytics-service.js',
    'src/services/admin-auth-service.js',
    'src/migrations/004_channel_analytics.js',
    'src/migrations/005_admin.js'
];

section('1. 关键文件');
let missing = 0;
REQUIRED_FILES.forEach((rel) => {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) ok(rel);
    else {
        fail(`缺失: ${rel}`);
        missing += 1;
    }
});
if (missing) {
    console.log('\n请先补传缺失文件后再重启 Node。');
}

section('2. 环境');
require(path.join(ROOT, 'src/bootstrap/env')).loadEnvFiles();
const PORT = Number(process.env.PORT) || 3000;
const dbPath = process.env.DB_PATH || path.join(ROOT, 'data/sleep_music_v2.db');
console.log(`  NODE_ENV=${process.env.NODE_ENV || '(未设)'}`);
console.log(`  PORT=${PORT}`);
console.log(`  DB_PATH=${dbPath}`);
console.log(`  数据库文件存在: ${fs.existsSync(dbPath) ? '是' : '否'}`);

section('3. 数据库迁移');
try {
    const { initDatabaseConnection, resetDatabaseConnection } = require(path.join(
        ROOT,
        'src/bootstrap/database'
    ));
    resetDatabaseConnection();
    initDatabaseConnection();
    const { runMigrations } = require(path.join(ROOT, 'src/bootstrap/run-migrations'));
    const db = require(path.join(ROOT, 'src/bootstrap/database')).getDb();
    const result = runMigrations(db);
    ok(`迁移完成，新应用: ${result.applied.length ? result.applied.join(', ') : '无'}`);
    const tables = ['daily_channel_stats', 'admin_users', 'biz_events'];
    tables.forEach((t) => {
        const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
        if (row) ok(`表 ${t}`);
        else fail(`表不存在: ${t}`);
    });
} catch (err) {
    fail(`迁移/数据库失败: ${err.message}`);
    console.error(err.stack);
}

section('4. 启动 app（完整链路）');
try {
    const app = require(path.join(ROOT, 'src/app.js'));
    ok('src/app.js 加载成功');
} catch (err) {
    fail(`app 加载失败: ${err.message}`);
    console.error(err.stack);
    console.log('\n→ 这通常就是 Node 启动崩溃、Nginx 502 的直接原因。');
    process.exit(1);
}

section('5. HTTP 探活');
try {
    const app = require(path.join(ROOT, 'src/app.js'));
    const server = app.listen(PORT, '127.0.0.1', () => {
        const req = http.get(`http://127.0.0.1:${PORT}/api/admin/health`, (res) => {
            let body = '';
            res.on('data', (c) => {
                body += c;
            });
            res.on('end', () => {
                if (res.statusCode === 200 && body.includes('"code":0')) {
                    ok(`/api/admin/health → HTTP ${res.statusCode}`);
                } else {
                    fail(`/api/admin/health → HTTP ${res.statusCode} ${body.slice(0, 120)}`);
                }
                server.close(() => {
                    console.log('\n诊断结束。若第 5 步通过但浏览器仍 502，请检查 Nginx proxy_pass 端口是否为', PORT);
                    process.exit(0);
                });
            });
        });
        req.on('error', (e) => {
            fail(`本机请求失败: ${e.message}`);
            server.close(() => process.exit(1));
        });
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            fail(`端口 ${PORT} 已被占用 — Node 可能已在跑，或僵尸进程占端口`);
            console.log(`  请执行: ss -lntp | grep ${PORT}`);
        } else {
            fail(`listen 失败: ${err.message}`);
        }
        process.exit(1);
    });
} catch (err) {
    fail(`app 启动失败: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
}
