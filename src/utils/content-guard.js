const crypto = require('crypto');
const { ErrorCode, sendError, logError, logWarn, logInfo } = require('../error-codes');
const contentSecurity = require('../content-security');
const mediaSecStore = require('../media-sec-store');
const { getDb } = require('../bootstrap/database');
const { getApiBaseUrl } = require('./media-url');
const { uploadDir } = require('./upload-storage');

async function blockIfContentUnsafe(res, openid, items) {
    try {
        const check = await contentSecurity.checkTexts(openid, items);
        if (!check.pass) {
            logWarn('内容安全', '拦截', {
                openid: openid ? String(openid).slice(0, 8) + '…' : '',
                field: check.field || '',
                suggest: check.suggest || '',
                segment: check.segment || ''
            });
            sendError(res, ErrorCode.CONTENT_SENSITIVE);
            return true;
        }
        if (check.skipped) {
            logWarn('内容安全', '已跳过检测（SKIP_CONTENT_SEC_CHECK 或未配置微信密钥）', {
                field: (items || []).map((i) => i.field).filter(Boolean).join(',') || undefined
            });
        }
        return false;
    } catch (err) {
        logError('内容安全检测', err);
        sendError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
        return true;
    }
}

/** @returns {Promise<boolean>} true 表示已拦截并写响应 */
async function blockIfImagesUnsafe(res, urls, req) {
    try {
        const baseUrl = req ? getApiBaseUrl(req) : process.env.BASE_URL || '';
        for (const url of (urls || []).filter(Boolean).slice(0, 9)) {
            const check = await contentSecurity.checkHostedImage(url, { uploadDir, baseUrl });
            if (!check.pass) {
                logWarn('内容安全', '图片拦截', { url: String(url).slice(0, 120) });
                sendError(res, ErrorCode.CONTENT_SENSITIVE);
                return true;
            }
        }
        return false;
    } catch (err) {
        logError('图片内容安全检测', err);
        sendError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
        return true;
    }
}

/** 单张托管/公网图片（头像、封面等） */
async function blockIfHostedImageUnsafe(res, imageUrl, req, field) {
    if (!imageUrl || !String(imageUrl).trim()) return false;
    try {
        const check = await contentSecurity.checkHostedImage(imageUrl, {
            uploadDir,
            baseUrl: getApiBaseUrl(req)
        });
        if (!check.pass) {
            logWarn('内容安全', '图片拦截', { field, url: String(imageUrl).slice(0, 120) });
            sendError(res, ErrorCode.CONTENT_SENSITIVE);
            return true;
        }
        return false;
    } catch (err) {
        logError('图片内容安全', err, { field });
        sendError(res, ErrorCode.WECHAT_API_ERROR, '内容安全检测失败，请稍后重试');
        return true;
    }
}

/** 提交音频异步审核（结果经消息推送回调，见 /api/wechat/msg-push） */
async function scheduleAudioMediaCheck(openid, audioUrl, refType, refId) {
    if (!openid || !audioUrl || !String(audioUrl).trim()) return;
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    try {
        const r = await contentSecurity.checkAudioUrlAsync(
            openid,
            contentSecurity.SCENE.SOCIAL,
            audioUrl,
            baseUrl
        );
        if (r.skipped || !r.submitted || !r.trace_id) return;
        mediaSecStore.insertTask(db, {
            trace_id: r.trace_id,
            media_type: contentSecurity.MEDIA_TYPE.AUDIO,
            media_url: contentSecurity.toAbsoluteMediaUrl(audioUrl, baseUrl),
            ref_type: refType,
            ref_id: refId,
            openid
        });
        logInfo('内容安全', '音频异步任务已提交', {
            trace_id: r.trace_id,
            ref_type: refType,
            ref_id: refId
        });
    } catch (err) {
        logError('音频内容安全提交', err, { ref_type: refType, ref_id: refId });
    }
}

function verifyWechatMsgSignature(token, timestamp, nonce, signature) {
    if (!token || !signature) return false;
    const arr = [String(token), String(timestamp || ''), String(nonce || '')].sort();
    const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
    return hash === String(signature);
}

module.exports = {
    blockIfContentUnsafe,
    blockIfImagesUnsafe,
    blockIfHostedImageUnsafe,
    scheduleAudioMediaCheck,
    verifyWechatMsgSignature
};
