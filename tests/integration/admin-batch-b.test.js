/**
 * Admin 批次 B：弹窗可视化/统计、渠道整合、XLSX 导出、管理员与改密
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
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
const channelA = 'batch_b_a';
const channelB = 'batch_b_b';

before(async () => {
    ctx = createTestApp();
    adminAuthService.upsertAdminUser({
        username: 'batch_b_admin',
        password: 'BatchBAdmin123!',
        role: 'super'
    });

    ctx.db.prepare(
        `INSERT INTO channels (id, name, status, updated_at) VALUES (?, 'Batch A', 'active', datetime('now', 'localtime'))`
    ).run(channelA);
    ctx.db.prepare(
        `INSERT INTO channels (id, name, status, updated_at) VALUES (?, 'Batch B', 'draft', datetime('now', 'localtime'))`
    ).run(channelB);
    ctx.db.prepare(`INSERT INTO channel_branding (channel_id, splash_title, version) VALUES (?, '源标题', 1)`).run(
        channelA
    );
    ctx.db.prepare(`INSERT INTO channel_branding (channel_id, version) VALUES (?, 1)`).run(channelB);

    ctx.db.prepare(
        `INSERT INTO promo_campaigns (id, payload_json, enabled, priority, updated_at)
         VALUES ('test_promo', ?, 1, 50, datetime('now', 'localtime'))`
    ).run(
        JSON.stringify({
            id: 'test_promo',
            type: 'rich',
            title: '测试弹窗',
            scenes: ['home_show']
        })
    );

    ctx.db.prepare(
        `INSERT INTO biz_events (event_type, channel_id, payload_json, created_at)
         VALUES ('promo.show', 'default', ?, datetime('now', 'localtime'))`
    ).run(JSON.stringify({ promoId: 'test_promo', action: 'show' }));

    const login = await request(ctx.app, 'POST', '/api/admin/auth/login', {
        body: { username: 'batch_b_admin', password: 'BatchBAdmin123!' }
    });
    cookie = adminCookie(login.headers['set-cookie']);
});

after(() => {
    if (ctx) ctx.cleanup();
});

test('GET /api/admin/promo/meta', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/promo/meta', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(Array.isArray(res.body.data.scenes));
});

test('GET /api/admin/promo/simulate', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/promo/simulate?scene=home_show', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(res.body.data.matchedCount >= 0);
});

test('GET /api/admin/promo/campaigns/:id/stats', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/promo/campaigns/test_promo/stats', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(res.body.data.exposures >= 1);
});

test('GET /api/admin/channels/:id/hub', async () => {
    const res = await request(ctx.app, 'GET', `/api/admin/channels/${channelA}/hub`, { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.channel.id, channelA);
    assert.ok(res.body.data.stats);
});

test('POST /api/admin/channels/:id/branding/copy', async () => {
    const res = await request(ctx.app, 'POST', `/api/admin/channels/${channelB}/branding/copy`, {
        cookie,
        body: { sourceChannelId: channelA }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.branding.splashTitle, '源标题');
});

test('PATCH /api/admin/channels/batch-status', async () => {
    const res = await request(ctx.app, 'PATCH', '/api/admin/channels/batch-status', {
        cookie,
        body: { ids: [channelB], status: 'active' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.deepEqual(res.body.data.updated, [channelB]);
});

test('POST /api/admin/export/jobs xlsx + download', async () => {
    const res = await request(ctx.app, 'POST', '/api/admin/export/jobs', {
        cookie,
        body: { type: 'channel_stats', format: 'xlsx' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.format, 'xlsx');
    const jobId = res.body.data.id;

    const dl = await new Promise((resolve, reject) => {
        const server = ctx.app.listen(0, () => {
            const { port } = server.address();
            http.get(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: `/api/admin/export/jobs/${jobId}/download`,
                    headers: { Cookie: cookie }
                },
                (r) => {
                    let chunks = [];
                    r.on('data', (c) => chunks.push(c));
                    r.on('end', () => {
                        server.close();
                        resolve({
                            status: r.statusCode,
                            contentType: r.headers['content-type'],
                            size: Buffer.concat(chunks).length
                        });
                    });
                }
            ).on('error', (e) => {
                server.close();
                reject(e);
            });
        });
    });
    assert.equal(dl.status, 200);
    assert.match(String(dl.contentType || ''), /spreadsheet/);
    assert.ok(dl.size > 100);
});

test('GET /api/admin/settings/health', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/settings/health', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(res.body.data.dbSizeBytes >= 0);
});

test('POST /api/admin/settings/password', async () => {
    const res = await request(ctx.app, 'POST', '/api/admin/settings/password', {
        cookie,
        body: { currentPassword: 'BatchBAdmin123!', newPassword: 'BatchBAdmin456!' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
});

test('POST /api/admin/settings/admins', async () => {
    const res = await request(ctx.app, 'POST', '/api/admin/settings/admins', {
        cookie,
        body: { username: 'batch_b_op', password: 'BatchBOp12345!', role: 'operator' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.user.username, 'batch_b_op');
});

test('POST /api/promo/event 写入 biz_events', async () => {
    const res = await request(ctx.app, 'POST', '/api/promo/event', {
        body: { promoId: 'test_promo', action: 'click', scene: 'home_show', channel: 'default' }
    });
    assert.equal(res.status, 200);
    const row = ctx.db
        .prepare(`SELECT COUNT(*) AS c FROM biz_events WHERE event_type = 'promo.click'`)
        .get();
    assert.ok(row.c >= 1);
});
