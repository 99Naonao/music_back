/**
 * 运营弹窗 DB 表 + 从 promo-data 种子
 */
const { ACTIVE_CAMPAIGNS } = require('../promo-data');

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS promo_campaigns (
            id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    const count = db.prepare('SELECT COUNT(*) AS c FROM promo_campaigns').get().c;
    if (count > 0) return;

    const ins = db.prepare(
        `INSERT INTO promo_campaigns (id, payload_json, enabled, priority, updated_at)
         VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`
    );
    for (const c of ACTIVE_CAMPAIGNS) {
        const payload = { ...c };
        const enabled = payload.enabled !== false ? 1 : 0;
        const priority = payload.priority != null ? payload.priority : 0;
        delete payload.enabled;
        ins.run(c.id, JSON.stringify(payload), enabled, priority);
    }
    console.log(`[DB migration] promo_campaigns 已种子 ${ACTIVE_CAMPAIGNS.length} 条`);
}

module.exports = { up };
