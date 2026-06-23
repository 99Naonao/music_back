/**
 * Admin 鉴权集成测试
 * 运行：npm run test:integration
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
                        let json = null;
                        try {
                            json = JSON.parse(raw);
                        } catch (e) {
                            return reject(new Error(`非 JSON: ${raw.slice(0, 200)}`));
                        }
                        resolve({
                            status: res.statusCode,
                            body: json,
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

function extractAdminSid(setCookie) {
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const line of list) {
        const m = String(line).match(/admin_sid=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
    }
    return '';
}

let ctx;

before(() => {
    ctx = createTestApp();
    adminAuthService.upsertAdminUser({
        username: 'test_admin',
        password: 'TestAdmin123!',
        role: 'super'
    });
});

after(() => {
    if (ctx) ctx.cleanup();
});

test('GET /api/admin/health 无需登录', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.publicPath, '/admin');
});

test('GET /api/admin/auth/me 未登录返回 401', async () => {
    const res = await request(ctx.app, 'GET', '/api/admin/auth/me');
    assert.equal(res.status, 401);
    assert.notEqual(res.body.code, 0);
});

test('POST /api/admin/auth/login 成功并写入 Cookie', async () => {
    const res = await request(ctx.app, 'POST', '/api/admin/auth/login', {
        body: { username: 'test_admin', password: 'TestAdmin123!' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.user.username, 'test_admin');
    const sid = extractAdminSid(res.setCookie);
    assert.ok(sid);

    const me = await request(ctx.app, 'GET', '/api/admin/auth/me', {
        cookie: `admin_sid=${encodeURIComponent(sid)}`
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.role, 'super');
});

test('GET /api/admin/ping 需登录', async () => {
    const login = await request(ctx.app, 'POST', '/api/admin/auth/login', {
        body: { username: 'test_admin', password: 'TestAdmin123!' }
    });
    const sid = extractAdminSid(login.setCookie);
    const res = await request(ctx.app, 'GET', '/api/admin/ping', {
        cookie: `admin_sid=${encodeURIComponent(sid)}`
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.ok, true);
});
