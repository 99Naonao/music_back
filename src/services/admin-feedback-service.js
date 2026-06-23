const { ErrorCode } = require('../error-codes');

const READ_ROLES = new Set(['super', 'operator', 'readonly']);
const WRITE_ROLES = new Set(['super', 'operator']);
const FEEDBACK_STATUSES = new Set(['pending', 'processing', 'resolved', 'ignored']);

function assertRead(adminUser) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function assertWrite(adminUser) {
    if (!adminUser || !WRITE_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN, message: '当前账号无权处理反馈' };
    }
    return { ok: true };
}

function listFeedback(db, adminUser, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const page = Math.max(1, parseInt(query && query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query && query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const status = query && query.status ? String(query.status).trim() : '';

    let where = '1=1';
    const params = [];
    if (status && FEEDBACK_STATUSES.has(status)) {
        where += ' AND status = ?';
        params.push(status);
    }

    const total = db.prepare(`SELECT COUNT(*) AS c FROM user_feedback WHERE ${where}`).get(...params).c;
    const list = db
        .prepare(
            `SELECT id, user_id, wx_openid, nickname, feedback_type, content, contact,
                    status, admin_note, handled_by, handled_at, created_at
             FROM user_feedback WHERE ${where}
             ORDER BY created_at DESC LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset);

    const pendingCount = db
        .prepare(
            `SELECT COUNT(*) AS c FROM user_feedback WHERE status IN ('pending', 'processing')`
        )
        .get().c;

    return {
        ok: true,
        data: {
            list,
            total,
            page,
            limit,
            pendingCount
        }
    };
}

function updateFeedback(db, adminUser, id, body) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const fid = id != null ? String(id).trim() : '';
    if (!fid) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'id 不能为空' };
    }

    const row = db.prepare('SELECT id FROM user_feedback WHERE id = ?').get(fid);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '反馈不存在' };
    }

    const status =
        body && body.status != null ? String(body.status).trim() : undefined;
    if (status !== undefined && !FEEDBACK_STATUSES.has(status)) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'status 无效' };
    }

    const adminNote =
        body && body.adminNote !== undefined ? String(body.adminNote || '').slice(0, 500) : undefined;

    const sets = [];
    const params = [];

    if (status !== undefined) {
        sets.push('status = ?');
        params.push(status);
        sets.push('handled_by = ?');
        params.push(adminUser.username);
        sets.push(`handled_at = datetime('now', 'localtime')`);
    }
    if (adminNote !== undefined) {
        sets.push('admin_note = ?');
        params.push(adminNote || null);
    }

    if (!sets.length) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '无更新字段' };
    }

    db.prepare(`UPDATE user_feedback SET ${sets.join(', ')} WHERE id = ?`).run(...params, fid);

    const updated = db
        .prepare(
            `SELECT id, status, admin_note, handled_by, handled_at FROM user_feedback WHERE id = ?`
        )
        .get(fid);

    return {
        ok: true,
        data: {
            id: updated.id,
            status: updated.status,
            adminNote: updated.admin_note,
            handledBy: updated.handled_by,
            handledAt: updated.handled_at
        },
        message: '反馈已更新'
    };
}

module.exports = {
    listFeedback,
    updateFeedback,
    FEEDBACK_STATUSES
};
