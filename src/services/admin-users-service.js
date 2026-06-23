const { ErrorCode } = require('../error-codes');
const adminAuthService = require('./admin-auth-service');
const { hashPassword, verifyPassword } = require('../utils/admin-password');

function assertSuper(adminUser) {
    if (!adminUser || adminUser.role !== 'super') {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function listAdmins(db, adminUser) {
    const auth = assertSuper(adminUser);
    if (!auth.ok) return auth;

    const rows = db
        .prepare(
            `SELECT id, username, role, partner_channel_id, is_active, last_login_at, created_at
             FROM admin_users ORDER BY created_at ASC`
        )
        .all();

    return {
        ok: true,
        data: {
            list: rows.map((r) => adminAuthService.sanitizeAdminUser(r))
        }
    };
}

function createAdmin(db, adminUser, body, meta) {
    const auth = assertSuper(adminUser);
    if (!auth.ok) return auth;

    try {
        const result = adminAuthService.upsertAdminUser({
            username: body.username,
            password: body.password,
            role: body.role || 'operator',
            partnerChannelId: body.partnerChannelId
        });

        adminAuthService.insertAuditLog({
            adminUserId: adminUser.id,
            action: 'admin.user.create',
            targetType: 'admin_user',
            targetId: result.id,
            detailJson: { username: result.username, role: body.role || 'operator' },
            ip: meta && meta.ip
        });

        const row = adminAuthService.findAdminById(result.id);
        return {
            ok: true,
            data: { user: adminAuthService.sanitizeAdminUser(row) },
            message: result.created ? '管理员已创建' : '管理员已更新'
        };
    } catch (err) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: err.message };
    }
}

function patchAdmin(db, adminUser, targetId, body, meta) {
    const auth = assertSuper(adminUser);
    if (!auth.ok) return auth;

    const id = String(targetId || '').trim();
    const row = adminAuthService.findAdminById(id);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '用户不存在' };
    }

    if (id === adminUser.id && body.isActive === false) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '不能禁用当前登录账号' };
    }

    const updates = [];
    const params = [];

    if (body.role != null) {
        const role = String(body.role).trim();
        if (!adminAuthService.VALID_ROLES.has(role)) {
            return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '角色无效' };
        }
        if (role === 'partner' && !body.partnerChannelId && !row.partner_channel_id) {
            return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'partner 须指定渠道' };
        }
        updates.push('role = ?');
        params.push(role);
    }

    if (body.partnerChannelId !== undefined) {
        updates.push('partner_channel_id = ?');
        params.push(body.partnerChannelId || null);
    }

    if (body.isActive !== undefined) {
        updates.push('is_active = ?');
        params.push(body.isActive === false || body.isActive === 0 ? 0 : 1);
    }

    if (body.password) {
        const pwd = String(body.password);
        if (pwd.length < 8) {
            return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '密码至少 8 位' };
        }
        updates.push('password_hash = ?');
        params.push(hashPassword(pwd));
    }

    if (!updates.length) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '无有效更新字段' };
    }

    params.push(id);
    db.prepare(`UPDATE admin_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    adminAuthService.insertAuditLog({
        adminUserId: adminUser.id,
        action: 'admin.user.patch',
        targetType: 'admin_user',
        targetId: id,
        detailJson: {
            role: body.role,
            isActive: body.isActive,
            resetPassword: !!body.password
        },
        ip: meta && meta.ip
    });

    return {
        ok: true,
        data: { user: adminAuthService.sanitizeAdminUser(adminAuthService.findAdminById(id)) },
        message: '已更新'
    };
}

function changePassword(db, adminUser, body, meta) {
    if (!adminUser) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const current = body && body.currentPassword != null ? String(body.currentPassword) : '';
    const next = body && body.newPassword != null ? String(body.newPassword) : '';

    if (!current || !next) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '请填写当前密码与新密码' };
    }
    if (next.length < 8) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '新密码至少 8 位' };
    }

    const row = adminAuthService.findAdminByUsername(adminUser.username);
    if (!row || !verifyPassword(current, row.password_hash)) {
        return { ok: false, error: ErrorCode.UNAUTHORIZED, message: '当前密码不正确' };
    }

    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(
        hashPassword(next),
        adminUser.id
    );

    adminAuthService.insertAuditLog({
        adminUserId: adminUser.id,
        action: 'admin.password.change',
        targetType: 'admin_user',
        targetId: adminUser.id,
        ip: meta && meta.ip
    });

    return { ok: true, message: '密码已修改' };
}

module.exports = {
    listAdmins,
    createAdmin,
    patchAdmin,
    changePassword
};
