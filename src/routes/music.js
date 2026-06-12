/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware } = require('../middleware/auth');
const musicService = require('../services/music-service');

const {
    sendError,
    sendSuccess,
    ErrorCode,
    logError,
    logInfo,
    convertDbError,
    contentSecurity,
    blockIfContentUnsafe,
    blockIfHostedImageUnsafe,
    scheduleAudioMediaCheck,
    uploadDir
} = ctx;

musicService.setUploadDir(uploadDir);

router.post('/create', authMiddleware, async (req, res) => {
    try {
        const { title, userPrompt } = req.body || {};
        const openid = req.user.wx_openid;
        if (
            await blockIfContentUnsafe(res, openid, [
                { content: title, scene: contentSecurity.SCENE.PROFILE, field: 'title' },
                { content: userPrompt, scene: contentSecurity.SCENE.SOCIAL, field: 'userPrompt' }
            ])
        ) {
            return;
        }

        const result = await musicService.createMusic({
            req,
            userId: req.user.id,
            body: req.body,
            scheduleAudioMediaCheck
        });
        if (!result.ok) {
            const code = result.dbErr ? convertDbError(result.dbErr) : result.error;
            return sendError(res, code, result.message);
        }
        sendSuccess(res, result.data, result.message);
    } catch (error) {
        logError('创建音乐', error, req.body);
        sendError(res, ErrorCode.MUSIC_CREATE_FAILED, error.message);
    }
});

router.get('/library', (req, res) => {
    try {
        const result = musicService.listLibrary(req, req.query);
        sendSuccess(res, result.data);
    } catch (err) {
        logError('获取曲库列表', err);
        sendError(res, convertDbError(err), err.message);
    }
});

router.post('/library/play', (req, res) => {
    try {
        const musicId = req.body && req.body.musicId;
        const result = musicService.recordLibraryPlay(musicId);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data);
    } catch (err) {
        logError('曲库播放计数', err, { musicId: req.body && req.body.musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/user/:userId', async (req, res) => {
    try {
        const result = await musicService.listUserMusic(req.params.userId);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data);
    } catch (err) {
        logError('获取用户作品列表', err, { userId: req.params.userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.post('/:musicId/cancel', authMiddleware, (req, res) => {
    try {
        const musicId = String(req.params.musicId || '').trim();
        const result = musicService.cancelMusic(musicId, req.user.id);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('取消生成', err, { musicId: req.params.musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/:musicId/status', async (req, res) => {
    try {
        const result = await musicService.getMusicStatus(req.params.musicId);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data);
    } catch (err) {
        logError('查询音乐状态', err, { musicId: req.params.musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.put('/:musicId/title', authMiddleware, async (req, res) => {
    const { musicId } = req.params;
    const userId = req.user.id;
    const titleRaw = req.body && req.body.title != null ? String(req.body.title).trim() : '';

    if (
        await blockIfContentUnsafe(res, req.user.wx_openid, [
            { content: titleRaw, scene: contentSecurity.SCENE.PROFILE, field: 'title' }
        ])
    ) {
        return;
    }

    try {
        const result = musicService.updateMusicTitle(musicId, userId, titleRaw);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('更新作品名称', err, { musicId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.put('/:musicId/player-cover', authMiddleware, async (req, res) => {
    const { musicId } = req.params;
    const userId = req.user.id;
    const coverUrlRaw = req.body && req.body.coverUrl != null ? String(req.body.coverUrl).trim() : '';

    const validated = musicService.validatePlayerCoverUrl(coverUrlRaw);
    if (!validated.ok) {
        return sendError(res, validated.error, validated.message);
    }
    if (validated.coverUrl && (await blockIfHostedImageUnsafe(res, validated.coverUrl, req, 'coverUrl'))) {
        return;
    }

    try {
        const result = musicService.updatePlayerCover(musicId, userId, validated.coverUrl);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('更新作品播放器封面', err, { musicId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/:musicId', authMiddleware, (req, res) => {
    try {
        const result = musicService.deleteMusic(req.params.musicId, req.user.id);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('删除音乐作品', err, { musicId: req.params.musicId, userId: req.user.id });
        sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
