/**
 * 运营弹窗：DB 存储 + 静态 fallback（promo-data.js）
 */
const { getDb } = require('../bootstrap/database');
const { ACTIVE_CAMPAIGNS, filterPromoCampaigns } = require('../promo-data');

function hasPromoTable(db) {
    return !!db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_campaigns'")
        .get();
}

function parsePayload(row) {
    try {
        const obj = JSON.parse(row.payload_json || '{}');
        if (row.enabled === 0) obj.enabled = false;
        else if (obj.enabled === undefined) obj.enabled = true;
        if (row.priority != null && obj.priority == null) obj.priority = row.priority;
        return obj;
    } catch (e) {
        return null;
    }
}

function loadCampaignsFromDb(db) {
    if (!hasPromoTable(db)) return null;
    const rows = db
        .prepare(
            `SELECT id, payload_json, enabled, priority FROM promo_campaigns ORDER BY priority DESC, id ASC`
        )
        .all();
    if (!rows.length) return null;
    return rows.map(parsePayload).filter(Boolean);
}

function getAllCampaigns(db) {
    const fromDb = loadCampaignsFromDb(db);
    if (fromDb) return fromDb;
    return ACTIVE_CAMPAIGNS.filter((c) => c.enabled !== false);
}

function getPromoCampaignsForScene(scene, channelId) {
    const db = getDb();
    const list = getAllCampaigns(db);
    return filterPromoCampaigns(list, scene, channelId);
}

function seedFromStatic(db) {
    if (!hasPromoTable(db)) return 0;
    const count = db.prepare('SELECT COUNT(*) AS c FROM promo_campaigns').get().c;
    if (count > 0) return 0;

    const ins = db.prepare(
        `INSERT INTO promo_campaigns (id, payload_json, enabled, priority, updated_at)
         VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`
    );
    let n = 0;
    for (const c of ACTIVE_CAMPAIGNS) {
        const payload = { ...c };
        const enabled = payload.enabled !== false ? 1 : 0;
        const priority = payload.priority != null ? payload.priority : 0;
        delete payload.enabled;
        ins.run(c.id, JSON.stringify(payload), enabled, priority);
        n += 1;
    }
    return n;
}

module.exports = {
    getPromoCampaignsForScene,
    getAllCampaigns,
    loadCampaignsFromDb,
    seedFromStatic,
    hasPromoTable,
    parsePayload
};
