const { getDb } = require('../bootstrap/database');

function findUserIdByOpenid(openid) {
    const row = getDb().prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
    return row ? row.id : null;
}

function getUserPointsRow(userId) {
    return getDb().prepare('SELECT * FROM user_points WHERE user_id = ?').get(userId);
}

function initUserPoints(userId) {
    getDb()
        .prepare('INSERT INTO user_points (user_id, points, total_points) VALUES (?, 0, 0)')
        .run(userId);
    return { points: 0, total_points: 0 };
}

function addPointsBalance(userId, pointsNum) {
    getDb()
        .prepare(
            `UPDATE user_points SET points = points + ?, total_points = total_points + ?,
             updated_at = datetime('now', 'localtime') WHERE user_id = ?`
        )
        .run(pointsNum, pointsNum, userId);
}

function deductPointsBalance(userId, pointsNum) {
    getDb()
        .prepare(
            `UPDATE user_points SET points = points - ?,
             updated_at = datetime('now', 'localtime') WHERE user_id = ?`
        )
        .run(pointsNum, userId);
}

function insertPointsHistory(id, userId, signedPoints, type, description) {
    getDb()
        .prepare(
            'INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)'
        )
        .run(id, userId, signedPoints, type, description != null ? String(description) : '');
}

function listPointsHistory(userId, limit, offset, pointsCond) {
    const db = getDb();
    const list = db
        .prepare(
            `SELECT * FROM points_history WHERE user_id = ?${pointsCond}
             ORDER BY created_at DESC LIMIT ? OFFSET ?`
        )
        .all(userId, limit, offset);
    const countRow = db
        .prepare(`SELECT COUNT(*) as total FROM points_history WHERE user_id = ?${pointsCond}`)
        .get(userId);
    const sums = db
        .prepare(
            `SELECT
                COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 0 END), 0) AS totalIncome,
                COALESCE(SUM(CASE WHEN points < 0 THEN -points ELSE 0 END), 0) AS totalExpense
             FROM points_history WHERE user_id = ?`
        )
        .get(userId);
    return { list, total: countRow.total, summary: sums };
}

function hasDailyClaim(userId, taskKey, claimDate) {
    const row = getDb()
        .prepare(
            `SELECT 1 AS ok FROM daily_task_claims WHERE user_id = ? AND task_key = ? AND claim_date = ?`
        )
        .get(userId, taskKey, claimDate);
    return !!(row && row.ok);
}

function listDailyClaimsForDate(userId, claimDate) {
    return getDb()
        .prepare(`SELECT task_key FROM daily_task_claims WHERE user_id = ? AND claim_date = ?`)
        .all(userId, claimDate);
}

function insertDailyClaim(userId, taskKey, claimDate, points) {
    getDb()
        .prepare(
            `INSERT INTO daily_task_claims (user_id, task_key, claim_date, points) VALUES (?, ?, ?, ?)`
        )
        .run(userId, taskKey, claimDate, points);
}

module.exports = {
    findUserIdByOpenid,
    getUserPointsRow,
    initUserPoints,
    addPointsBalance,
    deductPointsBalance,
    insertPointsHistory,
    listPointsHistory,
    hasDailyClaim,
    listDailyClaimsForDate,
    insertDailyClaim
};
