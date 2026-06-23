/**
 * Admin 渠道 M1 集成测试
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
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
        username: 'channel_admin',
        password: 'ChannelAdmin123!',
        role: 'super'
    });
});

after(() => {
    if (ctx) ctx.cleanup();
});

test('Admin 渠道 CRUD', async () => {
    const login = await request(ctx.app, 'POST', '/api/admin/auth/login', {
        body: { username: 'channel_admin', password: 'ChannelAdmin123!' }
    });
    cookie = adminCookie(login.setCookie);
    assert.equal(login.body.code, 0);

    const list = await request(ctx.app, 'GET', '/api/admin/channels', { cookie });
    assert.equal(list.body.code, 0);
    assert.ok(Array.isArray(list.body.data.list));

    const created = await request(ctx.app, 'POST', '/api/admin/channels', {
        cookie,
        body: {
            id: 'test_partner',
            name: '测试渠道',
            status: 'draft'
        }
    });
    assert.equal(created.body.code, 0);
    assert.equal(created.body.data.channel.id, 'test_partner');

    const branding = await request(ctx.app, 'PUT', '/api/admin/channels/test_partner/branding', {
        cookie,
        body: {
            splashTitle: '测试开屏',
            themePresetId: 'deep_sleep_post',
            features: { hideMall: true }
        }
    });
    assert.equal(branding.body.code, 0);

    const active = await request(ctx.app, 'PATCH', '/api/admin/channels/test_partner/status', {
        cookie,
        body: { status: 'active' }
    });
    assert.equal(active.body.code, 0);
    assert.equal(active.body.data.channel.status, 'active');
});
