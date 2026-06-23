const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');
const { ErrorCode } = require('../error-codes');
const adminStatsService = require('./admin-stats-service');
const { getDataDir } = require('../bootstrap/database');

const EXPORT_ROLES = new Set(['super', 'operator', 'partner']);
const EXPORT_TYPES = new Set(['channel_stats', 'feedback']);
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

function exportsDir() {
    const dir = path.join(getDataDir(), 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function jobMetaPath(jobId) {
    return path.join(exportsDir(), `${jobId}.meta.json`);
}

function assertExport(adminUser) {
    if (!adminUser || !EXPORT_ROLES.has(adminUser.role)) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }
    return { ok: true };
}

function cleanupExpiredJobs() {
    const dir = exportsDir();
    const now = Date.now();
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (e) {
        return;
    }
    files.forEach((name) => {
        const full = path.join(dir, name);
        try {
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > JOB_TTL_MS) {
                fs.unlinkSync(full);
            }
        } catch (e) {
            /* ignore */
        }
    });
}

function loadJob(jobId) {
    const metaPath = jobMetaPath(jobId);
    if (!fs.existsSync(metaPath)) return null;
    try {
        const job = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (!job.filePath || !fs.existsSync(job.filePath)) return null;
        const age = Date.now() - new Date(job.createdAt).getTime();
        if (age > JOB_TTL_MS) {
            try {
                fs.unlinkSync(metaPath);
                if (job.filePath) fs.unlinkSync(job.filePath);
            } catch (e) {
                /* ignore */
            }
            return null;
        }
        return job;
    } catch (e) {
        return null;
    }
}

function saveJob(job) {
    fs.writeFileSync(jobMetaPath(job.id), JSON.stringify(job, null, 2), 'utf8');
}

function escapeCsvCell(val) {
    const s = val == null ? '' : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function rowsToCsv(columns, rows) {
    const lines = [columns.map(escapeCsvCell).join(',')];
    rows.forEach((row) => {
        lines.push(columns.map((col) => escapeCsvCell(row[col])).join(','));
    });
    return '\uFEFF' + lines.join('\n');
}

async function rowsToXlsx(columns, rows, meta) {
    const wb = new ExcelJS.Workbook();
    wb.creator = '眠音盒 Admin';
    wb.created = new Date();

    const info = wb.addWorksheet('导出信息');
    info.columns = [
        { header: '字段', key: 'k', width: 18 },
        { header: '值', key: 'v', width: 40 }
    ];
    Object.entries(meta || {}).forEach(([k, v]) => {
        info.addRow({ k, v: v == null ? '' : String(v) });
    });

    const sheet = wb.addWorksheet('数据');
    sheet.columns = columns.map((col) => ({ header: col, key: col, width: 16 }));
    rows.forEach((row) => sheet.addRow(row));

    return wb.xlsx.writeBuffer();
}

function fetchChannelStatsRows(db, from, to, channelId) {
    let sql = `SELECT stat_date, channel_id, dau, new_bindings, music_completed, cards_created
               FROM daily_channel_stats WHERE stat_date >= ? AND stat_date <= ?`;
    const params = [from, to];
    if (channelId) {
        sql += ' AND channel_id = ?';
        params.push(channelId);
    }
    sql += ' ORDER BY stat_date ASC, channel_id ASC';
    return db.prepare(sql).all(...params);
}

function fetchFeedbackRows(db, from, to) {
    return db
        .prepare(
            `SELECT id, nickname, wx_openid, feedback_type, content, contact, status, created_at
             FROM user_feedback
             WHERE date(created_at) >= ? AND date(created_at) <= ?
             ORDER BY created_at DESC`
        )
        .all(from, to);
}

function buildExportData(db, adminUser, query) {
    const auth = assertExport(adminUser);
    if (!auth.ok) return auth;

    const type = String((query && query.type) || 'channel_stats').trim();
    if (!EXPORT_TYPES.has(type)) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'type 无效' };
    }

    const range = adminStatsService.resolveRange(db, query);
    if (!range.ok) return range;

    const ch = adminStatsService.resolveChannelFilter(adminUser, query && query.channel);
    if (!ch.ok) return ch;

    const from = range.from;
    const to = range.to;
    const channelId = ch.channelId || '';

    if (type === 'feedback') {
        const rows = fetchFeedbackRows(db, from, to);
        return {
            ok: true,
            data: {
                type,
                from,
                to,
                columns: [
                    'id',
                    'nickname',
                    'wx_openid',
                    'feedback_type',
                    'content',
                    'contact',
                    'status',
                    'created_at'
                ],
                rows
            }
        };
    }

    const rows = fetchChannelStatsRows(db, from, to, channelId || null);
    return {
        ok: true,
        data: {
            type,
            from,
            to,
            channelId: channelId || 'all',
            columns: [
                'stat_date',
                'channel_id',
                'dau',
                'new_bindings',
                'music_completed',
                'cards_created'
            ],
            rows
        }
    };
}

function previewExport(db, adminUser, query) {
    const built = buildExportData(db, adminUser, query);
    if (!built.ok) return built;

    const { columns, rows, type, from, to, channelId } = built.data;
    return {
        ok: true,
        data: {
            type,
            from,
            to,
            channelId,
            format: (query && query.format) || 'csv',
            columns,
            rows: rows.slice(0, 100),
            totalRows: rows.length,
            truncated: rows.length > 100
        }
    };
}

async function createExportJob(db, adminUser, query) {
    cleanupExpiredJobs();

    const built = buildExportData(db, adminUser, query);
    if (!built.ok) return built;

    const { columns, rows, type, from, to, channelId } = built.data;
    const format = String((query && query.format) || 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv';
    const jobId = uuidv4();
    const filename = `export_${type}_${from}_${to}_${jobId.slice(0, 8)}.${format}`;
    const filePath = path.join(exportsDir(), filename);

    if (format === 'xlsx') {
        const buffer = await rowsToXlsx(columns, rows, {
            type,
            from,
            to,
            channelId: channelId || 'all',
            rowCount: rows.length,
            exportedBy: adminUser.username,
            exportedAt: new Date().toISOString()
        });
        fs.writeFileSync(filePath, Buffer.from(buffer));
    } else {
        fs.writeFileSync(filePath, rowsToCsv(columns, rows), 'utf8');
    }

    const job = {
        id: jobId,
        status: 'done',
        type,
        format,
        from,
        to,
        channelId: channelId || 'all',
        rowCount: rows.length,
        filename,
        filePath,
        createdAt: new Date().toISOString(),
        createdBy: adminUser.username
    };
    saveJob(job);

    return {
        ok: true,
        data: {
            id: jobId,
            status: job.status,
            format: job.format,
            rowCount: job.rowCount,
            downloadUrl: `/api/admin/export/jobs/${jobId}/download`
        },
        message: '导出任务已完成'
    };
}

function getExportJob(adminUser, jobId) {
    const auth = assertExport(adminUser);
    if (!auth.ok) return auth;

    cleanupExpiredJobs();
    const job = loadJob(String(jobId || '').trim());
    if (!job) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '导出任务不存在或已过期' };
    }

    return {
        ok: true,
        data: {
            id: job.id,
            status: job.status,
            type: job.type,
            format: job.format,
            from: job.from,
            to: job.to,
            channelId: job.channelId,
            rowCount: job.rowCount,
            createdAt: job.createdAt
        }
    };
}

function resolveDownload(adminUser, jobId) {
    const auth = assertExport(adminUser);
    if (!auth.ok) return auth;

    cleanupExpiredJobs();
    const job = loadJob(String(jobId || '').trim());
    if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
        return { ok: false, error: ErrorCode.FILE_NOT_FOUND, message: '文件不存在或已过期' };
    }

    return {
        ok: true,
        data: {
            filePath: job.filePath,
            filename: job.filename,
            format: job.format || 'csv'
        }
    };
}

module.exports = {
    previewExport,
    createExportJob,
    getExportJob,
    resolveDownload,
    EXPORT_TYPES
};
