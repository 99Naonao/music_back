const { ErrorCode } = require('../error-codes');
const adminStatsService = require('./admin-stats-service');
const channelAnalytics = require('./channel-analytics-service');

const READ_ROLES = new Set(['super', 'operator', 'readonly', 'partner']);

const FUNNEL_STEPS = [
    { key: 'launch', label: '启动 (DAU)' },
    { key: 'login', label: '登录用户' },
    { key: 'music_start', label: '发起生成' },
    { key: 'music_complete', label: '生成完成' },
    { key: 'card', label: '贺卡/分享卡' },
    { key: 'share', label: '贺卡分享' }
];

function assertRead(adminUser) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function channelSql(alias, channelId) {
    if (!channelId) return { clause: '', params: [] };
    const col = alias ? `${alias}.channel_id` : 'channel_id';
    return { clause: ` AND ${col} = ?`, params: [channelId] };
}

function musicChannelSql(channelId) {
    if (!channelId) return { clause: '', params: [] };
    return {
        clause: ` AND COALESCE(NULLIF(TRIM(source_channel), ''), 'default') = ?`,
        params: [channelId]
    };
}

function countLaunch(db, from, to, channelId) {
    const ch = channelSql('', channelId);
    const row = db
        .prepare(
            `SELECT COUNT(DISTINCT visitor_key) AS cnt
             FROM daily_active_visitors
             WHERE stat_date >= ? AND stat_date <= ?${ch.clause}`
        )
        .get(from, to, ...ch.params);
    return row ? row.cnt : 0;
}

function countLoginUsers(db, from, to, channelId) {
    const ch = channelSql('', channelId);
    const row = db
        .prepare(
            `SELECT COUNT(DISTINCT user_id) AS cnt
             FROM daily_active_visitors
             WHERE stat_date >= ? AND stat_date <= ?
               AND user_id IS NOT NULL AND TRIM(user_id) != ''${ch.clause}`
        )
        .get(from, to, ...ch.params);
    return row ? row.cnt : 0;
}

function countMusicStart(db, from, to, channelId) {
    const ch = musicChannelSql(channelId);
    const row = db
        .prepare(
            `SELECT COUNT(*) AS cnt FROM music_tracks
             WHERE user_id != 'system'
               AND status != 'cancelled'
               AND date(created_at) >= ? AND date(created_at) <= ?${ch.clause}`
        )
        .get(from, to, ...ch.params);
    return row ? row.cnt : 0;
}

function countMusicComplete(db, from, to, channelId) {
    const ch = musicChannelSql(channelId);
    const row = db
        .prepare(
            `SELECT COUNT(*) AS cnt FROM music_tracks
             WHERE user_id != 'system'
               AND status = 'completed'
               AND date(created_at) >= ? AND date(created_at) <= ?${ch.clause}`
        )
        .get(from, to, ...ch.params);
    return row ? row.cnt : 0;
}

function countCards(db, from, to, channelId) {
    const ch = musicChannelSql(channelId);
    const g = db
        .prepare(
            `SELECT COUNT(*) AS cnt FROM greeting_cards
             WHERE date(created_at) >= ? AND date(created_at) <= ?${ch.clause}`
        )
        .get(from, to, ...ch.params);
    const s = db
        .prepare(
            `SELECT COUNT(*) AS cnt FROM card_shares
             WHERE date(created_at) >= ? AND date(created_at) <= ?${ch.clause}`
        )
        .get(from, to, ...ch.params);
    return (g?.cnt || 0) + (s?.cnt || 0);
}

function countShares(db, from, to, channelId) {
    const ch = musicChannelSql(channelId);
    const row = db
        .prepare(
            `SELECT COUNT(*) AS cnt FROM card_shares
             WHERE date(created_at) >= ? AND date(created_at) <= ?${ch.clause}`
        )
        .get(from, to, ...ch.params);
    return row ? row.cnt : 0;
}

function getFunnel(db, adminUser, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const range = adminStatsService.resolveRange(db, query);
    if (!range.ok) return range;

    const ch = adminStatsService.resolveChannelFilter(adminUser, query && query.channel);
    if (!ch.ok) return ch;

    const channelId = ch.channelId || '';
    const { from, to } = range;

    const counts = {
        launch: countLaunch(db, from, to, channelId || null),
        login: countLoginUsers(db, from, to, channelId || null),
        music_start: countMusicStart(db, from, to, channelId || null),
        music_complete: countMusicComplete(db, from, to, channelId || null),
        card: countCards(db, from, to, channelId || null),
        share: countShares(db, from, to, channelId || null)
    };

    const base = counts.launch || 1;
    const steps = FUNNEL_STEPS.map((s) => ({
        key: s.key,
        label: s.label,
        count: counts[s.key] || 0,
        rateFromLaunch: counts.launch
            ? Math.round(((counts[s.key] || 0) / counts.launch) * 1000) / 10
            : null
    }));

    return {
        ok: true,
        data: {
            from,
            to,
            channelId: channelId || 'all',
            steps,
            counts
        }
    };
}

function getRetention(db, adminUser, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const ch = adminStatsService.resolveChannelFilter(adminUser, query && query.channel);
    if (!ch.ok) return ch;

    const channelId = ch.channelId || '';
    const cohortDateRaw = query && query.cohortDate ? String(query.cohortDate).trim() : '';
    const cohortDate =
        /^\d{4}-\d{2}-\d{2}$/.test(cohortDateRaw)
            ? cohortDateRaw
            : db.prepare(`SELECT date('now', 'localtime', '-7 days') AS d`).get().d;

    const chClause = channelSql('', channelId || null);
    const cohortRow = db
        .prepare(
            `SELECT COUNT(DISTINCT visitor_key) AS cnt
             FROM daily_active_visitors
             WHERE stat_date = ?${chClause.clause}`
        )
        .get(cohortDate, ...chClause.params);
    const cohortSize = cohortRow ? cohortRow.cnt : 0;

    function retainedOn(offsetDays) {
        if (!cohortSize) return { count: 0, rate: null, date: null };
        const targetDate = db.prepare(`SELECT date(?, ?) AS d`).get(cohortDate, `+${offsetDays} days`).d;
        let sql = `SELECT COUNT(DISTINCT d1.visitor_key) AS cnt
             FROM daily_active_visitors d1
             INNER JOIN daily_active_visitors d2
               ON d1.visitor_key = d2.visitor_key AND d1.channel_id = d2.channel_id
             WHERE d1.stat_date = ? AND d2.stat_date = ?`;
        const params = [cohortDate, targetDate];
        if (channelId) {
            sql += ' AND d1.channel_id = ?';
            params.push(channelId);
        }
        const row = db.prepare(sql).get(...params);
        const count = row ? row.cnt : 0;
        return {
            count,
            rate: Math.round((count / cohortSize) * 1000) / 10,
            date: targetDate
        };
    }

    return {
        ok: true,
        data: {
            cohortDate,
            channelId: channelId || 'all',
            cohortSize,
            d1: retainedOn(1),
            d3: retainedOn(3),
            d7: retainedOn(7)
        }
    };
}

module.exports = {
    getFunnel,
    getRetention,
    FUNNEL_STEPS
};
