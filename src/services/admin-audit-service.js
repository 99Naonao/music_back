const { ErrorCode } = require('../error-codes');

const READ_ROLES = new Set(['super', 'operator', 'readonly']);

function assertRead(adminUser) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function listAuditLogs(db, adminUser, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const page = Math.max(1, parseInt(query && query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query && query.limit, 10) || 30));
    const offset = (page - 1) * limit;

    const from = query && query.from ? String(query.from).trim() : '';
    const to = query && query.to ? String(query.to).trim() : '';
    const action = query && query.action ? String(query.action).trim() : '';

    let where = '1=1';
    const params = [];

    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
        where += ' AND date(a.created_at) >= ?';
        params.push(from);
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        where += ' AND date(a.created_at) <= ?';
        params.push(to);
    }
    if (action) {
        where += ' AND a.action LIKE ? ESCAPE \'\\\'';
        params.push(`%${action.replace(/[%_\\]/g, '\\$&')}%`);
    }

    const total = db
        .prepare(`SELECT COUNT(*) AS c FROM admin_audit_logs a WHERE ${where}`)
        .get(...params).c;

    const rows = db
        .prepare(
            `SELECT a.id, a.admin_user_id, a.action, a.target_type, a.target_id,
                    a.detail_json, a.ip, a.created_at, u.username
             FROM admin_audit_logs a
             LEFT JOIN admin_users u ON u.id = a.admin_user_id
             WHERE ${where}
             ORDER BY a.id DESC
             LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

    return {
        ok: true,
        data: {
            list: rows.map((r) => ({
                id: r.id,
                adminUserId: r.admin_user_id,
                username: r.username || r.admin_user_id || '—',
                action: r.action,
                targetType: r.target_type,
                targetId: r.target_id,
                detail: r.detail_json ? JSON.parse(r.detail_json) : null,
                ip: r.ip,
                createdAt: r.created_at
            })),
            total,
            page,
            limit
        }
    };
}

module.exports = { listAuditLogs };
