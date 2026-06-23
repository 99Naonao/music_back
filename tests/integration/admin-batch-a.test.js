/**
 * Admin 批次 A：工作台 / 反馈工作流 / 审计 / 看板增强
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createTestApp } = require('../helpers/test-app');
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
let feedbackId = '';

before(() => {
    ctx = createTestApp();
    adminAuthService.upsertAdminUser({
        username: 'batch_a_admin',
        password: 'BatchAAdmin123!',
        role: 'super'
    });
    feedbackId = uuidv4();
    ctx.db.prepare(
        `INSERT INTO user_feedback (id, feedback_type, content, status, created_at)
         VALUES (?, '建议', '批次A测试', 'pending', datetime('now', 'localtime'))`
    ).run(feedbackId);
});

after(() => {
    if (ctx) ctx.cleanup();
});

test('Admin batch A APIs', async () => {
    const login = await request(ctx.app, 'POST', '/api/admin/auth/login', {
        body: { username: 'batch_a_admin', password: 'BatchAAdmin123!' }
    });
    cookie = adminCookie(login.setCookie);

    const wb = await request(ctx.app, 'GET', '/api/admin/workbench', { cookie });
    assert.equal(wb.body.code, 0);
    assert.ok(wb.body.data.pendingFeedback >= 1);

    const overview = await request(ctx.app, 'GET', '/api/admin/stats/overview', { cookie });
    assert.equal(overview.body.code, 0);
    assert.ok(overview.body.data.compare);

    const patch = await request(ctx.app, 'PATCH', `/api/admin/feedback/${feedbackId}`, {
        cookie,
        body: { status: 'resolved', adminNote: '已处理' }
    });
    assert.equal(patch.body.code, 0);
    assert.equal(patch.body.data.status, 'resolved');

    const audit = await request(ctx.app, 'GET', '/api/admin/audit-logs?page=1', { cookie });
    assert.equal(audit.body.code, 0);
    assert.ok(Array.isArray(audit.body.data.list));

    const ch = await request(ctx.app, 'GET', '/api/admin/stats/channel/channel_1', { cookie });
    assert.equal(ch.body.code, 0);
    assert.ok(ch.body.data.channel);
});
