/**
 * 初始化首个 super 管理员（仅首次或重置密码时使用）
 *
 *   node scripts/seed-admin.js
 *   node scripts/seed-admin.js --username admin --password 'YourPass123!'
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=xxx node scripts/seed-admin.js
 */
require('../src/bootstrap/env').loadEnvFiles();

const { initDatabaseConnection, getDb } = require('../src/bootstrap/database');
const { initDatabase } = require('../src/bootstrap/init-database');
const adminAuthService = require('../src/services/admin-auth-service');

function readArg(flag) {
    const idx = process.argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= process.argv.length) return '';
    return process.argv[idx + 1];
}

function main() {
    initDatabaseConnection();
    initDatabase();

    const username =
        readArg('--username') ||
        (process.env.ADMIN_SEED_USERNAME || process.env.ADMIN_USERNAME || '').trim() ||
        'admin';
    const password =
        readArg('--password') ||
        (process.env.ADMIN_SEED_PASSWORD || process.env.ADMIN_PASSWORD || '').trim();

    if (!password) {
        console.error(
            '[seed-admin] 请提供密码：--password 或环境变量 ADMIN_SEED_PASSWORD / ADMIN_PASSWORD'
        );
        process.exit(1);
    }

    const result = adminAuthService.upsertAdminUser({
        username,
        password,
        role: 'super'
    });

    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) AS c FROM admin_users').get().c;

    console.log('[seed-admin] 完成', {
        username: result.username,
        id: result.id,
        created: result.created,
        totalAdmins: count,
        db: process.env.DB_PATH || '(default data/sleep_music_v2.db)'
    });
    console.log('[seed-admin] 登录：POST /api/admin/auth/login');
    console.log('[seed-admin] 页面： https://music.zsyl.cc/admin/ （Nginx 静态，见 deploy/nginx-admin.conf.example）');
}

main();
