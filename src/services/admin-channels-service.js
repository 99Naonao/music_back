const { ErrorCode } = require('../error-codes');
const channelService = require('../channel-service');
const adminAuthService = require('./admin-auth-service');
const adminStatsService = require('./admin-stats-service');

const WRITE_ROLES = new Set(['super', 'operator']);
const READ_ROLES = new Set(['super', 'operator', 'readonly', 'partner']);

function assertChannelId(idRaw) {
    const id = channelService.normalizeChannelId(idRaw);
    if (!id || id === channelService.DEFAULT_CHANNEL_ID) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道 ID 无效（2～48 位字母数字_-，且不能为 default）' };
    }
    if (id !== String(idRaw || '').trim()) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道 ID 格式无效' };
    }
    return { ok: true, channelId: id };
}

function canReadChannel(adminUser, channelId) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) return false;
    if (adminUser.role === 'partner') {
        return adminUser.partnerChannelId === channelId;
    }
    return true;
}

function canWriteChannel(adminUser, channelId) {
    if (!adminUser || !WRITE_ROLES.has(adminUser.role)) return false;
    if (adminUser.role === 'partner') {
        return adminUser.partnerChannelId === channelId;
    }
    return true;
}

function mapChannelRow(row, brandingRow) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        status: row.status || 'draft',
        contractStart: row.contract_start || null,
        contractEnd: row.contract_end || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        brandingVersion: brandingRow && brandingRow.version != null ? Number(brandingRow.version) : 0
    };
}

function brandingRowToAdmin(brandingRow, channelRow) {
    const payload = channelService.getBrandingForChannel(
        require('../bootstrap/database').getDb(),
        channelRow.id
    );
    return {
        splashImageUrl: (brandingRow && brandingRow.splash_image_url) || '',
        splashTitle: (brandingRow && brandingRow.splash_title) || '',
        splashSubtitle: (brandingRow && brandingRow.splash_subtitle) || '',
        splashSlogan: (brandingRow && brandingRow.splash_slogan) || '',
        logoUrl: (brandingRow && brandingRow.logo_url) || '',
        shareImageUrl: (brandingRow && brandingRow.share_image_url) || '',
        themePresetId: (brandingRow && brandingRow.theme_preset_id) || 'deep_sleep_post',
        themeVariant: (brandingRow && brandingRow.theme_variant) || 'dawn',
        primaryColor: (brandingRow && brandingRow.primary_color) || '',
        navBg: (brandingRow && brandingRow.nav_bg) || '',
        navFront: (brandingRow && brandingRow.nav_front) || '',
        tabSelected: (brandingRow && brandingRow.tab_selected) || '',
        tabColor: (brandingRow && brandingRow.tab_color) || '',
        tabBg: (brandingRow && brandingRow.tab_bg) || '',
        windowBg: (brandingRow && brandingRow.window_bg) || '',
        features: payload.features || { ...channelService.DEFAULT_FEATURES },
        copy: payload.copy || {},
        contact: payload.contact || {},
        version: brandingRow && brandingRow.version != null ? Number(brandingRow.version) : 1,
        preview: payload
    };
}

function listChannels(db, adminUser) {
    if (!adminUser || !READ_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    let rows;
    if (adminUser.role === 'partner' && adminUser.partnerChannelId) {
        rows = db
            .prepare(
                `SELECT id, name, status, contract_start, contract_end, created_at, updated_at
                 FROM channels WHERE id = ? ORDER BY updated_at DESC`
            )
            .all(adminUser.partnerChannelId);
    } else {
        rows = db
            .prepare(
                `SELECT id, name, status, contract_start, contract_end, created_at, updated_at
                 FROM channels ORDER BY updated_at DESC, id ASC`
            )
            .all();
    }

    const list = rows.map((row) => {
        const b = db.prepare('SELECT version FROM channel_branding WHERE channel_id = ?').get(row.id);
        return mapChannelRow(row, b);
    });

    return {
        ok: true,
        data: {
            list,
            themePresets: channelService.channelThemePresets.listChannelThemePresets()
        }
    };
}

function getChannelDetail(db, channelIdRaw, adminUser) {
    const validated = assertChannelId(channelIdRaw);
    if (!validated.ok) return validated;
    const channelId = validated.channelId;

    if (!canReadChannel(adminUser, channelId)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道不存在' };
    }

    const brandingRow = db.prepare('SELECT * FROM channel_branding WHERE channel_id = ?').get(channelId);

    return {
        ok: true,
        data: {
            channel: mapChannelRow(row, brandingRow),
            branding: brandingRowToAdmin(brandingRow, row),
            miniProgramHint: `pages/splash/splash?channel=${encodeURIComponent(channelId)}`
        }
    };
}

function createChannel(db, body, adminUser, meta) {
    if (!adminUser || !WRITE_ROLES.has(adminUser.role) || adminUser.role === 'partner') {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const validated = assertChannelId(body && body.id);
    if (!validated.ok) return validated;
    const channelId = validated.channelId;

    const name = body && body.name != null ? String(body.name).trim() : '';
    if (!name) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '渠道名称不能为空' };
    }

    const exists = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
    if (exists) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道 ID 已存在' };
    }

    const status = body.status != null ? String(body.status).trim() : 'draft';
    if (!['draft', 'active', 'disabled'].includes(status)) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'status 须为 draft/active/disabled' };
    }

    db.prepare(
        `INSERT INTO channels (id, name, status, contract_start, contract_end, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`
    ).run(
        channelId,
        name.slice(0, 64),
        status,
        body.contractStart || null,
        body.contractEnd || null
    );

    db.prepare(
        `INSERT INTO channel_branding (channel_id, theme_preset_id, theme_variant, version)
         VALUES (?, 'deep_sleep_post', 'dawn', 1)`
    ).run(channelId);

    if (body.branding && typeof body.branding === 'object') {
        const br = updateBranding(db, channelId, body.branding, adminUser, meta, { skipAuth: true });
        if (!br.ok) return br;
    }

    adminAuthService.insertAuditLog({
        adminUserId: adminUser.id,
        action: 'channel.create',
        targetType: 'channel',
        targetId: channelId,
        detailJson: { name, status },
        ip: meta && meta.ip
    });

    return getChannelDetail(db, channelId, adminUser);
}

function updateChannel(db, channelIdRaw, body, adminUser, meta) {
    const validated = assertChannelId(channelIdRaw);
    if (!validated.ok) return validated;
    const channelId = validated.channelId;

    if (!canWriteChannel(adminUser, channelId)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道不存在' };
    }

    const name = body && body.name != null ? String(body.name).trim() : row.name;
    if (!name) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '渠道名称不能为空' };
    }

    db.prepare(
        `UPDATE channels SET
           name = ?,
           contract_start = ?,
           contract_end = ?,
           updated_at = datetime('now', 'localtime')
         WHERE id = ?`
    ).run(
        name.slice(0, 64),
        body.contractStart !== undefined ? body.contractStart || null : row.contract_start,
        body.contractEnd !== undefined ? body.contractEnd || null : row.contract_end,
        channelId
    );

    adminAuthService.insertAuditLog({
        adminUserId: adminUser.id,
        action: 'channel.update',
        targetType: 'channel',
        targetId: channelId,
        detailJson: { name },
        ip: meta && meta.ip
    });

    return getChannelDetail(db, channelId, adminUser);
}

function patchChannelStatus(db, channelIdRaw, statusRaw, adminUser, meta) {
    const validated = assertChannelId(channelIdRaw);
    if (!validated.ok) return validated;
    const channelId = validated.channelId;

    if (!canWriteChannel(adminUser, channelId)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const status = statusRaw != null ? String(statusRaw).trim() : '';
    if (!['draft', 'active', 'disabled'].includes(status)) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'status 须为 draft/active/disabled' };
    }

    const row = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道不存在' };
    }

    db.prepare(
        `UPDATE channels SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(status, channelId);

    adminAuthService.insertAuditLog({
        adminUserId: adminUser.id,
        action: 'channel.status',
        targetType: 'channel',
        targetId: channelId,
        detailJson: { status },
        ip: meta && meta.ip
    });

    return getChannelDetail(db, channelId, adminUser);
}

function updateBranding(db, channelIdRaw, body, adminUser, meta, options) {
    const validated = assertChannelId(channelIdRaw);
    if (!validated.ok) return validated;
    const channelId = validated.channelId;

    if (!options || !options.skipAuth) {
        if (!canWriteChannel(adminUser, channelId)) {
            return { ok: false, error: ErrorCode.FORBIDDEN };
        }
    }

    const row = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '渠道不存在' };
    }

    const b = body || {};
    const brandingExists = db
        .prepare('SELECT channel_id, version FROM channel_branding WHERE channel_id = ?')
        .get(channelId);

    const featuresJson =
        b.features != null ? JSON.stringify(b.features) : undefined;
    const copyJson = b.copy != null ? JSON.stringify(b.copy) : undefined;

    const presetId = b.themePresetId != null
        ? channelService.channelThemePresets.normalizeChannelPresetId(b.themePresetId)
        : undefined;

    const nextVersion =
        brandingExists && brandingExists.version != null ? Number(brandingExists.version) + 1 : 1;

    if (!brandingExists) {
        db.prepare(`INSERT INTO channel_branding (channel_id, version) VALUES (?, 1)`).run(channelId);
    }

    db.prepare(
        `UPDATE channel_branding SET
           splash_image_url = COALESCE(?, splash_image_url),
           splash_title = COALESCE(?, splash_title),
           splash_subtitle = COALESCE(?, splash_subtitle),
           splash_slogan = COALESCE(?, splash_slogan),
           logo_url = COALESCE(?, logo_url),
           share_image_url = COALESCE(?, share_image_url),
           theme_preset_id = COALESCE(?, theme_preset_id),
           theme_variant = COALESCE(?, theme_variant),
           primary_color = COALESCE(?, primary_color),
           nav_bg = COALESCE(?, nav_bg),
           nav_front = COALESCE(?, nav_front),
           tab_selected = COALESCE(?, tab_selected),
           tab_color = COALESCE(?, tab_color),
           tab_bg = COALESCE(?, tab_bg),
           window_bg = COALESCE(?, window_bg),
           features_json = COALESCE(?, features_json),
           copy_json = COALESCE(?, copy_json),
           contact_phone = COALESCE(?, contact_phone),
           contact_phone_display = COALESCE(?, contact_phone_display),
           contact_email = COALESCE(?, contact_email),
           version = ?,
           updated_at = datetime('now', 'localtime')
         WHERE channel_id = ?`
    ).run(
        b.splashImageUrl !== undefined ? b.splashImageUrl || '' : null,
        b.splashTitle !== undefined ? b.splashTitle || '' : null,
        b.splashSubtitle !== undefined ? b.splashSubtitle || '' : null,
        b.splashSlogan !== undefined ? b.splashSlogan || '' : null,
        b.logoUrl !== undefined ? b.logoUrl || '' : null,
        b.shareImageUrl !== undefined ? b.shareImageUrl || '' : null,
        presetId !== undefined ? presetId : null,
        b.themeVariant !== undefined ? b.themeVariant || 'dawn' : null,
        b.primaryColor !== undefined ? b.primaryColor || '' : null,
        b.navBg !== undefined ? b.navBg || '' : null,
        b.navFront !== undefined ? b.navFront || '' : null,
        b.tabSelected !== undefined ? b.tabSelected || '' : null,
        b.tabColor !== undefined ? b.tabColor || '' : null,
        b.tabBg !== undefined ? b.tabBg || '' : null,
        b.windowBg !== undefined ? b.windowBg || '' : null,
        featuresJson !== undefined ? featuresJson : null,
        copyJson !== undefined ? copyJson : null,
        b.contact && b.contact.phone !== undefined ? b.contact.phone || '' : null,
        b.contact && b.contact.phoneDisplay !== undefined ? b.contact.phoneDisplay || '' : null,
        b.contact && b.contact.email !== undefined ? b.contact.email || '' : null,
        nextVersion,
        channelId
    );

    db.prepare(`UPDATE channels SET updated_at = datetime('now', 'localtime') WHERE id = ?`).run(
        channelId
    );

    if (adminUser) {
        adminAuthService.insertAuditLog({
            adminUserId: adminUser.id,
            action: 'channel.branding.update',
            targetType: 'channel',
            targetId: channelId,
            detailJson: { version: nextVersion },
            ip: meta && meta.ip
        });
    }

    return { ok: true, message: 'Branding 已保存', version: nextVersion };
}

function getChannelHub(db, channelIdRaw, adminUser, query) {
    const detail = getChannelDetail(db, channelIdRaw, adminUser);
    if (!detail.ok) return detail;

    const channelId = detail.data.channel.id;
    const stats = adminStatsService.getChannelDetail(db, adminUser, channelId, {
        ...(query || {}),
        metric: (query && query.metric) || 'dau'
    });
    if (!stats.ok) return stats;

    const audit = listChannelAuditLogs(db, channelId, adminUser, 15);

    return {
        ok: true,
        data: {
            ...detail.data,
            stats: stats.data,
            audit: audit.ok ? audit.data.list : []
        }
    };
}

function copyBrandingFrom(db, targetIdRaw, body, adminUser, meta) {
    const validated = assertChannelId(targetIdRaw);
    if (!validated.ok) return validated;
    const targetId = validated.channelId;

    if (!canWriteChannel(adminUser, targetId)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const sourceValidated = assertChannelId(body && body.sourceChannelId);
    if (!sourceValidated.ok) return sourceValidated;
    const sourceId = sourceValidated.channelId;

    if (sourceId === targetId) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '源渠道与目标相同' };
    }

    const sourceBranding = db
        .prepare('SELECT * FROM channel_branding WHERE channel_id = ?')
        .get(sourceId);
    if (!sourceBranding) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '源渠道 branding 不存在' };
    }

    const targetExists = db.prepare('SELECT id FROM channels WHERE id = ?').get(targetId);
    if (!targetExists) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '目标渠道不存在' };
    }

    const brandingPayload = brandingRowToAdmin(sourceBranding, { id: sourceId });
    const result = updateBranding(db, targetId, brandingPayload, adminUser, meta);
    if (!result.ok) return result;

    adminAuthService.insertAuditLog({
        adminUserId: adminUser.id,
        action: 'channel.branding.copy',
        targetType: 'channel',
        targetId: targetId,
        detailJson: { from: sourceId },
        ip: meta && meta.ip
    });

    return getChannelDetail(db, targetId, adminUser);
}

function batchPatchStatus(db, body, adminUser, meta) {
    if (!adminUser || !WRITE_ROLES.has(adminUser.role) || adminUser.role === 'partner') {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const ids = Array.isArray(body && body.ids) ? body.ids : [];
    const status = body && body.status != null ? String(body.status).trim() : '';
    if (!ids.length) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'ids 不能为空' };
    }
    if (!['draft', 'active', 'disabled'].includes(status)) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'status 无效' };
    }

    const updated = [];
    const failed = [];

    ids.forEach((rawId) => {
        const r = patchChannelStatus(db, rawId, status, adminUser, meta);
        if (r.ok) {
            updated.push(String(rawId).trim());
        } else {
            failed.push({ id: rawId, message: r.message || '失败' });
        }
    });

    adminAuthService.insertAuditLog({
        adminUserId: adminUser.id,
        action: 'channel.batch_status',
        targetType: 'channel',
        targetId: updated.join(','),
        detailJson: { status, count: updated.length },
        ip: meta && meta.ip
    });

    return {
        ok: true,
        data: { updated, failed, status },
        message: `已更新 ${updated.length} 个渠道`
    };
}

function listChannelAuditLogs(db, channelIdRaw, adminUser, limit) {
    const validated = assertChannelId(channelIdRaw);
    if (!validated.ok) return validated;
    const channelId = validated.channelId;

    if (!canReadChannel(adminUser, channelId)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const rows = db
        .prepare(
            `SELECT id, admin_user_id, action, target_type, target_id, detail_json, ip, created_at
             FROM admin_audit_logs
             WHERE target_type = 'channel' AND target_id = ?
             ORDER BY id DESC LIMIT ?`
        )
        .all(channelId, lim);

    return {
        ok: true,
        data: {
            list: rows.map((r) => ({
                id: r.id,
                adminUserId: r.admin_user_id,
                action: r.action,
                detail: r.detail_json ? JSON.parse(r.detail_json) : null,
                ip: r.ip,
                createdAt: r.created_at
            }))
        }
    };
}

module.exports = {
    listChannels,
    getChannelDetail,
    getChannelHub,
    createChannel,
    updateChannel,
    patchChannelStatus,
    batchPatchStatus,
    updateBranding,
    copyBrandingFrom,
    listChannelAuditLogs,
    canReadChannel,
    canWriteChannel
};
