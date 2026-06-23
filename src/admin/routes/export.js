const express = require('express');
const fs = require('fs');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminExportService = require('../../services/admin-export-service');
const { adminAuthMiddleware, requireRole } = require('../middleware');

const { sendError, sendSuccess, ErrorCode, logError, convertDbError, getDb } = ctx;
const db = getDb();

const canExport = [adminAuthMiddleware, requireRole('super', 'operator', 'partner')];

function handleResult(res, result) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    if (result.data !== undefined) {
        return sendSuccess(res, result.data, result.message || '操作成功');
    }
    return sendSuccess(res, null, result.message || '操作成功');
}

router.get('/export/preview', ...canExport, (req, res) => {
    try {
        return handleResult(res, adminExportService.previewExport(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 导出预览', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/export/jobs', ...canExport, async (req, res) => {
    try {
        const query = { ...(req.body || {}), ...(req.query || {}) };
        const result = await adminExportService.createExportJob(db, req.adminUser, query);
        return handleResult(res, result);
    } catch (err) {
        logError('Admin 导出任务', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/export/jobs/:id', ...canExport, (req, res) => {
    try {
        return handleResult(res, adminExportService.getExportJob(req.adminUser, req.params.id));
    } catch (err) {
        logError('Admin 导出状态', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/export/jobs/:id/download', ...canExport, (req, res) => {
    try {
        const result = adminExportService.resolveDownload(req.adminUser, req.params.id);
        if (!result.ok) {
            return sendError(res, result.error || ErrorCode.FILE_NOT_FOUND, result.message);
        }
        const { filePath, filename, format } = result.data;
        const mime =
            format === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'text/csv; charset=utf-8';
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        logError('Admin 导出下载', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
