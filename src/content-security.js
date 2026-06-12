/**
 * 微信小程序内容安全（msgSecCheck / imgSecCheck）
 * 文档：https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.msgSecCheck.html
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { resolveWxCredentials, getDefaultAppId } = require('./wx-mini-apps');

const USER_VIOLATION_MSG = '所发布内容含违规信息';

const SCENE = {
    PROFILE: 1,
    COMMENT: 2,
    FORUM: 3,
    SOCIAL: 4
};

const MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';
const IMG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/img_sec_check';
const MEDIA_CHECK_ASYNC_URL = 'https://api.weixin.qq.com/wxa/media_check_async';
const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';

/** 微信 media_check_async：1 音频 2 图片 */
const MEDIA_TYPE = {
    AUDIO: 1,
    IMAGE: 2
};

const MAX_TEXT_LEN = 2500;

/** 本地敏感词（substring 匹配，忽略空白；部署后可用 CONTENT_BLOCK_KEYWORDS 追加） */
const GUIDE_WORDS = [
    '加微信', '加v', '加qq', '私聊', '私信', '扫码加', 'vx', 'v信',
    '卫星', 'qq号', '微信群', 'qq群', '进群', '拉群', '引流'
    // 已删：电话/手机号/联系方式（反馈留联常用）；推广/广告/赚钱/兼职/日赚（日常讨论易误伤）
];

const ABUSE_WORDS = [
    '傻逼', '智障', '脑残', '废物', '垃圾', '去死', '王八蛋',
    '草泥马', '你妈逼', '杂种', '贱货', '人渣', '滚蛋', '去死吧'
];

const FRAUD_WORDS = [
    '代开发票', '高仿', '精仿', '一比一', '复刻', '假货', '走私',
    '套现', '洗钱', '跑分', '代还信用卡', '高利贷', '裸贷',
    '刷单', '刷信誉', '刷好评', '解封', '代注册', '养号', '黑号',
    '微信解封', 'QQ解封', '抖音解封', '代办证件', '假证'
    // 已删：贷款（正常借贷讨论易误伤，高利贷/裸贷仍拦）
];

const POLITICS_WORDS = [
    '法轮功', '台独', '港独', '藏独', '疆独', '分裂国家', '反动',
    '推翻政府', '邪教', '反共', '辱国', '卖国', '抹黑中国'
];

const VIOLENCE_WORDS = [
    '杀人', '砍死', '弄死', '炸死', '虐杀', '血腥', '恐怖',
    '袭击', '爆炸', '放火', '强奸', '贩毒', '吸毒',
    '弄死你', '打残你', '灭门'
    // 已删：报复（报复性熬夜等）；盗窃/抢劫；自杀/自残/跳楼/割腕（情绪倾诉易误伤，交微信 API）
];

const GAMBLE_WORDS = [
    '赌博', '博彩', '私彩', '网赌', '菠菜', '百家乐', '龙虎斗',
    '炸金花', '牛牛', '德州扑克', '麻将赌博', '赌博群', '下注', '赔率',
    '盘口', '庄家', '放水', '洗白', '代理赌博', '彩票外挂'
    // 已删：彩票（单字场景多，用下方短语规则）；跑分（已在 FRAUD）
];

const SEX_WORDS = [
    '色情', '做爱', '性交', '裸聊', '约炮', '约P', '招嫖', '嫖娼',
    '卖淫', '外围', '一夜情', '约爱',
    '淫', '成人网站', '免费成人', '自慰',
    '口交', '肛交', '三P', '群P', '换妻', '乱伦', '偷拍', '迷奸'
    // 已删：裸/露/骚/浪/调情/成人/情趣/69（裸睡、数字等易误伤）；黄词由下方正则补充
];

/** 短语/组合规则（比单词更准） */
const DEFAULT_BLOCK_REGEX = [
    /黄(?:片|网|色)/,
    /彩票.*(?:预测|号码|内幕|中奖)/,
    /(?:内部|内幕).*(?:预测|号码)/,
    /百分百中奖/,
    /(?:稳赚|包中)(?:不赔)?/,
    /(?:上门|同城).*(?:特殊服务|约炮)/,
    /(?:办证|刻章|发票).*(?:联系|微信|电话)/,
    /(?:免费|在线).*成人/
];

const LOCAL_BLOCK_WORDS = [
    ...GUIDE_WORDS,
    ...ABUSE_WORDS,
    ...FRAUD_WORDS,
    ...POLITICS_WORDS,
    ...VIOLENCE_WORDS,
    ...GAMBLE_WORDS,
    ...SEX_WORDS
];

function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordsToPatterns(words) {
    return words.map((w) => new RegExp(escapeRegExp(w), 'i'));
}

function buildDefaultBlockPatterns() {
    return [...wordsToPatterns(LOCAL_BLOCK_WORDS), ...DEFAULT_BLOCK_REGEX];
}

let cachedBlockPatterns = null;

function getDefaultBlockPatterns() {
    if (!cachedBlockPatterns) {
        cachedBlockPatterns = buildDefaultBlockPatterns();
    }
    return cachedBlockPatterns;
}

let tokenCacheByApp = new Map();

function isSecCheckSkipped() {
    return String(process.env.SKIP_CONTENT_SEC_CHECK || '').toLowerCase() === 'true';
}

/** 是否已配置任一小程序 AppId/Secret（含 WX_APP_ID_MUSIC 等） */
function hasWxCredentials(appId) {
    if (isSecCheckSkipped()) return false;
    return !!resolveWxCredentials(appId || getDefaultAppId());
}

function isSuggestPass(suggest) {
    return String(suggest || '').toLowerCase() === 'pass';
}

function getExtraBlockPatterns() {
    const raw = String(process.env.CONTENT_BLOCK_KEYWORDS || '').trim();
    if (!raw) return [];
    return raw
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((kw) => new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}

function matchesLocalBlocklist(text) {
    const raw = String(text || '');
    const compact = raw.replace(/\s+/g, '');
    const patterns = [...getDefaultBlockPatterns(), ...getExtraBlockPatterns()];
    for (const re of patterns) {
        if (re.test(compact) || re.test(raw)) {
            return { hit: true, pattern: re.source };
        }
    }
    return { hit: false };
}

function checkLocalBlocklistForText(text) {
    const raw = String(text || '').trim();
    if (!raw) return { hit: false };
    const parts = [raw, ...extractSubSegments(raw)];
    const seen = new Set();
    for (const part of parts) {
        const key = part.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const hit = matchesLocalBlocklist(key);
        if (hit.hit) return { hit: true, segment: key.slice(0, 80), pattern: hit.pattern };
    }
    return { hit: false };
}

async function getAccessToken(appId) {
    if (isSecCheckSkipped()) return null;

    const cred = resolveWxCredentials(appId || getDefaultAppId());
    if (!cred) return null;

    const now = Date.now();
    const cached = tokenCacheByApp.get(cred.appId);
    if (cached && cached.expireAt > now + 60 * 1000) {
        return cached.token;
    }

    const res = await axios.get(TOKEN_URL, {
        params: {
            grant_type: 'client_credential',
            appid: cred.appId,
            secret: cred.appSecret
        },
        timeout: Number(process.env.WX_API_TIMEOUT_MS || 15000)
    });

    const data = res.data || {};
    if (!data.access_token) {
        throw new Error(data.errmsg || '获取 access_token 失败');
    }

    tokenCacheByApp.set(cred.appId, {
        token: data.access_token,
        expireAt: now + (Number(data.expires_in) || 7200) * 1000
    });
    return data.access_token;
}

function splitTextChunks(text) {
    const s = String(text);
    if (s.length <= MAX_TEXT_LEN) return [s];
    const chunks = [];
    for (let i = 0; i < s.length; i += MAX_TEXT_LEN) {
        chunks.push(s.slice(i, i + MAX_TEXT_LEN));
    }
    return chunks;
}

/** 长文中夹带违规句时，整段检测可能 pass；按行/句再检一遍 */
function extractSubSegments(text) {
    const raw = String(text || '');
    const parts = raw
        .split(/\r?\n|[。！？!?；;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 4);
    return parts;
}

async function runMsgSecCheck(openid, scene, content) {
    const text = String(content).slice(0, MAX_TEXT_LEN);
    if (!text.trim()) return { pass: true };
    return openid
        ? msgSecCheckV2(openid, scene, text)
        : msgSecCheckV1(text);
}

async function msgSecCheckV1(content) {
    const token = await getAccessToken();
    if (!token) return { pass: true, skipped: true };

    const res = await axios.post(
        `${MSG_SEC_CHECK_URL}?access_token=${token}`,
        { content: String(content).slice(0, MAX_TEXT_LEN) },
        { timeout: Number(process.env.WX_API_TIMEOUT_MS || 15000) }
    );
    const data = res.data || {};
    if (data.errcode === 0) return { pass: true, raw: data };
    if (data.errcode === 87014) return { pass: false, raw: data };
    throw new Error(data.errmsg || `msgSecCheck v1 errcode=${data.errcode}`);
}

async function msgSecCheckV2(openid, scene, content) {
    const token = await getAccessToken();
    if (!token) return { pass: true, skipped: true };

    const res = await axios.post(
        `${MSG_SEC_CHECK_URL}?access_token=${token}`,
        {
            version: 2,
            openid: String(openid),
            scene: Number(scene) || SCENE.COMMENT,
            content: String(content).slice(0, MAX_TEXT_LEN)
        },
        { timeout: Number(process.env.WX_API_TIMEOUT_MS || 15000) }
    );
    const data = res.data || {};
    if (data.errcode === 0 && data.result) {
        return { pass: isSuggestPass(data.result.suggest), suggest: data.result.suggest, raw: data };
    }
    if (data.errcode === 87014) return { pass: false, raw: data };
    throw new Error(data.errmsg || `msgSecCheck v2 errcode=${data.errcode}`);
}

/**
 * @param {string|null|undefined} openid
 * @param {number} scene
 * @param {string} content
 */
async function checkTextContent(openid, scene, content) {
    const text = content != null ? String(content).trim() : '';
    if (!text) return { pass: true };

    const local = checkLocalBlocklistForText(text);
    if (local.hit) {
        return {
            pass: false,
            result: { suggest: 'local_blocklist', local: true, pattern: local.pattern },
            segment: local.segment
        };
    }

    if (isSecCheckSkipped()) return { pass: true, skipped: true };
    if (!hasWxCredentials()) return { pass: true, skipped: true };

    const segments = [
        ...splitTextChunks(text),
        ...extractSubSegments(text).filter((part) => part.length < MAX_TEXT_LEN)
    ];
    const seen = new Set();
    for (const segment of segments) {
        const key = segment.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const result = await runMsgSecCheck(openid, scene, key);
        if (!result.pass) {
            return { pass: false, result, segment: key.slice(0, 80) };
        }
    }
    return { pass: true };
}

/**
 * @param {string|null|undefined} openid
 * @param {Array<{ content: string, scene?: number, field?: string }>} items
 */
async function checkTexts(openid, items) {
    let skippedWechat = isSecCheckSkipped() || !hasWxCredentials();
    for (const item of items || []) {
        const text = item && item.content != null ? String(item.content).trim() : '';
        if (!text) continue;
        const scene = item.scene != null ? item.scene : SCENE.COMMENT;
        const result = await checkTextContent(openid, scene, text);
        if (!result.pass) {
            return {
                pass: false,
                field: item.field || null,
                suggest: result.result && result.result.suggest,
                segment: result.segment || null
            };
        }
        if (result.skipped) skippedWechat = true;
    }
    return skippedWechat ? { pass: true, skipped: true } : { pass: true };
}

async function checkImageFile(filePath, options = {}) {
    if (isSecCheckSkipped()) return { pass: true, skipped: true };
    if (!hasWxCredentials()) return { pass: true, skipped: true };
    if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('图片文件不存在');
    }

    const cred = resolveWxCredentials(getDefaultAppId());
    let token = await getAccessToken();
    if (!token) return { pass: true, skipped: true };

    const postCheck = async (accessToken) => {
        const form = new FormData();
        form.append('media', fs.createReadStream(filePath));
        const res = await axios.post(`${IMG_SEC_CHECK_URL}?access_token=${accessToken}`, form, {
            headers: form.getHeaders(),
            timeout: Number(process.env.WX_API_TIMEOUT_MS || 30000),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        return res.data || {};
    };

    let data = await postCheck(token);
    if (data.errcode === 40001 && !options._retried && cred) {
        tokenCacheByApp.delete(cred.appId);
        token = await getAccessToken();
        if (token) {
            data = await postCheck(token);
        }
    }

    if (data.errcode === 0) return { pass: true, raw: data };
    if (data.errcode === 87014) return { pass: false, raw: data };
    if (data.errcode === 40005) {
        return { pass: false, invalidMedia: true, reason: 'type', raw: data };
    }
    if (data.errcode === 40006) {
        return { pass: false, invalidMedia: true, reason: 'size', raw: data };
    }
    throw new Error(data.errmsg || `imgSecCheck errcode=${data.errcode}`);
}

/**
 * 远程图片（社区帖已上传至本服务的 URL）
 */
async function checkImageUrl(imageUrl) {
    if (isSecCheckSkipped()) return { pass: true, skipped: true };
    if (!hasWxCredentials()) return { pass: true, skipped: true };

    const url = String(imageUrl || '').trim();
    if (!url) return { pass: true };

    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: Number(process.env.WX_API_TIMEOUT_MS || 20000),
        maxContentLength: 10 * 1024 * 1024
    });

    const token = await getAccessToken();
    if (!token) return { pass: true, skipped: true };

    const form = new FormData();
    form.append('media', Buffer.from(res.data), {
        filename: 'check.jpg',
        contentType: res.headers['content-type'] || 'image/jpeg'
    });

    const checkRes = await axios.post(`${IMG_SEC_CHECK_URL}?access_token=${token}`, form, {
        headers: form.getHeaders(),
        timeout: Number(process.env.WX_API_TIMEOUT_MS || 30000),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });

    const data = checkRes.data || {};
    if (data.errcode === 0) return { pass: true, raw: data };
    if (data.errcode === 87014) return { pass: false, raw: data };
    throw new Error(data.errmsg || `imgSecCheck url errcode=${data.errcode}`);
}

async function checkImageUrls(urls, max = 9) {
    const list = (urls || []).filter(Boolean).slice(0, max);
    for (const url of list) {
        const result = await checkImageUrl(url);
        if (!result.pass) return { pass: false, url };
    }
    return { pass: true };
}

function toAbsoluteMediaUrl(urlStr, baseUrl) {
    const raw = String(urlStr || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = String(baseUrl || '').replace(/\/$/, '');
    if (!base) return raw;
    return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

/** 从本服务托管图片 URL 解析落盘路径（供 imgSecCheck 直读，避免二次下载） */
function tryResolveUploadDiskPath(imageUrl, uploadDir) {
    if (!imageUrl || !uploadDir) return null;
    const raw = String(imageUrl).trim();
    let filename = '';
    try {
        if (raw.includes('/api/music/cover')) {
            const u = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://local');
            filename = u.searchParams.get('f') || u.searchParams.get('file') || '';
        } else {
            const m = raw.match(/\/(?:api\/upload\/(?:image|file)|uploads)\/([^?#]+)/i);
            if (m) filename = m[1];
        }
    } catch (_) {
        const m = raw.match(/\/(?:api\/upload\/(?:image|file)|uploads)\/([^?#]+)/i);
        if (m) filename = m[1];
    }
    if (!filename) return null;
    const safe = path.basename(decodeURIComponent(filename));
    if (!safe) return null;
    const filePath = path.join(uploadDir, safe);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(uploadDir))) return null;
    return fs.existsSync(resolved) ? resolved : null;
}

/**
 * 图片：优先读本地落盘，否则按公网 URL 拉图后 imgSecCheck
 */
async function checkHostedImage(imageUrl, options = {}) {
    const { uploadDir, baseUrl } = options;
    const url = String(imageUrl || '').trim();
    if (!url) return { pass: true };

    const disk = uploadDir ? tryResolveUploadDiskPath(url, uploadDir) : null;
    if (disk) return checkImageFile(disk);

    const abs = toAbsoluteMediaUrl(url, baseUrl);
    if (!abs || !/^https?:\/\//i.test(abs)) {
        return { pass: true, skipped: true, reason: 'no_absolute_url' };
    }
    return checkImageUrl(abs);
}

/**
 * 异步多媒体审核（图片/音频 URL 须可被微信服务器下载，约 30 分钟内推送结果）
 */
async function submitMediaCheckAsync(openid, scene, mediaUrl, mediaType) {
    if (isSecCheckSkipped()) return { pass: true, skipped: true };
    if (!hasWxCredentials()) return { pass: true, skipped: true };

    const url = String(mediaUrl || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
        return { pass: true, skipped: true, reason: 'invalid_url' };
    }
    if (!openid) {
        return { pass: true, skipped: true, reason: 'no_openid' };
    }

    const token = await getAccessToken();
    if (!token) return { pass: true, skipped: true };

    const res = await axios.post(
        `${MEDIA_CHECK_ASYNC_URL}?access_token=${token}`,
        {
            openid: String(openid),
            scene: Number(scene) || SCENE.SOCIAL,
            version: 2,
            media_url: url,
            media_type: Number(mediaType) === MEDIA_TYPE.AUDIO ? MEDIA_TYPE.AUDIO : MEDIA_TYPE.IMAGE
        },
        { timeout: Number(process.env.WX_API_TIMEOUT_MS || 20000) }
    );

    const data = res.data || {};
    if (data.errcode === 0 && data.trace_id) {
        return { pass: true, submitted: true, trace_id: data.trace_id, raw: data };
    }
    if (data.errcode === 87014) return { pass: false, raw: data };
    throw new Error(data.errmsg || `media_check_async errcode=${data.errcode}`);
}

async function checkAudioUrlAsync(openid, scene, audioUrl, baseUrl) {
    const abs = toAbsoluteMediaUrl(audioUrl, baseUrl);
    return submitMediaCheckAsync(openid, scene, abs, MEDIA_TYPE.AUDIO);
}

module.exports = {
    USER_VIOLATION_MSG,
    SCENE,
    MEDIA_TYPE,
    checkTextContent,
    checkTexts,
    checkImageFile,
    checkImageUrl,
    checkImageUrls,
    checkHostedImage,
    toAbsoluteMediaUrl,
    tryResolveUploadDiskPath,
    submitMediaCheckAsync,
    checkAudioUrlAsync
};
