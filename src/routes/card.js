/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware } = require('../middleware/auth');
const channelService = require('../channel-service');
const cardShareService = require('../services/card-share-service');
const giftInboxService = require('../services/gift-inbox-service');

const {
    getDb,
    sendError,
    sendSuccess,
    ErrorCode,
    logError,
    logWarn,
    logInfo,
    convertDbError,
    uuidv4,
    contentSecurity,
    cardTemplates,
    blockIfContentUnsafe,
    blockIfHostedImageUnsafe,
    scheduleAudioMediaCheck
} = ctx;
const db = getDb();

router.post('/gift-inbox', authMiddleware, (req, res) => {
    const shareId = req.body && req.body.shareId != null ? String(req.body.shareId).trim() : '';
    const userId = req.user.id;

    try {
        const result = giftInboxService.recordGiftOpen(userId, shareId);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        if (result.data.recorded) {
            logInfo('收礼箱', '已记录', { userId, shareId: shareId.slice(0, 8) + '…' });
        }
        sendSuccess(res, result.data);
    } catch (err) {
        logError('收礼箱记录', err, { userId, shareId });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 收礼箱列表（须在 /api/card/:cardId 之前注册，否则 gift-inbox 会被当成 cardId） */
router.get('/gift-inbox', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const limit = req.query.limit;

    try {
        const data = giftInboxService.listGiftInbox(userId, limit);
        sendSuccess(res, data);
    } catch (err) {
        logError('收礼箱列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/gift-inbox/:shareId', authMiddleware, (req, res) => {
    const shareId =
        req.params && req.params.shareId != null ? String(req.params.shareId).trim() : '';
    const userId = req.user.id;

    try {
        const result = giftInboxService.removeFromGiftInbox(userId, shareId);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data);
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

    logInfo('贺卡分享', 'POST 创建请求', {
        senderId,
        musicId: musicId || '',
        templateId: templateId || '',
        recipient: recipient ? String(recipient).slice(0, 20) : '',
        hasCover: !!(coverImage && String(coverImage).trim()),
        hasAudio: !!(audioUrl && String(audioUrl).trim())
    });

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
    if (coverRaw && (await blockIfHostedImageUnsafe(res, coverRaw, req, 'coverImage'))) {
        logWarn('贺卡分享', '创建失败：封面图安全未通过', { senderId, musicId });
        return;
    }

    try {
        const result = cardShareService.createShare({
            req,
            senderId,
            wxOpenid: req.user.wx_openid,
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
            savedToLibrary,
            scheduleAudioMediaCheck
        });

        if (!result.ok) {
            logWarn('贺卡分享', '创建失败', {
                senderId,
                musicId,
                code: result.error && result.error.code
            });
            return sendError(res, result.error, result.message);
        }

        logInfo('贺卡分享', 'POST 创建成功', {
            shareId: result.data.shareId,
            senderId,
            musicId,
            templateId: result.data.templateId || '',
            hasCustomCover: result.meta.hasCustomCover
        });
        sendSuccess(res, result.data, '分享创建成功');
    } catch (err) {
        logError('创建贺卡分享', err, { musicId, senderId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/shares/mine', authMiddleware, (req, res) => {
    const userId = req.user.id;

    try {
        const list = cardShareService.listMySavedShares(userId, req.query.limit);
        sendSuccess(res, list);
    } catch (err) {
        logError('获取我的贺卡列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/share/:shareId', (req, res) => {
    const { shareId } = req.params;

    logInfo('贺卡分享', 'GET 详情请求', { shareId });

    try {
        const result = cardShareService.getShareDetail(shareId, req);
        if (!result.ok) {
            if (result.error === ErrorCode.SHARE_NOT_FOUND) {
                logWarn('贺卡分享', 'GET 未找到', { shareId });
            }
            return sendError(res, result.error, result.message);
        }

        logInfo('贺卡分享', 'GET 成功', {
            shareId,
            ...result.meta,
            recipient: result.meta.recipient ? String(result.meta.recipient).slice(0, 20) : ''
        });
        sendSuccess(res, result.data);
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
    const { musicId, senderId, recipientName, message, templateStyle } = req.body;

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

    let sourceChannel = null;
    const senderRow =
        senderId &&
        db.prepare('SELECT id FROM users WHERE id = ? OR wx_openid = ?').get(senderId, senderId);
    sourceChannel = channelService.resolveSourceChannel(db, {
        headers: req.headers,
        user: senderRow || undefined
    });

    try {
        db.prepare(
            `INSERT INTO greeting_cards (id, music_id, sender_id, recipient_name, message, template_style, share_url, source_channel)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            cardId,
            musicId,
            senderId || null,
            recipientName,
            message || '',
            templateStyle || 'default',
            shareUrl,
            sourceChannel
        );

        sendSuccess(res, { cardId, shareUrl }, '贺卡创建成功');
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
        const card = db
            .prepare(
                `SELECT c.*, m.title as music_title, m.audio_url, m.main_instrument, m.frequency
                 FROM greeting_cards c
                 JOIN music_tracks m ON c.music_id = m.id
                 WHERE c.id = ?`
            )
            .get(cardId);

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
