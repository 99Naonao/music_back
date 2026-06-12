/**
 * library / points 域集成测试（阶段 2.5）
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

test('GET /api/points/config 无需登录', async () => {
    const res = await request(ctx.app, 'GET', '/api/points/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(res.body.data);
});

test('GET /api/points/:openid 查询积分', async () => {
    const user = seedUser(ctx.db, `pts_${uuidv4()}`);
    const res = await request(ctx.app, 'GET', `/api/points/${user.openid}`, { token: user.openid });
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.equal(res.body.data.points, 0);
});

test('POST /api/points/add 增加积分并写入明细', async () => {
    const user = seedUser(ctx.db, `pts_add_${uuidv4()}`);
    const addRes = await request(ctx.app, 'POST', '/api/points/add', {
        token: user.openid,
        body: { points: 5, type: 'test_reward', description: '测试奖励' }
    });
    assert.equal(addRes.status, 200);
    assert.equal(addRes.body.data.currentPoints, 5);

    const histRes = await request(ctx.app, 'GET', `/api/points/${user.openid}/history`, {
        token: user.openid
    });
    assert.equal(histRes.status, 200);
    assert.ok(histRes.body.data.list.length >= 1);
    assert.equal(histRes.body.data.list[0].points, 5);
});

test('POST /api/play-history 记录播放', async () => {
    const user = seedUser(ctx.db, `lib_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, user.id);
    const res = await request(ctx.app, 'POST', '/api/play-history', {
        token: user.openid,
        body: {
            musicId,
            title: '测试曲目',
            audioUrl: '/api/music/audio?f=test.mp3'
        }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.musicId, musicId);

    const listRes = await request(ctx.app, 'GET', '/api/play-history', { token: user.openid });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.list.length, 1);
});

test('POST /api/favorites/:musicId 收藏曲目', async () => {
    const user = seedUser(ctx.db, `fav_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, user.id);
    const res = await request(ctx.app, 'POST', `/api/favorites/${musicId}`, {
        token: user.openid
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.favorited, true);

    const listRes = await request(ctx.app, 'GET', '/api/favorites', { token: user.openid });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.list.length, 1);
    assert.equal(listRes.body.data.list[0].musicId, musicId);
});
