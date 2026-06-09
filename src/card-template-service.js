/**
 * 贺卡模板库：PNG 放在项目根 images/card/，清单见 images/card-templates.json
 * 访问 URL：https://域名/images/card/文件名（与商城配图相同，可用 MALL_IMAGE_BASE）
 */
const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = 'card-templates.json';
const IMAGES_DIR = path.join(__dirname, '..', 'images');
/** 贺卡 PNG 专用子目录（相对 images/） */
const CARD_SUBDIR = 'card';
const CARD_ASSETS_DIR = path.join(IMAGES_DIR, CARD_SUBDIR);

/** @returns {string} */
function publicImageBase() {
    return (process.env.MALL_IMAGE_BASE || process.env.PUBLIC_IMAGE_BASE || 'https://music.zsyl.cc').replace(
        /\/$/,
        ''
    );
}

/**
 * 规范为相对 images/ 的路径，如 card/goodnight-01.png
 * manifest 里可写 card/xxx.png，或仅写文件名（自动归入 card/）
 */
function normalizeCardFile(file) {
    let rel = String(file || '').replace(/^\//, '').replace(/\\/g, '/').trim();
    if (!rel || rel.includes('..')) return '';
    if (!rel.startsWith(`${CARD_SUBDIR}/`)) {
        rel = `${CARD_SUBDIR}/${rel}`;
    }
    return rel;
}

/** @param {string} file - 相对 images/，如 card/goodnight-01.png */
function cardImageUrl(file) {
    const rel = normalizeCardFile(file);
    if (!rel) return '';
    return `${publicImageBase()}/images/${rel}`;
}

function manifestPath() {
    return path.join(IMAGES_DIR, MANIFEST_NAME);
}

function loadManifest() {
    const p = manifestPath();
    if (!fs.existsSync(p)) {
        return { categories: [], templates: [] };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        return {
            categories: Array.isArray(raw.categories) ? raw.categories : [],
            templates: Array.isArray(raw.templates) ? raw.templates : []
        };
    } catch (e) {
        console.warn('[card-templates] 解析 manifest 失败:', e.message);
        return { categories: [], templates: [] };
    }
}

function serializeTextLayout(textLayout) {
    if (textLayout == null || textLayout === '') return '';
    if (typeof textLayout === 'string') return textLayout.trim();
    try {
        return JSON.stringify(textLayout);
    } catch (e) {
        return '';
    }
}

function parseTextLayout(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'object') return raw;
    const s = String(raw).trim();
    if (!s) return null;
    try {
        return JSON.parse(s);
    } catch (e) {
        return s;
    }
}

function fileExistsUnderImages(file) {
    const rel = normalizeCardFile(file);
    if (!rel) return false;
    const full = path.join(IMAGES_DIR, rel);
    return fs.existsSync(full);
}

/**
 * 将 manifest 同步到 SQLite（启动时或脚本调用）
 * @param {import('better-sqlite3').Database} db
 */
function syncCardTemplatesFromManifest(db) {
    const { categories, templates } = loadManifest();

    const upsertCategory = db.prepare(`
        INSERT INTO card_template_categories (id, name, sort_order, enabled)
        VALUES (@id, @name, @sort_order, @enabled)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            sort_order = excluded.sort_order,
            enabled = excluded.enabled
    `);

    const upsertTemplate = db.prepare(`
        INSERT INTO card_templates (
            id, category_id, name, image_file, cover_url, bg_image_url,
            gradient_template, sort_order, enabled, text_layout, chars_per_line
        ) VALUES (
            @id, @category_id, @name, @image_file, @cover_url, @bg_image_url,
            @gradient_template, @sort_order, @enabled, @text_layout, @chars_per_line
        )
        ON CONFLICT(id) DO UPDATE SET
            category_id = excluded.category_id,
            name = excluded.name,
            image_file = excluded.image_file,
            cover_url = excluded.cover_url,
            bg_image_url = excluded.bg_image_url,
            gradient_template = excluded.gradient_template,
            sort_order = excluded.sort_order,
            enabled = excluded.enabled,
            text_layout = excluded.text_layout,
            chars_per_line = excluded.chars_per_line
    `);

    const syncTx = db.transaction(() => {
        for (const c of categories) {
            if (!c.id || !c.name) continue;
            upsertCategory.run({
                id: String(c.id),
                name: String(c.name),
                sort_order: Number(c.sortOrder) || 0,
                enabled: c.enabled === false ? 0 : 1
            });
        }

        const manifestCategoryIds = categories.map((c) => String(c.id)).filter(Boolean);
        const manifestTemplateIds = templates.map((t) => String(t.id)).filter(Boolean);

        let synced = 0;
        let skippedMissingFile = 0;
        for (const t of templates) {
            if (!t.id || !t.name) continue;

            if (t.defaultGradient === true) {
                upsertTemplate.run({
                    id: String(t.id),
                    category_id: String(t.categoryId || 'general'),
                    name: String(t.name),
                    image_file: '',
                    cover_url: '',
                    bg_image_url: '',
                    gradient_template: Number(t.gradientTemplate) || 1,
                    sort_order: Number(t.sortOrder) || 0,
                    enabled: t.enabled === false ? 0 : 1,
                    text_layout: serializeTextLayout(t.textLayout),
                    chars_per_line: normalizeCharsPerLine(t.charsPerLine)
                });
                synced += 1;
                continue;
            }

            if (!t.file) continue;
            const rel = normalizeCardFile(t.file);
            if (!rel || !fileExistsUnderImages(rel)) {
                skippedMissingFile += 1;
                console.warn(`[card-templates] 跳过（文件不存在）: ${rel || t.file} (${t.id})`);
                continue;
            }
            const url = cardImageUrl(rel);
            upsertTemplate.run({
                id: String(t.id),
                category_id: String(t.categoryId || 'general'),
                name: String(t.name),
                image_file: rel,
                cover_url: url,
                bg_image_url: url,
                gradient_template: Number(t.gradientTemplate) || 1,
                sort_order: Number(t.sortOrder) || 0,
                enabled: t.enabled === false ? 0 : 1,
                text_layout: serializeTextLayout(t.textLayout),
                chars_per_line: normalizeCharsPerLine(t.charsPerLine)
            });
            synced += 1;
        }

        let disabledCategories = 0;
        let disabledTemplates = 0;
        if (manifestCategoryIds.length) {
            const ph = manifestCategoryIds.map(() => '?').join(',');
            disabledCategories = db
                .prepare(
                    `UPDATE card_template_categories SET enabled = 0
                     WHERE id NOT IN (${ph}) AND enabled = 1`
                )
                .run(...manifestCategoryIds).changes;
        }
        if (manifestTemplateIds.length) {
            const ph = manifestTemplateIds.map(() => '?').join(',');
            disabledTemplates = db
                .prepare(
                    `UPDATE card_templates SET enabled = 0
                     WHERE id NOT IN (${ph}) AND enabled = 1`
                )
                .run(...manifestTemplateIds).changes;
        }

        return {
            synced,
            skippedMissingFile,
            categories: categories.length,
            disabledCategories,
            disabledTemplates
        };
    });

    const result = syncTx();
    console.log(
        `[card-templates] 同步完成: ${result.synced} 张模板, ${result.skippedMissingFile} 张因缺图跳过, ${result.categories} 个分类, 下架分类 ${result.disabledCategories || 0}, 下架模板 ${result.disabledTemplates || 0}`
    );
    return result;
}

function normalizeCharsPerLine(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(30, Math.max(4, Math.round(n)));
}

function mapTemplateRow(row) {
    if (!row) return null;
    const imageFile = row.image_file || '';
    const coverUrl = row.cover_url || '';
    const bgImageUrl = row.bg_image_url || '';
    const defaultGradient =
        row.id === 'tpl_default' || (!imageFile && !coverUrl && !bgImageUrl);
    const charsPerLine = normalizeCharsPerLine(row.chars_per_line);
    return {
        id: row.id,
        categoryId: row.category_id,
        name: row.name,
        imageFile,
        coverUrl,
        bgImageUrl,
        gradientTemplate: row.gradient_template,
        sortOrder: row.sort_order,
        defaultGradient,
        textLayout: parseTextLayout(row.text_layout),
        ...(charsPerLine != null ? { charsPerLine } : {})
    };
}

function listCategories(db) {
    const rows = db
        .prepare(
            `SELECT id, name, sort_order FROM card_template_categories
             WHERE enabled = 1 ORDER BY sort_order ASC, name ASC`
        )
        .all();
    return [{ id: 'all', name: '全部', sortOrder: -1 }].concat(
        rows.map((r) => ({
            id: r.id,
            name: r.name,
            sortOrder: r.sort_order
        }))
    );
}

function listTemplates(db, { category, page = 1, limit = 50 } = {}) {
    const lim = Math.min(100, Math.max(1, Number(limit) || 50));
    const off = (Math.max(1, Number(page) || 1) - 1) * lim;
    let sql = `SELECT id, category_id, name, image_file, cover_url, bg_image_url, gradient_template, sort_order, text_layout, chars_per_line
               FROM card_templates WHERE enabled = 1`;
    const params = [];
    if (category && category !== 'all') {
        sql += ` AND category_id = ?`;
        params.push(String(category));
    }
    sql += ` ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`;
    params.push(lim, off);

    const list = db.prepare(sql).all(...params).map(mapTemplateRow);

    let countSql = `SELECT COUNT(*) AS total FROM card_templates WHERE enabled = 1`;
    const countParams = [];
    if (category && category !== 'all') {
        countSql += ` AND category_id = ?`;
        countParams.push(String(category));
    }
    const total = db.prepare(countSql).get(...countParams).total;

    return { list, total, page: Number(page) || 1, limit: lim };
}

function getTemplateById(db, templateId) {
    const row = db
        .prepare(
            `SELECT id, category_id, name, image_file, cover_url, bg_image_url, gradient_template, sort_order, text_layout, chars_per_line
             FROM card_templates WHERE id = ? AND enabled = 1`
        )
        .get(String(templateId));
    return mapTemplateRow(row);
}

function resolveTemplateForShare(db, { templateId, template, artistBgImage }) {
    if (templateId) {
        const tpl = db
            .prepare(
                `SELECT id, gradient_template, bg_image_url, cover_url FROM card_templates
                 WHERE id = ? AND enabled = 1`
            )
            .get(String(templateId));
        if (!tpl) {
            return { error: 'INVALID_TEMPLATE' };
        }
        const isDefault = tpl.id === 'tpl_default' || (!tpl.image_file && !tpl.bg_image_url && !tpl.cover_url);
        return {
            templateId: tpl.id,
            template: Number(tpl.gradient_template) || 1,
            artistBgImage: isDefault ? '' : tpl.bg_image_url || tpl.cover_url || ''
        };
    }
    return {
        templateId: null,
        template: Number(template) || 1,
        artistBgImage: artistBgImage || ''
    };
}

module.exports = {
    IMAGES_DIR,
    CARD_SUBDIR,
    CARD_ASSETS_DIR,
    MANIFEST_NAME,
    normalizeCardFile,
    publicImageBase,
    cardImageUrl,
    loadManifest,
    syncCardTemplatesFromManifest,
    listCategories,
    listTemplates,
    getTemplateById,
    resolveTemplateForShare,
    mapTemplateRow
};
