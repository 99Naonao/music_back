const { ErrorCode } = require('../error-codes');
const adminStatsService = require('./admin-stats-service');

const READ_ROLES = new Set(['super', 'operator', 'readonly', 'partner']);

function assertRead(adminUser) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function countPendingFeedback(db) {
    const row = db
        .prepare(
            `SELECT COUNT(*) AS c FROM user_feedback WHERE status IN ('pending', 'processing')`
        )
        .get();
    return row ? row.c || 0 : 0;
}

function listZeroDauChannels(db, days) {
    const n = Math.min(30, Math.max(1, parseInt(days, 10) || 7));
    const from = db.prepare(`SELECT date('now', 'localtime', ?) AS d`).get(`-${n - 1} days`).d;

    const channels = db
        .prepare(`SELECT id, name FROM channels WHERE status = 'active' ORDER BY id ASC`)
        .all();

    return channels
        .filter((ch) => {
            const row = db
                .prepare(
                    `SELECT COALESCE(SUM(dau), 0) AS total
                     FROM daily_channel_stats
                     WHERE channel_id = ? AND stat_date >= ?`
                )
                .get(ch.id, from);
            return (row && row.total) === 0;
        })
        .map((c) => ({ id: c.id, name: c.name }));
}

function listExpiringContracts(db, withinDays) {
    const n = Math.min(90, Math.max(1, parseInt(withinDays, 10) || 30));
    return db
        .prepare(
            `SELECT id, name, contract_end AS contractEnd, status
             FROM channels
             WHERE contract_end IS NOT NULL AND TRIM(contract_end) != ''
               AND date(contract_end) <= date('now', 'localtime', ?)
               AND date(contract_end) >= date('now', 'localtime')
             ORDER BY contract_end ASC`
        )
        .all(`+${n} days`);
}

function getWorkbench(db, adminUser) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const compare = adminStatsService.getTodayCompare(db, adminUser, {});
    if (!compare.ok) return compare;

    const zeroDau = adminUser.role === 'partner' ? [] : listZeroDauChannels(db, 7);
    const expiring = adminUser.role === 'partner' ? [] : listExpiringContracts(db, 30);

    return {
        ok: true,
        data: {
            pendingFeedback: countPendingFeedback(db),
            zeroDauChannels: zeroDau,
            expiringContracts: expiring,
            today: compare.data.today,
            compare: compare.data.compare,
            yesterdayDau: compare.data.yesterdayDau
        }
    };
}

module.exports = {
    getWorkbench,
    countPendingFeedback
};
