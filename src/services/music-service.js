const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const musicRepo = require('../repositories/music-tracks');
const channelService = require('../channel-service');
const musicAudioStore = require('../music-audio-store');
const { ErrorCode, logError, logWarn, logInfo } = require('../error-codes');
const { incrementMusicPlayCount } = require('../utils/music-play-count');
const {
    sanitizePlayerCoverUrlForClient,
    migrateLegacyCoverUrlToMusicCover,
    normalizePublicCoverUrl,
    isOurHostedUploadUrl,
    resolveReferenceAudioProbeTarget,
    resolveHostedUploadToDisk,
    getApiBaseUrl
} = require('../utils/media-url');
const { resolveLibraryCoverRel, toAbsoluteCoverUrl } = require('../library-cover');
const { normalizeLibraryAudioUrl } = require('../media-paths');
const { generateMusic, checkGenerationStatus, isMinimaxMockAllowed } = require('../minimax-service');
const { mixFinalAudio, probeAudioDurationSec, assertReferenceAudioDurationSec } = require('../audio-mixer');

let uploadDir = '';

function setUploadDir(dir) {
    uploadDir = dir || '';
}

function getUploadDir() {
    return uploadDir;
}

async function enrichTrackRow(row, options = {}) {
    const skipRemotePersist = options.skipRemotePersist === true;
    const base = {
        ...row,
        player_cover_url: sanitizePlayerCoverUrlForClient(row.player_cover_url) || null
    };

    if (skipRemotePersist) {
        let audioUrl = base.audio_url ? String(base.audio_url).trim() : '';
        if (audioUrl && musicAudioStore.localAudioFileExists(uploadDir, row.id)) {
            const localUrl = musicAudioStore.buildMusicAudioPublicUrl(row.id);
            if (localUrl) audioUrl = localUrl;
        }
        return {
            ...base,
            audio_url: audioUrl,
            audioReachable: !!audioUrl
        };
    }

    const enriched = await musicAudioStore.enrichTrackAudio(uploadDir, base);
    if (enriched.audio_url && enriched.audio_url !== row.audio_url) {
        try {
            musicRepo.updateAudioUrl(row.id, enriched.audio_url);
        } catch (dbErr) {
            logWarn('更新作品本地音频地址', dbErr.message || '失败', { musicId: row.id });
        }
    }
    return enriched;
}

async function completeMusicTrackWithAudio(musicId, remoteUrl, audioDurationMs, scheduleAudioMediaCheck) {
    if (musicRepo.isCancelled(musicId)) {
        logInfo('作品音频', '用户已取消，跳过落盘', { musicId });
        return;
    }

    let publicUrl = String(remoteUrl || '').trim();
    if (!publicUrl) return;

    try {
        const localUrl = await musicAudioStore.persistMusicAudioFromRemote(
            uploadDir,
            musicId,
            publicUrl
        );
        if (localUrl) publicUrl = localUrl;
    } catch (e) {
        logWarn('音频落盘', '失败，暂存外链', { musicId, message: e.message });
    }

    try {
        const voiceUrl = musicRepo.getVoiceUrl(musicId);
        const voiceDisk = voiceUrl ? resolveHostedUploadToDisk(voiceUrl) : null;
        const musicLocalPath = musicAudioStore.getLocalAudioFilePath(uploadDir, musicId);
        if (voiceDisk && musicLocalPath && fs.existsSync(musicLocalPath)) {
            const mixedPath = await mixFinalAudio({
                musicUrl: musicLocalPath,
                voiceFile: voiceDisk,
                volumes: { music: 0.82, voice: 0.58 }
            });
            if (mixedPath && fs.existsSync(mixedPath)) {
                fs.copyFileSync(mixedPath, musicLocalPath);
                try {
                    fs.unlinkSync(mixedPath);
                } catch (_) {
                    /* ignore */
                }
                const mixedPublic = musicAudioStore.buildMusicAudioPublicUrl(musicId);
                if (mixedPublic) publicUrl = mixedPublic;
                logInfo('人声混音', '已完成', { musicId });
            }
        }
    } catch (mixErr) {
        logWarn('人声混音', mixErr.message || '失败，保留纯音乐', { musicId });
    }

    const ms =
        audioDurationMs != null && Number.isFinite(Number(audioDurationMs))
            ? Math.round(Number(audioDurationMs))
            : null;
    try {
        if (musicRepo.isCancelled(musicId)) {
            logInfo('作品音频', '落盘完成后已取消，丢弃成片', { musicId });
            return;
        }
        const changes = musicRepo.completeTrack(musicId, publicUrl, ms);
        if (!changes) {
            logInfo('作品音频', '用户已取消，未写入 completed', { musicId });
            return;
        }
        logInfo('作品音频', '已就绪', {
            musicId,
            hosted: musicAudioStore.isSelfHostedMusicAudioUrl(publicUrl)
        });

        const owner = musicRepo.findTrackOwnerOpenid(musicId);
        if (owner && owner.wx_openid && typeof scheduleAudioMediaCheck === 'function') {
            scheduleAudioMediaCheck(owner.wx_openid, publicUrl, 'music_track', musicId);
        }
    } catch (err) {
        logError('写入作品音频', err, { musicId });
    }
}

async function generateMusicAudio(
    musicId,
    instrument,
    frequency,
    duration,
    bpm,
    soundEffects,
    promptExtras,
    scheduleAudioMediaCheck
) {
    const musicService = process.env.MUSIC_SERVICE || 'minimax';

    if (musicService === 'minimax') {
        try {
            const result = await generateMusic({
                instrument,
                frequency,
                bpm,
                userId: 'system',
                durationSeconds: duration != null ? Number(duration) : 180,
                soundEffects: Array.isArray(soundEffects) ? soundEffects : [],
                userPrompt: promptExtras.userPrompt,
                moodLabel: promptExtras.moodLabel,
                sceneLabels: promptExtras.sceneLabels,
                hasVoiceTrack: !!(promptExtras && promptExtras.hasVoiceTrack),
                referenceAudioUrl:
                    promptExtras && promptExtras.referenceAudioUrl
                        ? promptExtras.referenceAudioUrl
                        : ''
            });

            if (!result || result.success !== true) {
                console.error('[generateMusicAudio] MiniMax 不可用:', result && result.error);
                try {
                    musicRepo.setStatusIfNotCancelled(musicId, 'failed');
                } catch (err) {
                    console.error('[DB] 更新失败状态:', err);
                }
                return;
            }

            if (musicRepo.isCancelled(musicId)) {
                logInfo('生成音乐', '用户已取消，忽略 MiniMax 响应', { musicId });
                return;
            }

            if (result.audioUrl) {
                await completeMusicTrackWithAudio(
                    musicId,
                    result.audioUrl,
                    result.audioDurationMs,
                    scheduleAudioMediaCheck
                );
                console.log(`[Music Generated] ${musicId}: persisted`);
                return;
            }

            if (result.jobId) {
                pollMinimaxStatus(musicId, result.jobId, scheduleAudioMediaCheck);
                return;
            }

            console.error('[generateMusicAudio] MiniMax 返回无 audioUrl/jobId');
            try {
                musicRepo.setStatusIfNotCancelled(musicId, 'failed');
            } catch (err) {
                console.error('[DB] 更新失败状态:', err);
            }
            return;
        } catch (error) {
            console.error('[generateMusicAudio] MiniMax 调用失败:', error);
            try {
                musicRepo.setStatusIfNotCancelled(musicId, 'failed');
            } catch (err) {
                console.error('[DB] 更新失败状态:', err);
            }
            return;
        }
    }

    if (!isMinimaxMockAllowed()) {
        try {
            musicRepo.setStatusIfNotCancelled(musicId, 'failed');
        } catch (err) {
            console.error('[DB] 更新失败状态:', err);
        }
        console.warn('[generateMusicAudio] 非 minimax 服务且禁止 mock，已标记 failed:', musicId);
        return;
    }

    const sampleUrls = {
        guqin: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        piano: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        handpan: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
        cello: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3'
    };

    const audioUrl = sampleUrls[instrument] || sampleUrls.guqin;

    setTimeout(() => {
        completeMusicTrackWithAudio(musicId, audioUrl, null, scheduleAudioMediaCheck).catch((err) => {
            console.error('[DB] Mock 音频落盘失败:', err);
        });
    }, 5000);
}

function pollMinimaxStatus(musicId, jobId, scheduleAudioMediaCheck) {
    let attempts = 0;
    const maxAttempts = parseInt(process.env.MINIMAX_POLL_MAX_ATTEMPTS || '120', 10) || 120;

    const interval = setInterval(async () => {
        attempts++;
        try {
            if (musicRepo.isCancelled(musicId)) {
                clearInterval(interval);
                logInfo('MiniMax 轮询', '任务已取消，停止轮询', { musicId, jobId });
                return;
            }

            const status = await checkGenerationStatus(jobId);

            if (status.success === false) {
                clearInterval(interval);
                try {
                    musicRepo.setStatusIfNotCancelled(musicId, 'failed');
                } catch (err) {
                    console.error('[DB] 更新失败状态失败:', err);
                }
                console.warn(
                    `[Music Generation Failed] ${musicId}（状态查询失败）:`,
                    status.error || ''
                );
                return;
            }

            if (status.status === 'completed') {
                clearInterval(interval);
                let audioUrl = status.audioUrl;
                if (!audioUrl) {
                    if (!isMinimaxMockAllowed()) {
                        try {
                            musicRepo.setStatusIfNotCancelled(musicId, 'failed');
                        } catch (err) {
                            console.error('[DB] 更新失败状态失败:', err);
                        }
                        console.warn(`[Music Generation Failed] ${musicId}（completed 但无音频 URL）`);
                        return;
                    }
                    audioUrl = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
                }
                await completeMusicTrackWithAudio(
                    musicId,
                    audioUrl,
                    status.audioDurationMs,
                    scheduleAudioMediaCheck
                );
                console.log(`[Music Generated] ${musicId}: persisted`);
                return;
            } else if (status.status === 'failed') {
                clearInterval(interval);
                try {
                    musicRepo.setStatusIfNotCancelled(musicId, 'failed');
                } catch (err) {
                    console.error('[DB] 更新失败状态失败:', err);
                }
                console.log(`[Music Generation Failed] ${musicId}`);
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                try {
                    musicRepo.setStatusIfNotCancelled(musicId, 'timeout');
                } catch (err) {
                    console.error('[DB] 更新超时状态失败:', err);
                }
                console.warn(
                    `[Music Generation Timeout] musicId=${musicId} jobId=${jobId} ` +
                        `已轮询 ${maxAttempts} 次（约 ${maxAttempts * 3}s），数据库已标记 status=timeout。可调 MINIMAX_POLL_MAX_ATTEMPTS`
                );
            }
        } catch (error) {
            console.error(
                `[pollMinimaxStatus] 单次查询异常（不中断轮询，下次继续） musicId=${musicId} jobId=${jobId}:`,
                error.message || error
            );
        }
    }, 3000);
}

async function createMusic(params) {
    const {
        req,
        userId,
        body,
        scheduleAudioMediaCheck
    } = params;
    const {
        title,
        mainInstrument,
        frequency,
        duration,
        bpm,
        soundEffects,
        userPrompt,
        moodLabel,
        sceneLabels,
        voiceUrl,
        referenceAudioUrl
    } = body || {};

    if (!mainInstrument) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '乐器类型不能为空' };
    }
    if (!frequency) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '脑波频率不能为空' };
    }
    if (!bpm || isNaN(Number(bpm))) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'BPM参数无效' };
    }

    const musicId = uuidv4();
    const { getDb } = require('../bootstrap/database');

    try {
        const sourceChannel = channelService.resolveSourceChannel(getDb(), req);
        musicRepo.insertTrack({
            id: musicId,
            userId,
            title: title || '未命名作品',
            mainInstrument,
            frequency,
            duration: duration || 180,
            bpm,
            sourceChannel
        });
    } catch (err) {
        logError('创建音乐-数据库插入', err, { musicId, userId });
        return { ok: false, error: ErrorCode.MUSIC_CREATE_FAILED, message: err.message, dbErr: err };
    }

    const voiceUrlRaw = voiceUrl != null ? String(voiceUrl).trim() : '';
    logInfo('创建音乐', '人声音轨', {
        musicId,
        hasVoiceTrack: !!voiceUrlRaw,
        voiceUrl: voiceUrlRaw || null
    });
    if (voiceUrlRaw) {
        try {
            musicRepo.updateVoiceUrl(musicId, voiceUrlRaw);
        } catch (err) {
            logWarn('保存人声音轨地址', err.message || '失败', { musicId });
        }
    }

    const referenceAudioUrlRaw =
        referenceAudioUrl != null ? String(referenceAudioUrl).trim() : '';
    if (referenceAudioUrlRaw) {
        try {
            const refProbeTarget = resolveReferenceAudioProbeTarget(referenceAudioUrlRaw);
            if (!refProbeTarget) {
                return {
                    ok: false,
                    error: ErrorCode.INVALID_PARAMS,
                    message: '参考音乐地址无效或曲库/上传文件不存在（须 6 秒～6 分钟可访问音频）'
                };
            }
            const refDur = await probeAudioDurationSec(refProbeTarget);
            assertReferenceAudioDurationSec(refDur);
            musicRepo.updateReferenceAudioUrl(musicId, referenceAudioUrlRaw);
            logInfo('创建音乐', '参考音乐', {
                musicId,
                referenceAudioUrl: referenceAudioUrlRaw,
                durationSec: refDur
            });
        } catch (err) {
            const msg = err && err.message ? err.message : '参考音乐校验失败';
            return { ok: false, error: ErrorCode.INVALID_PARAMS, message: msg };
        }
    }

    if (soundEffects && soundEffects.length > 0) {
        soundEffects.forEach((effect) => {
            try {
                musicRepo.insertSoundEffect({
                    id: uuidv4(),
                    musicId,
                    type: effect.type,
                    startTime: effect.startTime,
                    endTime: effect.endTime,
                    volume: effect.volume || 0.5
                });
            } catch (err) {
                logWarn('插入白噪音失败', err.message, { musicId, effect });
            }
        });
    }

    generateMusicAudio(musicId, mainInstrument, frequency, duration, bpm, soundEffects, {
        userPrompt,
        moodLabel,
        sceneLabels,
        voiceUrl: voiceUrlRaw,
        hasVoiceTrack: !!voiceUrlRaw,
        referenceAudioUrl: referenceAudioUrlRaw
    }, scheduleAudioMediaCheck);

    return {
        ok: true,
        data: {
            musicId,
            status: 'generating',
            estimatedTime: 30
        },
        message: '音乐创建成功，正在生成中'
    };
}

function cancelMusic(musicId, userId) {
    if (!musicId) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'musicId不能为空' };
    }

    const track = musicRepo.findById(musicId);
    if (!track) {
        return { ok: false, error: ErrorCode.MUSIC_NOT_FOUND };
    }
    if (track.user_id !== userId) {
        return { ok: false, error: ErrorCode.FORBIDDEN, message: '无权取消该任务' };
    }

    const status = String(track.status || '').toLowerCase();
    if (status === 'cancelled') {
        return { ok: true, data: { musicId, status: 'cancelled', already: true }, message: '任务已取消' };
    }
    if (status === 'completed') {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '作品已生成，无法取消' };
    }

    musicRepo.setStatus(musicId, 'cancelled');
    logInfo('取消生成', '已标记 cancelled', { musicId, userId, prevStatus: status });
    return { ok: true, data: { musicId, status: 'cancelled' }, message: '已取消生成' };
}

async function getMusicStatus(musicId) {
    if (!musicId) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '音乐ID不能为空' };
    }

    const track = musicRepo.findById(musicId);
    if (!track) {
        return { ok: false, error: ErrorCode.MUSIC_NOT_FOUND };
    }

    const effects = musicRepo.listSoundEffects(musicId);
    // 轮询接口须轻量：勿在此触发外链音频落盘（易超 nginx 超时 → CONNECTION_RESET）
    const enriched = await enrichTrackRow(track, { skipRemotePersist: true });

    return {
        ok: true,
        data: {
            ...enriched,
            soundEffects: effects
        }
    };
}

async function listUserMusic(openid) {
    if (!openid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '用户ID不能为空' };
    }

    const internalId = musicRepo.findInternalUserIdByOpenid(openid);
    if (!internalId) {
        return { ok: true, data: [] };
    }

    const rows = musicRepo.listCompletedByUserId(internalId);
    const tracks = await Promise.all(rows.map((row) => enrichTrackRow(row)));
    return { ok: true, data: tracks };
}

function deleteMusic(musicId, userId) {
    if (!musicId) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '音乐ID不能为空' };
    }

    const track = musicRepo.findById(musicId);
    if (!track) {
        return { ok: false, error: ErrorCode.MUSIC_NOT_FOUND };
    }
    if (track.user_id !== userId) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    musicRepo.deleteTrack(musicId);
    return { ok: true, data: { deleted: true }, message: '已删除' };
}

function updateMusicTitle(musicId, userId, titleRaw) {
    if (!musicId) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '音乐ID不能为空' };
    }
    if (!titleRaw) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '作品名称不能为空' };
    }
    if (titleRaw.length > 48) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '作品名称不能超过 48 个字符' };
    }

    const track = musicRepo.findById(musicId);
    if (!track) {
        return { ok: false, error: ErrorCode.MUSIC_NOT_FOUND };
    }
    if (track.user_id !== userId) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    musicRepo.updateTitle(musicId, titleRaw);
    logInfo('作品名称', '已更新', { musicId, userId, title: titleRaw });
    return { ok: true, data: { title: titleRaw }, message: '名称已保存' };
}

function validatePlayerCoverUrl(coverUrlRaw) {
    if (!coverUrlRaw) {
        return { ok: true, coverUrl: '' };
    }
    if (!/^https?:\/\//i.test(coverUrlRaw)) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '封面须为 http(s) 地址' };
    }
    const lowerRaw = coverUrlRaw.toLowerCase();
    if (
        lowerRaw.includes('/__tmp__/') ||
        lowerRaw.startsWith('wxfile://') ||
        (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(coverUrlRaw) &&
            !isOurHostedUploadUrl(coverUrlRaw))
    ) {
        return {
            ok: false,
            error: ErrorCode.INVALID_PARAMS,
            message: '封面须先上传到本服务，不能使用本地临时路径'
        };
    }
    if (!isOurHostedUploadUrl(coverUrlRaw)) {
        return {
            ok: false,
            error: ErrorCode.INVALID_PARAMS,
            message: '封面须为本服务上传的图片（/api/music/cover?f= 或 /uploads/）'
        };
    }
    const coverUrl = migrateLegacyCoverUrlToMusicCover(normalizePublicCoverUrl(coverUrlRaw));
    return { ok: true, coverUrl };
}

function updatePlayerCover(musicId, userId, coverUrl) {
    if (!musicId) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '音乐ID不能为空' };
    }

    const track = musicRepo.findById(musicId);
    if (!track) {
        return { ok: false, error: ErrorCode.MUSIC_NOT_FOUND };
    }
    if (track.user_id !== userId) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    musicRepo.updatePlayerCover(musicId, coverUrl || null);
    logInfo('作品播放器封面', '已更新', { musicId, userId, hasCover: !!coverUrl });
    return { ok: true, data: { player_cover_url: coverUrl || null }, message: '封面已保存' };
}

function listLibrary(req, query) {
    const { category, page = 1, limit = 50 } = query || {};
    const apiBase = req ? getApiBaseUrl(req) : '';
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 50;

    const { tracks, total } = musicRepo.listSystemLibrary(category, pageNum, limitNum);

    return {
        ok: true,
        data: {
            list: tracks.map((t) => {
                const ms = t.audio_duration_ms;
                let durationSec = 0;
                if (ms != null && Number(ms) > 0) {
                    durationSec = Math.max(1, Math.ceil(Number(ms) / 1000));
                } else if (t.duration != null && Number(t.duration) > 0) {
                    durationSec = Math.floor(Number(t.duration));
                }
                const coverRel = resolveLibraryCoverRel(t.player_cover_url, t.audio_url);
                const coverUrl = toAbsoluteCoverUrl(coverRel, apiBase);
                return {
                    ...t,
                    duration: durationSec,
                    audioUrl: normalizeLibraryAudioUrl(t.audio_url),
                    description: t.description || '',
                    coverUrl,
                    plays: Math.max(0, Math.floor(Number(t.play_count) || 0))
                };
            }),
            total
        }
    };
}

function recordLibraryPlay(musicId) {
    const mid = String(musicId || '').trim();
    if (!mid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'musicId不能为空' };
    }

    const row = musicRepo.findSystemTrackForPlay(mid);
    if (!row) {
        return { ok: false, error: ErrorCode.MUSIC_NOT_FOUND, message: '曲库曲目不存在' };
    }

    incrementMusicPlayCount(mid);
    const plays = Math.max(0, Math.floor(Number(musicRepo.getPlayCount(mid)) || 0));
    return { ok: true, data: { musicId: mid, plays } };
}

module.exports = {
    setUploadDir,
    getUploadDir,
    createMusic,
    cancelMusic,
    getMusicStatus,
    listUserMusic,
    deleteMusic,
    updateMusicTitle,
    validatePlayerCoverUrl,
    updatePlayerCover,
    listLibrary,
    recordLibraryPlay
};
