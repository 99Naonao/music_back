const { ErrorCode } = require('../error-codes');
const { v4: uuidv4 } = require('uuid');
const channelService = require('../channel-service');

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

function mapTrack(row) {
    return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        instrument: row.main_instrument || '',
        frequency: row.frequency || '',
        plays: row.play_count || 0,
        libraryEnabled: row.library_enabled !== 0,
        librarySortOrder: row.library_sort_order || 0,
        createdAt: row.created_at
    };
}

function listSystemTracks(db, adminUser, query) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const includeDisabled = query && (query.includeDisabled === '1' || query.includeDisabled === true);
    let sql = `SELECT id, title, description, main_instrument, frequency, COALESCE(play_count,0) AS play_count,
                      library_enabled, library_sort_order, created_at
               FROM music_tracks
               WHERE user_id = 'system' AND status = 'completed'`;
    if (!includeDisabled) {
        sql += ' AND COALESCE(library_enabled, 1) != 0';
    }
    sql += ' ORDER BY library_sort_order DESC, created_at DESC LIMIT 200';

    const rows = db.prepare(sql).all();
    return { ok: true, data: { list: rows.map(mapTrack) } };
}

function patchSystemTrack(db, adminUser, trackId, body) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const id = String(trackId || '').trim();
    const row = db
        .prepare(`SELECT id FROM music_tracks WHERE id = ? AND user_id = 'system'`)
        .get(id);
    if (!row) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '曲库曲目不存在' };
    }

    const updates = [];
    const params = [];

    if (body.libraryEnabled !== undefined) {
        updates.push('library_enabled = ?');
        params.push(body.libraryEnabled === false || body.libraryEnabled === 0 ? 0 : 1);
    }
    if (body.librarySortOrder != null) {
        updates.push('library_sort_order = ?');
        params.push(Number(body.librarySortOrder) || 0);
    }
    if (body.title != null) {
        updates.push('title = ?');
        params.push(String(body.title).slice(0, 200));
    }
    if (body.description != null) {
        updates.push('description = ?');
        params.push(String(body.description).slice(0, 500));
    }

    if (!updates.length) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '无有效更新' };
    }

    params.push(id);
    db.prepare(`UPDATE music_tracks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db
        .prepare(
            `SELECT id, title, description, main_instrument, frequency, COALESCE(play_count,0) AS play_count,
                    library_enabled, library_sort_order, created_at
             FROM music_tracks WHERE id = ?`
        )
        .get(id);

    return { ok: true, data: mapTrack(updated), message: '已更新' };
}

function listBanners(db, adminUser) {
    const auth = assertRead(adminUser);
    if (!auth.ok) return auth;

    const rows = db
        .prepare(
            `SELECT id, title, image_url, link_path, link_type, sort_order, enabled,
                    channel_ids_json, start_at, end_at, updated_at
             FROM home_banners ORDER BY sort_order DESC, updated_at DESC`
        )
        .all();

    return {
        ok: true,
        data: {
            list: rows.map((r) => ({
                id: r.id,
                title: r.title || '',
                imageUrl: r.image_url,
                linkPath: r.link_path || '',
                linkType: r.link_type || 'navigateTo',
                sortOrder: r.sort_order || 0,
                enabled: r.enabled !== 0,
                channelIds: r.channel_ids_json ? JSON.parse(r.channel_ids_json) : [],
                startAt: r.start_at,
                endAt: r.end_at,
                updatedAt: r.updated_at
            }))
        }
    };
}

function upsertBanner(db, adminUser, id, body) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const bid = String(id || body.id || uuidv4()).trim();
    const imageUrl = body.imageUrl != null ? String(body.imageUrl).trim() : '';
    if (!imageUrl && !id) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: 'imageUrl 必填' };
    }

    const existing = db.prepare('SELECT * FROM home_banners WHERE id = ?').get(bid);
    const channelIdsJson =
        body.channelIds != null ? JSON.stringify(body.channelIds) : existing?.channel_ids_json || null;

    db.prepare(
        `INSERT INTO home_banners (id, title, image_url, link_path, link_type, sort_order, enabled,
           channel_ids_json, start_at, end_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(id) DO UPDATE SET
           title = COALESCE(excluded.title, title),
           image_url = COALESCE(NULLIF(excluded.image_url, ''), image_url),
           link_path = excluded.link_path,
           link_type = excluded.link_type,
           sort_order = excluded.sort_order,
           enabled = excluded.enabled,
           channel_ids_json = excluded.channel_ids_json,
           start_at = excluded.start_at,
           end_at = excluded.end_at,
           updated_at = datetime('now', 'localtime')`
    ).run(
        bid,
        body.title != null ? String(body.title).slice(0, 100) : existing?.title || '',
        imageUrl || existing?.image_url || '',
        body.linkPath != null ? String(body.linkPath) : existing?.link_path || '',
        body.linkType != null ? String(body.linkType) : existing?.link_type || 'navigateTo',
        body.sortOrder != null ? Number(body.sortOrder) : existing?.sort_order || 0,
        body.enabled !== undefined ? (body.enabled === false || body.enabled === 0 ? 0 : 1) : existing?.enabled ?? 1,
        channelIdsJson,
        body.startAt !== undefined ? body.startAt || null : existing?.start_at || null,
        body.endAt !== undefined ? body.endAt || null : existing?.end_at || null
    );

    return { ok: true, data: { id: bid }, message: 'Banner 已保存' };
}

function deleteBanner(db, adminUser, id) {
    const auth = assertWrite(adminUser);
    if (!auth.ok) return auth;

    const bid = String(id || '').trim();
    db.prepare('DELETE FROM home_banners WHERE id = ?').run(bid);
    return { ok: true, message: '已删除' };
}

function getActiveBannersForChannel(db, channelRaw) {
    const channelId = channelService.normalizeChannelId(channelRaw);
    const today = db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;

    const rows = db
        .prepare(
            `SELECT id, title, image_url, link_path, link_type, sort_order, channel_ids_json
             FROM home_banners
             WHERE enabled = 1
               AND (start_at IS NULL OR start_at <= ?)
               AND (end_at IS NULL OR end_at >= ?)
             ORDER BY sort_order DESC, updated_at DESC`
        )
        .all(today, today);

    const list = rows
        .filter((r) => {
            if (!r.channel_ids_json) return true;
            try {
                const allow = JSON.parse(r.channel_ids_json);
                if (!Array.isArray(allow) || !allow.length) return true;
                return allow.includes(channelId);
            } catch (e) {
                return true;
            }
        })
        .map((r) => ({
            id: r.id,
            title: r.title || '',
            imageUrl: r.image_url,
            linkPath: r.link_path || '',
            linkType: r.link_type || 'navigateTo'
        }));

    return { list };
}

module.exports = {
    listSystemTracks,
    patchSystemTrack,
    listBanners,
    upsertBanner,
    deleteBanner,
    getActiveBannersForChannel
};
