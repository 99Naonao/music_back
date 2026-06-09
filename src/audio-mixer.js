/**
 * 音频合成服务
 * 功能：
 * 1. 白噪音时间轴合成
 * 2. AI音乐 + 白噪音 + 人声三轨混音
 * 3. 输出最终MP3
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { resolveAudioDir } = require('./media-paths');

// 音频文件存储目录（与 DB_PATH / DATA_DIR 对齐）
const AUDIO_DIR = resolveAudioDir();
const EFFECTS_DIR = path.join(AUDIO_DIR, 'effects');

// 确保目录存在
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
}
if (!fs.existsSync(EFFECTS_DIR)) {
    fs.mkdirSync(EFFECTS_DIR, { recursive: true });
}

/**
 * 白噪音效果配置
 */
/** 用户上传的参考音乐时长（秒） */
const REFERENCE_AUDIO_MIN_SEC = 6;
const REFERENCE_AUDIO_MAX_SEC = 360;

const EFFECTS_CONFIG = {
    rain: { file: 'rain.mp3', defaultVolume: 0.5 },
    water: { file: 'water.mp3', defaultVolume: 0.5 },
    wave: { file: 'wave.mp3', defaultVolume: 0.6 },
    wind: { file: 'wind.mp3', defaultVolume: 0.4 },
    bird: { file: 'bird.mp3', defaultVolume: 0.3 },
    cricket: { file: 'cricket.mp3', defaultVolume: 0.4 },
    fire: { file: 'fire.mp3', defaultVolume: 0.5 },
    thunder: { file: 'thunder.mp3', defaultVolume: 0.4 },
    snow: { file: 'snow.mp3', defaultVolume: 0.3 },
    train: { file: 'train.mp3', defaultVolume: 0.5 },
    cafe: { file: 'cafe.mp3', defaultVolume: 0.4 },
    white_noise: { file: 'white_noise.mp3', defaultVolume: 0.5 },
    pink_noise: { file: 'pink_noise.mp3', defaultVolume: 0.5 },
    brown_noise: { file: 'brown_noise.mp3', defaultVolume: 0.5 },
    singing_bowl: { file: 'singing_bowl.mp3', defaultVolume: 0.5 },
    tingsha: { file: 'tingsha.mp3', defaultVolume: 0.4 }
};

/**
 * 合成白噪音时间轴
 * @param {Array} effects - 白噪音配置数组 [{type, startTime, endTime, volume}]
 * @param {number} totalDuration - 总时长（秒）
 * @returns {Promise<string>} 合成后的音频文件路径
 */
async function mixEffects(effects, totalDuration = 180) {
    return new Promise((resolve, reject) => {
        const outputFile = path.join(AUDIO_DIR, `effects_${uuidv4()}.mp3`);

        // 如果没有效果，生成静音
        if (!effects || effects.length === 0) {
            return generateSilence(totalDuration, outputFile)
                .then(() => resolve(outputFile))
                .catch(reject);
        }

        // 构建ffmpeg复杂滤镜
        const filterComplex = buildEffectsFilter(effects, totalDuration);

        // 创建ffmpeg命令
        const command = ffmpeg();

        // 添加输入文件
        effects.forEach(effect => {
            const config = EFFECTS_CONFIG[effect.type];
            if (config) {
                const filePath = path.join(EFFECTS_DIR, config.file);
                if (fs.existsSync(filePath)) {
                    command.input(filePath);
                }
            }
        });

        // 应用滤镜并输出
        command
            .complexFilter(filterComplex.filter, filterComplex.outputs)
            .outputOptions(['-acodec libmp3lame', '-b:a 128k'])
            .output(outputFile)
            .on('end', () => {
                console.log('白噪音合成完成:', outputFile);
                resolve(outputFile);
            })
            .on('error', (err) => {
                console.error('白噪音合成失败:', err);
                reject(err);
            })
            .run();
    });
}

/**
 * 构建ffmpeg滤镜字符串
 */
function buildEffectsFilter(effects, totalDuration) {
    const inputs = [];
    const filters = [];
    let outputIndex = 0;

    effects.forEach((effect, index) => {
        const config = EFFECTS_CONFIG[effect.type];
        if (!config) return;

        const filePath = path.join(EFFECTS_DIR, config.file);
        if (!fs.existsSync(filePath)) return;

        const inputIndex = index;
        const volume = effect.volume || config.defaultVolume;
        const startTime = effect.startTime || 0;
        const endTime = effect.endTime || totalDuration;
        const duration = endTime - startTime;

        // 为每个音效创建滤镜链
        // 1. 裁剪时长 2. 调整音量 3. 延迟到指定时间
        filters.push({
            filter: 'atrim',
            options: { start: 0, end: duration },
            inputs: `${inputIndex}:a`,
            outputs: `trimmed${index}`
        });

        filters.push({
            filter: 'volume',
            options: { volume: volume },
            inputs: `trimmed${index}`,
            outputs: `volume${index}`
        });

        filters.push({
            filter: 'adelay',
            options: { delays: `${startTime * 1000}|${startTime * 1000}` },
            inputs: `volume${index}`,
            outputs: `delayed${index}`
        });

        inputs.push(`delayed${index}`);
    });

    // 混合所有输入
    if (inputs.length > 0) {
        filters.push({
            filter: 'amix',
            options: { inputs: inputs.length, duration: 'longest' },
            inputs: inputs,
            outputs: 'mixed'
        });

        return {
            filter: filters,
            outputs: 'mixed'
        };
    }

    // 如果没有有效输入，返回空滤镜
    return { filter: [], outputs: '0:a' };
}

/**
 * 生成静音文件
 */
async function generateSilence(duration, outputFile) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input('anullsrc=r=44100:cl=stereo')
            .inputFormat('lavfi')
            .duration(duration)
            .outputOptions(['-acodec libmp3lame', '-b:a 128k'])
            .output(outputFile)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

/**
 * 三轨混音（AI音乐 + 白噪音 + 人声）
 * @param {Object} params
 * @param {string} params.musicUrl - AI音乐URL或路径
 * @param {string} params.effectsFile - 白噪音合成文件路径
 * @param {string} params.voiceFile - 人声文件路径（可选）
 * @param {Object} params.volumes - 音量配置 {music, effects, voice}
 * @returns {Promise<string>} 最终音频文件路径
 */
async function mixFinalAudio(params) {
    const { musicUrl, effectsFile, voiceFile, volumes = {} } = params;
    const outputFile = path.join(AUDIO_DIR, `final_${uuidv4()}.mp3`);

    return new Promise((resolve, reject) => {
        const command = ffmpeg();
        const inputs = [];
        const filters = [];
        let inputIndex = 0;

        // 添加AI音乐
        if (musicUrl) {
            command.input(musicUrl);
            filters.push({
                filter: 'volume',
                options: { volume: volumes.music || 0.8 },
                inputs: `${inputIndex}:a`,
                outputs: `music_vol`
            });
            inputs.push('music_vol');
            inputIndex++;
        }

        // 添加白噪音
        if (effectsFile && fs.existsSync(effectsFile)) {
            command.input(effectsFile);
            filters.push({
                filter: 'volume',
                options: { volume: volumes.effects || 0.4 },
                inputs: `${inputIndex}:a`,
                outputs: `effects_vol`
            });
            inputs.push('effects_vol');
            inputIndex++;
        }

        // 添加人声
        if (voiceFile && fs.existsSync(voiceFile)) {
            command.input(voiceFile);
            filters.push({
                filter: 'volume',
                options: { volume: volumes.voice || 0.6 },
                inputs: `${inputIndex}:a`,
                outputs: `voice_vol`
            });
            inputs.push('voice_vol');
            inputIndex++;
        }

        // 混合所有轨道
        if (inputs.length > 1) {
            filters.push({
                filter: 'amix',
                options: { inputs: inputs.length, duration: 'longest' },
                inputs: inputs,
                outputs: 'final'
            });

            command
                .complexFilter(filters, 'final')
                .outputOptions([
                    '-acodec libmp3lame',
                    '-b:a 192k',
                    '-ar 44100'
                ])
                .output(outputFile)
                .on('end', () => {
                    console.log('最终混音完成:', outputFile);
                    resolve(outputFile);
                })
                .on('error', (err) => {
                    console.error('混音失败:', err);
                    reject(err);
                })
                .run();
        } else if (inputs.length === 1) {
            // 只有一个输入，直接复制
            command
                .input(musicUrl || effectsFile || voiceFile)
                .outputOptions(['-acodec libmp3lame', '-b:a 192k'])
                .output(outputFile)
                .on('end', () => resolve(outputFile))
                .on('error', reject)
                .run();
        } else {
            reject(new Error('没有可用的音频输入'));
        }
    });
}

function probeAudioDurationSec(filePathOrUrl) {
    return new Promise((resolve, reject) => {
        const target = String(filePathOrUrl || '').trim();
        if (!target) {
            reject(new Error('参考音频文件不存在'));
            return;
        }
        const isRemote = /^https?:\/\//i.test(target);
        if (!isRemote && !fs.existsSync(target)) {
            reject(new Error('参考音频文件不存在'));
            return;
        }
        ffmpeg.ffprobe(target, (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            const d = Number(data && data.format && data.format.duration);
            if (!Number.isFinite(d) || d <= 0) {
                reject(new Error('无法读取参考音频时长'));
                return;
            }
            resolve(d);
        });
    });
}

function assertReferenceAudioDurationSec(durationSec) {
    const d = Number(durationSec);
    if (!Number.isFinite(d) || d < REFERENCE_AUDIO_MIN_SEC || d > REFERENCE_AUDIO_MAX_SEC) {
        throw new Error(
            `参考音乐时长须在 ${REFERENCE_AUDIO_MIN_SEC}～${REFERENCE_AUDIO_MAX_SEC} 秒之间`
        );
    }
    return d;
}

/**
 * 将用户参考音乐叠入 AI 成片的时间轴窗口（辅助白噪音听感）
 * @param {string} musicPath - 主音乐本地路径
 * @param {Array} effects - [{ referencePath, startTime, endTime, volume }]
 * @returns {Promise<string>} 输出文件路径
 */
async function overlayReferenceEffectsOnMusic(musicPath, effects) {
    const list = (effects || []).filter(
        (e) => e && e.referencePath && fs.existsSync(e.referencePath)
    );
    if (!list.length || !musicPath || !fs.existsSync(musicPath)) {
        return musicPath;
    }

    const outputFile = path.join(AUDIO_DIR, `music_ref_${uuidv4()}.mp3`);

    return new Promise((resolve, reject) => {
        const command = ffmpeg();
        command.input(musicPath);
        const filters = [];
        const mixInputs = ['base_vol'];
        let inputIndex = 1;

        filters.push({
            filter: 'volume',
            options: { volume: 1 },
            inputs: '0:a',
            outputs: 'base_vol'
        });

        list.forEach((effect, idx) => {
            const start = Math.max(0, Number(effect.startTime) || 0);
            const end = Math.max(start, Number(effect.endTime) || start + 1);
            const windowDur = Math.max(0.1, end - start);
            const vol =
                typeof effect.volume === 'number'
                    ? Math.max(0.05, Math.min(1, effect.volume))
                    : 0.45;

            command.input(effect.referencePath).inputOptions(['-stream_loop', '-1']);
            const inLabel = `${inputIndex}:a`;
            const trimOut = `ref_trim_${idx}`;
            const volOut = `ref_vol_${idx}`;
            const delayOut = `ref_delay_${idx}`;

            filters.push({
                filter: 'atrim',
                options: { start: 0, duration: windowDur },
                inputs: inLabel,
                outputs: trimOut
            });
            filters.push({
                filter: 'volume',
                options: { volume: vol },
                inputs: trimOut,
                outputs: volOut
            });
            filters.push({
                filter: 'adelay',
                options: { delays: `${Math.round(start * 1000)}|${Math.round(start * 1000)}` },
                inputs: volOut,
                outputs: delayOut
            });
            mixInputs.push(delayOut);
            inputIndex += 1;
        });

        filters.push({
            filter: 'amix',
            options: { inputs: mixInputs.length, duration: 'longest', dropout_transition: 0 },
            inputs: mixInputs,
            outputs: 'mixed'
        });

        command
            .complexFilter(filters, 'mixed')
            .outputOptions(['-acodec libmp3lame', '-b:a 192k', '-ar 44100'])
            .output(outputFile)
            .on('end', () => resolve(outputFile))
            .on('error', (err) => reject(err))
            .run();
    });
}

/**
 * 上传音频到阿里云OSS
 * @param {string} localFile - 本地文件路径
 * @param {string} ossKey - OSS存储路径
 * @returns {Promise<string>} OSS访问URL
 */
async function uploadToOSS(localFile, ossKey) {
    // TODO: 实现阿里云OSS上传
    // 需要配置：AccessKey、SecretKey、Bucket、Endpoint

    // 临时返回本地路径（开发测试用）
    return `file://${localFile}`;
}

module.exports = {
    mixEffects,
    mixFinalAudio,
    overlayReferenceEffectsOnMusic,
    probeAudioDurationSec,
    assertReferenceAudioDurationSec,
    REFERENCE_AUDIO_MIN_SEC,
    REFERENCE_AUDIO_MAX_SEC,
    uploadToOSS,
    EFFECTS_CONFIG,
    AUDIO_DIR
};
