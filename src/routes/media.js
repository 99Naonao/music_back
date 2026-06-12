const express = require('express');
const path = require('path');
const fs = require('fs');
const { QRCODE_DIR } = require('../mall-qrcode');
const { ErrorCode, sendError, logWarn } = require('../error-codes');
const {
    uploadDir,
    libraryAudioDir,
    sendUploadFileByName,
    sendMusicCoverFile,
    sendMusicAudioFile,
    sendLibraryAudioFile,
    mallImagesDir
} = require('../utils/upload-storage');
const { AUDIO_DIR } = require('../audio-mixer');

function registerMediaRoutes(app) {
    app.get('/api/music/cover', sendMusicCoverFile);
    app.get('/api/music/cover/:filename', sendMusicCoverFile);
    app.get('/api/music/audio', sendMusicAudioFile);
    app.get('/api/music/library-audio', sendLibraryAudioFile);
    
    app.get(/^\/api\/upload\/file\/.+/, sendUploadFileByName);
    app.get(/^\/api\/upload\/image\/.+/, sendUploadFileByName);
    app.get(/^\/api\/upload\/audio\/.+/, sendUploadFileByName);
    /** Nginx 把 /api 前缀剥掉时的兜底 */
    app.get(/^\/upload\/file\/.+/, sendUploadFileByName);
    app.get(/^\/upload\/image\/.+/, sendUploadFileByName);
    app.get(/^\/upload\/audio\/.+/, sendUploadFileByName);
    app.use('/uploads', express.static(uploadDir));
    if (!fs.existsSync(QRCODE_DIR)) {
        fs.mkdirSync(QRCODE_DIR, { recursive: true });
    }
    app.get("/audio/:filename", (req, res) => {
        const { filename } = req.params;
    
        if (!filename) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '文件名不能为空');
        }
    
        // 安全检查：防止目录遍历攻击
        const sanitizedFilename = path.basename(filename);
        const filePath = path.join(AUDIO_DIR, sanitizedFilename);
    
        // 确保文件路径在允许的目录内
        if (!filePath.startsWith(AUDIO_DIR)) {
            return sendError(res, ErrorCode.INVALID_PARAMS, '非法文件路径');
        }
    
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            sendError(res, ErrorCode.FILE_NOT_FOUND);
        }
    });
    
    app.get("/audio/library/:filename", (req, res) => {
        const { filename } = req.params;
    
        if (!filename) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '文件名不能为空');
        }
    
        const sanitizedFilename = path.basename(filename);
        const filePath = path.join(libraryAudioDir, sanitizedFilename);
        const libraryRoot = path.resolve(libraryAudioDir) + path.sep;
    
        if (!path.resolve(filePath).startsWith(libraryRoot)) {
            return sendError(res, ErrorCode.INVALID_PARAMS, '非法文件路径');
        }
    
        if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'audio/mpeg');
            res.sendFile(filePath);
        } else {
            logWarn('读取官方曲库音频(旧路径)', '文件不存在', {
                libraryAudioDir,
                filename: sanitizedFilename,
                filePath,
                hint: '请使用 /api/music/library-audio?f='
            });
            sendError(res, ErrorCode.FILE_NOT_FOUND);
        }
    });
}

module.exports = { registerMediaRoutes };
