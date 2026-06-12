/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const { incrementMusicPlayCount } = require('../utils/music-play-count');

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

function isTrackCancelled(musicId) {
    const row = db.prepare('SELECT status FROM music_tracks WHERE id = ?').get(musicId);
    return !!(row && String(row.status || '').toLowerCase() === 'cancelled');
}

/** 已 cancelled 的任务不再被 failed / timeout / completed 覆盖 */
function setTrackStatusIfNotCancelled(musicId, status) {
    return db
        .prepare(`UPDATE music_tracks SET status = ? WHERE id = ? AND status != 'cancelled'`)
        .run(status, musicId).changes;
}

router.post('/create', authMiddleware, async (req, res) => {
    try {
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
        } = req.body;
        const userId = req.user.id;

        // 参数校验
        if (!mainInstrument) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '乐器类型不能为空');
        }
        if (!frequency) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '脑波频率不能为空');
        }
        if (!bpm || isNaN(Number(bpm))) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'BPM参数无效');
        }

        const openid = req.user.wx_openid;
        if (
            await blockIfContentUnsafe(res, openid, [
                { content: title, scene: contentSecurity.SCENE.PROFILE, field: 'title' },
                { content: userPrompt, scene: contentSecurity.SCENE.SOCIAL, field: 'userPrompt' }
            ])
        ) {
            return;
        }

        const musicId = uuidv4();

        // 保存音乐基本信息
        try {
            const sourceChannel = channelService.resolveSourceChannel(db, req);
            const stmt = db.prepare(`INSERT INTO music_tracks (id, user_id, title, main_instrument, frequency, duration, bpm, source_channel)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            stmt.run(
                musicId,
                userId,
                title || '未命名作品',
                mainInstrument,
                frequency,
                duration || 180,
                bpm,
                sourceChannel
            );
        } catch (err) {
            logError('创建音乐-数据库插入', err, { musicId, userId });
            return sendError(res, convertDbError(err), err.message);
        }

        const voiceUrlRaw = voiceUrl != null ? String(voiceUrl).trim() : '';
        logInfo('创建音乐', '人声音轨', {
            musicId,
            hasVoiceTrack: !!voiceUrlRaw,
            voiceUrl: voiceUrlRaw || null
        });
        if (voiceUrlRaw) {
            try {
                db.prepare('UPDATE music_tracks SET voice_url = ? WHERE id = ?').run(
                    voiceUrlRaw,
                    musicId
                );
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
                    return sendError(
                        res,
                        ErrorCode.INVALID_PARAMS,
                        '参考音乐地址无效或曲库/上传文件不存在（须 6 秒～6 分钟可访问音频）'
                    );
                }
                const refDur = await probeAudioDurationSec(refProbeTarget);
                assertReferenceAudioDurationSec(refDur);
                db.prepare('UPDATE music_tracks SET reference_audio_url = ? WHERE id = ?').run(
                    referenceAudioUrlRaw,
                    musicId
                );
                logInfo('创建音乐', '参考音乐', {
                    musicId,
                    referenceAudioUrl: referenceAudioUrlRaw,
                    durationSec: refDur
                });
            } catch (err) {
                const msg = err && err.message ? err.message : '参考音乐校验失败';
                return sendError(res, ErrorCode.INVALID_PARAMS, msg);
            }
        }

        // 保存白噪音时间轴
        if (soundEffects && soundEffects.length > 0) {
            const insertEffect = db.prepare(`
                INSERT INTO sound_effects (id, music_id, effect_type, start_time, end_time, volume)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            soundEffects.forEach((effect) => {
                try {
                    insertEffect.run(
                        uuidv4(),
                        musicId,
                        effect.type,
                        effect.startTime,
                        effect.endTime,
                        effect.volume || 0.5
                    );
                } catch (err) {
                    logWarn('插入白噪音失败', err.message, { musicId, effect });
                }
            });
        }

        // 异步生成音频
        generateMusicAudio(musicId, mainInstrument, frequency, duration, bpm, soundEffects, {
            userPrompt,
            moodLabel,
            sceneLabels,
            voiceUrl: voiceUrlRaw,
            hasVoiceTrack: !!voiceUrlRaw,
            referenceAudioUrl: referenceAudioUrlRaw
        });

        sendSuccess(res, {
            musicId,
            status: 'generating',
            estimatedTime: 30
        }, '音乐创建成功，正在生成中');
    } catch (error) {
        logError('创建音乐', error, req.body);
        sendError(res, ErrorCode.MUSIC_CREATE_FAILED, error.message);
    }
});

/** 用户放弃生成（软取消：MiniMax 无法中止，但不再落库 completed、列表不展示） */
router.post('/:musicId/cancel', authMiddleware, (req, res) => {
    const musicId = String(req.params.musicId || '').trim();
    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'musicId不能为空');
    }

    try {
        const track = db
            .prepare('SELECT id, user_id, status FROM music_tracks WHERE id = ?')
            .get(musicId);
        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }
        if (track.user_id !== req.user.id) {
            return sendError(res, ErrorCode.FORBIDDEN, '无权取消该任务');
        }

        const status = String(track.status || '').toLowerCase();
        if (status === 'cancelled') {
            return sendSuccess(res, { musicId, status: 'cancelled', already: true }, '任务已取消');
        }
        if (status === 'completed') {
            return sendError(res, ErrorCode.INVALID_PARAMS, '作品已生成，无法取消');
        }

        db.prepare(`UPDATE music_tracks SET status = 'cancelled' WHERE id = ?`).run(musicId);
        logInfo('取消生成', '已标记 cancelled', { musicId, userId: req.user.id, prevStatus: status });
        sendSuccess(res, { musicId, status: 'cancelled' }, '已取消生成');
    } catch (err) {
        logError('取消生成', err, { musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/:musicId/status', async (req, res) => {
    const { musicId } = req.params;

    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }

    try {
        const stmt = db.prepare('SELECT * FROM music_tracks WHERE id = ?');
        const track = stmt.get(musicId);

        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }

        const effectsStmt = db.prepare('SELECT * FROM sound_effects WHERE music_id = ? ORDER BY start_time');
        const effects = effectsStmt.all(musicId);

        const playerCover = sanitizePlayerCoverUrlForClient(track.player_cover_url);
        const base = { ...track, player_cover_url: playerCover || null };
        const enriched = await musicAudioStore.enrichTrackAudio(uploadDir, base);
        if (enriched.audio_url && enriched.audio_url !== track.audio_url) {
            try {
                db.prepare('UPDATE music_tracks SET audio_url = ? WHERE id = ?').run(
                    enriched.audio_url,
                    musicId
                );
            } catch (dbErr) {
                logWarn('更新作品本地音频地址', dbErr.message || '失败', { musicId });
            }
        }
        sendSuccess(res, {
            ...enriched,
            soundEffects: effects
        });
    } catch (err) {
        logError('查询音乐状态', err, { musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/user/:userId', async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '用户ID不能为空');
    }

    try {
        // userId 是 wx_openid，需要先查询对应的 users.id
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(userId);
        if (!user) {
            return sendSuccess(res, []);
        }

        // 与小程序「我的作品」一致：只列出已生成完成且有音频的成片（不含失败/进行中记录）
        const stmt = db.prepare(`SELECT id, title, main_instrument, frequency, bpm, duration, audio_url, audio_duration_ms, player_cover_url, status, created_at,
            COALESCE(play_count, 0) AS play_count
         FROM music_tracks
         WHERE user_id = ?
           AND status = 'completed'
           AND audio_url IS NOT NULL
           AND TRIM(audio_url) != ''
         ORDER BY created_at DESC
         LIMIT 50`);
        const rows = stmt.all(user.id);
        const tracks = await Promise.all(
            rows.map(async (row) => {
                const base = {
                    ...row,
                    player_cover_url: sanitizePlayerCoverUrlForClient(row.player_cover_url) || null
                };
                const enriched = await musicAudioStore.enrichTrackAudio(uploadDir, base);
                if (enriched.audio_url && enriched.audio_url !== row.audio_url) {
                    try {
                        db.prepare('UPDATE music_tracks SET audio_url = ? WHERE id = ?').run(
                            enriched.audio_url,
                            row.id
                        );
                    } catch (dbErr) {
                        logWarn('更新作品本地音频地址', dbErr.message || '失败', {
                            musicId: row.id
                        });
                    }
                }
                return enriched;
            })
        );

        sendSuccess(res, tracks);
    } catch (err) {
        logError('获取用户作品列表', err, { userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/:musicId', authMiddleware, (req, res) => {
    const { musicId } = req.params;
    const userId = req.user.id;

    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }

    try {
        const track = db.prepare('SELECT id, user_id FROM music_tracks WHERE id = ?').get(musicId);
        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }
        if (track.user_id !== userId) {
            return sendError(res, ErrorCode.FORBIDDEN);
        }

        const delTx = db.transaction(() => {
            db.prepare('DELETE FROM sound_effects WHERE music_id = ?').run(musicId);
            db.prepare('UPDATE community_posts SET music_id = NULL WHERE music_id = ?').run(musicId);
            db.prepare('DELETE FROM greeting_cards WHERE music_id = ?').run(musicId);
            db.prepare('DELETE FROM card_shares WHERE music_id = ?').run(musicId);
            db.prepare('DELETE FROM music_tracks WHERE id = ?').run(musicId);
        });
        delTx();

        sendSuccess(res, { deleted: true }, '已删除');
    } catch (err) {
        logError('删除音乐作品', err, { musicId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 修改作品名称 */
router.put('/:musicId/title', authMiddleware, async (req, res) => {
    const { musicId } = req.params;
    const userId = req.user.id;
    const titleRaw = req.body && req.body.title != null ? String(req.body.title).trim() : '';

    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }
    if (!titleRaw) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '作品名称不能为空');
    }
    if (titleRaw.length > 48) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '作品名称不能超过 48 个字符');
    }

    if (
        await blockIfContentUnsafe(res, req.user.wx_openid, [
            { content: titleRaw, scene: contentSecurity.SCENE.PROFILE, field: 'title' }
        ])
    ) {
        return;
    }

    try {
        const track = db.prepare('SELECT id, user_id FROM music_tracks WHERE id = ?').get(musicId);
        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }
        if (track.user_id !== userId) {
            return sendError(res, ErrorCode.FORBIDDEN);
        }

        db.prepare('UPDATE music_tracks SET title = ? WHERE id = ?').run(titleRaw, musicId);
        logInfo('作品名称', '已更新', { musicId, userId, title: titleRaw });
        sendSuccess(res, { title: titleRaw }, '名称已保存');
    } catch (err) {
        logError('更新作品名称', err, { musicId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 作品播放器封面（仅播放器 / mini 条，不写入贺卡） */
router.put('/:musicId/player-cover', authMiddleware, async (req, res) => {
    const { musicId } = req.params;
    const userId = req.user.id;
    const coverUrlRaw = req.body && req.body.coverUrl != null ? String(req.body.coverUrl).trim() : '';

    if (!musicId) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '音乐ID不能为空');
    }

    let coverUrl = '';
    if (coverUrlRaw) {
        if (!/^https?:\/\//i.test(coverUrlRaw)) {
            return sendError(res, ErrorCode.INVALID_PARAMS, '封面须为 http(s) 地址');
        }
        const lowerRaw = coverUrlRaw.toLowerCase();
        if (
            lowerRaw.includes('/__tmp__/') ||
            lowerRaw.startsWith('wxfile://') ||
            (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(coverUrlRaw) &&
                !isOurHostedUploadUrl(coverUrlRaw))
        ) {
            return sendError(
                res,
                ErrorCode.INVALID_PARAMS,
                '封面须先上传到本服务，不能使用本地临时路径'
            );
        }
        if (!isOurHostedUploadUrl(coverUrlRaw)) {
            return sendError(
                res,
                ErrorCode.INVALID_PARAMS,
                '封面须为本服务上传的图片（/api/music/cover?f= 或 /uploads/）'
            );
        }
        coverUrl = migrateLegacyCoverUrlToMusicCover(normalizePublicCoverUrl(coverUrlRaw));
        if (await blockIfHostedImageUnsafe(res, coverUrl, req, 'coverUrl')) {
            return;
        }
    }

    try {
        const track = db.prepare('SELECT id, user_id FROM music_tracks WHERE id = ?').get(musicId);
        if (!track) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND);
        }
        if (track.user_id !== userId) {
            return sendError(res, ErrorCode.FORBIDDEN);
        }

        db.prepare('UPDATE music_tracks SET player_cover_url = ? WHERE id = ?').run(
            coverUrl || null,
            musicId
        );

        logInfo('作品播放器封面', '已更新', { musicId, userId, hasCover: !!coverUrl });
        sendSuccess(res, { player_cover_url: coverUrl || null }, '封面已保存');
    } catch (err) {
        logError('更新作品播放器封面', err, { musicId, userId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/library', (req, res) => {
    const { category, page = 1, limit = 50 } = req.query;

    try {
        const apiBase = getApiBaseUrl(req);
        let sql = `SELECT id, title, description, main_instrument as instrument, frequency, bpm, duration,
            audio_duration_ms, audio_url, player_cover_url, COALESCE(play_count, 0) AS play_count, created_at
         FROM music_tracks
         WHERE user_id = 'system' AND status = 'completed'`;
        const params = [];

        // 按分类关键词过滤
        if (category && category !== '全部') {
            sql += ` AND (
                title LIKE ? OR
                description LIKE ? OR
                main_instrument LIKE ? OR
                frequency LIKE ?
            )`;
            const like = `%${category}%`;
            params.push(like, like, like, like);
        }

        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(Number(limit), (Number(page) - 1) * Number(limit));

        const stmt = db.prepare(sql);
        const tracks = stmt.all(...params);

        // 统计总数
        const countSql = `SELECT COUNT(*) as total FROM music_tracks WHERE user_id = 'system' AND status = 'completed'`;
        const countRow = db.prepare(countSql).get();

        sendSuccess(res, {
            list: tracks.map(t => {
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
            total: countRow.total
        });
    } catch (err) {
        logError('获取曲库列表', err);
        sendError(res, convertDbError(err), err.message);
    }
});

/** 官方曲库播放计数（无需登录；仅 system 曲库 id） */
router.post('/library/play', (req, res) => {
    const mid = String((req.body && req.body.musicId) || '').trim();
    if (!mid) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'musicId不能为空');
    }
    try {
        const row = db.prepare(
            `SELECT id, COALESCE(play_count, 0) AS play_count FROM music_tracks
             WHERE id = ? AND user_id = 'system' AND status = 'completed'`
        ).get(mid);
        if (!row) {
            return sendError(res, ErrorCode.MUSIC_NOT_FOUND, '曲库曲目不存在');
        }
        incrementMusicPlayCount(mid);
        const updated = db.prepare(
            `SELECT COALESCE(play_count, 0) AS play_count FROM music_tracks WHERE id = ?`
        ).get(mid);
        sendSuccess(res, {
            musicId: mid,
            plays: Math.max(0, Math.floor(Number(updated && updated.play_count) || 0))
        });
    } catch (err) {
        logError('曲库播放计数', err, { musicId: mid });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 生成完成后：下载音频到本机并写入可长期播放的 URL */
async function completeMusicTrackWithAudio(musicId, remoteUrl, audioDurationMs) {
    if (isTrackCancelled(musicId)) {
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
        const row = db.prepare('SELECT voice_url FROM music_tracks WHERE id = ?').get(musicId);
        const voiceDisk =
            row && row.voice_url ? resolveHostedUploadToDisk(row.voice_url) : null;
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
        if (isTrackCancelled(musicId)) {
            logInfo('作品音频', '落盘完成后已取消，丢弃成片', { musicId });
            return;
        }
        const changes = db
            .prepare(
                `UPDATE music_tracks SET status = ?, audio_url = ?, audio_duration_ms = ? WHERE id = ? AND status != 'cancelled'`
            )
            .run('completed', publicUrl, ms, musicId).changes;
        if (!changes) {
            logInfo('作品音频', '用户已取消，未写入 completed', { musicId });
            return;
        }
        logInfo('作品音频', '已就绪', {
            musicId,
            hosted: musicAudioStore.isSelfHostedMusicAudioUrl(publicUrl)
        });

        const owner = db
            .prepare(
                `SELECT u.wx_openid FROM users u
                 INNER JOIN music_tracks t ON t.user_id = u.id WHERE t.id = ?`
            )
            .get(musicId);
        if (owner && owner.wx_openid) {
            scheduleAudioMediaCheck(owner.wx_openid, publicUrl, 'music_track', musicId);
        }
    } catch (err) {
        logError('写入作品音频', err, { musicId });
    }
}

// 生成音乐音频：生产环境（NODE_ENV=production）默认禁止 mock 与示例音
async function generateMusicAudio(
    musicId,
    instrument,
    frequency,
    duration,
    bpm,
    soundEffects,
    promptExtras = {}
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
                    setTrackStatusIfNotCancelled(musicId, 'failed');
                } catch (err) {
                    console.error('[DB] 更新失败状态:', err);
                }
                return;
            }

            if (isTrackCancelled(musicId)) {
                logInfo('生成音乐', '用户已取消，忽略 MiniMax 响应', { musicId });
                return;
            }

            if (result.audioUrl) {
                await completeMusicTrackWithAudio(
                    musicId,
                    result.audioUrl,
                    result.audioDurationMs
                );
                console.log(`[Music Generated] ${musicId}: persisted`);
                return;
            }

            if (result.jobId) {
                pollMinimaxStatus(musicId, result.jobId);
                return;
            }

            console.error('[generateMusicAudio] MiniMax 返回无 audioUrl/jobId');
            try {
                setTrackStatusIfNotCancelled(musicId, 'failed');
            } catch (err) {
                console.error('[DB] 更新失败状态:', err);
            }
            return;
        } catch (error) {
            console.error('[generateMusicAudio] MiniMax 调用失败:', error);
            try {
                setTrackStatusIfNotCancelled(musicId, 'failed');
            } catch (err) {
                console.error('[DB] 更新失败状态:', err);
            }
            return;
        }
    }

    if (!isMinimaxMockAllowed()) {
        try {
            setTrackStatusIfNotCancelled(musicId, 'failed');
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
        completeMusicTrackWithAudio(musicId, audioUrl, null).catch((err) => {
            console.error('[DB] Mock 音频落盘失败:', err);
        });
    }, 5000);
}

// 轮询 MiniMax 生成状态（每 3s；默认 120 次≈6 分钟，合成常超过 3 分钟可调 MINIMAX_POLL_MAX_ATTEMPTS）
function pollMinimaxStatus(musicId, jobId) {
    let attempts = 0;
    const maxAttempts = parseInt(process.env.MINIMAX_POLL_MAX_ATTEMPTS || '120', 10) || 120;

    const interval = setInterval(async () => {
        attempts++;
        try {
            if (isTrackCancelled(musicId)) {
                clearInterval(interval);
                logInfo('MiniMax 轮询', '任务已取消，停止轮询', { musicId, jobId });
                return;
            }

            const status = await checkGenerationStatus(jobId);

            if (status.success === false) {
                clearInterval(interval);
                try {
                    setTrackStatusIfNotCancelled(musicId, 'failed');
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
                            setTrackStatusIfNotCancelled(musicId, 'failed');
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
                    status.audioDurationMs
                );
                console.log(`[Music Generated] ${musicId}: persisted`);
                return;
            } else if (status.status === 'failed') {
                clearInterval(interval);
                try {
                    setTrackStatusIfNotCancelled(musicId, 'failed');
                } catch (err) {
                    console.error('[DB] 更新失败状态失败:', err);
                }
                console.log(`[Music Generation Failed] ${musicId}`);
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                try {
                    setTrackStatusIfNotCancelled(musicId, 'timeout');
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

module.exports = router;
