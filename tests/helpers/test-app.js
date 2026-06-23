/**
 * 集成测试：内存 SQLite + 完整 Express app（不监听端口，supertest 注入）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const ROOT = path.join(__dirname, '../..');

function clearModule(rel) {
    const abs = path.join(ROOT, rel);
    try {
        delete require.cache[require.resolve(abs)];
    } catch (e) {
        /* ignore */
    }
}

function resetAppModules() {
    [
        'src/bootstrap/database.js',
        'src/bootstrap/init-database.js',
        'src/bootstrap/run-migrations.js',
        'src/utils/app-context.js',
        'src/routes/card.js',
        'src/routes/library.js',
        'src/routes/points.js',
        'src/routes/music.js',
        'src/routes/user.js',
        'src/services/music-service.js',
        'src/services/user-service.js',
        'src/repositories/music-tracks.js',
        'src/repositories/users.js',
        'src/routes/tasks.js',
        'src/routes/shop.js',
        'src/routes/mall.js',
        'src/routes/mianjia.js',
        'src/routes/branding.js',
        'src/admin/index.js',
        'src/admin/middleware.js',
        'src/admin/routes/auth.js',
        'src/admin/routes/channels.js',
        'src/admin/routes/upload.js',
        'src/services/admin-auth-service.js',
        'src/services/admin-channels-service.js',
        'src/services/admin-stats-service.js',
        'src/admin/routes/stats.js',
        'src/admin/routes/feedback.js',
        'src/admin/routes/community.js',
        'src/admin/routes/promo.js',
        'src/admin/routes/export.js',
        'src/services/admin-feedback-service.js',
        'src/services/admin-community-service.js',
        'src/services/admin-promo-service.js',
        'src/services/admin-export-service.js',
        'src/services/admin-workbench-service.js',
        'src/services/admin-audit-service.js',
        'src/admin/routes/workbench.js',
        'src/admin/routes/audit.js',
        'src/admin/routes/settings.js',
        'src/migrations/007_feedback_workflow.js',
        'src/migrations/008_promo_events_index.js',
        'src/migrations/009_batch_c_content.js',
        'src/services/admin-analytics-service.js',
        'src/services/admin-content-service.js',
        'src/services/admin-card-service.js',
        'src/admin/routes/analytics.js',
        'src/admin/routes/content.js',
        'src/services/admin-users-service.js',
        'src/services/admin-system-service.js',
        'src/services/branding-service.js',
        'src/services/promo-campaign-service.js',
        'src/promo-data.js',
        'src/routes/community.js',
        'src/services/community-service.js',
        'src/routes/index.js',
        'src/app.js'
    ].forEach(clearModule);
}

function createTestApp() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-test-'));
    const dbPath = path.join(tmpDir, 'test.db');

    resetAppModules();

    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = dbPath;
    process.env.SKIP_CONTENT_SEC_CHECK = 'true';
    process.env.BASE_URL = 'https://music.test';

    require(path.join(ROOT, 'src/bootstrap/env')).loadEnvFiles();

    const { resetDatabaseConnection } = require(path.join(ROOT, 'src/bootstrap/database'));
    resetDatabaseConnection();

    const app = require(path.join(ROOT, 'src/app.js'));
    const { getDb } = require(path.join(ROOT, 'src/bootstrap/database'));

    return {
        app,
        db: getDb(),
        tmpDir,
        dbPath,
        cleanup() {
            try {
                resetDatabaseConnection();
            } catch (e) {
                /* ignore */
            }
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch (e) {
                /* ignore */
            }
        }
    };
}

function seedUser(db, openid) {
    const id = uuidv4();
    db.prepare(
        `INSERT INTO users (id, wx_openid, nickname) VALUES (?, ?, ?)`
    ).run(id, openid, '测试用户');
    return { id, openid };
}

function seedMusicTrack(db, userId, overrides = {}) {
    const id = overrides.id || uuidv4();
    db.prepare(
        `INSERT INTO music_tracks (id, user_id, title, main_instrument, frequency, duration, bpm, audio_url, status, player_cover_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(
        id,
        userId,
        overrides.title || '测试曲目',
        overrides.instrument || 'piano',
        overrides.frequency || 'alpha',
        overrides.duration || 180,
        overrides.bpm || 60,
        overrides.audioUrl || '/api/music/audio?f=test.mp3',
        overrides.playerCoverUrl || '/api/music/cover?f=cover.png'
    );
    return id;
}

module.exports = {
    createTestApp,
    seedUser,
    seedMusicTrack
};
