/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
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

const SHARE_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isShareUuidString(id) {
    const s = id != null ? String(id).trim() : '';
    return s !== '' && SHARE_UUID_RE.test(s);
}

function mapGiftInboxRow(row) {
    if (!row) return null;
    const coverRaw =
        (row.cover_image && String(row.cover_image).trim()) ||
        (row.artist_bg_image && String(row.artist_bg_image).trim()) ||
        '';
    const musicCover = row.player_cover_url
        ? sanitizePlayerCoverUrlForClient(row.player_cover_url)
        : '';
    const message = row.message != null ? String(row.message) : '';
    const preview =
        message.length > 48 ? `${message.slice(0, 48)}…` : message;
    return {
        shareId: row.share_id,
        recipient: row.recipient || '',
        messagePreview: preview,
        workTitle: row.work_title || '专属助眠曲',
        coverUrl: coverRaw || musicCover || '',
        musicId: row.music_id || '',
        senderId: row.sender_id || '',
        sharedAt: row.shared_at || '',
        firstOpenedAt: row.first_opened_at || '',
        lastOpenedAt: row.last_opened_at || ''
    };
}

router.post('/gift-inbox', authMiddleware, (req, res) => {
    const shareId = req.body && req.body.shareId != null ? String(req.body.shareId).trim() : '';
    const userId = req.user.id;

    if (!isShareUuidString(shareId)) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '分享ID无效');
    }

    try {
        const share = db.prepare('SELECT id, sender_id FROM card_shares WHERE id = ?').get(shareId);
        if (!share) {
            return sendError(res, ErrorCode.SHARE_NOT_FOUND);
        }
        if (share.sender_id && String(share.sender_id) === String(userId)) {
            return sendSuccess(res, { recorded: false, reason: 'self_share' });
        }

        db.prepare(
            `INSERT INTO card_gift_inbox (user_id, share_id, sender_id, first_opened_at, last_opened_at)
             VALUES (?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
             ON CONFLICT(user_id, share_id) DO UPDATE SET
               last_opened_at = datetime('now', 'localtime'),
               sender_id = excluded.sender_id`
        ).run(userId, shareId, share.sender_id || null);

        logInfo('收礼箱', '已记录', { userId, shareId: shareId.slice(0, 8) + '…' });
        sendSuccess(res, { recorded: true, shareId });
    } catch (err) {
        logError('收礼箱记录', err, { userId, shareId });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 收礼箱列表（须在 /api/card/:cardId 之前注册，否则 gift-inbox 会被当成 cardId） */
router.get('/gift-inbox', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    try {
        const rows = db
            .prepare(
                `SELECT i.share_id, i.sender_id, i.first_opened_at, i.last_opened_at,
                        s.recipient, s.message, s.music_id, s.cover_image, s.artist_bg_image,
                        s.created_at AS shared_at,
                        m.title AS work_title, m.player_cover_url
                 FROM card_gift_inbox i
                 INNER JOIN card_shares s ON s.id = i.share_id
                 LEFT JOIN music_tracks m ON m.id = s.music_id
                 WHERE i.user_id = ?
                 ORDER BY datetime(i.last_opened_at) DESC
                 LIMIT ?`
            )
            .all(userId, limitNum);

        sendSuccess(res, {
            list: rows.map(mapGiftInboxRow).filter(Boolean),
            total: rows.length
        });
    } catch (err) {
        logError('收礼箱列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 从收礼箱移除（不删除原分享） */
router.delete('/gift-inbox/:shareId', authMiddleware, (req, res) => {
    const shareId =
        req.params && req.params.shareId != null ? String(req.params.shareId).trim() : '';
    const userId = req.user.id;

    if (!isShareUuidString(shareId)) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '分享ID无效');
    }

    try {
        const r = db
            .prepare('DELETE FROM card_gift_inbox WHERE user_id = ? AND share_id = ?')
            .run(userId, shareId);
        sendSuccess(res, { removed: r.changes > 0 });
    } catch (err) {
        logError('收礼箱移除', err, { userId, shareId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.post('/share', authMiddleware, async (req, res) => {
    const {
        musicId,
        recipient,
        message,
        template,
        templateId,
        musicInstrument,
        musicFrequency,
        musicBpm,
        coverImage,
        audioUrl,
        artistBgImage,
        savedToLibrary
    } = req.body;
    const senderId = req.user.id;
    const savedToLib = savedToLibrary === true || savedToLibrary === 1 || savedToLibrary === '1' ? 1 : 0;

    logInfo('贺卡分享', 'POST 创建请求', {
        senderId,
        musicId: musicId || '',
        templateId: templateId || '',
        recipient: recipient ? String(recipient).slice(0, 20) : '',
        hasCover: !!(coverImage && String(coverImage).trim()),
        hasAudio: !!(audioUrl && String(audioUrl).trim())
    });

    // 参数校验
    if (!musicId) {
        logWarn('贺卡分享', '创建失败：缺少 musicId', { senderId });
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }
    if (!recipient || recipient.trim().length === 0) {
        logWarn('贺卡分享', '创建失败：收件人为空', { senderId, musicId });
        return sendError(res, ErrorCode.RECIPIENT_EMPTY);
    }

    if (
        await blockIfContentUnsafe(res, req.user.wx_openid, [
            { content: recipient, scene: contentSecurity.SCENE.SOCIAL, field: 'recipient' },
            { content: message, scene: contentSecurity.SCENE.SOCIAL, field: 'message' }
        ])
    ) {
        logWarn('贺卡分享', '创建失败：内容安全未通过', { senderId, musicId });
        return;
    }

    const coverRaw = coverImage != null ? String(coverImage).trim() : '';
    const hasCustomCover = coverRaw !== '';
    if (coverRaw && (await blockIfHostedImageUnsafe(res, coverRaw, req, 'coverImage'))) {
        logWarn('贺卡分享', '创建失败：封面图安全未通过', { senderId, musicId });
        return;
    }

    const resolved = cardTemplates.resolveTemplateForShare(db, {
        templateId,
        template,
        artistBgImage,
        hasCustomCover
    });
    if (resolved.error === 'INVALID_TEMPLATE') {
        logWarn('贺卡分享', '创建失败：模板无效', {
            senderId,
            musicId,
            templateId: templateId || '',
            template
        });
        return sendError(res, ErrorCode.CARD_TEMPLATE_INVALID);
    }

    const shareId = uuidv4();
    const sourceChannel = channelService.resolveSourceChannel(db, req);

    try {
        const stmt = db.prepare(`INSERT INTO card_shares (id, music_id, sender_id, recipient, message, template, template_id, music_instrument, music_frequency, music_bpm, cover_image, audio_url, artist_bg_image, saved_to_library, source_channel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(
            shareId,
            musicId,
            senderId,
            recipient,
            message || '',
            resolved.template,
            resolved.templateId,
            musicInstrument || '',
            musicFrequency || '',
            musicBpm || 60,
            coverImage || '',
            audioUrl || '',
            resolved.artistBgImage,
            savedToLib,
            sourceChannel
        );

        if (audioUrl && String(audioUrl).trim()) {
            scheduleAudioMediaCheck(req.user.wx_openid, audioUrl, 'card_share', shareId);
        }

        logInfo('贺卡分享', 'POST 创建成功', {
            shareId,
            senderId,
            musicId,
            templateId: resolved.templateId || '',
            hasCustomCover
        });
        sendSuccess(res, { shareId, templateId: resolved.templateId }, '分享创建成功');
    } catch (err) {
        logError('创建贺卡分享', err, { musicId, senderId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/shares/mine', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    try {
        const rows = db
            .prepare(
                `SELECT id, music_id, recipient, message, template, template_id,
                        music_instrument, music_frequency, music_bpm,
                        cover_image, audio_url, artist_bg_image, created_at
                 FROM card_shares
                 WHERE sender_id = ? AND COALESCE(saved_to_library, 0) = 1
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?`
            )
            .all(userId, limitNum);

        const list = rows.map((r) => ({
            shareId: r.id,
            musicId: r.music_id,
            recipient: r.recipient,
            message: r.message,
            template: r.template,
            templateId: r.template_id || '',
            musicInstrument: r.music_instrument,
            musicFrequency: r.music_frequency,
            musicBpm: r.music_bpm,
            coverImage: r.cover_image,
            audioUrl: r.audio_url,
            artistBgImage: r.artist_bg_image || '',
            createdAt: r.created_at
        }));

        sendSuccess(res, list);
    } catch (err) {
        logError('获取我的贺卡列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/share/:shareId', (req, res) => {
    const { shareId } = req.params;

    if (!shareId) {
        logWarn('贺卡分享', 'GET 失败：shareId 为空');
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '分享ID不能为空');
    }

    logInfo('贺卡分享', 'GET 详情请求', { shareId });

    try {
        const stmt = db.prepare('SELECT * FROM card_shares WHERE id = ?');
        const share = stmt.get(shareId);

        if (!share) {
            logWarn('贺卡分享', 'GET 未找到', { shareId });
            return sendError(res, ErrorCode.SHARE_NOT_FOUND);
        }

        let templateCategoryId = ''
        let textLayout = null
        let charsPerLine = null
        if (share.template_id) {
            const tpl = cardTemplates.getTemplateById(db, share.template_id);
            if (tpl) {
                templateCategoryId = tpl.categoryId || ''
                textLayout = tpl.textLayout || null
                charsPerLine = tpl.charsPerLine != null ? tpl.charsPerLine : null
            }
        }

        let workTitle = ''
        let musicCoverUrl = ''
        let durationSec = 0
        if (share.music_id) {
            try {
                const track = db
                    .prepare(
                        `SELECT title, player_cover_url, audio_url, audio_duration_ms, duration,
                                main_instrument, frequency, bpm
                         FROM music_tracks WHERE id = ?`
                    )
                    .get(share.music_id)
                if (track) {
                    workTitle = track.title || ''
                    musicCoverUrl =
                        sanitizePlayerCoverUrlForClient(track.player_cover_url) || ''
                    if (!share.audio_url && track.audio_url) {
                        share.audio_url = track.audio_url
                    }
                    const ms = track.audio_duration_ms
                    if (ms != null && Number(ms) > 0) {
                        durationSec = Math.max(1, Math.ceil(Number(ms) / 1000))
                    } else if (track.duration != null && Number(track.duration) > 0) {
                        durationSec = Math.floor(Number(track.duration))
                    }
                }
            } catch (trackErr) {
                logWarn('获取分享贺卡关联曲目', trackErr, { shareId, musicId: share.music_id })
            }
        }

        logInfo('贺卡分享', 'GET 成功', {
            shareId,
            musicId: share.music_id,
            senderId: share.sender_id,
            recipient: share.recipient ? String(share.recipient).slice(0, 20) : '',
            workTitle: workTitle || '',
            hasCustomCover: !!(share.cover_image && String(share.cover_image).trim()),
            hasMusicCover: !!musicCoverUrl,
            durationSec
        });
        sendSuccess(res, {
            shareId: share.id,
            musicId: share.music_id,
            senderId: share.sender_id,
            recipient: share.recipient,
            message: share.message,
            template: share.template,
            templateId: share.template_id || '',
            templateCategoryId,
            textLayout,
            charsPerLine,
            workTitle,
            musicCoverUrl,
            durationSec,
            musicInfo: {
                instrument: share.music_instrument,
                frequency: share.music_frequency,
                bpm: share.music_bpm
            },
            coverImage: sanitizeCardShareImageForClient(req, share.cover_image),
            audioUrl: share.audio_url,
            artistBgImage: sanitizeCardShareImageForClient(req, share.artist_bg_image),
            createdAt: share.created_at
        });
    } catch (err) {
        logError('获取贺卡分享详情', err, { shareId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/template-categories', (req, res) => {
    try {
        sendSuccess(res, cardTemplates.listCategories(db));
    } catch (err) {
        logError('获取贺卡分类', err);
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/templates', (req, res) => {
    const { category, page, limit } = req.query;
    try {
        const data = cardTemplates.listTemplates(db, { category, page, limit });
        sendSuccess(res, data);
    } catch (err) {
        logError('获取贺卡模板列表', err, { category });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/templates/:templateId', (req, res) => {
    const { templateId } = req.params;
    if (!templateId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '模板ID不能为空');
    }
    try {
        const tpl = cardTemplates.getTemplateById(db, templateId);
        if (!tpl) {
            return sendError(res, ErrorCode.CARD_TEMPLATE_INVALID);
        }
        sendSuccess(res, tpl);
    } catch (err) {
        logError('获取贺卡模板详情', err, { templateId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.post('/templates/sync', (req, res) => {
    const secret = process.env.CARD_TEMPLATE_SYNC_SECRET;
    if (secret && req.headers['x-sync-secret'] !== secret) {
        return sendError(res, ErrorCode.FORBIDDEN, '同步密钥无效');
    }
    try {
        const result = cardTemplates.syncCardTemplatesFromManifest(db);
        sendSuccess(res, result, '贺卡模板已同步');
    } catch (err) {
        logError('同步贺卡模板', err);
        sendError(res, convertDbError(err), err.message);
    }
});

router.post('/create', async (req, res) => {
    const {
        musicId,
        senderId,
        recipientName,
        message,
        templateStyle
    } = req.body;

    // 参数校验
    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }
    if (!recipientName || recipientName.trim().length === 0) {
        return sendError(res, ErrorCode.RECIPIENT_EMPTY);
    }

    if (
        await blockIfContentUnsafe(res, null, [
            { content: recipientName, scene: contentSecurity.SCENE.SOCIAL, field: 'recipientName' },
            { content: message, scene: contentSecurity.SCENE.SOCIAL, field: 'message' }
        ])
    ) {
        return;
    }

    const cardId = uuidv4();
    const shareUrl = `${req.protocol}://${req.get('host')}/card/${cardId}`;

    try {
        const stmt = db.prepare(`INSERT INTO greeting_cards (id, music_id, sender_id, recipient_name, message, template_style, share_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(cardId, musicId, senderId || null, recipientName, message || '', templateStyle || 'default', shareUrl);

        sendSuccess(res, {
            cardId,
            shareUrl
        }, '贺卡创建成功');
    } catch (err) {
        logError('创建贺卡', err, { musicId, senderId });
        sendError(res, ErrorCode.CARD_CREATE_FAILED, err.message);
    }
});

router.get('/:cardId', (req, res) => {
    const { cardId } = req.params;

    if (!cardId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '贺卡ID不能为空');
    }
    if (cardId === 'gift-inbox') {
        return sendError(res, ErrorCode.UNAUTHORIZED, '请先登录');
    }

    try {
        const stmt = db.prepare(`SELECT c.*, m.title as music_title, m.audio_url, m.main_instrument, m.frequency
         FROM greeting_cards c
         JOIN music_tracks m ON c.music_id = m.id
         WHERE c.id = ?`);
        const card = stmt.get(cardId);

        if (!card) {
            return sendError(res, ErrorCode.CARD_NOT_FOUND);
        }

        sendSuccess(res, card);
    } catch (err) {
        logError('获取贺卡详情', err, { cardId });
        sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
