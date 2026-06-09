/**
 * 官方曲库音频导入脚本
 * 用法：
 *   1. 把 .mp3 文件放到 data/audio/library/ 目录
 *   2. （可选）创建 data/audio/library/library.json 配置文件
 *   3. 执行：node scripts/import-library.js
 *
 * library.json 格式示例：
 * {
 *   "深度睡眠曲.mp3": {
 *     "title": "深度睡眠曲",
 *     "instrument": "piano",
 *     "frequency": "delta",
 *     "bpm": 60,
 *     "description": "曲目释义…",
 *     "category": "睡眠"
 *   }
 * }
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const {
    resolveDataDir,
    resolveLibraryAudioDir,
    buildLibraryAudioPublicPath
} = require('../src/media-paths');
const { coverRelPathFromAudioFilename } = require('../src/library-cover');

const projectRoot = path.join(__dirname, '..');
const imagesRoot = path.join(projectRoot, 'images');

const DATA_DIR = resolveDataDir();
const LIBRARY_DIR = resolveLibraryAudioDir();
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'sleep_music_v2.db');
const LIBRARY_SYSTEM_USER_ID = 'system';

const db = new Database(DB_PATH);

/** music_tracks.user_id 外键指向 users.id，须先存在 system 用户 */
function ensureSystemUser() {
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(LIBRARY_SYSTEM_USER_ID);
    if (row) return;
    db.prepare('INSERT INTO users (id, nickname) VALUES (?, ?)').run(
        LIBRARY_SYSTEM_USER_ID,
        '官方曲库'
    );
    console.log(`[就绪] 已创建系统用户 id=${LIBRARY_SYSTEM_USER_ID}`);
}

// 从文件名推断元数据（兜底逻辑）
function inferMeta(filename) {
    const name = path.basename(filename, path.extname(filename));
    const lower = name.toLowerCase();

    // 推断分类
    let category = '全部';
    if (lower.includes('睡眠') || lower.includes('sleep') || lower.includes('眠')) category = '睡眠';
    else if (lower.includes('冥想') || lower.includes('meditation') || lower.includes('禅')) category = '冥想';
    else if (lower.includes('自然') || lower.includes('nature') || lower.includes('雨') || lower.includes('海') || lower.includes('风') || lower.includes('鸟')) category = '自然';
    else if (lower.includes('专注') || lower.includes('focus') || lower.includes('学习') || lower.includes('工作')) category = '专注';

    // 推断频率
    let frequency = 'alpha';
    if (lower.includes('delta') || lower.includes('德尔塔') || lower.includes('深度')) frequency = 'delta';
    else if (lower.includes('theta') || lower.includes('西塔') || lower.includes('冥想')) frequency = 'theta';
    else if (lower.includes('alpha') || lower.includes('阿尔法') || lower.includes('放松')) frequency = 'alpha';
    else if (lower.includes('schumann') || lower.includes('舒曼')) frequency = 'schumann';

    // 推断乐器
    let instrument = 'piano';
    if (lower.includes('古琴') || lower.includes('guqin')) instrument = 'guqin';
    else if (lower.includes('手碟') || lower.includes('handpan')) instrument = 'handpan';
    else if (lower.includes('颂钵') || lower.includes('singing')) instrument = 'singingbowl';
    else if (lower.includes('笛') || lower.includes('flute') || lower.includes('bamboo')) instrument = 'bamboo';

    return {
        title: name,
        instrument,
        frequency,
        bpm: 60,
        duration: 180,
        category,
        description: ''
    };
}

// 加载配置文件（如果存在）
function loadConfig() {
    const configPath = path.join(LIBRARY_DIR, 'library.json');
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (err) {
            console.warn('[警告] library.json 解析失败，使用自动推断:', err.message);
        }
    }
    return {};
}

function formatDurationLabel(seconds) {
    const sec = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** 用 ffprobe 读取真实时长（秒）；失败时返回 null */
function probeDurationSec(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
            if (err) {
                console.warn(
                    `[警告] 无法读取时长 ${path.basename(filePath)}: ${err.message}`
                );
                return resolve(null);
            }
            const raw = data && data.format && data.format.duration;
            const sec = Math.round(Number(raw));
            if (!sec || sec < 1) return resolve(null);
            resolve(sec);
        });
    });
}

async function main() {
    // 确保目录存在
    if (!fs.existsSync(LIBRARY_DIR)) {
        fs.mkdirSync(LIBRARY_DIR, { recursive: true });
    }

    ensureSystemUser();

    // 扫描音频文件
    const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac'];
    const allEntries = fs.readdirSync(LIBRARY_DIR).filter((f) => f !== 'library.json');
    const files = allEntries.filter((f) => {
        const ext = path.extname(f).toLowerCase();
        return AUDIO_EXTS.includes(ext);
    });
    const skippedNoExt = allEntries.filter((f) => !AUDIO_EXTS.includes(path.extname(f).toLowerCase()));

    if (files.length === 0) {
        console.log('未在 data/audio/library/ 发现可导入的音频文件');
        console.log('支持扩展名:', AUDIO_EXTS.join(', '));
        if (skippedNoExt.length > 0) {
            console.log('\n目录里有文件但扩展名不对（脚本不会导入）：');
            skippedNoExt.forEach((f) => console.log(`  - ${f}`));
            console.log('\n请改名为例如 truck1.mp3、truck2.mp3 后再执行本脚本');
        } else {
            console.log('请把 .mp3/.wav/.m4a/.aac 放入该目录后重试');
        }
        return;
    }

    const config = loadConfig();

    const now = new Date().toISOString();
    let imported = 0;
    let skipped = 0;

    const trackCols = db.prepare('PRAGMA table_info(music_tracks)').all();
    const colSet = new Set(trackCols.map((c) => c.name));
    const hasAudioDurationMs = colSet.has('audio_duration_ms');
    const hasDescription = colSet.has('description');
    const hasPlayerCover = colSet.has('player_cover_url');

    function buildInsertStmt() {
        const fields = [
            'id',
            'user_id',
            'title',
            'main_instrument',
            'frequency',
            'duration',
            'bpm',
            'audio_url'
        ];
        if (hasDescription) fields.push('description');
        if (hasPlayerCover) fields.push('player_cover_url');
        if (hasAudioDurationMs) fields.push('audio_duration_ms');
        fields.push('status', 'created_at');
        const updateFields = fields.filter((f) => f !== 'id' && f !== 'created_at');
        const setClause = updateFields.map((f) => `${f}=excluded.${f}`).join(', ');
        const placeholders = fields.map(() => '?').join(', ');
        return db.prepare(
            `INSERT INTO music_tracks (${fields.join(', ')}) VALUES (${placeholders})
             ON CONFLICT(id) DO UPDATE SET ${setClause}`
        );
    }

    const insertTrack = buildInsertStmt();

    for (const file of files) {
        const fileConfig = config[file] || {};
        const inferred = inferMeta(file);
        const meta = { ...inferred, ...fileConfig };
        const filePath = path.join(LIBRARY_DIR, file);

        let durationSec =
            fileConfig.duration != null && Number(fileConfig.duration) > 0
                ? Math.floor(Number(fileConfig.duration))
                : null;
        if (durationSec == null) {
            durationSec = await probeDurationSec(filePath);
        }
        if (durationSec == null) {
            durationSec = 180;
            console.warn(`[警告] ${file} 使用默认时长 3:00（请安装 ffmpeg/ffprobe 或在 library.json 填写 duration）`);
        }
        const durationMs = durationSec * 1000;

        // 生成稳定 ID（基于文件名，重复导入时更新同一条记录）
        const musicId = 'lib_' + Buffer.from(file).toString('hex').slice(0, 16);
        const audioUrl = buildLibraryAudioPublicPath(file);
        let coverRel = meta.cover ? String(meta.cover).trim() : coverRelPathFromAudioFilename(file);
        if (coverRel && !coverRel.startsWith('/')) {
            coverRel = coverRel.startsWith('images/') ? `/${coverRel}` : `/images/${coverRel}`;
        }
        const coverAbs = coverRel
            ? path.join(imagesRoot, coverRel.replace(/^\/images\//, ''))
            : '';
        if (coverAbs && !fs.existsSync(coverAbs)) {
            console.warn(`[警告] 封面不存在: ${coverAbs}（仍写入路径 ${coverRel}）`);
        }

        // 检查是否已存在
        const existing = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(musicId);

        try {
            const desc =
                meta.description != null ? String(meta.description).trim() : '';
            const row = [
                musicId,
                LIBRARY_SYSTEM_USER_ID,
                meta.title,
                meta.instrument,
                meta.frequency,
                durationSec,
                meta.bpm || 60,
                audioUrl
            ];
            if (hasDescription) row.push(desc);
            if (hasPlayerCover) row.push(coverRel || null);
            if (hasAudioDurationMs) row.push(durationMs);
            row.push('completed', now);
            insertTrack.run(...row);
            const label = formatDurationLabel(durationSec);
            if (existing) {
                console.log(`[更新] ${file} -> ${meta.title} · ${label}`);
            } else {
                console.log(`[导入] ${file} -> ${meta.title} · ${label}`);
            }
            imported++;
        } catch (err) {
            console.error(`[失败] ${file}:`, err.message);
            skipped++;
        }
    }

    console.log(`\n完成：导入 ${imported} 首，跳过 ${skipped} 首`);
    console.log('曲库接口：GET http://localhost:3000/api/music/library');
}

main().catch((err) => {
    console.error('[致命]', err);
    process.exit(1);
});
