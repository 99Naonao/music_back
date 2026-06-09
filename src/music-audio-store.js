/**
 * 作品音频落盘与播放地址（避免仅依赖 MiniMax 临时外链）
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { logInfo, logWarn } = require('./error-codes');

function getMusicAudioDir(uploadDir) {
    const dir = path.join(uploadDir, 'music-audio');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function audioFilenameForMusicId(musicId) {
    const id = String(musicId || '').trim();
    if (!id) return '';
    return `audio-${id}.mp3`;
}

function getLocalAudioFilePath(uploadDir, musicId) {
    const name = audioFilenameForMusicId(musicId);
    if (!name) return null;
    return path.join(getMusicAudioDir(uploadDir), name);
}

function buildMusicAudioPublicUrl(musicId) {
    const base = (process.env.BASE_URL || '').replace(/\/$/, '');
    const name = audioFilenameForMusicId(musicId);
    if (!base || !name) return '';
    return `${base}/api/music/audio?f=${encodeURIComponent(name)}`;
}

function isSelfHostedMusicAudioUrl(urlStr) {
    const raw = String(urlStr || '').trim();
    if (!raw) return false;
    if (raw.includes('/api/music/audio')) return true;
    try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://x${raw.startsWith('/') ? raw : `/${raw}`}`);
        if (u.pathname === '/api/music/audio' || u.pathname.endsWith('/api/music/audio')) {
            return !!(u.searchParams.get('f') || u.searchParams.get('file'));
        }
    } catch (_) {
        /* ignore */
    }
    return false;
}

function localAudioFileExists(uploadDir, musicId) {
    const fp = getLocalAudioFilePath(uploadDir, musicId);
    if (!fp || !fs.existsSync(fp)) return false;
    try {
        return fs.statSync(fp).size > 1024;
    } catch (_) {
        return false;
    }
}

function resolveMusicAudioDiskPath(uploadDir, filenameParam) {
    const safe = path.basename(decodeURIComponent(String(filenameParam || '')));
    if (!safe || !/^audio-.+\.mp3$/i.test(safe)) return null;
    const filePath = path.join(getMusicAudioDir(uploadDir), safe);
    const resolved = path.resolve(filePath);
    const root = path.resolve(getMusicAudioDir(uploadDir));
    if (!resolved.startsWith(root)) return null;
    return { safe, filePath: resolved };
}

async function probeRemoteAudioUrl(urlStr) {
    const url = String(urlStr || '').trim();
    if (!/^https?:\/\//i.test(url)) return false;
    try {
        const head = await axios.head(url, {
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: (s) => s >= 200 && s < 400
        });
        return true;
    } catch (_) {
        try {
            const res = await axios.get(url, {
                timeout: 12000,
                maxRedirects: 5,
                responseType: 'arraybuffer',
                maxContentLength: 512 * 1024,
                validateStatus: (s) => s >= 200 && s < 400
            });
            return res.data && res.data.byteLength > 1024;
        } catch (e2) {
            return false;
        }
    }
}

/**
 * 从 MiniMax 等外链下载 MP3 到本地 music-audio/
 * @returns {Promise<string|null>} 本服务对外 URL
 */
async function persistMusicAudioFromRemote(uploadDir, musicId, remoteUrl) {
    const url = String(remoteUrl || '').trim();
    const id = String(musicId || '').trim();
    if (!id || !/^https?:\/\//i.test(url)) return null;

    const dest = getLocalAudioFilePath(uploadDir, id);
    if (!dest) return null;

    if (localAudioFileExists(uploadDir, id)) {
        return buildMusicAudioPublicUrl(id);
    }

    logInfo('音频落盘', '开始下载', { musicId: id, remote: url.slice(0, 80) });

    const res = await axios.get(url, {
        timeout: 120000,
        maxRedirects: 8,
        responseType: 'arraybuffer',
        maxContentLength: 80 * 1024 * 1024,
        validateStatus: (s) => s >= 200 && s < 400
    });

    const buf = Buffer.from(res.data);
    if (!buf.length || buf.length < 1024) {
        throw new Error(`下载内容过小: ${buf.length} bytes`);
    }

    const tmp = `${dest}.part-${Date.now()}`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);

    const publicUrl = buildMusicAudioPublicUrl(id);
    logInfo('音频落盘', '完成', { musicId: id, bytes: buf.length, publicUrl });
    return publicUrl;
}

/**
 * 列表/播放用：补全 audio_url，仅在确无地址时标 audioReachable=false。
 * 不在服务端用 HEAD 探测外链（CDN 常拒服务器 IP，会误杀能在小程序里播的地址）。
 */
async function enrichTrackAudio(uploadDir, row) {
    const musicId = row.id;
    let audioUrl = row.audio_url ? String(row.audio_url).trim() : '';

    if (!audioUrl) {
        return { ...row, audio_url: audioUrl, audioReachable: false };
    }

    if (localAudioFileExists(uploadDir, musicId)) {
        const localUrl = buildMusicAudioPublicUrl(musicId);
        if (localUrl) audioUrl = localUrl;
        return { ...row, audio_url: audioUrl, audioReachable: true };
    }

    if (isSelfHostedMusicAudioUrl(audioUrl)) {
        return { ...row, audio_url: audioUrl, audioReachable: true };
    }

    if (/^https?:\/\//i.test(audioUrl)) {
        try {
            const localUrl = await persistMusicAudioFromRemote(uploadDir, musicId, audioUrl);
            if (localUrl) {
                audioUrl = localUrl;
            }
        } catch (e) {
            logWarn('音频落盘', '列表懒迁移失败', {
                musicId,
                message: e.message
            });
        }
    }

    return { ...row, audio_url: audioUrl, audioReachable: true };
}

module.exports = {
    getMusicAudioDir,
    audioFilenameForMusicId,
    getLocalAudioFilePath,
    buildMusicAudioPublicUrl,
    isSelfHostedMusicAudioUrl,
    localAudioFileExists,
    resolveMusicAudioDiskPath,
    probeRemoteAudioUrl,
    persistMusicAudioFromRemote,
    enrichTrackAudio
};
