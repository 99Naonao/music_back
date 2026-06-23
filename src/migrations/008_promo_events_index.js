/**
 * 弹窗埋点写入 biz_events（供 Admin 效果统计）
 */
function up(db) {
    db.exec(
        'CREATE INDEX IF NOT EXISTS idx_biz_events_promo ON biz_events(event_type, created_at)'
    );
}

module.exports = { up };
