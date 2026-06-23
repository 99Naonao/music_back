/**
 * 分渠道埋点：启动 DAU、业务事件、日聚合（供 M2 看板 / 定时任务）
 */
const channelService = require('../channel-service');

function statChannelId(raw) {
    const id = channelService.normalizeChannelId(raw);
    return id === channelService.DEFAULT_CHANNEL_ID ? 'default' : id;
}

function resolveChannelFromRequest(db, req, bodyChannel) {
    const fromBody =
        bodyChannel != null && String(bodyChannel).trim()
            ? channelService.normalizeChannelId(bodyChannel)
            : '';
    if (fromBody && fromBody !== channelService.DEFAULT_CHANNEL_ID) {
        return statChannelId(fromBody);
    }
    const resolved = channelService.resolveSourceChannel(db, req);
    return statChannelId(resolved || channelService.DEFAULT_CHANNEL_ID);
}

function normalizeVisitorKey(raw) {
    const s = raw != null ? String(raw).trim() : '';
    if (!s || s.length > 128) return '';
    return s.slice(0, 128);
}

function visitorKeyForRequest(req, body) {
    if (req.user && req.user.id) {
        return `u:${req.user.id}`;
    }
    const fromBody = normalizeVisitorKey(body && body.visitorKey);
    if (fromBody) return `d:${fromBody}`;
    return '';
}

function insertBizEvent(db, row) {
    db.prepare(
        `INSERT INTO biz_events (event_type, channel_id, user_id, visitor_key, payload_json)
         VALUES (?, ?, ?, ?, ?)`
    ).run(
        row.eventType,
        statChannelId(row.channelId),
        row.userId || null,
        row.visitorKey || null,
        row.payloadJson != null ? JSON.stringify(row.payloadJson) : null
    );
}

function recordAppLaunch(db, req, body) {
    const channelId = resolveChannelFromRequest(db, req, body && body.channel);
    const visitorKey = visitorKeyForRequest(req, body || {});
    const userId = req.user && req.user.id ? req.user.id : null;

    if (!visitorKey) {
        return { ok: false, reason: 'missing_visitor_key' };
    }

    const statDate = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;

    insertBizEvent(db, {
        eventType: 'app.launch',
        channelId,
        userId,
        visitorKey,
        payloadJson: {
            scene: body && body.scene != null ? String(body.scene) : '',
            path: body && body.path != null ? String(body.path).slice(0, 200) : ''
        }
    });

    db.prepare(
        `INSERT OR IGNORE INTO daily_active_visitors (stat_date, channel_id, visitor_key, user_id)
         VALUES (?, ?, ?, ?)`
    ).run(statDate, channelId, visitorKey, userId);

    return { ok: true, channelId, statDate };
}

function recordChannelBind(db, userId, channelIdRaw, source, options) {
    const channelId = statChannelId(channelIdRaw);
    if (channelId === 'default') return;

    const isNew = !!(options && options.isNewBinding);
    if (!isNew) return;

    insertBizEvent(db, {
        eventType: 'channel.bind',
        channelId,
        userId,
        visitorKey: userId ? `u:${userId}` : null,
        payloadJson: { source: source || 'client' }
    });
}

function formatLocalDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function aggregateDailyStats(db, statDateInput) {
    const statDate =
        statDateInput ||
        db.prepare(`SELECT date('now', 'localtime', '-1 day') AS d`).get().d;

    const channels = new Set(['default']);

    const dauRows = db
        .prepare(
            `SELECT channel_id, COUNT(*) AS cnt
             FROM daily_active_visitors
             WHERE stat_date = ?
             GROUP BY channel_id`
        )
        .all(statDate);
    dauRows.forEach((r) => channels.add(r.channel_id));

    const bindRows = db
        .prepare(
            `SELECT channel_id, COUNT(*) AS cnt
             FROM user_channel_bindings
             WHERE date(bound_at) = ?
             GROUP BY channel_id`
        )
        .all(statDate);
    bindRows.forEach((r) => channels.add(statChannelId(r.channel_id)));

    const musicRows = db
        .prepare(
            `SELECT COALESCE(NULLIF(TRIM(source_channel), ''), 'default') AS channel_id, COUNT(*) AS cnt
             FROM music_tracks
             WHERE status = 'completed' AND date(created_at) = ?
             GROUP BY COALESCE(NULLIF(TRIM(source_channel), ''), 'default')`
        )
        .all(statDate);
    musicRows.forEach((r) => channels.add(statChannelId(r.channel_id)));

    const cardRows = db
        .prepare(
            `SELECT COALESCE(NULLIF(TRIM(source_channel), ''), 'default') AS channel_id, COUNT(*) AS cnt
             FROM card_shares
             WHERE date(created_at) = ?
             GROUP BY COALESCE(NULLIF(TRIM(source_channel), ''), 'default')`
        )
        .all(statDate);
    cardRows.forEach((r) => channels.add(statChannelId(r.channel_id)));

    const greetingRows = db
        .prepare(
            `SELECT COALESCE(NULLIF(TRIM(source_channel), ''), 'default') AS channel_id, COUNT(*) AS cnt
             FROM greeting_cards
             WHERE date(created_at) = ?
             GROUP BY COALESCE(NULLIF(TRIM(source_channel), ''), 'default')`
        )
        .all(statDate);
    greetingRows.forEach((r) => channels.add(statChannelId(r.channel_id)));

    const dauMap = Object.fromEntries(dauRows.map((r) => [r.channel_id, r.cnt]));
    const bindMap = Object.fromEntries(
        bindRows.map((r) => [statChannelId(r.channel_id), r.cnt])
    );
    const musicMap = Object.fromEntries(
        musicRows.map((r) => [statChannelId(r.channel_id), r.cnt])
    );
    const cardMap = Object.fromEntries(
        cardRows.map((r) => [statChannelId(r.channel_id), r.cnt])
    );
    const greetingMap = Object.fromEntries(
        greetingRows.map((r) => [statChannelId(r.channel_id), r.cnt])
    );

    const upsert = db.prepare(
        `INSERT INTO daily_channel_stats (stat_date, channel_id, dau, new_bindings, music_completed, cards_created)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(stat_date, channel_id) DO UPDATE SET
           dau = excluded.dau,
           new_bindings = excluded.new_bindings,
           music_completed = excluded.music_completed,
           cards_created = excluded.cards_created`
    );

    const results = [];
    for (const channelId of channels) {
        const cid = statChannelId(channelId);
        const cardsCreated = (cardMap[cid] || 0) + (greetingMap[cid] || 0);
        upsert.run(
            statDate,
            cid,
            dauMap[cid] || 0,
            bindMap[cid] || 0,
            musicMap[cid] || 0,
            cardsCreated
        );
        results.push({
            channelId: cid,
            dau: dauMap[cid] || 0,
            newBindings: bindMap[cid] || 0,
            musicCompleted: musicMap[cid] || 0,
            cardsCreated
        });
    }

    return { statDate, channels: results };
}

module.exports = {
    statChannelId,
    resolveChannelFromRequest,
    recordAppLaunch,
    recordChannelBind,
    aggregateDailyStats,
    formatLocalDate
};
