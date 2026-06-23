/**
 * Admin Step 4：反馈 / 社区 / 导出
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createTestApp, seedUser } = require('../helpers/test-app');
const adminAuthService = require('../../src/services/admin-auth-service');
const { v4: uuidv4 } = require('uuid');

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
                            setCookie: res.headers['set-cookie']
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

before(() => {
    ctx = createTestApp();
    adminAuthService.upsertAdminUser({
        username: 'step4_admin',
        password: 'Step4Admin123!',
        role: 'super'
    });

    const user = seedUser(ctx.db, 'fb_openid_' + uuidv4());
    ctx.db.prepare(
        `INSERT INTO user_feedback (id, user_id, wx_openid, nickname, feedback_type, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`
    ).run(uuidv4(), user.id, user.openid, '测试用户', '建议', '测试反馈内容');

    const postId = uuidv4();
    ctx.db.prepare(
        `INSERT INTO community_posts (id, user_id, title, content, topic, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`
    ).run(postId, user.id, '测试帖', '社区测试内容', 'general');
    ctx._postId = postId;
});

after(() => {
    if (ctx) ctx.cleanup();
});

test('Admin feedback / community / export / promo', async () => {
    const login = await request(ctx.app, 'POST', '/api/admin/auth/login', {
        body: { username: 'step4_admin', password: 'Step4Admin123!' }
    });
    cookie = adminCookie(login.setCookie);

    const fb = await request(ctx.app, 'GET', '/api/admin/feedback?page=1&limit=10', { cookie });
    assert.equal(fb.body.code, 0);
    assert.ok(Array.isArray(fb.body.data.list));

    const posts = await request(
        ctx.app,
        'GET',
        '/api/admin/community/posts?q=' + encodeURIComponent('测试'),
        { cookie }
    );
    assert.equal(posts.body.code, 0);
    assert.ok(posts.body.data.list.length >= 1);

    const promo = await request(ctx.app, 'GET', '/api/admin/promo/campaigns', { cookie });
    assert.equal(promo.body.code, 0);
    assert.ok(Array.isArray(promo.body.data.list));

    const preview = await request(
        ctx.app,
        'GET',
        '/api/admin/export/preview?type=feedback&from=2020-01-01&to=2099-12-31',
        { cookie }
    );
    assert.equal(preview.body.code, 0);
    assert.ok(Array.isArray(preview.body.data.rows));

    const job = await request(ctx.app, 'POST', '/api/admin/export/jobs', {
        cookie,
        body: { type: 'feedback', from: '2020-01-01', to: '2099-12-31' }
    });
    assert.equal(job.body.code, 0);
    assert.ok(job.body.data.id);

    const del = await request(ctx.app, 'DELETE', `/api/admin/community/posts/${ctx._postId}`, {
        cookie
    });
    assert.equal(del.body.code, 0);
});
