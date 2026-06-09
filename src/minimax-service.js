/**
 * MiniMax AI 音乐生成服务
 * 官方文档: https://platform.minimaxi.com/docs/api-reference/music-generation
 * OpenAPI: POST /v1/music_generation ， Host 见 servers（一般为 https://api.minimaxi.com）
 */

const axios = require('axios');

/**
 * 生产环境默认不使用模拟任务/示例音频。
 * - 显式 MINIMAX_ALLOW_MOCK=true：允许 mock（任意 NODE_ENV）
 * - 显式 MINIMAX_ALLOW_MOCK=false：禁止 mock
 * - 未设置：production 禁止，其余环境允许
 */
function isMinimaxMockAllowed() {
    const v = process.env.MINIMAX_ALLOW_MOCK;
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return process.env.NODE_ENV !== 'production';
}

// MiniMax API 配置（MINIMAX_API_BASE 需包含 /v1，例如 https://api.minimaxi.com/v1）
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_API_BASE = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com/v1';
/** 文档枚举：music-2.6 | music-2.6-free | music-cover | music-cover-free */
const MINIMAX_MUSIC_MODEL = process.env.MINIMAX_MUSIC_MODEL || 'music-2.6-free';
/** 有参考音频时使用 music-cover（见 https://platform.minimaxi.com/docs/api-reference/music-generation ） */
const MINIMAX_COVER_MODEL = process.env.MINIMAX_COVER_MODEL || 'music-cover-free';
const REFERENCE_AUDIO_MIN_SEC = 6;
const REFERENCE_AUDIO_MAX_SEC = 360;
/** 音乐生成常见 60～180s+，排队时更长；避免 axios 早于 MiniMax 返回（毫秒；默认 6 分钟，可用 MINIMAX_GENERATE_TIMEOUT_MS 覆盖） */
const DEFAULT_MINIMAX_GENERATE_TIMEOUT_MS = 1000 * 60 * 6;
const MINIMAX_GENERATE_TIMEOUT_MS = Math.max(
    1000 * 60,
    parseInt(
        process.env.MINIMAX_GENERATE_TIMEOUT_MS || String(DEFAULT_MINIMAX_GENERATE_TIMEOUT_MS),
        10
    ) || DEFAULT_MINIMAX_GENERATE_TIMEOUT_MS
);

/** 提示词里写的目标时长（分钟）。无入参时从环境读，默认 3 分钟；API 不保证严格等于该长度，以官方模型为准 */
const DEFAULT_MINIMAX_MUSIC_DURATION_MINUTES = 3;
function resolveTargetDurationMinutes(params) {
    const sec = params && params.durationSeconds;
    if (sec != null && !Number.isNaN(Number(sec))) {
        const minutes = Math.max(1, Math.min(20, Math.round(Number(sec) / 60)));
        return minutes;
    }
    const fromEnv = parseInt(
        process.env.MINIMAX_MUSIC_DURATION_MINUTES || String(DEFAULT_MINIMAX_MUSIC_DURATION_MINUTES),
        10
    );
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
        return Math.min(20, fromEnv);
    }
    return DEFAULT_MINIMAX_MUSIC_DURATION_MINUTES;
}

// 乐器映射表（将我们的乐器映射到提示词关键词）
const INSTRUMENT_TO_PROMPT = {
    guqin: 'guqin, chinese traditional, ambient meditation',
    guzheng: 'guzheng, chinese traditional, peaceful flowing',
    erhu: 'erhu, chinese traditional, emotional ambient',
    xiao: 'xiao flute, chinese traditional, serene airy',
    piano: 'piano, ambient classical, peaceful gentle',
    handpan: 'handpan, ambient meditation, ethereal mystical',
    cello: 'cello, ambient classical, deep emotional',
    harp: 'harp, ambient dreamy, light floating',
    flute: 'flute, ambient nature, clear refreshing',
    sitar: 'indian classical sitar, meditation, spiritual mystical',
    koto: 'japanese traditional koto, ambient, elegant peaceful',
    singingbowl: 'tibetan singing bowl, deep resonance, ambient meditation, healing vibrations'
};

// 脑波频率映射到描述词
const FREQUENCY_TO_DESC = {
    alpha: 'alpha wave relaxation, light meditation, stress relief',
    theta: 'theta wave deep meditation, subconscious healing, deep calm',
    delta: 'delta wave deep sleep, unconscious restoration, total relaxation',
    schumann: 'schumann resonance 7.83Hz, earth frequency, anxiety relief, emotional balance'
};

/** 白噪音类型 → 英文提示（与用户端 rain/wind/… 对齐） */
const EFFECT_TYPE_TO_PROMPT = {
    rain: 'soft gentle rain',
    wind: 'soft airy wind',
    thunder: 'very distant subtle thunder (sleep-safe, barely audible)',
    fire: 'quiet campfire crackle',
    waves: 'calm ocean waves',
    birds: 'sparse distant birdsong'
};

function formatTimelineMmSs(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * 把用户在音轨页配置的「白噪音时间轴」写进提示词（MiniMax 仅能文本引导，成片时间精度以模型为准；
 * 文案上须明确「只在窗口内出现」，避免模型把 Blend beds 理解成全程铺底。）
 */
function buildAmbientEffectsPrompt(soundEffects) {
    if (!Array.isArray(soundEffects) || soundEffects.length === 0) {
        return '';
    }

    const parts = soundEffects
        .filter((e) => e && e.enabled !== false && e.type)
        .map((e) => {
            const desc = EFFECT_TYPE_TO_PROMPT[e.type] || `subtle ambient ${e.type}`;
            const start = Number(e.startTime) || 0;
            const end =
                e.endTime != null && !Number.isNaN(Number(e.endTime))
                    ? Number(e.endTime)
                    : start + 30;
            let volHint = 'balanced soft layer';
            if (typeof e.volume === 'number') {
                if (e.volume < 0.35) volHint = 'very subtle in the background';
                else if (e.volume > 0.65) volHint = 'clear but still gentle';
            }
            return `${formatTimelineMmSs(start)}–${formatTimelineMmSs(end)}: ${desc} ONLY (${volHint})`;
        });

    if (parts.length === 0) {
        return '';
    }

    return (
        `\n\nAmbient sound schedule (strict windows — read carefully):\n` +
        `${parts.join('\n')}\n\n` +
        `Mixing rules:\n` +
        `- Lead instrument: must play continuously through the entire piece from start to finish—the main melodic/harmonic bed never drops out.\n` +
        `- Inside each listed time window: the lead instrument and the scheduled ambient layer play together at the same time (layered mix). Keep the lead clearly in the foreground; ambient is quieter underneath—not ambient replacing or soloing over the lead.\n` +
        `- Outside those windows: ambient layers must be completely absent; only the lead instrument is heard.\n` +
        `- Do not use ambient as a continuous bed under the full track; ambient appears only inside the listed windows, never dominant.`
    );
}

/**
 * AI 创作页：用户描述 / 心情 / 场景名
 */
function buildUserCreativeBlock(extras) {
    if (!extras || typeof extras !== 'object') {
        return '';
    }
    const lines = [];
    const brief = String(extras.userPrompt || '').trim();
    if (brief) {
        lines.push(`User creative brief (follow the intent, may be in Chinese): ${brief}`);
    }
    const mood = String(extras.moodLabel || '').trim();
    if (mood) {
        lines.push(`Emotional tone / mood: ${mood} (keep the music aligned with this feeling).`);
    }
    const scenes = Array.isArray(extras.sceneLabels)
        ? extras.sceneLabels.map((s) => String(s).trim()).filter(Boolean)
        : [];
    if (scenes.length > 0) {
        lines.push(
            `Desired ambient themes from user selection: ${scenes.join(', ')} (weave subtly into the mix where appropriate).`
        );
    }
    if (lines.length === 0) {
        return '';
    }
    return `\n\n${lines.join('\n')}`;
}

/**
 * 用户录制/上传的人声：提示模型留出融合空间
 */
function buildVoiceTrackBlock(extras) {
    if (!extras || !extras.hasVoiceTrack) {
        return '';
    }
    return (
        '\n\nThe user provided a personal vocal recording to blend into the final mix. ' +
        'Keep the lead instrument continuous; leave warm, gentle space for soft human voice or humming ' +
        'at moderate volume—intimate and soothing, never dominant, no lyrics or pop vocals.'
    );
}

/**
 * 生成音乐提示词
 */
function generatePrompt(instrument, frequency, bpm, durationMinutes, soundEffects, extras) {
    const instrumentDesc = INSTRUMENT_TO_PROMPT[instrument] || INSTRUMENT_TO_PROMPT.piano;
    const freqDesc = FREQUENCY_TO_DESC[frequency] || FREQUENCY_TO_DESC.alpha;
    const dm = durationMinutes || DEFAULT_MINIMAX_MUSIC_DURATION_MINUTES;
    const ambientBlock = buildAmbientEffectsPrompt(soundEffects);
    const userBlock = buildUserCreativeBlock(extras);
    const voiceBlock = buildVoiceTrackBlock(extras);
    const leadThrough =
        ambientBlock.trim() !== ''
            ? '\nThe featured lead instrument must sound through the full track from beginning to end; optional ambient layers follow separate rules below.'
            : '';

    return `Create a ${freqDesc} ambient sleep music piece featuring ${instrumentDesc}.
The music has a gentle tempo around ${bpm} BPM.
No drums, no sudden changes, smooth and continuous flow.
Designed for sleep aid and relaxation. Target length: about ${dm} minute${dm === 1 ? '' : 's'}.${leadThrough}${ambientBlock}${userBlock}${voiceBlock}`;
}

/**
 * 从官方 GenerateMusicResp 解析结果（MusicData.status: 1 合成中 2 已完成）
 * output_format 为 url 时，地址可能在 data 或 extra_info 等字段（以实际响应为准）
 */
function parseMusicGenerationResponse(payload) {
    const p = payload || {};
    const br = p.base_resp || {};
    if (br.status_code !== undefined && br.status_code !== 0) {
        return { ok: false, error: br.status_msg || 'MiniMax 业务错误', code: br.status_code };
    }

    const data = p.data || {};
    const statusNum = Number(data.status);
    const musicStatus = Number.isFinite(statusNum) ? statusNum : null;

    let audioUrl =
        data.audio_url ||
        data.url ||
        data.file_url ||
        (typeof data.audio === 'string' && /^https?:\/\//i.test(data.audio) ? data.audio : null);

    if (!audioUrl && p.extra_info && typeof p.extra_info === 'object') {
        const ex = p.extra_info;
        audioUrl = ex.audio_url || ex.url || ex.music_url || null;
    }

    /** MiniMax extra_info.music_duration 一般为毫秒（可能在根节点或 data 内） */
    let audioDurationMs = null;
    const extra =
        p.extra_info && typeof p.extra_info === 'object'
            ? p.extra_info
            : data.extra_info && typeof data.extra_info === 'object'
              ? data.extra_info
              : null;
    if (extra && extra.music_duration != null) {
        const md = Number(extra.music_duration);
        if (Number.isFinite(md) && md >= 0) {
            audioDurationMs = Math.round(md);
        }
    }

    return {
        ok: true,
        traceId: p.trace_id || null,
        musicStatus,
        audioUrl: audioUrl || null,
        audioDurationMs,
        raw: p
    };
}

function toMinimaxPublicAudioUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (raw.startsWith('http://')) return `https://${raw.slice(7)}`;
    if (raw.startsWith('https://')) return raw;
    const base = String(process.env.BASE_URL || process.env.API_PUBLIC_URL || '').replace(/\/$/, '');
    if (base) return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
    return raw;
}

/**
 * music-cover 风格描述（prompt 必填且 10～300 字符）
 * @see https://platform.minimaxi.com/docs/api-reference/music-generation
 */
function buildMusicCoverStylePrompt(instrument, frequency, bpm, soundEffects, extras) {
    const instrumentDesc = INSTRUMENT_TO_PROMPT[instrument] || INSTRUMENT_TO_PROMPT.piano;
    const freqDesc = FREQUENCY_TO_DESC[frequency] || FREQUENCY_TO_DESC.alpha;
    const ambientBlock = buildAmbientEffectsPrompt(soundEffects);
    const userBlock = buildUserCreativeBlock(extras);
    const voiceBlock = buildVoiceTrackBlock(extras);
    let core = `Ambient sleep instrumental cover, ${freqDesc}, ${instrumentDesc}, gentle ${bpm} BPM, soft continuous flow, no drums`;
    if (ambientBlock.trim()) {
        core += ', layered ambient beds in scheduled windows only';
    }
    if (userBlock.trim()) {
        core += userBlock.replace(/\n+/g, ' ').slice(0, 120);
    }
    if (voiceBlock.trim()) {
        core += ', leave space for soft personal vocal blend';
    }
    core = core.replace(/\s+/g, ' ').trim();
    if (core.length < 10) {
        core = `${core} calm night sleep`.slice(0, 300);
    }
    return core.slice(0, 300);
}

/**
 * 调用 MiniMax API 生成音乐
 */
async function generateMusic(params) {
    const { instrument, frequency, bpm, userId, soundEffects } = params;
    const hasVoiceTrack = !!params.hasVoiceTrack;
    const promptExtras = {
        userPrompt: params.userPrompt,
        moodLabel: params.moodLabel,
        sceneLabels: params.sceneLabels,
        hasVoiceTrack
    };

    try {
        if (!MINIMAX_API_KEY) {
            if (!isMinimaxMockAllowed()) {
                console.error('[Minimax] 生产环境必须配置 MINIMAX_API_KEY，禁止 mock');
                return { success: false, error: 'MINIMAX_API_KEY_REQUIRED' };
            }
            console.warn('[Minimax] API Key 未配置，使用模拟模式');
            return await mockGenerateMusic(params);
        }

        const durationMinutes = resolveTargetDurationMinutes(params);
        const refUrl = toMinimaxPublicAudioUrl(params.referenceAudioUrl);
        const useCover = !!refUrl;
        const musicGenUrl = `${MINIMAX_API_BASE}/music_generation`;

        let requestBody;
        if (useCover) {
            const coverPrompt = buildMusicCoverStylePrompt(
                instrument,
                frequency,
                bpm,
                soundEffects,
                promptExtras
            );
            requestBody = {
                model: MINIMAX_COVER_MODEL,
                prompt: coverPrompt,
                audio_url: refUrl,
                stream: false,
                output_format: 'url',
                audio_setting: {
                    sample_rate: 44100,
                    bitrate: 128000,
                    format: 'mp3'
                }
            };
        } else {
            const prompt = generatePrompt(
                instrument,
                frequency,
                bpm,
                durationMinutes,
                soundEffects,
                promptExtras
            );
            requestBody = {
                model: MINIMAX_MUSIC_MODEL,
                prompt: prompt.slice(0, 2000),
                is_instrumental: true,
                stream: false,
                output_format: 'url',
                lyrics_optimizer: false,
                audio_setting: {
                    sample_rate: 44100,
                    bitrate: 128000,
                    format: 'mp3'
                }
            };
        }

        console.log('[Minimax] ========== music_generation 请求 ==========');
        console.log(
            '[Minimax] 业务入参:',
            JSON.stringify(
                {
                    instrument,
                    frequency,
                    bpm,
                    userId,
                    durationSeconds: params.durationSeconds,
                    resolvedDurationMinutes: durationMinutes,
                    soundEffectsCount: Array.isArray(soundEffects) ? soundEffects.length : 0,
                    soundEffects: Array.isArray(soundEffects) ? soundEffects : [],
                    hasVoiceTrack,
                    promptHasVoiceBlock: hasVoiceTrack,
                    useMusicCover: useCover,
                    referenceAudioUrl: useCover ? refUrl : null,
                    minimaxModel: useCover ? MINIMAX_COVER_MODEL : MINIMAX_MUSIC_MODEL
                },
                null,
                2
            )
        );
        console.log('[Minimax] POST', musicGenUrl);
        console.log('[Minimax] 请求体 JSON:', JSON.stringify(requestBody, null, 2));
        console.log(
            '[Minimax] axios: timeout=%sms, MINIMAX_API_BASE=%s, MINIMAX_MUSIC_MODEL=%s, apiKey=%s',
            MINIMAX_GENERATE_TIMEOUT_MS,
            MINIMAX_API_BASE,
            MINIMAX_MUSIC_MODEL,
            MINIMAX_API_KEY ? `已配置(${MINIMAX_API_KEY.length} chars)` : '未配置'
        );

        // 与文档 GenerateMusicReq 对齐：纯音乐 is_instrumental=true，prompt 必填 [1,2000]
        const response = await axios.post(musicGenUrl, requestBody, {
            headers: {
                Authorization: `Bearer ${MINIMAX_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: MINIMAX_GENERATE_TIMEOUT_MS
        });

        console.log('[Minimax] 生成响应:', JSON.stringify(response.data, null, 2));

        const parsed = parseMusicGenerationResponse(response.data);
        if (!parsed.ok) {
            console.error('[Minimax] 业务错误:', parsed.error);
            if (!isMinimaxMockAllowed()) {
                return { success: false, error: parsed.error || 'MINIMAX_BUSINESS_ERROR' };
            }
            return await mockGenerateMusic(params);
        }

        // 文档：MusicData.status === 2 已完成，可直接取音频
        if (parsed.musicStatus === 2 && parsed.audioUrl) {
            return {
                success: true,
                audioUrl: parsed.audioUrl,
                immediate: true,
                source: 'minimax',
                audioDurationMs: parsed.audioDurationMs != null ? parsed.audioDurationMs : undefined
            };
        }

        const traceOrJob =
            parsed.traceId ||
            (parsed.raw && parsed.raw.data && parsed.raw.data.task_id) ||
            (parsed.raw && parsed.raw.data && parsed.raw.data.id);

        // status===1 合成中：用语义化状态并依赖 trace_id 轮询（若平台提供查询接口）
        if (parsed.musicStatus === 1 && traceOrJob) {
            return {
                success: true,
                jobId: traceOrJob,
                status: 'processing',
                estimatedTime: 30,
                source: 'minimax'
            };
        }

        if (traceOrJob) {
            return {
                success: true,
                jobId: traceOrJob,
                status: 'pending',
                estimatedTime: 30,
                source: 'minimax'
            };
        }

        console.error('[Minimax] 无法解析响应（无 trace_id / 可播放地址）:', response.data);
        if (!isMinimaxMockAllowed()) {
            return { success: false, error: 'MINIMAX_RESPONSE_UNPARSEABLE' };
        }
        return await mockGenerateMusic(params);

    } catch (error) {
        const isAxiosTimeout =
            error.code === 'ECONNABORTED' ||
            (error.message && /timeout|ETIMEDOUT|ECONNRESET/i.test(error.message));
        if (isAxiosTimeout) {
            console.error(
                `[Minimax] music_generation POST 在 ${MINIMAX_GENERATE_TIMEOUT_MS}ms 内未返回（axios 超时）。` +
                    '说明：该超时只约束「创建请求」这一跳；异步任务应返回 task_id 后由轮询完成。' +
                    '若官方接口同步阻塞超过此时长，请增大环境变量 MINIMAX_GENERATE_TIMEOUT_MS。'
            );
        } else {
            console.error('[Minimax] 生成失败:', error.message);
        }
        if (error.response) {
            console.error('[Minimax] 错误状态码:', error.response.status);
            console.error('[Minimax] 错误详情:', JSON.stringify(error.response.data, null, 2));
        } else if (!isAxiosTimeout) {
            console.error('[Minimax] 无 HTTP 响应体（多为网络/DNS/超时）:', error.code || '', error.message);
        }
        if (!isMinimaxMockAllowed()) {
            return { success: false, error: error.message || 'MINIMAX_REQUEST_FAILED' };
        }
        console.warn('[Minimax] 回退到模拟任务（mock job）');
        return await mockGenerateMusic(params);
    }
}

/**
 * 查询生成状态
 */
async function checkGenerationStatus(jobId) {
    try {
        if (jobId.startsWith('mock_')) {
            return await mockCheckStatus(jobId);
        }
        if (!MINIMAX_API_KEY) {
            if (!isMinimaxMockAllowed()) {
                return { success: false, status: 'failed', error: 'MINIMAX_API_KEY_REQUIRED' };
            }
            return await mockCheckStatus(jobId);
        }

        const statusUrl = `${MINIMAX_API_BASE}/music_generation`;
        const queryParams = { trace_id: jobId, task_id: jobId };
        console.log('[Minimax] ========== music_generation 状态查询 ==========');
        console.log('[Minimax] GET', statusUrl);
        console.log('[Minimax] query:', JSON.stringify(queryParams));

        // Minimax 状态查询接口
        // 若实际接口不同，请调整此处
        // 文档主路径仅为 POST；若平台提供查询，通常携带 trace_id（与创建响应一致）
        const response = await axios.get(statusUrl, {
            params: queryParams,
            headers: {
                Authorization: `Bearer ${MINIMAX_API_KEY}`
            },
            timeout: 15000
        });

        console.log('[Minimax] 状态响应:', JSON.stringify(response.data, null, 2));

        const parsed = parseMusicGenerationResponse(response.data);
        if (!parsed.ok) {
            return { success: false, status: 'failed', error: parsed.error };
        }

        let st = 'pending';
        if (parsed.musicStatus === 2) st = 'completed';
        else if (parsed.musicStatus === 1) st = 'processing';
        else st = mapStatus(parsed.raw && parsed.raw.status);

        return {
            success: true,
            status: st,
            audioUrl: parsed.audioUrl || undefined,
            audioDurationMs: parsed.audioDurationMs != null ? parsed.audioDurationMs : undefined,
            error: parsed.raw && parsed.raw.error
        };

    } catch (error) {
        const isTimeout =
            error.code === 'ECONNABORTED' ||
            (error.message && /timeout|ETIMEDOUT/i.test(error.message));
        if (isTimeout) {
            console.error('[Minimax] 状态查询请求超时（默认 15s）。生产环境将标记失败，不分发模拟音频');
        } else {
            console.error('[Minimax] 查询状态失败:', error.message);
        }
        if (error.response) {
            console.error('[Minimax] 错误详情:', JSON.stringify(error.response.data, null, 2));
        }
        if (!isMinimaxMockAllowed()) {
            return { success: false, status: 'failed', error: error.message || 'STATUS_QUERY_FAILED' };
        }
        return await mockCheckStatus(jobId);
    }
}

/**
 * 状态映射（Minimax 状态 -> 内部状态）
 */
function mapStatus(status) {
    if (!status) return 'pending';
    const s = String(status).toLowerCase();
    if (s.includes('pending') || s.includes('queue')) return 'pending';
    if (s.includes('progress') || s.includes('processing') || s.includes('inprogress')) return 'processing';
    if (s.includes('complete') || s.includes('success')) return 'completed';
    if (s.includes('fail') || s.includes('error')) return 'failed';
    return s;
}

/**
 * 模拟生成（API未配置或失败时回退）
 */
async function mockGenerateMusic(params) {
    const mockJobId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
        success: true,
        jobId: mockJobId,
        status: 'pending',
        estimatedTime: 5,
        mock: true,
        source: 'minimax-mock'
    };
}

/**
 * 模拟状态查询
 */
async function mockCheckStatus(jobId) {
    const elapsed = Date.now() - parseInt(jobId.split('_')[1]);

    if (elapsed < 5000) {
        return {
            success: true,
            status: 'processing',
            progress: Math.min(100, Math.floor(elapsed / 50))
        };
    }

    return {
        success: true,
        status: 'completed',
        audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        mock: true
    };
}

module.exports = {
    generateMusic,
    checkGenerationStatus,
    generatePrompt,
    parseMusicGenerationResponse,
    isMinimaxMockAllowed,
    INSTRUMENT_TO_PROMPT,
    FREQUENCY_TO_DESC
};
