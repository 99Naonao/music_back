const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const ctx = require('../../utils/app-context');
const { adminAuthMiddleware, requireRole } = require('../middleware');
const { sendMiniError } = require('../../error-codes');

const {
    upload,
    uploadDir,
    sendSuccess,
    ErrorCode,
    logError,
    logInfo,
    logWarn,
    contentSecurity,
    buildPublicUploadUrl,
    getUploadPublicPathForFilename
} = ctx;

const canUpload = [adminAuthMiddleware, requireRole('super', 'operator')];

const WX_IMG_SEC_MAX_BYTES = 1024 * 1024;

router.post('/upload/image', ...canUpload, upload.single('image'), async (req, res) => {
    if (!req.file) {
        return sendMiniError(res, ErrorCode.MISSING_REQUIRED_PARAM, '请选择图片');
    }
    const diskPath = path.join(uploadDir, req.file.filename);
    if (!fs.existsSync(diskPath)) {
        logError('Admin 图片上传', new Error('写入后文件不存在'), { diskPath });
        return sendMiniError(res, ErrorCode.FILE_UPLOAD_FAILED, '文件写入失败');
    }

    let fileSize = 0;
    try {
        fileSize = fs.statSync(diskPath).size;
    } catch (e) {}

    if (fileSize > WX_IMG_SEC_MAX_BYTES) {
        try {
            fs.unlinkSync(diskPath);
        } catch (e) {}
        return sendMiniError(
            res,
            ErrorCode.FILE_TOO_LARGE,
            '图片不能超过 1MB，请换一张较小的 JPG/PNG'
        );
    }

    try {
        const imgCheck = await contentSecurity.checkImageFile(diskPath);
        if (!imgCheck.pass) {
            try {
                fs.unlinkSync(diskPath);
            } catch (e) {}
            if (imgCheck.invalidMedia) {
                return sendMiniError(res, ErrorCode.FILE_TOO_LARGE, '图片格式或大小不符合要求');
            }
            return sendMiniError(res, ErrorCode.CONTENT_SENSITIVE);
        }
    } catch (err) {
        try {
            fs.unlinkSync(diskPath);
        } catch (e) {}
        logError('Admin 图片内容安全', err);
        return sendMiniError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
    }

    const safeName = path.basename(req.file.filename);
    const imageUrl = buildPublicUploadUrl(req, safeName);
    const publicPath = getUploadPublicPathForFilename(safeName);
    logInfo('Admin 图片上传', '成功', { filename: safeName, imageUrl, admin: req.adminUser.username });
    sendSuccess(res, { url: imageUrl, path: publicPath }, '上传成功');
});

module.exports = router;
