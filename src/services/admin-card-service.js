const { ErrorCode } = require('../error-codes');
const cardTemplateService = require('../card-template-service');
const fs = require('fs');
const path = require('path');

const READ_ROLES = new Set(['super', 'operator', 'readonly']);
const WRITE_ROLES = new Set(['super', 'operator']);

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

function listTemplatesAdmin(db, adminUser, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const category = query && query.category ? String(query.category) : '';
    let sql = `SELECT t.id, t.category_id, t.name, t.image_file, t.enabled, t.sort_order,
                      c.name AS category_name
               FROM card_templates t
               LEFT JOIN card_template_categories c ON c.id = t.category_id`;
    const params = [];
    if (category && category !== 'all') {
        sql += ' WHERE t.category_id = ?';
        params.push(category);
    }
    sql += ' ORDER BY t.sort_order ASC, t.name ASC LIMIT 500';

    const rows = db.prepare(sql).all(...params);
    const categories = db
        .prepare(
            `SELECT id, name, sort_order, enabled FROM card_template_categories ORDER BY sort_order ASC`
        )
        .all();

    return {
        ok: true,
        data: {
            categories: categories.map((c) => ({
                id: c.id,
                name: c.name,
                sortOrder: c.sort_order,
                enabled: c.enabled !== 0
            })),
            list: rows.map((r) => ({
                id: r.id,
                categoryId: r.category_id,
                categoryName: r.category_name,
                name: r.name,
                imageFile: r.image_file,
                enabled: r.enabled !== 0,
                sortOrder: r.sort_order
            }))
        }
    };
}

function patchTemplate(db, adminUser, id, body) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const tid = String(id || '').trim();
    const row = db.prepare('SELECT id FROM card_templates WHERE id = ?').get(tid);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '模板不存在' };
    }

    const updates = [];
    const params = [];
    if (body.enabled !== undefined) {
        updates.push('enabled = ?');
        params.push(body.enabled === false || body.enabled === 0 ? 0 : 1);
    }
    if (body.sortOrder != null) {
        updates.push('sort_order = ?');
        params.push(Number(body.sortOrder) || 0);
    }
    if (body.name != null) {
        updates.push('name = ?');
        params.push(String(body.name).slice(0, 100));
    }

    if (!updates.length) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '无有效更新' };
    }

    params.push(tid);
    db.prepare(`UPDATE card_templates SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return { ok: true, message: '模板已更新' };
}

function patchCategory(db, adminUser, id, body) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const cid = String(id || '').trim();
    const row = db.prepare('SELECT id FROM card_template_categories WHERE id = ?').get(cid);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '分类不存在' };
    }

    const updates = [];
    const params = [];
    if (body.enabled !== undefined) {
        updates.push('enabled = ?');
        params.push(body.enabled === false || body.enabled === 0 ? 0 : 1);
    }
    if (body.sortOrder != null) {
        updates.push('sort_order = ?');
        params.push(Number(body.sortOrder) || 0);
    }

    if (!updates.length) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '无有效更新' };
    }

    params.push(cid);
    db.prepare(`UPDATE card_template_categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return { ok: true, message: '分类已更新' };
}

function getSyncInfo(db, adminUser) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const manifestPath = path.join(__dirname, '..', '..', 'images', 'card-templates.json');
    let manifestCount = 0;
    try {
        if (fs.existsSync(manifestPath)) {
            const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            manifestCount = Array.isArray(raw.templates) ? raw.templates.length : 0;
        }
    } catch (e) {
        /* ignore */
    }

    const dbCount = db.prepare('SELECT COUNT(*) AS c FROM card_templates').get().c;

    return {
        ok: true,
        data: {
            manifestPath: 'images/card-templates.json',
            manifestTemplateCount: manifestCount,
            dbTemplateCount: dbCount,
            syncHint: '服务器执行 node scripts/sync-card-templates.js 同步 manifest → DB'
        }
    };
}

function runSyncFromManifest(db, adminUser) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    cardTemplateService.syncCardTemplatesFromManifest(db);
    const dbCount = db.prepare('SELECT COUNT(*) AS c FROM card_templates').get().c;
    return { ok: true, data: { dbTemplateCount: dbCount }, message: '已从 manifest 同步' };
}

module.exports = {
    listTemplatesAdmin,
    patchTemplate,
    patchCategory,
    getSyncInfo,
    runSyncFromManifest
};
