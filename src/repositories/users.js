const { getDb } = require('../bootstrap/database');

function findByOpenid(openid) {
    const oid = openid != null ? String(openid).trim() : '';
    if (!oid) return null;
    return getDb()
        .prepare('SELECT id, wx_openid, nickname, avatar_url FROM users WHERE wx_openid = ?')
        .get(oid);
}

function findIdByOpenid(openid) {
    const row = getDb().prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
    return row ? row.id : null;
}

function findProfileByOpenid(openid) {
    return getDb()
        .prepare(
            'SELECT id, wx_openid, phone, nickname, avatar_url, gender, birthday FROM users WHERE wx_openid = ?'
        )
        .get(openid);
}

function findLoginProfile(openid) {
    return getDb().prepare('SELECT nickname, avatar_url FROM users WHERE wx_openid = ?').get(openid);
}

function getShopToken(openid) {
    const row = getDb().prepare('SELECT shop_token FROM users WHERE wx_openid = ?').get(openid);
    return row && row.shop_token ? row.shop_token : null;
}

function insertUser(row) {
    getDb()
        .prepare(
            'INSERT INTO users (id, wx_openid, wx_app_id, phone, nickname, avatar_url) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(row.id, row.openid, row.appId, row.phone, row.nickname, row.avatarUrl);
}

function updateUserOnLogin(openid, phone, nickname, appId) {
    getDb()
        .prepare('UPDATE users SET phone = ?, nickname = ?, wx_app_id = ? WHERE wx_openid = ?')
        .run(phone || '', nickname, appId, openid);
}

function updateProfile(openid, updates) {
    if (!updates.length) return;
    const params = updates.map((u) => u.value);
    params.push(openid);
    const sql = `UPDATE users SET ${updates.map((u) => `${u.field} = ?`).join(', ')} WHERE wx_openid = ?`;
    getDb().prepare(sql).run(...params);
}

function countFollowers(userId) {
    return getDb().prepare('SELECT COUNT(*) as c FROM user_follows WHERE following_id = ?').get(userId).c;
}

function countFollowing(userId) {
    return getDb().prepare('SELECT COUNT(*) as c FROM user_follows WHERE follower_id = ?').get(userId).c;
}

function listFollowers(userId, limit, offset) {
    return getDb()
        .prepare(
            `SELECT u.wx_openid, u.nickname, u.avatar_url, f.created_at as followed_at,
                    EXISTS(
                        SELECT 1 FROM user_follows f2
                        WHERE f2.follower_id = ? AND f2.following_id = u.id
                    ) as is_following
                 FROM user_follows f
                 JOIN users u ON f.follower_id = u.id
                 WHERE f.following_id = ?
                 ORDER BY f.created_at DESC
                 LIMIT ? OFFSET ?`
        )
        .all(userId, userId, limit, offset);
}

function countFollowersTotal(userId) {
    return getDb().prepare('SELECT COUNT(*) as c FROM user_follows WHERE following_id = ?').get(userId).c;
}

function listFollowing(userId, limit, offset) {
    return getDb()
        .prepare(
            `SELECT u.wx_openid, u.nickname, u.avatar_url, f.created_at as followed_at
             FROM user_follows f
             JOIN users u ON f.following_id = u.id
             WHERE f.follower_id = ?
             ORDER BY f.created_at DESC
             LIMIT ? OFFSET ?`
        )
        .all(userId, limit, offset);
}

function countFollowingTotal(userId) {
    return getDb().prepare('SELECT COUNT(*) as c FROM user_follows WHERE follower_id = ?').get(userId).c;
}

function isFollowing(followerId, followingId) {
    const row = getDb()
        .prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?')
        .get(followerId, followingId);
    return !!row;
}

function addFollow(followerId, followingId) {
    getDb()
        .prepare('INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)')
        .run(followerId, followingId);
}

function removeFollow(followerId, followingId) {
    getDb()
        .prepare('DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?')
        .run(followerId, followingId);
}

function insertFollowNotification(notif) {
    getDb()
        .prepare(
            `INSERT INTO notifications (id, user_id, type, title, content, related_id)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(notif.id, notif.userId, notif.type, notif.title, notif.content, notif.relatedId);
}

function purgeUser(uid) {
    const db = getDb();
    const tx = db.transaction((internalUserId) => {
        const trackIds = db
            .prepare('SELECT id FROM music_tracks WHERE user_id = ?')
            .all(internalUserId)
            .map((r) => r.id);

        for (const tid of trackIds) {
            db.prepare('UPDATE community_posts SET music_id = NULL WHERE music_id = ?').run(tid);
        }

        const myCommentPosts = db
            .prepare('SELECT post_id FROM community_comments WHERE user_id = ?')
            .all(internalUserId);
        for (const row of myCommentPosts) {
            db.prepare(
                `UPDATE community_posts SET comments = CASE WHEN comments > 0 THEN comments - 1 ELSE 0 END WHERE id = ?`
            ).run(row.post_id);
        }
        db.prepare('DELETE FROM community_comments WHERE user_id = ?').run(internalUserId);

        const myLikePosts = db
            .prepare('SELECT post_id FROM community_likes WHERE user_id = ?')
            .all(internalUserId);
        for (const row of myLikePosts) {
            db.prepare(
                `UPDATE community_posts SET likes = CASE WHEN likes > 0 THEN likes - 1 ELSE 0 END WHERE id = ?`
            ).run(row.post_id);
        }
        db.prepare('DELETE FROM community_likes WHERE user_id = ?').run(internalUserId);

        const myPostIds = db
            .prepare('SELECT id FROM community_posts WHERE user_id = ?')
            .all(internalUserId)
            .map((r) => r.id);
        for (const pid of myPostIds) {
            db.prepare('DELETE FROM community_likes WHERE post_id = ?').run(pid);
            db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(pid);
        }
        db.prepare('DELETE FROM community_posts WHERE user_id = ?').run(internalUserId);

        for (const tid of trackIds) {
            db.prepare('DELETE FROM sound_effects WHERE music_id = ?').run(tid);
            db.prepare('DELETE FROM greeting_cards WHERE music_id = ?').run(tid);
            db.prepare('DELETE FROM card_shares WHERE music_id = ?').run(tid);
        }
        db.prepare('DELETE FROM music_tracks WHERE user_id = ?').run(internalUserId);

        db.prepare('DELETE FROM greeting_cards WHERE sender_id = ?').run(internalUserId);
        db.prepare('DELETE FROM card_shares WHERE sender_id = ?').run(internalUserId);

        db.prepare('DELETE FROM notifications WHERE user_id = ?').run(internalUserId);
        db.prepare('DELETE FROM play_history WHERE user_id = ?').run(internalUserId);
        db.prepare('DELETE FROM user_favorites WHERE user_id = ?').run(internalUserId);
        db.prepare(
            'DELETE FROM user_follows WHERE follower_id = ? OR following_id = ?'
        ).run(internalUserId, internalUserId);
        db.prepare('DELETE FROM points_history WHERE user_id = ?').run(internalUserId);
        db.prepare('DELETE FROM user_points WHERE user_id = ?').run(internalUserId);

        const delUser = db.prepare('DELETE FROM users WHERE id = ?').run(internalUserId);
        if (delUser.changes !== 1) {
            throw new Error('用户记录未删除（可能已不存在）');
        }
    });
    tx(uid);
}

module.exports = {
    findByOpenid,
    findIdByOpenid,
    findProfileByOpenid,
    findLoginProfile,
    getShopToken,
    insertUser,
    updateUserOnLogin,
    updateProfile,
    countFollowers,
    countFollowing,
    listFollowers,
    countFollowersTotal,
    listFollowing,
    countFollowingTotal,
    isFollowing,
    addFollow,
    removeFollow,
    insertFollowNotification,
    purgeUser
};
