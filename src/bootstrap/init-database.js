const { getDb } = require('./database');
const cardTemplates = require('../card-template-service');
const mediaSecStore = require('../media-sec-store');
const channelService = require('../channel-service');

const { runMigrations } = require('./run-migrations');

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

    runMigrations(db);

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
