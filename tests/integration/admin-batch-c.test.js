/**
 * Admin 批次 C：漏斗/留存、社区增强、内容配置台
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { createTestApp } = require('../helpers/test-app');
const adminAuthService = require('../../src/services/admin-auth-service');

function request(app, method, url, { body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, () => {
            const { port } = server.address();
            const payload = body != null ? JSON.stringify(body) : null;
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: url,
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        ...(cookie ? { Cookie: cookie } : {}),
                        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
                    }
                },
                (res) => {
                    let raw = '';
                    res.on('data', (c) => {
                        raw += c;
                    });
                    res.on('end', () => {
                        server.close();
                        resolve({
                            status: res.statusCode,
                            body: JSON.parse(raw),
                            headers: res.headers
                        });
                    });
                }
            );
            req.on('error', (err) => {
                server.close();
                reject(err);
            });
            if (payload) req.write(payload);
            req.end();
        });
    });
}

function adminCookie(setCookie) {
    const line = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const m = String(line || '').match(/admin_sid=([^;]+)/);
    return m ? `admin_sid=${decodeURIComponent(m[1])}` : '';
}

let ctx;
let cookie = '';
let postId = '';
let commentId = '';
let trackId = '';

before(async () => {
    ctx = createTestApp();
    adminAuthService.upsertAdminUser({
        username: 'batch_c_admin',
        password: 'BatchCAdmin123!',
        role: 'super'
    });

    trackId = `lib_${uuidv4().slice(0, 8)}`;
    ctx.db.prepare(
        `INSERT INTO music_tracks (id, user_id, title, status, library_enabled, library_sort_order)
         VALUES (?, 'system', '批次C曲库', 'completed', 1, 10)`
    ).run(trackId);

    const userId = uuidv4();
    ctx.db.prepare(`INSERT INTO users (id, nickname, wx_openid) VALUES (?, '测试用户', 'openid_batch_c')`).run(
        userId
    );
    postId = uuidv4();
    ctx.db.prepare(
        `INSERT INTO community_posts (id, user_id, title, content) VALUES (?, ?, '标题', '内容测试')`
    ).run(postId, userId);
    commentId = uuidv4();
    ctx.db.prepare(
        `INSERT INTO community_comments (id, post_id, user_id, content) VALUES (?, ?, ?, '评论1')`
    ).run(commentId, postId, userId);

    const today = ctx.db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
    ctx.db.prepare(
        `INSERT OR IGNORE INTO daily_active_visitors (stat_date, channel_id, visitor_key, user_id)
         VALUES (?, 'default', 'v_cohort', ?)`
    ).run(today, userId);

    const login = await request(ctx.app, 'POST', '/api/admin/auth/login', {
        body: { username: 'batch_c_admin', password: 'BatchCAdmin123!' }
    });
    cookie = adminCookie(login.headers['set-cookie']);
});

after(() => {
    if (ctx) ctx.cleanup();
});

test('GET /api/admin/analytics/funnel', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/analytics/funnel', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(Array.isArray(res.body.data.steps));
    assert.ok(res.body.data.steps.length >= 4);
});

test('GET /api/admin/analytics/retention', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/analytics/retention', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(res.body.data.d7);
});

test('GET /api/admin/community/posts/:id', async () => {
    const res = await request(ctx.app, 'GET', `/api/admin/community/posts/${postId}`, { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.post.id, postId);
    assert.ok(res.body.data.comments.length >= 1);
});

test('DELETE comment + user risk', async () => {
    const risk = await request(ctx.app, 'GET', '/api/admin/community/users/openid_batch_c/risk', { cookie });
    assert.equal(risk.body.code, 0);

    const del = await request(
        ctx.app,
        'DELETE',
        `/api/admin/community/posts/${postId}/comments/${commentId}`,
        { cookie }
    );
    assert.equal(del.status, 200);
    assert.equal(del.body.code, 0);
});

test('PATCH /api/admin/content/library/:id', async () => {
    const res = await request(ctx.app, 'PATCH', `/api/admin/content/library/${trackId}`, {
        cookie,
        body: { libraryEnabled: false, librarySortOrder: 99 }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.libraryEnabled, false);
});

test('Banner CRUD + public API', async () => {
    const bid = 'banner_test_c';
    const create = await request(ctx.app, 'POST', '/api/admin/content/banners', {
        cookie,
        body: { id: bid, title: '测试', imageUrl: 'https://example.com/b.png', enabled: true }
    });
    assert.equal(create.body.code, 0);

    const pub = await request(ctx.app, 'GET', '/api/home/banners');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.code, 0);
    assert.ok(Array.isArray(pub.body.data.list));

    const del = await request(ctx.app, 'DELETE', `/api/admin/content/banners/${bid}`, { cookie });
    assert.equal(del.body.code, 0);
});

test('GET /api/admin/content/card-templates', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/content/card-templates', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(Array.isArray(res.body.data.list));
});
