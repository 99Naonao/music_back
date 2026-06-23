const { ErrorCode } = require('../error-codes');
const promoCampaignService = require('./promo-campaign-service');
const { getPromoCampaignsForScene } = require('../promo-data');

const READ_ROLES = new Set(['super', 'operator', 'readonly']);
const WRITE_ROLES = new Set(['super', 'operator']);

const PROMO_SCENES = [
    { id: 'home_show', label: '首页展示' },
    { id: 'complete_show', label: '完成页' },
    { id: 'player_show', label: '播放器' },
    { id: 'mine_show', label: '我的' },
    { id: 'community_show', label: '社区' },
    { id: 'after_card_share', label: '贺卡分享后' },
    { id: 'after_generate', label: '生成后' }
];

const PROMO_TYPES = [
    { id: 'rich', label: '富文本弹窗' },
    { id: 'banner', label: '横幅' },
    { id: 'image', label: '图片' }
];

const PROMO_RULES = [
    { id: '', label: '无规则（始终可展示）' },
    { id: 'inactive_visit', label: '久未访问' },
    { id: 'inactive_login', label: '久未登录' },
    { id: 'inactive_card', label: '久未做贺卡' },
    { id: 'inactive_music', label: '久未生成音乐' },
    { id: 'inactive_community', label: '久未发帖' },
    { id: 'first_visit', label: '首次访问' }
];

const LINK_TYPES = [
    { id: 'navigateTo', label: 'navigateTo' },
    { id: 'switchTab', label: 'switchTab' },
    { id: 'redirectTo', label: 'redirectTo' }
];

function assertRead(adminUser) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function assertWrite(adminUser) {
    if (!adminUser || !WRITE_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function listCampaigns(db, adminUser) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const rows = db
        .prepare(
            `SELECT id, payload_json, enabled, priority, updated_at AS updatedAt
             FROM promo_campaigns ORDER BY priority DESC, id ASC`
        )
        .all();

    const list = rows.map((r) => {
        const payload = promoCampaignService.parsePayload(r) || {};
        return {
            id: r.id,
            enabled: r.enabled !== 0,
            priority: r.priority,
            updatedAt: r.updatedAt,
            title: payload.title || r.id,
            type: payload.type,
            scenes: payload.scenes || [],
            payload
        };
    });

    return { ok: true, data: { list } };
}

function getCampaign(db, adminUser, id) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const cid = String(id || '').trim();
    const row = db.prepare('SELECT * FROM promo_campaigns WHERE id = ?').get(cid);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '活动不存在' };
    }

    const payload = promoCampaignService.parsePayload(row) || {};
    return {
        ok: true,
        data: {
            id: row.id,
            enabled: row.enabled !== 0,
            priority: row.priority,
            updatedAt: row.updated_at,
            payload
        }
    };
}

function upsertCampaign(db, adminUser, id, body) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const cid = String(id || body.id || '').trim();
    if (!cid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'id 不能为空' };
    }

    const payload = body.payload || body;
    if (!payload || typeof payload !== 'object') {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'payload 无效' };
    }

    const enabled =
        body.enabled !== undefined
            ? body.enabled !== false && body.enabled !== 0
            : payload.enabled !== false;
    const priority =
        body.priority != null
            ? Number(body.priority)
            : payload.priority != null
              ? Number(payload.priority)
              : 0;

    const toStore = { ...payload, id: cid };
    delete toStore.enabled;

    db.prepare(
        `INSERT INTO promo_campaigns (id, payload_json, enabled, priority, updated_at)
         VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           enabled = excluded.enabled,
           priority = excluded.priority,
           updated_at = datetime('now', 'localtime')`
    ).run(cid, JSON.stringify(toStore), enabled ? 1 : 0, priority);

    return {
        ok: true,
        data: { id: cid, enabled, priority },
        message: '活动已保存'
    };
}

function patchCampaignStatus(db, adminUser, id, body) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const cid = String(id || '').trim();
    const row = db.prepare('SELECT id FROM promo_campaigns WHERE id = ?').get(cid);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '活动不存在' };
    }

    const enabled = body.enabled !== false && body.enabled !== 0;
    const priority = body.priority != null ? Number(body.priority) : undefined;

    if (priority != null && !Number.isNaN(priority)) {
        db.prepare(
            `UPDATE promo_campaigns SET enabled = ?, priority = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(enabled ? 1 : 0, priority, cid);
    } else {
        db.prepare(
            `UPDATE promo_campaigns SET enabled = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(enabled ? 1 : 0, cid);
    }

    return { ok: true, data: { id: cid, enabled }, message: '状态已更新' };
}

function getMeta() {
    return {
        ok: true,
        data: {
            scenes: PROMO_SCENES,
            types: PROMO_TYPES,
            rules: PROMO_RULES,
            linkTypes: LINK_TYPES
        }
    };
}

function simulatePreview(db, adminUser, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const scene = query && query.scene ? String(query.scene).trim() : 'home_show';
    const channel = query && query.channel ? String(query.channel).trim() : 'default';

    const list = getPromoCampaignsForScene(scene, channel);
    const winner = list.length ? list[0] : null;

    return {
        ok: true,
        data: {
            scene,
            channel,
            matchedCount: list.length,
            winner,
            candidates: list.slice(0, 5)
        }
    };
}

function getCampaignStats(db, adminUser, promoIdRaw, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const promoId = String(promoIdRaw || '').trim();
    if (!promoId) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'promoId 无效' };
    }

    const days = Math.min(90, Math.max(1, parseInt(query && query.days, 10) || 30));
    const since = db
        .prepare(`SELECT date('now', 'localtime', ?) AS d`)
        .get(`-${days - 1} days`).d;

    const rows = db
        .prepare(
            `SELECT event_type, COUNT(*) AS cnt
             FROM biz_events
             WHERE event_type LIKE 'promo.%'
               AND date(created_at) >= ?
               AND json_extract(payload_json, '$.promoId') = ?
             GROUP BY event_type`
        )
        .all(since, promoId);

    const byAction = {};
    let total = 0;
    rows.forEach((r) => {
        const action = String(r.event_type).replace(/^promo\./, '');
        byAction[action] = r.cnt;
        total += r.cnt;
    });

    const exposures = byAction.show || byAction.exposure || 0;
    const clicks = byAction.click || byAction.confirm || 0;
    const dismisses = byAction.dismiss || byAction.close || 0;
    const ctr = exposures > 0 ? Math.round((clicks / exposures) * 1000) / 10 : null;

    const daily = db
        .prepare(
            `SELECT date(created_at) AS statDate, event_type, COUNT(*) AS cnt
             FROM biz_events
             WHERE event_type LIKE 'promo.%'
               AND date(created_at) >= ?
               AND json_extract(payload_json, '$.promoId') = ?
             GROUP BY date(created_at), event_type
             ORDER BY statDate ASC`
        )
        .all(since, promoId);

    return {
        ok: true,
        data: {
            promoId,
            days,
            since,
            total,
            exposures,
            clicks,
            dismisses,
            ctr,
            byAction,
            daily
        }
    };
}

module.exports = {
    listCampaigns,
    getCampaign,
    upsertCampaign,
    patchCampaignStatus,
    getMeta,
    simulatePreview,
    getCampaignStats,
    PROMO_SCENES
};
