/**
 * 增量列迁移（idempotent，可安全重复逻辑已由 PRAGMA 守卫）
 */
function hasColumn(db, table, column) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
}

function addColumnIfMissing(db, table, column, ddl) {
    if (!hasColumn(db, table, column)) {
        db.exec(ddl);
        console.log(`[DB migration] 已添加列 ${table}.${column}`);
    }
}

function up(db) {
    addColumnIfMissing(
        db,
        'sound_effects',
        'use_reference_music',
        `ALTER TABLE sound_effects ADD COLUMN use_reference_music INTEGER DEFAULT 0`
    );
    addColumnIfMissing(
        db,
        'sound_effects',
        'reference_audio_url',
        `ALTER TABLE sound_effects ADD COLUMN reference_audio_url TEXT`
    );

    addColumnIfMissing(
        db,
        'music_tracks',
        'audio_duration_ms',
        `ALTER TABLE music_tracks ADD COLUMN audio_duration_ms INTEGER`
    );
    addColumnIfMissing(
        db,
        'music_tracks',
        'player_cover_url',
        `ALTER TABLE music_tracks ADD COLUMN player_cover_url TEXT`
    );
    addColumnIfMissing(
        db,
        'music_tracks',
        'play_count',
        `ALTER TABLE music_tracks ADD COLUMN play_count INTEGER DEFAULT 0`
    );
    if (hasColumn(db, 'music_tracks', 'play_count')) {
        try {
            db.exec(`
                UPDATE music_tracks SET play_count = COALESCE((
                    SELECT COUNT(*) FROM play_history h WHERE h.music_id = music_tracks.id
                ), 0)
                WHERE COALESCE(play_count, 0) = 0
            `);
        } catch (backfillErr) {
            console.warn('[DB migration] play_count 回填:', backfillErr.message);
        }
    }
    addColumnIfMissing(db, 'music_tracks', 'voice_url', `ALTER TABLE music_tracks ADD COLUMN voice_url TEXT`);
    addColumnIfMissing(
        db,
        'music_tracks',
        'reference_audio_url',
        `ALTER TABLE music_tracks ADD COLUMN reference_audio_url TEXT`
    );
    addColumnIfMissing(
        db,
        'music_tracks',
        'description',
        `ALTER TABLE music_tracks ADD COLUMN description TEXT`
    );

    addColumnIfMissing(
        db,
        'community_comments',
        'parent_id',
        `ALTER TABLE community_comments ADD COLUMN parent_id TEXT`
    );
    addColumnIfMissing(
        db,
        'community_comments',
        'reply_to_user_id',
        `ALTER TABLE community_comments ADD COLUMN reply_to_user_id TEXT`
    );
    addColumnIfMissing(
        db,
        'community_comments',
        'likes',
        `ALTER TABLE community_comments ADD COLUMN likes INTEGER DEFAULT 0`
    );

    addColumnIfMissing(db, 'users', 'shop_token', `ALTER TABLE users ADD COLUMN shop_token TEXT`);
    addColumnIfMissing(db, 'users', 'shop_sn', `ALTER TABLE users ADD COLUMN shop_sn TEXT`);
    addColumnIfMissing(db, 'users', 'wx_app_id', `ALTER TABLE users ADD COLUMN wx_app_id TEXT`);

    addColumnIfMissing(
        db,
        'card_shares',
        'artist_bg_image',
        `ALTER TABLE card_shares ADD COLUMN artist_bg_image TEXT`
    );
    addColumnIfMissing(
        db,
        'card_shares',
        'template_id',
        `ALTER TABLE card_shares ADD COLUMN template_id TEXT`
    );
    addColumnIfMissing(
        db,
        'card_shares',
        'saved_to_library',
        `ALTER TABLE card_shares ADD COLUMN saved_to_library INTEGER DEFAULT 0`
    );

    addColumnIfMissing(
        db,
        'card_templates',
        'text_layout',
        `ALTER TABLE card_templates ADD COLUMN text_layout TEXT`
    );
    addColumnIfMissing(
        db,
        'card_templates',
        'chars_per_line',
        `ALTER TABLE card_templates ADD COLUMN chars_per_line INTEGER`
    );
}

module.exports = { up };
