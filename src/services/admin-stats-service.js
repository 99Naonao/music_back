const { ErrorCode } = require('../error-codes');
const channelAnalytics = require('./channel-analytics-service');
const channelService = require('../channel-service');

const READ_ROLES = new Set(['super', 'operator', 'readonly', 'partner']);
const METRICS = new Set(['dau', 'new_bindings', 'music_completed', 'cards_created']);

function statChannelId(raw) {
    return channelAnalytics.statChannelId(raw);
}

function parseDateStr(raw) {
    const s = raw != null ? String(raw).trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
}

function todayStr(db) {
    return db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;
}

function defaultRange(db) {
    const to = todayStr(db);
    const from = db.prepare(`SELECT date('now', 'localtime', '-6 days') AS d`).get().d;
    return { from, to };
}

function resolveRange(db, query) {
    const def = defaultRange(db);
    const from = parseDateStr(query && query.from) || def.from;
    const to = parseDateStr(query && query.to) || def.to;
    if (from > to) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'from 不能晚于 to' };
    }
    return { ok: true, from, to };
}

function resolveChannelFilter(adminUser, channelRaw) {
    if (adminUser.role === 'partner') {
        if (!adminUser.partnerChannelId) {
            return { ok: false, error: ErrorCode.FORBIDDEN, message: 'partner 账号未绑定渠道' };
        }
        return { ok: true, channelId: statChannelId(adminUser.partnerChannelId), forced: true };
    }
    const raw = channelRaw != null ? String(channelRaw).trim() : '';
    if (!raw || raw === 'all') {
        return { ok: true, channelId: '', forced: false };
    }
    const id = statChannelId(raw);
    if (id === 'default' && raw !== 'default') {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道参数无效' };
    }
    return { ok: true, channelId: id, forced: false };
}

function assertStatsRead(adminUser) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function channelNameMap(db) {
    const rows = db.prepare('SELECT id, name FROM channels').all();
    const map = { default: '默认渠道' };
    rows.forEach((r) => {
        map[r.id] = r.name || r.id;
    });
    return map;
}

function queryAggregatedRows(db, from, to, channelId) {
    if (channelId) {
        return db
            .prepare(
                `SELECT stat_date, channel_id, dau, new_bindings, music_completed, cards_created
                 FROM daily_channel_stats
                 WHERE stat_date >= ? AND stat_date <= ? AND channel_id = ?
                 ORDER BY stat_date ASC`
            )
            .all(from, to, channelId);
    }
    return db
        .prepare(
            `SELECT stat_date,
                    channel_id,
                    dau,
                    new_bindings,
                    music_completed,
                    cards_created
             FROM daily_channel_stats
             WHERE stat_date >= ? AND stat_date <= ?
             ORDER BY stat_date ASC, channel_id ASC`
        )
        .all(from, to);
}

function sumByDate(rows, channelId) {
    const map = {};
    rows.forEach((r) => {
        const d = r.stat_date;
        if (!map[d]) {
            map[d] = { dau: 0, newBindings: 0, musicCompleted: 0, cardsCreated: 0 };
        }
        if (channelId && r.channel_id !== channelId) return;
        map[d].dau += r.dau || 0;
        map[d].newBindings += r.new_bindings || 0;
        map[d].musicCompleted += r.music_completed || 0;
        map[d].cardsCreated += r.cards_created || 0;
    });
    return map;
}

function sumRange(totals) {
    return Object.values(totals).reduce(
        (acc, row) => ({
            dau: acc.dau + row.dau,
            newBindings: acc.newBindings + row.newBindings,
            musicCompleted: acc.musicCompleted + row.musicCompleted,
            cardsCreated: acc.cardsCreated + row.cardsCreated
        }),
        { dau: 0, newBindings: 0, musicCompleted: 0, cardsCreated: 0 }
    );
}

function countFeedback(db, from, to) {
    const row = db
        .prepare(
            `SELECT COUNT(*) AS c FROM user_feedback
             WHERE date(created_at) >= ? AND date(created_at) <= ?`
        )
        .get(from, to);
    return row ? row.c || 0 : 0;
}

function liveDaySnapshot(db, statDate, channelId) {
    const agg = channelAnalytics.aggregateDailyStats(db, statDate);
    if (channelId) {
        const hit = (agg.channels || []).find((c) => c.channelId === channelId);
        return hit || { dau: 0, newBindings: 0, musicCompleted: 0, cardsCreated: 0 };
    }
    return (agg.channels || []).reduce(
        (acc, c) => ({
            dau: acc.dau + (c.dau || 0),
            newBindings: acc.newBindings + (c.newBindings || 0),
            musicCompleted: acc.musicCompleted + (c.musicCompleted || 0),
            cardsCreated: acc.cardsCreated + (c.cardsCreated || 0)
        }),
        { dau: 0, newBindings: 0, musicCompleted: 0, cardsCreated: 0 }
    );
}

function mergeTodayLive(db, byDate, to, channelId) {
    const today = todayStr(db);
    if (to < today) return byDate;
    const live = liveDaySnapshot(db, today, channelId || '');
    return {
        ...byDate,
        [today]: {
            dau: live.dau || 0,
            newBindings: live.newBindings || 0,
            musicCompleted: live.musicCompleted || 0,
            cardsCreated: live.cardsCreated || 0
        }
    };
}

function metricValue(row, metric) {
    if (metric === 'dau') return row.dau || 0;
    if (metric === 'new_bindings') return row.newBindings || 0;
    if (metric === 'music_completed') return row.musicCompleted || 0;
    if (metric === 'cards_created') return row.cardsCreated || 0;
    return 0;
}

function pctChange(current, baseline) {
    const cur = Number(current) || 0;
    const base = Number(baseline) || 0;
    if (base === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - base) / base) * 1000) / 10;
}

function getDayMetrics(db, date, channelId) {
    const rows = queryAggregatedRows(db, date, date, channelId || null);
    let byDate = sumByDate(rows, channelId || '');
    byDate = mergeTodayLive(db, byDate, date, channelId || '');
    const row = byDate[date] || {
        dau: 0,
        newBindings: 0,
        musicCompleted: 0,
        cardsCreated: 0
    };
    return row;
}

function getTodayCompare(db, adminUser, query) {
    const auth = assertStatsRead(adminUser);
    if (!auth.ok) return auth;

    const ch = resolveChannelFilter(adminUser, query && query.channel);
    if (!ch.ok) return ch;

    const today = todayStr(db);
    const yesterday = db.prepare(`SELECT date('now', 'localtime', '-1 day') AS d`).get().d;
    const lastWeek = db.prepare(`SELECT date('now', 'localtime', '-7 days') AS d`).get().d;

    const channelId = ch.channelId || '';
    const todayRow = getDayMetrics(db, today, channelId);
    const yesterdayRow = getDayMetrics(db, yesterday, channelId);
    const lastWeekRow = getDayMetrics(db, lastWeek, channelId);

    return {
        ok: true,
        data: {
            today: todayRow,
            yesterdayDau: yesterdayRow.dau || 0,
            compare: {
                dauVsYesterday: pctChange(todayRow.dau, yesterdayRow.dau),
                dauVsLastWeek: pctChange(todayRow.dau, lastWeekRow.dau),
                newBindingsVsYesterday: pctChange(todayRow.newBindings, yesterdayRow.newBindings),
                musicCompletedVsYesterday: pctChange(todayRow.musicCompleted, yesterdayRow.musicCompleted)
            }
        }
    };
}

function getChannelDetail(db, adminUser, channelIdRaw, query) {
    const auth = assertStatsRead(adminUser);
    if (!auth.ok) return auth;

    const channelId = statChannelId(String(channelIdRaw || '').trim());
    if (!channelId) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道无效' };
    }

    const ch = resolveChannelFilter(adminUser, channelId);
    if (!ch.ok) return ch;

    const effectiveId = ch.channelId || channelId;
    const names = channelNameMap(db);
    const channelRow = db
        .prepare(
            `SELECT id, name, status, contract_start, contract_end, updated_at
             FROM channels WHERE id = ?`
        )
        .get(effectiveId);

    const range = resolveRange(db, query);
    if (!range.ok) return range;

    const overview = getOverview(db, adminUser, {
        ...query,
        from: range.from,
        to: range.to,
        channel: effectiveId
    });
    if (!overview.ok) return overview;

    const ts = getTimeseries(db, adminUser, {
        ...query,
        from: range.from,
        to: range.to,
        channel: effectiveId,
        metric: (query && query.metric) || 'dau'
    });
    if (!ts.ok) return ts;

    return {
        ok: true,
        data: {
            channel: channelRow
                ? {
                      id: channelRow.id,
                      name: channelRow.name,
                      status: channelRow.status,
                      contractStart: channelRow.contract_start,
                      contractEnd: channelRow.contract_end,
                      updatedAt: channelRow.updated_at
                  }
                : { id: effectiveId, name: names[effectiveId] || effectiveId },
            from: range.from,
            to: range.to,
            overview: overview.data,
            timeseries: ts.data
        }
    };
}

function getOverview(db, adminUser, query) {
    const auth = assertStatsRead(adminUser);
    if (!auth.ok) return auth;

    const range = resolveRange(db, query);
    if (!range.ok) return range;

    const ch = resolveChannelFilter(adminUser, query && query.channel);
    if (!ch.ok) return ch;

    const rows = queryAggregatedRows(db, range.from, range.to, ch.channelId || null);
    let byDate = sumByDate(rows, ch.channelId || '');
    byDate = mergeTodayLive(db, byDate, range.to, ch.channelId || '');

    const totals = sumRange(byDate);
    const today = todayStr(db);
    const todayRow = byDate[today] || {
        dau: 0,
        newBindings: 0,
        musicCompleted: 0,
        cardsCreated: 0
    };

    const yesterday = db.prepare(`SELECT date('now', 'localtime', '-1 day') AS d`).get().d;
    const lastWeek = db.prepare(`SELECT date('now', 'localtime', '-7 days') AS d`).get().d;
    const yesterdayRow = getDayMetrics(db, yesterday, ch.channelId || '');
    const lastWeekRow = getDayMetrics(db, lastWeek, ch.channelId || '');

    let pendingFeedback = 0;
    try {
        pendingFeedback = db
            .prepare(
                `SELECT COUNT(*) AS c FROM user_feedback WHERE status IN ('pending', 'processing')`
            )
            .get().c;
    } catch (e) {
        pendingFeedback = countFeedback(db, range.from, range.to);
    }

    return {
        ok: true,
        data: {
            from: range.from,
            to: range.to,
            channelId: ch.channelId || 'all',
            today: {
                dau: todayRow.dau,
                newBindings: todayRow.newBindings,
                musicCompleted: todayRow.musicCompleted,
                cardsCreated: todayRow.cardsCreated
            },
            compare: {
                dauVsYesterday: pctChange(todayRow.dau, yesterdayRow.dau),
                dauVsLastWeek: pctChange(todayRow.dau, lastWeekRow.dau),
                newBindingsVsYesterday: pctChange(todayRow.newBindings, yesterdayRow.newBindings),
                musicCompletedVsYesterday: pctChange(
                    todayRow.musicCompleted,
                    yesterdayRow.musicCompleted
                )
            },
            rangeTotals: totals,
            feedbackCount: countFeedback(db, range.from, range.to),
            pendingFeedback
        }
    };
}

function getTimeseries(db, adminUser, query) {
    const auth = assertStatsRead(adminUser);
    if (!auth.ok) return auth;

    const metric = query && query.metric ? String(query.metric).trim() : 'dau';
    if (!METRICS.has(metric)) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'metric 无效' };
    }

    const range = resolveRange(db, query);
    if (!range.ok) return range;

    const ch = resolveChannelFilter(adminUser, query && query.channel);
    if (!ch.ok) return ch;

    const rows = queryAggregatedRows(db, range.from, range.to, ch.channelId || null);
    let byDate = sumByDate(rows, ch.channelId || '');
    byDate = mergeTodayLive(db, byDate, range.to, ch.channelId || '');

    const dates = [];
    let cur = range.from;
    while (cur <= range.to) {
        dates.push(cur);
        const next = db.prepare(`SELECT date(?, '+1 day') AS d`).get(cur).d;
        cur = next;
    }

    const points = dates.map((d) => ({
        date: d,
        value: metricValue(byDate[d] || {}, metric)
    }));

    return {
        ok: true,
        data: {
            metric,
            from: range.from,
            to: range.to,
            channelId: ch.channelId || 'all',
            points
        }
    };
}

function getChannelsRanking(db, adminUser, query) {
    const auth = assertStatsRead(adminUser);
    if (!auth.ok) return auth;

    const range = resolveRange(db, query);
    if (!range.ok) return range;

    const ch = resolveChannelFilter(adminUser, query && query.channel);
    if (!ch.ok) return ch;

    const names = channelNameMap(db);

    if (ch.channelId) {
        const rows = queryAggregatedRows(db, range.from, range.to, ch.channelId);
        const byDate = sumByDate(rows, ch.channelId);
        const merged = mergeTodayLive(db, byDate, range.to, ch.channelId);
        const totals = sumRange(merged);
        return {
            ok: true,
            data: {
                from: range.from,
                to: range.to,
                list: [
                    {
                        channelId: ch.channelId,
                        channelName: names[ch.channelId] || ch.channelId,
                        ...totals
                    }
                ]
            }
        };
    }

    let rows = db
        .prepare(
            `SELECT channel_id,
                    SUM(dau) AS dau,
                    SUM(new_bindings) AS new_bindings,
                    SUM(music_completed) AS music_completed,
                    SUM(cards_created) AS cards_created
             FROM daily_channel_stats
             WHERE stat_date >= ? AND stat_date <= ?
             GROUP BY channel_id
             ORDER BY SUM(dau) DESC, channel_id ASC`
        )
        .all(range.from, range.to);

    const today = todayStr(db);
    if (range.to >= today) {
        const live = channelAnalytics.aggregateDailyStats(db, today);
        const liveMap = Object.fromEntries(
            (live.channels || []).map((c) => [c.channelId, c])
        );
        const aggMap = Object.fromEntries(rows.map((r) => [r.channel_id, r]));

        const ids = new Set([...rows.map((r) => r.channel_id), ...Object.keys(liveMap)]);
        rows = [...ids].map((id) => {
            const prev = aggMap[id] || {
                channel_id: id,
                dau: 0,
                new_bindings: 0,
                music_completed: 0,
                cards_created: 0
            };
            const liveRow = liveMap[id];
            if (!liveRow) return prev;
            const hadToday = db
                .prepare(
                    `SELECT 1 FROM daily_channel_stats WHERE stat_date = ? AND channel_id = ?`
                )
                .get(today, id);
            if (hadToday) return prev;
            return {
                channel_id: id,
                dau: (prev.dau || 0) + (liveRow.dau || 0),
                new_bindings: (prev.new_bindings || 0) + (liveRow.newBindings || 0),
                music_completed: (prev.music_completed || 0) + (liveRow.musicCompleted || 0),
                cards_created: (prev.cards_created || 0) + (liveRow.cardsCreated || 0)
            };
        });
        rows.sort((a, b) => (b.dau || 0) - (a.dau || 0));
    }

    return {
        ok: true,
        data: {
            from: range.from,
            to: range.to,
            list: rows.map((r) => ({
                channelId: r.channel_id,
                channelName: names[r.channel_id] || r.channel_id,
                dau: r.dau || 0,
                newBindings: r.new_bindings || 0,
                musicCompleted: r.music_completed || 0,
                cardsCreated: r.cards_created || 0
            }))
        }
    };
}

function listChannelOptions(db, adminUser) {
    const auth = assertStatsRead(adminUser);
    if (!auth.ok) return auth;

    if (adminUser.role === 'partner' && adminUser.partnerChannelId) {
        const id = statChannelId(adminUser.partnerChannelId);
        const row = db.prepare('SELECT id, name FROM channels WHERE id = ?').get(id);
        return {
            ok: true,
            data: {
                list: [{ id, name: (row && row.name) || id }]
            }
        };
    }

    const rows = db.prepare('SELECT id, name FROM channels ORDER BY id ASC').all();
    return {
        ok: true,
        data: {
            list: [{ id: 'all', name: '全部渠道' }].concat(
                rows.map((r) => ({ id: r.id, name: r.name || r.id }))
            )
        }
    };
}

module.exports = {
    getOverview,
    getTimeseries,
    getChannelsRanking,
    listChannelOptions,
    getTodayCompare,
    getChannelDetail,
    resolveRange,
    resolveChannelFilter
};
