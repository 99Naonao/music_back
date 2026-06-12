const { getDb } = require('./database');
const cardTemplates = require('../card-template-service');
const mediaSecStore = require('../media-sec-store');
const channelService = require('../channel-service');

function initDatabase() {
    const db = getDb();
    // 用户表
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            wx_openid TEXT UNIQUE,
            phone TEXT,
            nickname TEXT,
            avatar_url TEXT,
            gender TEXT,
            birthday TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // 官方曲库占位用户（music_tracks.user_id 外键）
    db.prepare(
        `INSERT OR IGNORE INTO users (id, nickname) VALUES ('system', '官方曲库')`
    ).run();

    // 音乐作品表
    db.exec(`
        CREATE TABLE IF NOT EXISTS music_tracks (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            main_instrument TEXT,
            frequency TEXT,
            duration INTEGER,
            bpm INTEGER,
            audio_url TEXT,
            status TEXT DEFAULT 'generating',
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 白噪音时间轴表
    db.exec(`
        CREATE TABLE IF NOT EXISTS sound_effects (
            id TEXT PRIMARY KEY,
            music_id TEXT,
            effect_type TEXT,
            start_time INTEGER,
            end_time INTEGER,
            volume REAL DEFAULT 0.5,
            use_reference_music INTEGER DEFAULT 0,
            reference_audio_url TEXT,
            FOREIGN KEY (music_id) REFERENCES music_tracks(id)
        )
    `);

    try {
        const seCols = db.prepare(`PRAGMA table_info(sound_effects)`).all();
        const seNames = new Set(seCols.map((c) => c.name));
        if (!seNames.has('use_reference_music')) {
            db.exec(`ALTER TABLE sound_effects ADD COLUMN use_reference_music INTEGER DEFAULT 0`);
            console.log('[DB] 已添加列 sound_effects.use_reference_music');
        }
        if (!seNames.has('reference_audio_url')) {
            db.exec(`ALTER TABLE sound_effects ADD COLUMN reference_audio_url TEXT`);
            console.log('[DB] 已添加列 sound_effects.reference_audio_url');
        }
    } catch (seMigrateErr) {
        console.warn('[DB] sound_effects 迁移:', seMigrateErr.message);
    }

    // 贺卡表
    db.exec(`
        CREATE TABLE IF NOT EXISTS greeting_cards (
            id TEXT PRIMARY KEY,
            music_id TEXT,
            sender_id TEXT,
            recipient_name TEXT,
            message TEXT,
            template_style TEXT,
            share_url TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (music_id) REFERENCES music_tracks(id),
            FOREIGN KEY (sender_id) REFERENCES users(id)
        )
    `);

    // 社群帖子表
    db.exec(`
        CREATE TABLE IF NOT EXISTS community_posts (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            content TEXT,
            images TEXT,
            topic TEXT,
            music_id TEXT,
            likes INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (music_id) REFERENCES music_tracks(id)
        )
    `);

    // 社群评论表
    db.exec(`
        CREATE TABLE IF NOT EXISTS community_comments (
            id TEXT PRIMARY KEY,
            post_id TEXT,
            user_id TEXT,
            content TEXT,
            parent_id TEXT,
            reply_to_user_id TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (post_id) REFERENCES community_posts(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 点赞记录表（防止重复点赞）
    db.exec(`
        CREATE TABLE IF NOT EXISTS community_likes (
            post_id TEXT,
            user_id TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (post_id, user_id),
            FOREIGN KEY (post_id) REFERENCES community_posts(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS community_comment_likes (
            comment_id TEXT,
            user_id TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (comment_id, user_id),
            FOREIGN KEY (comment_id) REFERENCES community_comments(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 贺卡分享表（用于小程序卡片分享）
    db.exec(`
        CREATE TABLE IF NOT EXISTS card_shares (
            id TEXT PRIMARY KEY,
            music_id TEXT,
            sender_id TEXT,
            recipient TEXT,
            message TEXT,
            template INTEGER DEFAULT 1,
            music_instrument TEXT,
            music_frequency TEXT,
            music_bpm INTEGER,
            cover_image TEXT,
            audio_url TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // 收礼箱：登录用户打开他人分享的贺卡时入库
    db.exec(`
        CREATE TABLE IF NOT EXISTS card_gift_inbox (
            user_id TEXT NOT NULL,
            share_id TEXT NOT NULL,
            sender_id TEXT,
            first_opened_at DATETIME DEFAULT (datetime('now', 'localtime')),
            last_opened_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (user_id, share_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 贺卡模板分类（清单来自 images/card-templates.json，启动时同步）
    db.exec(`
        CREATE TABLE IF NOT EXISTS card_template_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1
        )
    `);

    // 贺卡模板（PNG 置于项目根 images/，由 manifest 登记文件名）
    db.exec(`
        CREATE TABLE IF NOT EXISTS card_templates (
            id TEXT PRIMARY KEY,
            category_id TEXT NOT NULL,
            name TEXT NOT NULL,
            image_file TEXT NOT NULL,
            cover_url TEXT NOT NULL,
            bg_image_url TEXT NOT NULL,
            gradient_template INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (category_id) REFERENCES card_template_categories(id)
        )
    `);

    // 用户积分表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_points (
            user_id TEXT PRIMARY KEY,
            points INTEGER DEFAULT 0,
            total_points INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 积分变动记录表
    db.exec(`
        CREATE TABLE IF NOT EXISTS points_history (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            points INTEGER,
            type TEXT,
            description TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 每日任务领取记录（自然日，上海时区）
    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_task_claims (
            user_id TEXT NOT NULL,
            task_key TEXT NOT NULL,
            claim_date TEXT NOT NULL,
            points INTEGER NOT NULL,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (user_id, task_key, claim_date),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 通知表
    db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT,
            content TEXT,
            related_id TEXT,
            read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 用户关注关系
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_follows (
            follower_id TEXT NOT NULL,
            following_id TEXT NOT NULL,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (follower_id, following_id),
            FOREIGN KEY (follower_id) REFERENCES users(id),
            FOREIGN KEY (following_id) REFERENCES users(id)
        )
    `);

    // 用户意见反馈（小程序帮助中心提交）
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_feedback (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            wx_openid TEXT,
            nickname TEXT,
            feedback_type TEXT NOT NULL,
            content TEXT NOT NULL,
            contact TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 用户收藏的作品
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_favorites (
            user_id TEXT NOT NULL,
            music_id TEXT NOT NULL,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (user_id, music_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 播放记录（每用户每首曲目一条，重复播放更新 played_at）
    db.exec(`
        CREATE TABLE IF NOT EXISTS play_history (
            user_id TEXT NOT NULL,
            music_id TEXT NOT NULL,
            title TEXT,
            audio_url TEXT NOT NULL,
            cover TEXT,
            instrument TEXT,
            frequency TEXT,
            duration_sec INTEGER DEFAULT 0,
            source TEXT,
            played_at DATETIME DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (user_id, music_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    try {
        const cols = db.prepare(`PRAGMA table_info(music_tracks)`).all();
        const musicTrackColNames = new Set(cols.map((c) => c.name));
        if (!musicTrackColNames.has('audio_duration_ms')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN audio_duration_ms INTEGER`);
            console.log('[DB] 已添加列 music_tracks.audio_duration_ms（MiniMax 成片时长 ms）');
        }
        if (!musicTrackColNames.has('player_cover_url')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN player_cover_url TEXT`);
            console.log('[DB] 已添加列 music_tracks.player_cover_url（播放器封面，与贺卡无关）');
        }
        if (!musicTrackColNames.has('play_count')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN play_count INTEGER DEFAULT 0`);
            console.log('[DB] 已添加列 music_tracks.play_count（累计播放次数）');
            try {
                db.exec(`
                    UPDATE music_tracks SET play_count = COALESCE((
                        SELECT COUNT(*) FROM play_history h WHERE h.music_id = music_tracks.id
                    ), 0)
                    WHERE COALESCE(play_count, 0) = 0
                `);
                console.log('[DB] 已用 play_history 条数回填 play_count（历史下限）');
            } catch (backfillErr) {
                console.warn('[DB] play_count 回填:', backfillErr.message);
            }
        }
        if (!musicTrackColNames.has('voice_url')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN voice_url TEXT`);
            console.log('[DB] 已添加列 music_tracks.voice_url（用户人声音轨）');
        }
        if (!musicTrackColNames.has('reference_audio_url')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN reference_audio_url TEXT`);
            console.log('[DB] 已添加列 music_tracks.reference_audio_url（MiniMax 参考音乐）');
        }
        if (!musicTrackColNames.has('description')) {
            db.exec(`ALTER TABLE music_tracks ADD COLUMN description TEXT`);
            console.log('[DB] 已添加列 music_tracks.description（曲库释义等）');
        }
    } catch (migrateErr) {
        console.warn('[DB] music_tracks 迁移 audio_duration_ms:', migrateErr.message);
    }

    try {
        const ccCols = db.prepare(`PRAGMA table_info(community_comments)`).all();
        const ccNames = new Set(ccCols.map((c) => c.name));
        if (!ccNames.has('parent_id')) {
            db.exec(`ALTER TABLE community_comments ADD COLUMN parent_id TEXT`);
            console.log('[DB] 已添加列 community_comments.parent_id（楼中楼）');
        }
        if (!ccNames.has('reply_to_user_id')) {
            db.exec(`ALTER TABLE community_comments ADD COLUMN reply_to_user_id TEXT`);
            console.log('[DB] 已添加列 community_comments.reply_to_user_id（被回复用户）');
        }
        if (!ccNames.has('likes')) {
            db.exec(`ALTER TABLE community_comments ADD COLUMN likes INTEGER DEFAULT 0`);
            console.log('[DB] 已添加列 community_comments.likes（评论点赞数）');
        }
    } catch (migrateCcErr) {
        console.warn('[DB] community_comments 楼中楼字段迁移:', migrateCcErr.message);
    }

    try {
        const ensureUserCol = (name, ddl) => {
            const cols = db.prepare(`PRAGMA table_info(users)`).all();
            if (!cols.some((c) => c.name === name)) {
                db.exec(ddl);
                console.log(`[DB] 已添加列 users.${name}`);
            }
        };
        ensureUserCol('shop_token', `ALTER TABLE users ADD COLUMN shop_token TEXT`);
        ensureUserCol('shop_sn', `ALTER TABLE users ADD COLUMN shop_sn TEXT`);
        ensureUserCol('wx_app_id', `ALTER TABLE users ADD COLUMN wx_app_id TEXT`);
    } catch (migrateShopErr) {
        console.warn('[DB] users 商城字段迁移:', migrateShopErr.message);
    }

    try {
        const cols = db.prepare(`PRAGMA table_info(card_shares)`).all();
        const names = new Set(cols.map((c) => c.name));
        if (!names.has('artist_bg_image')) {
            db.exec(`ALTER TABLE card_shares ADD COLUMN artist_bg_image TEXT`);
            console.log('[DB] 已添加列 card_shares.artist_bg_image（贺卡背景模板图）');
        }
        if (!names.has('template_id')) {
            db.exec(`ALTER TABLE card_shares ADD COLUMN template_id TEXT`);
            console.log('[DB] 已添加列 card_shares.template_id（官方贺卡模板 ID）');
        }
        if (!names.has('saved_to_library')) {
            db.exec(`ALTER TABLE card_shares ADD COLUMN saved_to_library INTEGER DEFAULT 0`);
            console.log('[DB] 已添加列 card_shares.saved_to_library（用户手动保存到作品库）');
        }
    } catch (migrateCardErr) {
        console.warn('[DB] card_shares 迁移 artist_bg_image:', migrateCardErr.message);
    }

    try {
        const tplCols = db.prepare(`PRAGMA table_info(card_templates)`).all();
        const tplNames = new Set(tplCols.map((c) => c.name));
        if (!tplNames.has('text_layout')) {
            db.exec(`ALTER TABLE card_templates ADD COLUMN text_layout TEXT`);
            console.log('[DB] 已添加列 card_templates.text_layout（贺卡文字区 JSON）');
        }
        if (!tplNames.has('chars_per_line')) {
            db.exec(`ALTER TABLE card_templates ADD COLUMN chars_per_line INTEGER`);
            console.log('[DB] 已添加列 card_templates.chars_per_line（祝福语每行字数）');
        }
    } catch (migrateTplLayoutErr) {
        console.warn('[DB] card_templates 迁移 text_layout:', migrateTplLayoutErr.message);
    }

    try {
        cardTemplates.syncCardTemplatesFromManifest(db);
    } catch (syncTplErr) {
        console.warn('[DB] 贺卡模板同步:', syncTplErr.message);
    }

    try {
        mediaSecStore.ensureMediaSecTable(db);
    } catch (mediaSecErr) {
        console.warn('[DB] media_sec_tasks:', mediaSecErr.message);
    }

    try {
        channelService.initChannelModule(db);
    } catch (channelErr) {
        console.warn('[DB] 渠道换皮表:', channelErr.message);
    }

    console.log('[DB] 数据库初始化完成');
}

module.exports = { initDatabase };
