/**
 * card 域集成测试（阶段 2）
 * 运行：npm run test:integration
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

test('GET /api/card/gift-inbox 未登录返回 401（非 404）', async () => {
    const res = await request(ctx.app, 'GET', '/api/card/gift-inbox');
    assert.equal(res.status, 401);
    assert.notEqual(res.body.code, 1000);
});

test('POST /api/card/share 创建分享并写入 cover_image', async () => {
    const sender = seedUser(ctx.db, `sender_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, sender.id);
    const coverImage = 'https://music.test/api/music/cover?f=share-cover.png';

    const res = await request(ctx.app, 'POST', '/api/card/share', {
        token: sender.openid,
        body: {
            musicId,
            recipient: '小明',
            message: '晚安',
            template: 1,
            coverImage,
            audioUrl: '/api/music/audio?f=test.mp3'
        }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.ok(res.body.data.shareId);

    const row = ctx.db
        .prepare('SELECT cover_image FROM card_shares WHERE id = ?')
        .get(res.body.data.shareId);
    assert.ok(row);
    assert.equal(row.cover_image, coverImage);
});

test('GET /api/card/share/:shareId 返回 https 封面', async () => {
    const sender = seedUser(ctx.db, `sender_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, sender.id);
    const shareId = uuidv4();
    const coverImage = '/api/music/cover?f=gift.png';

    ctx.db
        .prepare(
            `INSERT INTO card_shares (id, music_id, sender_id, recipient, message, template, cover_image)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(shareId, musicId, sender.id, '小红', '好梦', 1, coverImage);

    const res = await request(ctx.app, 'GET', `/api/card/share/${shareId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.code, 0);
    assert.match(res.body.data.coverImage, /^https:\/\//);
});

test('POST + GET /api/card/gift-inbox 收礼箱流程', async () => {
    const sender = seedUser(ctx.db, `sender_${uuidv4()}`);
    const recipient = seedUser(ctx.db, `recv_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, sender.id);
    const shareId = uuidv4();

    ctx.db
        .prepare(
            `INSERT INTO card_shares (id, music_id, sender_id, recipient, message, template)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(shareId, musicId, sender.id, '朋友', '愿你安眠', 1);

    const postRes = await request(ctx.app, 'POST', '/api/card/gift-inbox', {
        token: recipient.openid,
        body: { shareId }
    });
    assert.equal(postRes.status, 200);
    assert.equal(postRes.body.code, 0);
    assert.equal(postRes.body.data.recorded, true);

    const listRes = await request(ctx.app, 'GET', '/api/card/gift-inbox', {
        token: recipient.openid
    });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.code, 0);
    assert.ok(Array.isArray(listRes.body.data.list));
    assert.ok(listRes.body.data.list.some((item) => item.shareId === shareId));
});

test('自己打开的分享不计入收礼箱', async () => {
    const sender = seedUser(ctx.db, `sender_${uuidv4()}`);
    const musicId = seedMusicTrack(ctx.db, sender.id);
    const shareId = uuidv4();

    ctx.db
        .prepare(
            `INSERT INTO card_shares (id, music_id, sender_id, recipient, message, template)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(shareId, musicId, sender.id, '自己', '测试', 1);

    const res = await request(ctx.app, 'POST', '/api/card/gift-inbox', {
        token: sender.openid,
        body: { shareId }
    });
    assert.equal(res.body.data.recorded, false);
    assert.equal(res.body.data.reason, 'self_share');
});
