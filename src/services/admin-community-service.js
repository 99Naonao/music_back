const { ErrorCode } = require('../error-codes');

const READ_ROLES = new Set(['super', 'operator', 'readonly']);
const WRITE_ROLES = new Set(['super', 'operator']);

function assertRead(adminUser) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function assertWrite(adminUser) {
    if (!adminUser || !WRITE_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN, message: '当前账号无权删帖' };
    }
    return { ok: true };
}

function purgeCommunityPostById(db, postId) {
    db.prepare('DELETE FROM community_likes WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM community_posts WHERE id = ?').run(postId);
}

function countCommentDescendants(db, commentId) {
    const ids = [commentId];
    let queue = [commentId];
    while (queue.length) {
        const pid = queue.shift();
        const children = db.prepare('SELECT id FROM community_comments WHERE parent_id = ?').all(pid);
        for (const ch of children) {
            ids.push(ch.id);
            queue.push(ch.id);
        }
    }
    return ids;
}

function deleteCommentLikesByIds(db, commentIds) {
    const ids = [...new Set((commentIds || []).filter(Boolean))];
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM community_comment_likes WHERE comment_id IN (${placeholders})`).run(...ids);
}

function searchPosts(db, adminUser, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const q = String((query && (query.q || query.keyword)) || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(query && query.limit, 10) || 20));

    let rows;
    if (q) {
        const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
        rows = db
            .prepare(
                `SELECT p.id, p.title, p.content, p.topic, p.created_at, p.music_id,
                        u.nickname AS author, u.wx_openid AS author_openid,
                        (SELECT COUNT(*) FROM community_likes cl WHERE cl.post_id = p.id) AS like_count,
                        (SELECT COUNT(*) FROM community_comments cc WHERE cc.post_id = p.id) AS comment_count
                 FROM community_posts p
                 LEFT JOIN users u ON p.user_id = u.id
                 WHERE p.content LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\'
                 ORDER BY p.created_at DESC
                 LIMIT ?`
            )
            .all(like, like, limit);
    } else {
        rows = db
            .prepare(
                `SELECT p.id, p.title, p.content, p.topic, p.created_at, p.music_id,
                        u.nickname AS author, u.wx_openid AS author_openid,
                        (SELECT COUNT(*) FROM community_likes cl WHERE cl.post_id = p.id) AS like_count,
                        (SELECT COUNT(*) FROM community_comments cc WHERE cc.post_id = p.id) AS comment_count
                 FROM community_posts p
                 LEFT JOIN users u ON p.user_id = u.id
                 ORDER BY p.created_at DESC
                 LIMIT ?`
            )
            .all(limit);
    }

    return {
        ok: true,
        data: {
            list: rows.map((r) => ({
                id: r.id,
                title: r.title,
                content: r.content,
                topic: r.topic,
                createdAt: r.created_at,
                author: r.author,
                authorOpenid: r.author_openid,
                musicId: r.music_id,
                likeCount: r.like_count,
                commentCount: r.comment_count
            })),
            count: rows.length
        }
    };
}

function getPostDetail(db, adminUser, postId) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const id = String(postId || '').trim();
    const post = db
        .prepare(
            `SELECT p.*, u.nickname AS author, u.wx_openid AS author_openid
             FROM community_posts p
             LEFT JOIN users u ON p.user_id = u.id
             WHERE p.id = ?`
        )
        .get(id);
    if (!post) {
        return { ok: false, error: ErrorCode.POST_NOT_FOUND };
    }

    const likeCount = db
        .prepare('SELECT COUNT(*) AS c FROM community_likes WHERE post_id = ?')
        .get(id).c;

    const comments = db
        .prepare(
            `SELECT c.id, c.content, c.parent_id, c.created_at, c.likes,
                    u.nickname AS author, u.wx_openid AS author_openid
             FROM community_comments c
             LEFT JOIN users u ON c.user_id = u.id
             WHERE c.post_id = ?
             ORDER BY c.created_at ASC`
        )
        .all(id);

    let music = null;
    if (post.music_id) {
        music = db
            .prepare(
                `SELECT id, title, status, audio_url FROM music_tracks WHERE id = ?`
            )
            .get(post.music_id);
    }

    return {
        ok: true,
        data: {
            post: {
                id: post.id,
                title: post.title,
                content: post.content,
                topic: post.topic,
                images: post.images,
                createdAt: post.created_at,
                author: post.author,
                authorOpenid: post.author_openid,
                likeCount,
                commentCount: comments.length
            },
            comments: comments.map((c) => ({
                id: c.id,
                content: c.content,
                parentId: c.parent_id,
                likes: c.likes || 0,
                createdAt: c.created_at,
                author: c.author,
                authorOpenid: c.author_openid
            })),
            music: music
                ? { id: music.id, title: music.title, status: music.status, hasAudio: !!music.audio_url }
                : null
        }
    };
}

function getUserRisk(db, adminUser, openidRaw) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const openid = String(openidRaw || '').trim();
    if (!openid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'openid 不能为空' };
    }

    const since = db.prepare(`SELECT date('now', 'localtime', '-29 days') AS d`).get().d;
    const user = db.prepare('SELECT id, nickname FROM users WHERE wx_openid = ?').get(openid);

    const postCount = user
        ? db
              .prepare(
                  `SELECT COUNT(*) AS c FROM community_posts
                   WHERE user_id = ? AND date(created_at) >= ?`
              )
              .get(user.id, since).c
        : 0;

    const commentCount = user
        ? db
              .prepare(
                  `SELECT COUNT(*) AS c FROM community_comments
                   WHERE user_id = ? AND date(created_at) >= ?`
              )
              .get(user.id, since).c
        : 0;

    return {
        ok: true,
        data: {
            openid,
            nickname: user?.nickname || null,
            since,
            postCount30d: postCount,
            commentCount30d: commentCount,
            riskHint: postCount >= 20 ? '发帖频繁，建议关注' : null
        }
    };
}

function deletePost(db, adminUser, postId) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const id = postId != null ? String(postId).trim() : '';
    if (!id) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '帖子ID不能为空' };
    }

    const post = db.prepare('SELECT id FROM community_posts WHERE id = ?').get(id);
    if (!post) {
        return { ok: false, error: ErrorCode.POST_NOT_FOUND };
    }

    purgeCommunityPostById(db, id);
    return {
        ok: true,
        data: { postId: id },
        message: '帖子已删除'
    };
}

function deleteComment(db, adminUser, postId, commentId) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const pid = String(postId || '').trim();
    const cid = String(commentId || '').trim();
    if (!pid || !cid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '参数不能为空' };
    }

    const comment = db.prepare('SELECT id, post_id FROM community_comments WHERE id = ?').get(cid);
    if (!comment || comment.post_id !== pid) {
        return { ok: false, error: ErrorCode.NOT_FOUND, message: '评论不存在' };
    }

    const toDelete = countCommentDescendants(db, cid);
    const placeholders = toDelete.map(() => '?').join(',');
    deleteCommentLikesByIds(db, toDelete);
    db.prepare(`DELETE FROM community_comments WHERE id IN (${placeholders})`).run(...toDelete);

    const liveCount = db
        .prepare('SELECT COUNT(*) AS c FROM community_comments WHERE post_id = ?')
        .get(pid).c;
    db.prepare('UPDATE community_posts SET comments = ? WHERE id = ?').run(liveCount, pid);

    return {
        ok: true,
        data: { deleted: toDelete.length },
        message: '评论已删除'
    };
}

module.exports = {
    searchPosts,
    getPostDetail,
    getUserRisk,
    deletePost,
    deleteComment,
    purgeCommunityPostById
};
