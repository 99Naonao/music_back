/**
 * music / user 域集成测试（阶段 2.5 P0 扩展）
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { createTestApp, seedUser, seedMusicTrack } = require('../helpers/test-app');

function request(app, method, url, { token, body } = {}) {
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
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {} )
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
                            return reject(new Error(`非 JSON 响应: ${raw.slice(0, 200)}`));
                        }
                        resolve({ status: res.statusCode, body: json });
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

let ctx;

before(() => {
    ctx = createTestApp();
});

after(() => {
    if (ctx) ctx.cleanup();
});

test('GET /api/user/profile 获取资料', async () => {
    const user = seedUser(ctx.db, `profile_${uuidv4()}`);
    const res = await request(ctx.app, 'GET', '/api/user/profile', { token: user.openid });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.openid, user.openid);
});

test('PUT /api/music/:musicId/title 修改作品名', async () => {
    const user = seedUser(ctx.db, `title_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, user.id, { title: '旧名称' });
    const res = await request(ctx.app, 'PUT', `/api/music/${musicId}/title`, {
        token: user.openid,
        body: { title: '新名称' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.title, '新名称');
});

test('GET /api/music/user/:openid 作品列表', async () => {
    const user = seedUser(ctx.db, `works_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, user.id);
    const res = await request(ctx.app, 'GET', `/api/music/user/${user.openid}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.data[0].id, musicId);
});

test('DELETE /api/music/:musicId 删除作品', async () => {
    const user = seedUser(ctx.db, `del_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, user.id);
    const res = await request(ctx.app, 'DELETE', `/api/music/${musicId}`, { token: user.openid });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.deleted, true);

    const row = ctx.db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(musicId);
    assert.equal(row, undefined);
});

test('GET /api/user/follow/stats 关注统计', async () => {
    const user = seedUser(ctx.db, `follow_${uuidv4()}`);
    const res = await request(ctx.app, 'GET', '/api/user/follow/stats', { token: user.openid });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.followCount, 0);
    assert.equal(res.body.data.fansCount, 0);
});

test('GET /api/music/library 官方曲库', async () => {
    const res = await request(ctx.app, 'GET', '/api/music/library');
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(Array.isArray(res.body.data.list));
    assert.ok(typeof res.body.data.total === 'number');
});
