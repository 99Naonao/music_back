/**
 * community 域业务 + 路由注册（阶段 2.5）
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');

function createCommunityRouter() {
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');

const {
    getDb,
    sendError,
    sendSuccess,
    successResponse,
    errorResponse,
    ErrorCode,
    logError,
    logWarn,
    logInfo,
    convertDbError,
    formatConsoleTimestampCn,
    uuidv4,
    axios,
    crypto,
    path,
    fs,
    contentSecurity,
    shopApi,
    wxMiniApps,
    channelService,
    cardTemplates,
    musicAudioStore,
    mediaSecStore,
    uploadDir,
    libraryAudioDir,
    upload,
    blockIfContentUnsafe,
    blockIfImagesUnsafe,
    blockIfHostedImageUnsafe,
    scheduleAudioMediaCheck,
    verifyWechatMsgSignature,
    getApiBaseUrl,
    buildPublicUploadUrl,
    getUploadPublicPathForFilename,
    buildPublicAudioUploadUrl,
    migrateLegacyCoverUrlToMusicCover,
    normalizePublicCoverUrl,
    sanitizePlayerCoverUrlForClient,
    sanitizeCardShareImageForClient,
    sanitizeCommunityImagesForClient,
    isOurHostedUploadUrl,
    resolveReferenceAudioProbeTarget,
    resolveHostedUploadToDisk,
    normalizeLibraryAudioUrl,
    resolveLibraryCoverRel,
    toAbsoluteCoverUrl,
    generateMusic,
    checkGenerationStatus,
    isMinimaxMockAllowed,
    generateBlessing,
    generateBlessingOffline,
    mixEffects,
    mixFinalAudio,
    probeAudioDurationSec,
    assertReferenceAudioDurationSec,
    AUDIO_DIR,
    MALL_PRODUCTS_DATA,
    getMallProductByIdFromStore,
    mallImageUrl,
    exposeQrcodeIfEnabled,
    exposeQrcodeListIfEnabled,
    getPromoCampaignsForScene,
    getMianjiaProducts,
    POINTS_TYPE,
    bedAccessToken,
    persistShopTokenFromPayload,
    requireShopToken,
    callShopWithAutoRefresh,
    recordPointsLedger,
    getOrInitPoints
} = ctx;
const db = getDb();

function withCommunityAuthorAvatar(row) {
    if (!row || typeof row !== 'object') return row;
    return {
        ...row,
        avatar: shopApi.formatUserAvatarForClient(row.avatar)
    };
}

function formatCommunityPostRow(post) {
    if (!post || typeof post !== 'object') return post;
    let images = [];
    if (post.images) {
        try {
            images = typeof post.images === 'string' ? JSON.parse(post.images) : post.images;
        } catch (_) {
            images = [];
        }
    }
    const liveComments =
        post.live_comments != null ? Number(post.live_comments) : null;
    const liveLikes = post.live_likes != null ? Number(post.live_likes) : null;
    return withCommunityAuthorAvatar({
        ...post,
        comments: liveComments != null && !Number.isNaN(liveComments) ? liveComments : post.comments || 0,
        likes: liveLikes != null && !Number.isNaN(liveLikes) ? liveLikes : post.likes || 0,
        images: sanitizeCommunityImagesForClient(images),
        music_cover_url: sanitizePlayerCoverUrlForClient(post.music_cover_url) || null
    });
}

function findUserByOpenid(openid) {
    const oid = openid != null ? String(openid).trim() : '';
    if (!oid) return null;
    return db.prepare('SELECT id, wx_openid, nickname, avatar_url FROM users WHERE wx_openid = ?').get(oid);
}

const LEGACY_REPLY_PREFIX_RE = /^回复\s*@([^：:]+)[：:]\s*/;

function stripLegacyReplyPrefix(content) {
    if (!content || typeof content !== 'string') return '';
    return content.replace(LEGACY_REPLY_PREFIX_RE, '');
}

function resolveCommentRootId(commentId, byId) {
    let id = commentId;
    const seen = new Set();
    while (id && !seen.has(id)) {
        seen.add(id);
        const row = byId.get(id);
        if (!row || !row.parent_id) return id;
        id = row.parent_id;
    }
    return commentId;
}

function loadReplyToUserMap(userIds) {
    const map = new Map();
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return map;
    const placeholders = ids.map(() => '?').join(',');
    const users = db
        .prepare(`SELECT id, wx_openid, nickname FROM users WHERE id IN (${placeholders})`)
        .all(...ids);
    users.forEach((u) => map.set(u.id, u));
    return map;
}

function formatCommunityCommentRow(row, replyToMap, likeMeta) {
    const base = withCommunityAuthorAvatar(row);
    const replyTo = row.reply_to_user_id ? replyToMap.get(row.reply_to_user_id) : null;
    const meta = likeMeta && likeMeta.get(row.id);
    return {
        id: base.id,
        post_id: base.post_id,
        user_id: base.user_id,
        content: stripLegacyReplyPrefix(base.content),
        created_at: base.created_at,
        name: base.name,
        avatar: base.avatar,
        openid: base.openid,
        parent_id: base.parent_id || null,
        reply_to_openid: replyTo ? replyTo.wx_openid : null,
        reply_to_name: replyTo ? replyTo.nickname || '盒友' : null,
        likes: meta ? meta.likes : Math.max(0, Number(row.likes) || 0),
        isLiked: !!(meta && meta.isLiked)
    };
}

function loadCommentLikeMeta(commentIds, viewerUserId) {
    const map = new Map();
    const ids = [...new Set((commentIds || []).filter(Boolean))];
    ids.forEach((id) => map.set(id, { likes: 0, isLiked: false }));
    if (!ids.length) return map;

    const placeholders = ids.map(() => '?').join(',');
    const countRows = db
        .prepare(
            `SELECT comment_id, COUNT(*) AS c FROM community_comment_likes WHERE comment_id IN (${placeholders}) GROUP BY comment_id`
        )
        .all(...ids);
    countRows.forEach((r) => {
        const prev = map.get(r.comment_id) || { likes: 0, isLiked: false };
        map.set(r.comment_id, { ...prev, likes: r.c });
    });

    const rows = db
        .prepare(`SELECT id, COALESCE(likes, 0) AS likes FROM community_comments WHERE id IN (${placeholders})`)
        .all(...ids);
    rows.forEach((r) => {
        const prev = map.get(r.id) || { likes: 0, isLiked: false };
        const stored = Math.max(0, Number(r.likes) || 0);
        map.set(r.id, {
            ...prev,
            likes: Math.max(prev.likes, stored)
        });
    });

    if (viewerUserId) {
        const likedRows = db
            .prepare(
                `SELECT comment_id FROM community_comment_likes WHERE user_id = ? AND comment_id IN (${placeholders})`
            )
            .all(viewerUserId, ...ids);
        likedRows.forEach((r) => {
            const prev = map.get(r.comment_id) || { likes: 0, isLiked: false };
            map.set(r.comment_id, { ...prev, isLiked: true });
        });
    }
    return map;
}

/** 评论排序：点赞数降序，相同则按发表时间升序 */
function sortCommentsByLikes(comments) {
    return [...(comments || [])].sort((a, b) => {
        const la = Math.max(0, Number(a.likes) || 0);
        const lb = Math.max(0, Number(b.likes) || 0);
        if (lb !== la) return lb - la;
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
}

function buildCommunityCommentTree(rows, viewerUserId) {
    if (!rows || !rows.length) return [];
    const replyToMap = loadReplyToUserMap(rows.map((r) => r.reply_to_user_id));
    const likeMeta = loadCommentLikeMeta(
        rows.map((r) => r.id),
        viewerUserId
    );
    const byId = new Map();
    for (const row of rows) {
        const c = formatCommunityCommentRow(row, replyToMap, likeMeta);
        byId.set(c.id, { ...c, replies: [] });
    }
    const roots = [];
    for (const c of byId.values()) {
        if (!c.parent_id) {
            roots.push(c);
            continue;
        }
        const rootId = resolveCommentRootId(c.parent_id, byId);
        const root = byId.get(rootId);
        if (root && root.id !== c.id) root.replies.push(c);
        else roots.push(c);
    }
    const sortedRoots = sortCommentsByLikes(roots);
    sortedRoots.forEach((r) => {
        r.replies = sortCommentsByLikes(r.replies);
    });
    return sortedRoots;
}

function deleteCommentLikesByIds(commentIds) {
    const ids = [...new Set((commentIds || []).filter(Boolean))];
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM community_comment_likes WHERE comment_id IN (${placeholders})`).run(...ids);
}

function countCommentDescendants(commentId) {
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

function formatFollowListUser(row, extra) {
    if (!row) return null;
    return {
        openid: row.wx_openid,
        nickname: row.nickname || '盒友',
        avatar: shopApi.formatUserAvatarForClient(row.avatar_url),
        followedAt: row.followed_at || row.created_at,
        ...(extra || {})
    };
}

/** 帖子列表用实时统计（避免 community_posts.comments/likes 与真实数据不一致） */
const COMMUNITY_POST_LIVE_COMMENTS_SQL = `(SELECT COUNT(*) FROM community_comments cc WHERE cc.post_id = p.id)`;
const COMMUNITY_POST_LIVE_LIKES_SQL = `(SELECT COUNT(*) FROM community_likes cl WHERE cl.post_id = p.id)`;

function resolveCommunityPostsOrderBy(feedType, sort) {
    const sortType = String(sort || '').toLowerCase();
    if (sortType === 'time' || sortType === 'latest') {
        return 'p.created_at DESC';
    }
    if (sortType === 'comments') {
        return `live_comments DESC, live_likes DESC, p.created_at DESC`;
    }
    if (sortType === 'likes') {
        return `live_likes DESC, live_comments DESC, p.created_at DESC`;
    }
    if (feedType === 'latest' || feedType === 'following') {
        return 'p.created_at DESC';
    }
    return `live_likes DESC, live_comments DESC, p.created_at DESC`;
}

router.post('/post', authMiddleware, async (req, res) => {
    const { title, content, images, topic, musicId } = req.body;
    const userId = req.user.id;

    // 参数校验
    if (!content || content.trim().length === 0) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '帖子内容不能为空'));
    }
    if (content.length > 2000) {
        return res.status(400).json(errorResponse(ErrorCode.INVALID_FORMAT, '帖子内容不能超过2000字'));
    }

    const safeImages = sanitizeCommunityImagesForClient(images);
    if (await blockIfContentUnsafe(res, req.user.wx_openid, [
        { content: title, scene: contentSecurity.SCENE.FORUM, field: 'title' },
        { content: content, scene: contentSecurity.SCENE.FORUM, field: 'content' },
        { content: topic, scene: contentSecurity.SCENE.FORUM, field: 'topic' }
    ])) {
        return;
    }
    if (safeImages.length && (await blockIfImagesUnsafe(res, safeImages, req))) {
        return;
    }

    const postId = uuidv4();
    const imagesJson = safeImages.length ? JSON.stringify(safeImages) : null;

    try {
        const stmt = db.prepare(`INSERT INTO community_posts (id, user_id, title, content, images, topic, music_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`);
        stmt.run(postId, userId, title || '', content, imagesJson, topic || '', musicId || null);

        logInfo('盒友圈发帖', '发布成功', {
            postId,
            userId,
            nickname: req.user.nickname || '',
            topic: topic || '',
            title: (title || '').slice(0, 40),
            contentPreview: content.slice(0, 80),
            contentLength: content.length,
            imageCount: safeImages.length,
            musicId: musicId || null
        });

        res.json(successResponse({ postId }, '发布成功'));
    } catch (err) {
        logError('发布帖子', err, { userId, title, topic });
        res.status(500).json(errorResponse(ErrorCode.POST_CREATE_FAILED, err.message));
    }
});

router.get('/posts', optionalAuthMiddleware, (req, res) => {
    const { page = 1, limit = 20, topic, feed = 'recommend', sort } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const feedType = String(feed || 'recommend').toLowerCase();

    if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json(errorResponse(ErrorCode.INVALID_PARAMS, 'page参数必须是大于0的数字'));
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return res.status(400).json(errorResponse(ErrorCode.INVALID_PARAMS, 'limit参数必须在1-100之间'));
    }

    const offset = (pageNum - 1) * limitNum;

    try {
        if (feedType === 'following' && !req.user) {
            return res.json(successResponse([]));
        }

        let query = `SELECT p.*,
            ${COMMUNITY_POST_LIVE_COMMENTS_SQL} AS live_comments,
            ${COMMUNITY_POST_LIVE_LIKES_SQL} AS live_likes,
            u.nickname as author, u.avatar_url as avatar, u.wx_openid as openid,
            m.title as music_title, m.audio_url as music_audio_url,
            m.audio_duration_ms as music_audio_duration_ms, m.duration as music_duration_sec,
            m.player_cover_url as music_cover_url, m.main_instrument as music_instrument
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         LEFT JOIN music_tracks m ON p.music_id = m.id`;
        const params = [];
        const where = [];

        if (topic && topic !== 'undefined' && topic !== '') {
            where.push('p.topic = ?');
            params.push(topic);
        }

        if (feedType === 'following') {
            where.push(
                'p.user_id IN (SELECT following_id FROM user_follows WHERE follower_id = ?)'
            );
            params.push(req.user.id);
        }

        if (where.length) {
            query += ` WHERE ${where.join(' AND ')}`;
        }

        query += ` ORDER BY ${resolveCommunityPostsOrderBy(feedType, sort)}`;
        query += ` LIMIT ? OFFSET ?`;
        params.push(limitNum, offset);

        const posts = db.prepare(query).all(...params);

        const formattedPosts = posts.map(formatCommunityPostRow);

        res.json(successResponse(formattedPosts));
    } catch (err) {
        logError('获取社群帖子列表', err, { page, limit, topic, feed });
        res.status(500).json(errorResponse(ErrorCode.DB_QUERY_ERROR, err.message));
    }
});

router.get('/post/:id', (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空'));
    }

    try {
        const stmt = db.prepare(`SELECT p.*, u.nickname as author, u.avatar_url as avatar, u.wx_openid as openid
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.id = ?`);
        const post = stmt.get(id);

        if (!post) {
            return res.status(404).json(errorResponse(ErrorCode.POST_NOT_FOUND));
        }

        res.json(successResponse(formatCommunityPostRow(post)));
    } catch (err) {
        logError('获取帖子详情', err, { postId: id });
        res.status(500).json(errorResponse(ErrorCode.DB_QUERY_ERROR, err.message));
    }
});

router.post('/post/:id/like', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空'));
    }

    // 检查帖子是否存在
    const postStmt = db.prepare('SELECT id FROM community_posts WHERE id = ?');
    const post = postStmt.get(id);
    if (!post) {
        return res.status(404).json(errorResponse(ErrorCode.POST_NOT_FOUND));
    }

    try {
        // 检查是否已点赞
        const checkStmt = db.prepare('SELECT * FROM community_likes WHERE post_id = ? AND user_id = ?');
        const existing = checkStmt.get(id, userId);

        if (existing) {
            // 取消点赞
            const deleteStmt = db.prepare('DELETE FROM community_likes WHERE post_id = ? AND user_id = ?');
            deleteStmt.run(id, userId);

            const updateStmt = db.prepare('UPDATE community_posts SET likes = likes - 1 WHERE id = ?');
            updateStmt.run(id);

            res.json(successResponse({ liked: false }, '取消点赞成功'));
        } else {
            // 点赞
            const insertStmt = db.prepare('INSERT INTO community_likes (post_id, user_id) VALUES (?, ?)');
            insertStmt.run(id, userId);

            const updateStmt = db.prepare('UPDATE community_posts SET likes = likes + 1 WHERE id = ?');
            updateStmt.run(id);

            // 发送点赞通知给帖主
            try {
                const post = db.prepare('SELECT user_id, content FROM community_posts WHERE id = ?').get(id);
                if (post && post.user_id !== userId) {
                    const notifId = uuidv4();
                    const title = post.content ? post.content.substring(0, 20) + '...' : '你的帖子';
                    db.prepare(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
                        VALUES (?, ?, ?, ?, ?, ?)`)
                        .run(notifId, post.user_id, 'like', title, '有人赞了你的帖子', id);
                }
            } catch (e) {
                logWarn('发送点赞通知失败', e.message);
            }

            res.json(successResponse({ liked: true }, '点赞成功'));
        }
    } catch (err) {
        logError('点赞操作', err, { postId: id, userId });
        res.status(500).json(errorResponse(ErrorCode.LIKE_FAILED, err.message));
    }
});

router.post('/post/:id/comment', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { content, replyToOpenid, parentId } = req.body;
    const userId = req.user.id;

    if (!id) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空'));
    }
    const text = content != null ? String(content).trim() : '';
    if (!text) {
        return res.status(400).json(errorResponse(ErrorCode.MISSING_REQUIRED_PARAM, '评论内容不能为空'));
    }
    if (text.length > 500) {
        return res.status(400).json(errorResponse(ErrorCode.INVALID_FORMAT, '评论内容不能超过500字'));
    }

    if (
        await blockIfContentUnsafe(res, req.user.wx_openid, [
            { content: text, scene: contentSecurity.SCENE.COMMENT, field: 'content' }
        ])
    ) {
        return;
    }

    const postStmt = db.prepare('SELECT id FROM community_posts WHERE id = ?');
    const post = postStmt.get(id);
    if (!post) {
        return res.status(404).json(errorResponse(ErrorCode.POST_NOT_FOUND));
    }

    let parent_id = null;
    let reply_to_user_id = null;
    const parentIdTrim = parentId != null ? String(parentId).trim() : '';
    if (parentIdTrim) {
        const parent = db
            .prepare('SELECT id, post_id, user_id FROM community_comments WHERE id = ?')
            .get(parentIdTrim);
        if (!parent || parent.post_id !== id) {
            return res
                .status(400)
                .json(errorResponse(ErrorCode.INVALID_PARAMS, '回复的评论不存在或不属于该帖'));
        }
        parent_id = parentIdTrim;
        const replyOid = replyToOpenid != null ? String(replyToOpenid).trim() : '';
        if (replyOid) {
            const replyUser = findUserByOpenid(replyOid);
            if (replyUser) reply_to_user_id = replyUser.id;
        } else {
            reply_to_user_id = parent.user_id;
        }
    }

    const commentId = uuidv4();

    try {
        const insertStmt = db.prepare(`INSERT INTO community_comments
            (id, post_id, user_id, content, parent_id, reply_to_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`);
        insertStmt.run(commentId, id, userId, text, parent_id, reply_to_user_id);

        const updateStmt = db.prepare('UPDATE community_posts SET comments = comments + 1 WHERE id = ?');
        updateStmt.run(id);

        try {
            const postRow = db.prepare('SELECT user_id, content FROM community_posts WHERE id = ?').get(id);
            const snippet = text.substring(0, 50);
            const notified = new Set();

            if (postRow && postRow.user_id !== userId) {
                const notifId = uuidv4();
                const title = postRow.content ? postRow.content.substring(0, 20) + '...' : '你的帖子';
                db.prepare(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
                    VALUES (?, ?, ?, ?, ?, ?)`)
                    .run(notifId, postRow.user_id, 'comment', title, snippet, id);
                notified.add(postRow.user_id);
            }

            if (reply_to_user_id && reply_to_user_id !== userId && !notified.has(reply_to_user_id)) {
                const notifId = uuidv4();
                db.prepare(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
                    VALUES (?, ?, ?, ?, ?, ?)`)
                    .run(notifId, reply_to_user_id, 'comment', '有人回复了你', snippet, id);
            }
        } catch (e) {
            logWarn('发送评论通知失败', e.message);
        }

        res.json(successResponse({ commentId }, '评论成功'));
    } catch (err) {
        logError('发布评论', err, { postId: id, userId });
        res.status(500).json(errorResponse(ErrorCode.COMMENT_CREATE_FAILED, err.message));
    }
});

router.get('/post/:id/comments', optionalAuthMiddleware, (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const viewerUserId = req.user ? req.user.id : null;

    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空');
    }

    // 分页参数校验
    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
        return sendError(res, ErrorCode.PAGE_PARAM_ERROR, 'page参数必须是大于0的数字');
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return sendError(res, ErrorCode.PAGE_PARAM_ERROR, 'limit参数必须在1-100之间');
    }

    const offset = (pageNum - 1) * limitNum;
    const fetchLimit = Math.min(limitNum * 20, 500);

    try {
        const stmt = db.prepare(`SELECT c.*, u.nickname as name, u.avatar_url as avatar, u.wx_openid as openid
         FROM community_comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.post_id = ?
         ORDER BY c.created_at ASC
         LIMIT ?`);
        const allRows = stmt.all(id, fetchLimit);
        const tree = buildCommunityCommentTree(allRows, viewerUserId);
        const list = tree.slice(offset, offset + limitNum);

        sendSuccess(res, { list, total: tree.length });
    } catch (err) {
        logError('获取评论列表', err, { postId: id, page, limit });
        sendError(res, convertDbError(err), err.message);
    }
});

router.post('/post/:postId/comment/:commentId/like', authMiddleware, (req, res) => {
    const { postId, commentId } = req.params;
    const userId = req.user.id;

    if (!postId || !commentId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '参数不能为空');
    }

    try {
        const comment = db
            .prepare('SELECT id, post_id, user_id FROM community_comments WHERE id = ?')
            .get(commentId);
        if (!comment || comment.post_id !== postId) {
            return sendError(res, ErrorCode.NOT_FOUND, '评论不存在');
        }

        const existing = db
            .prepare('SELECT 1 AS ok FROM community_comment_likes WHERE comment_id = ? AND user_id = ?')
            .get(commentId, userId);

        if (existing) {
            db.prepare('DELETE FROM community_comment_likes WHERE comment_id = ? AND user_id = ?').run(
                commentId,
                userId
            );
            const prev = db
                .prepare('SELECT COALESCE(likes, 0) AS likes FROM community_comments WHERE id = ?')
                .get(commentId);
            const nextLikes = Math.max(0, (prev?.likes || 0) - 1);
            db.prepare('UPDATE community_comments SET likes = ? WHERE id = ?').run(nextLikes, commentId);
            return sendSuccess(res, { liked: false, likes: nextLikes }, '取消点赞成功');
        }

        db.prepare('INSERT INTO community_comment_likes (comment_id, user_id) VALUES (?, ?)').run(
            commentId,
            userId
        );
        db.prepare('UPDATE community_comments SET likes = COALESCE(likes, 0) + 1 WHERE id = ?').run(commentId);
        const row = db.prepare('SELECT COALESCE(likes, 0) AS likes FROM community_comments WHERE id = ?').get(
            commentId
        );

        if (comment.user_id !== userId) {
            try {
                const notifId = uuidv4();
                db.prepare(`INSERT INTO notifications (id, user_id, type, title, content, related_id)
                    VALUES (?, ?, ?, ?, ?, ?)`)
                    .run(notifId, comment.user_id, 'like', '评论获赞', '有人赞了你的评论', postId);
            } catch (e) {
                logWarn('评论点赞通知失败', e.message);
            }
        }

        sendSuccess(res, { liked: true, likes: row ? row.likes : 1 }, '点赞成功');
    } catch (err) {
        logError('评论点赞', err, { postId, commentId, userId });
        sendError(res, ErrorCode.LIKE_FAILED, err.message);
    }
});

router.get('/post/:id/liked', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空');
    }

    try {
        const stmt = db.prepare('SELECT * FROM community_likes WHERE post_id = ? AND user_id = ?');
        const row = stmt.get(id, userId);
        sendSuccess(res, { liked: !!row });
    } catch (err) {
        logError('检查点赞状态', err, { postId: id, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/stats', (req, res) => {
    try {
        const postCount = db.prepare('SELECT COUNT(*) as count FROM community_posts').get().count;
        const commentCount = db.prepare('SELECT COUNT(*) as count FROM community_comments').get().count;
        const userCount = db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM community_posts').get().count;

        sendSuccess(res, { postCount, commentCount, userCount });
    } catch (err) {
        logError('获取社区统计', err);
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/user/:userId/posts', (req, res) => {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'page参数必须是大于0的数字');
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'limit参数必须在1-100之间');
    }

    const offset = (pageNum - 1) * limitNum;

    try {
        // userId 是 wx_openid，需要先查询对应的 users.id
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(userId);
        if (!user) {
            return sendSuccess(res, { list: [], total: 0, totalLikesReceived: 0 });
        }

        const total = db
            .prepare('SELECT COUNT(*) as c FROM community_posts WHERE user_id = ?')
            .get(user.id).c;

        /** 该用户所有帖子获赞之和（与 community_posts.likes 一致） */
        const totalLikesReceived = db
            .prepare(
                'SELECT COALESCE(SUM(likes), 0) AS s FROM community_posts WHERE user_id = ?'
            )
            .get(user.id).s;

        const stmt = db.prepare(`SELECT p.*, u.nickname as author, u.avatar_url as avatar
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         WHERE p.user_id = ?
         ORDER BY p.created_at DESC LIMIT ? OFFSET ?`);
        const posts = stmt.all(user.id, limitNum, offset);

        const formattedPosts = posts.map(formatCommunityPostRow);

        sendSuccess(res, {
            list: formattedPosts,
            total,
            totalLikesReceived
        });
    } catch (err) {
        logError('获取用户帖子列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/rankings', (req, res) => {
    const { type = 'likes', limit = 10 } = req.query;
    const limitNum = Number(limit);

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'limit参数必须在1-50之间');
    }

    let orderBy = 'p.likes DESC';
    if (type === 'comments') orderBy = 'p.comments DESC';
    else if (type === 'latest') orderBy = 'p.created_at DESC';

    try {
        const stmt = db.prepare(`SELECT p.*, u.nickname as author, u.avatar_url as avatar
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         ORDER BY ${orderBy}
         LIMIT ?`);
        const posts = stmt.all(limitNum);

        const formattedPosts = posts.map(formatCommunityPostRow);

        sendSuccess(res, formattedPosts);
    } catch (err) {
        logError('获取热门排行', err, { type });
        sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/post/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空');
    }

    try {
        const post = db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(id);
        if (!post) {
            return sendError(res, ErrorCode.POST_NOT_FOUND);
        }
        if (post.user_id !== userId) {
            return sendError(res, ErrorCode.FORBIDDEN, '无权删除该帖子');
        }

        purgeCommunityPostById(id);

        sendSuccess(res, null, '帖子删除成功');
    } catch (err) {
        logError('删除帖子', err, { postId: id, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/post/:postId/comment/:commentId', authMiddleware, (req, res) => {
    const { postId, commentId } = req.params;
    const userId = req.user.id;

    if (!postId || !commentId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '参数不能为空');
    }

    try {
        const comment = db.prepare('SELECT user_id, post_id FROM community_comments WHERE id = ?').get(commentId);
        if (!comment) {
            return sendError(res, ErrorCode.NOT_FOUND, '评论不存在');
        }

        const post = db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(postId);
        const isCommentAuthor = comment.user_id === userId;
        const isPostAuthor = post && post.user_id === userId;

        if (!isCommentAuthor && !isPostAuthor) {
            return sendError(res, ErrorCode.FORBIDDEN, '无权删除该评论');
        }

        const toDelete = countCommentDescendants(commentId);
        const placeholders = toDelete.map(() => '?').join(',');
        deleteCommentLikesByIds(toDelete);
        db.prepare(`DELETE FROM community_comments WHERE id IN (${placeholders})`).run(...toDelete);
        const postRow = db.prepare('SELECT comments FROM community_posts WHERE id = ?').get(postId);
        const nextCount = Math.max(0, (postRow?.comments || 0) - toDelete.length);
        db.prepare('UPDATE community_posts SET comments = ? WHERE id = ?').run(nextCount, postId);

        sendSuccess(res, { deleted: toDelete.length }, '评论删除成功');
    } catch (err) {
        logError('删除评论', err, { commentId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});


function getCommunityAdminSecret() {
    return String(process.env.COMMUNITY_ADMIN_SECRET || process.env.FEEDBACK_ADMIN_SECRET || '').trim();
}

function isCommunityAdminRequest(req) {
    const secret = getCommunityAdminSecret();
    const given = String(
        (req.query && req.query.secret) || req.headers['x-admin-secret'] || ''
    ).trim();
    return !!(secret && given && given === secret);
}

function purgeCommunityPostById(postId) {
    db.prepare('DELETE FROM community_likes WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM community_posts WHERE id = ?').run(postId);
}

router.get('/admin/posts', (req, res) => {
    if (!isCommunityAdminRequest(req)) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权操作');
    }
    logWarn('社区管理', 'secret 接口已弃用，请迁移至 /api/admin/community/posts');

    const q = String(req.query.q || req.query.keyword || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    try {
        let rows;
        if (q) {
            const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
            rows = db
                .prepare(
                    `SELECT p.id, p.title, p.content, p.topic, p.created_at, u.nickname AS author
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
                    `SELECT p.id, p.title, p.content, p.topic, p.created_at, u.nickname AS author
                     FROM community_posts p
                     LEFT JOIN users u ON p.user_id = u.id
                     ORDER BY p.created_at DESC
                     LIMIT ?`
                )
                .all(limit);
        }
        sendSuccess(res, { list: rows, count: rows.length });
    } catch (err) {
        logError('管理端查帖', err, { q });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 管理端：删除任意帖子（deprecated：请用 DELETE /api/admin/community/posts/:id） */
router.delete('/admin/post/:id', (req, res) => {
    if (!isCommunityAdminRequest(req)) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权操作');
    }
    logWarn('社区管理', 'secret 删帖接口已弃用，请迁移至 /api/admin/community/posts/:id');

    const { id } = req.params;
    if (!id) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '帖子ID不能为空');
    }

    try {
        const post = db.prepare('SELECT id FROM community_posts WHERE id = ?').get(id);
        if (!post) {
            return sendError(res, ErrorCode.POST_NOT_FOUND);
        }
        purgeCommunityPostById(id);
        logInfo('管理端删帖', '已删除', { postId: id });
        sendSuccess(res, { postId: id }, '帖子已删除');
    } catch (err) {
        logError('管理端删帖', err, { postId: id });
        sendError(res, convertDbError(err), err.message);
    }
});

return router;
}

module.exports = { createCommunityRouter };
