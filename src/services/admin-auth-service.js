const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../bootstrap/database');
const { hashPassword, verifyPassword } = require('../utils/admin-password');

const VALID_ROLES = new Set(['super', 'operator', 'readonly', 'partner']);
const SESSION_COOKIE = 'admin_sid';

function sessionTtlHours() {
    const n = parseInt(process.env.ADMIN_SESSION_TTL_HOURS, 10);
    return Number.isFinite(n) && n > 0 ? n : 168;
}

function findAdminByUsername(username) {
    const name = username != null ? String(username).trim() : '';
    if (!name) return null;
    return getDb()
        .prepare(
            `SELECT id, username, password_hash, role, partner_channel_id, is_active, last_login_at, created_at
             FROM admin_users WHERE username = ? COLLATE NOCASE`
        )
        .get(name);
}

function findAdminById(adminId) {
    if (!adminId) return null;
    return getDb()
        .prepare(
            `SELECT id, username, role, partner_channel_id, is_active, last_login_at, created_at
             FROM admin_users WHERE id = ?`
        )
        .get(adminId);
}

function sanitizeAdminUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        role: row.role,
        partnerChannelId: row.partner_channel_id || null,
        isActive: !!row.is_active,
        lastLoginAt: row.last_login_at || null,
        createdAt: row.created_at || null
    };
}

function insertAuditLog(entry) {
    getDb()
        .prepare(
            `INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, detail_json, ip)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
            entry.adminUserId || null,
            entry.action,
            entry.targetType || null,
            entry.targetId || null,
            entry.detailJson != null ? JSON.stringify(entry.detailJson) : null,
            entry.ip || null
        );
}

function createSession(adminUserId, meta) {
    const db = getDb();
    const sessionId = uuidv4();
    const ttlH = sessionTtlHours();
    db.prepare(
        `INSERT INTO admin_sessions (id, admin_user_id, expires_at, ip, user_agent)
         VALUES (?, ?, datetime('now', 'localtime', ?), ?, ?)`
    ).run(
        sessionId,
        adminUserId,
        `+${ttlH} hours`,
        (meta && meta.ip) || null,
        meta && meta.userAgent ? String(meta.userAgent).slice(0, 512) : null
    );
    db.prepare(`UPDATE admin_users SET last_login_at = datetime('now', 'localtime') WHERE id = ?`).run(
        adminUserId
    );
    return { sessionId, maxAgeSec: ttlH * 3600 };
}

function findValidSession(sessionId) {
    const sid = sessionId != null ? String(sessionId).trim() : '';
    if (!sid) return null;
    const row = getDb()
        .prepare(
            `SELECT s.id AS session_id, s.admin_user_id, s.expires_at,
                    u.username, u.role, u.partner_channel_id, u.is_active
             FROM admin_sessions s
             INNER JOIN admin_users u ON u.id = s.admin_user_id
             WHERE s.id = ?
               AND datetime(s.expires_at) > datetime('now', 'localtime')
               AND u.is_active = 1`
        )
        .get(sid);
    if (!row) return null;
    return {
        sessionId: row.session_id,
        adminUser: sanitizeAdminUser({
            id: row.admin_user_id,
            username: row.username,
            role: row.role,
            partner_channel_id: row.partner_channel_id,
            is_active: row.is_active
        })
    };
}

function deleteSession(sessionId) {
    const sid = sessionId != null ? String(sessionId).trim() : '';
    if (!sid) return;
    getDb().prepare('DELETE FROM admin_sessions WHERE id = ?').run(sid);
}

function login(username, password, meta) {
    const user = findAdminByUsername(username);
    if (!user || !user.is_active) {
        insertAuditLog({
            action: 'admin.login_failed',
            detailJson: { username: String(username || '').slice(0, 64) },
            ip: meta && meta.ip
        });
        return { ok: false, reason: 'invalid_credentials' };
    }
    if (!verifyPassword(password, user.password_hash)) {
        insertAuditLog({
            adminUserId: user.id,
            action: 'admin.login_failed',
            detailJson: { username: user.username },
            ip: meta && meta.ip
        });
        return { ok: false, reason: 'invalid_credentials' };
    }

    const session = createSession(user.id, meta);
    insertAuditLog({
        adminUserId: user.id,
        action: 'admin.login',
        ip: meta && meta.ip
    });
    return {
        ok: true,
        sessionId: session.sessionId,
        maxAgeSec: session.maxAgeSec,
        user: sanitizeAdminUser(user)
    };
}

function logout(sessionId, meta) {
    const found = findValidSession(sessionId);
    deleteSession(sessionId);
    if (found && found.adminUser) {
        insertAuditLog({
            adminUserId: found.adminUser.id,
            action: 'admin.logout',
            ip: meta && meta.ip
        });
    }
    return { ok: true };
}

function upsertAdminUser(payload) {
    const username = payload.username != null ? String(payload.username).trim() : '';
    const password = payload.password != null ? String(payload.password) : '';
    const role = payload.role != null ? String(payload.role).trim() : 'operator';
    const partnerChannelId =
        payload.partnerChannelId != null ? String(payload.partnerChannelId).trim() : '';

    if (!username || username.length < 3) {
        throw new Error('用户名至少 3 个字符');
    }
    if (!password || password.length < 8) {
        throw new Error('密码至少 8 个字符');
    }
    if (!VALID_ROLES.has(role)) {
        throw new Error(`无效角色: ${role}`);
    }
    if (role === 'partner' && !partnerChannelId) {
        throw new Error('partner 角色须指定 partnerChannelId');
    }

    const db = getDb();
    const existing = findAdminByUsername(username);
    const passwordHash = hashPassword(password);

    if (existing) {
        db.prepare(
            `UPDATE admin_users
             SET password_hash = ?, role = ?, partner_channel_id = ?, is_active = 1
             WHERE id = ?`
        ).run(
            passwordHash,
            role,
            role === 'partner' ? partnerChannelId : null,
            existing.id
        );
        return { id: existing.id, username: existing.username, created: false };
    }

    const id = uuidv4();
    db.prepare(
        `INSERT INTO admin_users (id, username, password_hash, role, partner_channel_id, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`
    ).run(id, username, passwordHash, role, role === 'partner' ? partnerChannelId : null);
    return { id, username, created: true };
}

module.exports = {
    SESSION_COOKIE,
    sessionTtlHours,
    findAdminByUsername,
    findAdminById,
    sanitizeAdminUser,
    findValidSession,
    login,
    logout,
    upsertAdminUser,
    insertAuditLog,
    VALID_ROLES
};
