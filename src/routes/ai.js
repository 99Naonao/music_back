/**
 * AI 祝福语、音乐生成、音频混音
 */
const express = require('express');
const ctx = require('../utils/app-context');
const {
    getDb,
    sendError,
    sendSuccess,
    ErrorCode,
    logError,
    logWarn,
    convertDbError,
    uuidv4,
    path,
    generateMusic,
    generateBlessing,
    generateBlessingOffline,
    mixEffects,
    mixFinalAudio
} = ctx;
const db = getDb();

const blessingRouter = express.Router();

blessingRouter.post('/generate-blessing', async (req, res) => {
    const { recipient, relationship } = req.body;

    if (!recipient || recipient.trim().length === 0) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '收件人姓名不能为空');
    }

    try {
        const blessing = await generateBlessing(recipient, relationship || '朋友');
        sendSuccess(res, {
            blessing,
            source: 'deepseek'
        }, '祝福语生成成功');
    } catch (error) {
        logError('AI生成祝福语', error, { recipient, relationship });
        const fallback = generateBlessingOffline(recipient);
        sendSuccess(res, {
            blessing: fallback,
            source: 'offline'
        }, 'AI服务暂不可用，已使用本地模板');
    }
});

function registerAiRoutes(app) {
    app.use('/api/ai', blessingRouter);

    app.post('/api/music/generate', async (req, res) => {
        const { userId, instrument, frequency, bpm, duration: bodyDuration, soundEffects: bodySoundEffects } =
            req.body;

        if (!instrument) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '乐器类型不能为空');
        }
        if (!frequency) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '脑波频率不能为空');
        }
        if (!bpm || isNaN(Number(bpm))) {
            return sendError(res, ErrorCode.INVALID_MUSIC_PARAMS, 'BPM参数无效');
        }

        const musicId = uuidv4();

        try {
            const stmt = db.prepare(
                'INSERT INTO music_tracks (id, user_id, main_instrument, frequency, bpm, status) VALUES (?, ?, ?, ?, ?, ?)'
            );
            stmt.run(musicId, userId || 'anonymous', instrument, frequency, bpm, 'generating');
        } catch (err) {
            logError('插入音乐记录', err, { musicId, userId });
            return sendError(res, convertDbError(err), err.message);
        }

        try {
            const result = await generateMusic({
                instrument,
                frequency,
                bpm,
                userId: userId || 'anonymous',
                durationSeconds:
                    bodyDuration != null && !Number.isNaN(Number(bodyDuration))
                        ? Number(bodyDuration)
                        : undefined,
                soundEffects: Array.isArray(bodySoundEffects) ? bodySoundEffects : []
            });

            if (result.success) {
                sendSuccess(
                    res,
                    {
                        musicId,
                        jobId: result.jobId,
                        status: result.status,
                        estimatedTime: result.estimatedTime,
                        mock: result.mock || false
                    },
                    '音乐生成任务已创建'
                );
            } else {
                try {
                    db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?').run('failed', musicId);
                } catch (dbErr) {
                    logWarn('更新音乐失败状态', dbErr.message);
                }
                sendError(res, ErrorCode.MUSIC_GENERATION_FAILED, '外部API调用失败');
            }
        } catch (error) {
            logError('生成音乐', error, { musicId, instrument, frequency });
            try {
                db.prepare('UPDATE music_tracks SET status = ? WHERE id = ?').run('failed', musicId);
            } catch (dbErr) {
                logWarn('更新音乐失败状态', dbErr.message);
            }
            sendError(res, ErrorCode.MUSIC_GENERATION_FAILED, error.message);
        }
    });

    app.post('/api/audio/mix-effects', async (req, res) => {
        const { effects, duration } = req.body;

        if (!effects || !Array.isArray(effects)) {
            return sendError(res, ErrorCode.INVALID_PARAMS, 'effects参数必须是数组');
        }
        if (effects.length === 0) {
            return sendError(res, ErrorCode.INVALID_PARAMS, 'effects数组不能为空');
        }

        try {
            const outputFile = await mixEffects(effects, duration || 180);
            sendSuccess(
                res,
                {
                    filePath: outputFile,
                    url: `/audio/${path.basename(outputFile)}`
                },
                '白噪音合成成功'
            );
        } catch (error) {
            logError('合成白噪音', error, { effects, duration });
            sendError(res, ErrorCode.AUDIO_MIX_FAILED, error.message);
        }
    });

    app.post('/api/audio/mix-final', async (req, res) => {
        const { musicUrl, effectsFile, voiceFile, volumes } = req.body;

        if (!musicUrl && !effectsFile && !voiceFile) {
            return sendError(res, ErrorCode.INVALID_PARAMS, '至少需要提供一条音轨');
        }

        try {
            const outputFile = await mixFinalAudio({
                musicUrl,
                effectsFile,
                voiceFile,
                volumes
            });
            sendSuccess(
                res,
                {
                    filePath: outputFile,
                    url: `/audio/${path.basename(outputFile)}`
                },
                '音频混音成功'
            );
        } catch (error) {
            logError('三轨混音', error, { musicUrl, effectsFile, voiceFile });
            sendError(res, ErrorCode.AUDIO_MIX_FAILED, error.message);
        }
    });
}

module.exports = { registerAiRoutes };
