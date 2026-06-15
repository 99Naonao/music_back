/**
 * 热路径 COUNT / feed 查询索引（idempotent）
 */
function up(db) {
    const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_music_tracks_user_status ON music_tracks(user_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_community_posts_user ON community_posts(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read)',
        'CREATE INDEX IF NOT EXISTS idx_play_history_user_played ON play_history(user_id, played_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_points_history_user_created ON points_history(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id)',
        'CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id)',
        'CREATE INDEX IF NOT EXISTS idx_community_likes_post ON community_likes(post_id)',
        'CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id)',
        'CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id)'
    ];
    for (const sql of indexes) {
        db.exec(sql);
    }
    console.log('[DB migration] 003: 性能索引已就绪');
}

module.exports = { up };
