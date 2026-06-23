/**
 * Admin M2 看板集成测试
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createTestApp } = require('../helpers/test-app');
const adminAuthService = require('../../src/services/admin-auth-service');
const channelAnalytics = require('../../src/services/channel-analytics-service');

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
        username: 'stats_admin',
        password: 'StatsAdmin123!',
        role: 'super'
    });
    channelAnalytics.aggregateDailyStats(ctx.db, '2026-06-20');
});

after(() => {
    if (ctx) ctx.cleanup();
});

test('Admin stats overview / timeseries / ranking', async () => {
    const login = await request(ctx.app, 'POST', '/api/admin/auth/login', {
        body: { username: 'stats_admin', password: 'StatsAdmin123!' }
    });
    cookie = adminCookie(login.setCookie);

    const overview = await request(
        ctx.app,
        'GET',
        '/api/admin/stats/overview?from=2026-06-20&to=2026-06-22',
        { cookie }
    );
    assert.equal(overview.body.code, 0);
    assert.ok(overview.body.data.today);
    assert.ok(overview.body.data.rangeTotals);

    const ts = await request(
        ctx.app,
        'GET',
        '/api/admin/stats/timeseries?metric=dau&from=2026-06-20&to=2026-06-22',
        { cookie }
    );
    assert.equal(ts.body.code, 0);
    assert.ok(Array.isArray(ts.body.data.points));

    const rank = await request(
        ctx.app,
        'GET',
        '/api/admin/stats/channels-ranking?from=2026-06-20&to=2026-06-22',
        { cookie }
    );
    assert.equal(rank.body.code, 0);
    assert.ok(Array.isArray(rank.body.data.list));
});
