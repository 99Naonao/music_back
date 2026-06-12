/**
 * 一次性脚本：从 app.js 提取路由块到 routes/*.js
 * 用法：node scripts/extract-routes.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src/app.js');
const ROUTES_DIR = path.join(__dirname, '../src/routes');

const DOMAIN_RULES = [
    { file: 'health.js', mount: null, match: (p) => p === '/health' },
    { file: 'wechat.js', mount: null, match: (p) => p.startsWith('/api/wechat/') },
    {
        file: 'media.js',
        mount: null,
        match: (p) =>
            p.startsWith('/api/music/cover') ||
            p.startsWith('/api/music/audio') ||
            p.startsWith('/api/music/library-audio') ||
            p.startsWith('/audio/') ||
            /^\/api\/upload\//.test(p) ||
            /^\/upload\//.test(p)
    },
    { file: 'card.js', mount: '/api/card', match: (p) => p.startsWith('/api/card/') || p === '/api/card/create' },
    {
        file: 'music.js',
        mount: '/api/music',
        match: (p) => p.startsWith('/api/music/') || p === '/api/music/create' || p === '/api/music/generate'
    },
    { file: 'community.js', mount: '/api/community', match: (p) => p.startsWith('/api/community/') },
    { file: 'feedback.js', mount: '/api/feedback', match: (p) => p.startsWith('/api/feedback') },
    { file: 'upload.js', mount: '/api/upload', match: (p) => p.startsWith('/api/upload/') && p.includes('POST') },
    { file: 'library.js', mount: '/api', match: (p) =>
        p.startsWith('/api/play-history') ||
        p.startsWith('/api/favorites') ||
        p.startsWith('/api/notifications')
    },
    { file: 'user.js', mount: '/api/user', match: (p) => p.startsWith('/api/user/') },
    { file: 'shop.js', mount: '/api/shop', match: (p) => p.startsWith('/api/shop/') },
    { file: 'branding.js', mount: '/api', match: (p) =>
        p.startsWith('/api/branding') ||
        p.startsWith('/api/channel-theme-presets') ||
        p.startsWith('/api/promo/')
    },
    { file: 'mall.js', mount: '/api/mall', match: (p) => p.startsWith('/api/mall/') },
    { file: 'mianjia.js', mount: '/api/mianjia', match: (p) => p.startsWith('/api/mianjia/') },
    { file: 'detection.js', mount: '/api/detection', match: (p) => p.startsWith('/api/detection/') },
    { file: 'tasks.js', mount: '/api/tasks', match: (p) => p.startsWith('/api/tasks/') },
    { file: 'points.js', mount: '/api/points', match: (p) => p.startsWith('/api/points') },
    { file: 'ai.js', mount: '/api', match: (p) =>
        p.startsWith('/api/ai/') ||
        p.startsWith('/api/audio/') ||
        p === '/api/music/generate'
    }
];

function extractRouteBlocks(source) {
    const lines = source.split('\n');
    const blocks = [];
    let i = 0;
    const routeStartRe = /^app\.(get|post|put|delete|patch|all)\(/;

    while (i < lines.length) {
        const line = lines[i];
        if (!routeStartRe.test(line)) {
            i++;
            continue;
        }
        const start = i;
        let depth = 0;
        let started = false;
        while (i < lines.length) {
            const l = lines[i];
            for (const ch of l) {
                if (ch === '(' || ch === '{') depth++;
                if (ch === ')' || ch === '}') depth--;
            }
            if (l.includes('(')) started = true;
            i++;
            if (started && depth <= 0 && l.trim().endsWith(');')) break;
        }
        blocks.push(lines.slice(start, i).join('\n'));
    }
    return blocks;
}

function pathFromBlock(block) {
    const m = block.match(/app\.\w+\(\s*(\/^\\.+?\/[a-z]*|\`[^\`]+\`|'[^']+'|"[^"]+")/);
    if (!m) return '';
    let raw = m[1].trim();
    if (raw.startsWith('/') || raw.startsWith("'") || raw.startsWith('"')) {
        return raw.replace(/^['"]|['"]$/g, '');
    }
    return raw;
}

function stripMount(routePath, mount) {
    if (!mount || !routePath.startsWith('/')) return routePath;
    if (routePath === mount) return '/';
    if (routePath.startsWith(mount + '/')) {
        return routePath.slice(mount.length) || '/';
    }
    return routePath;
}

function classifyBlock(block) {
    const p = pathFromBlock(block);
    const method = (block.match(/^app\.(\w+)/) || [])[1] || 'get';
    for (const rule of DOMAIN_RULES) {
        const testPath = rule.file === 'upload.js' ? `${p} POST` : p;
        if (rule.match(testPath) || rule.match(p)) {
            return { ...rule, path: p, method, block };
        }
    }
    return { file: 'misc.js', mount: null, path: p, method, block };
}

function transformBlock(block, mount) {
    let out = block.replace(/^app\./, 'router.');
    const p = pathFromBlock(block);
    if (mount && p.startsWith('/') && !p.startsWith('/^')) {
        const inner = stripMount(p, mount);
        out = out.replace(
            /router\.(get|post|put|delete|patch|all)\(\s*['"][^'"]+['"]/,
            `router.$1('${inner.replace(/'/g, "\\'")}'`
        );
    }
    return out;
}

const source = fs.readFileSync(SRC, 'utf8');
const blocks = extractRouteBlocks(source);
const grouped = {};

blocks.forEach((block) => {
    const info = classifyBlock(block);
    if (!grouped[info.file]) grouped[info.file] = { mount: info.mount, blocks: [] };
    grouped[info.file].blocks.push(transformBlock(block, info.mount));
});

if (!fs.existsSync(ROUTES_DIR)) fs.mkdirSync(ROUTES_DIR, { recursive: true });

const header = `const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');

const {
    db,
    authMiddleware,
    optionalAuthMiddleware,
    sendSuccess,
    sendError,
    ErrorCode,
    logError,
    logWarn,
    logInfo,
    uuidv4,
    axios,
    upload,
    uploadDir,
    libraryAudioDir,
    getApiBaseUrl,
    buildPublicUploadUrl,
    getUploadPublicPathForFilename,
    sanitizePlayerCoverUrlForClient,
    sanitizeCardShareImageForClient,
    sanitizeCommunityImagesForClient,
    blockIfContentUnsafe,
    blockIfImagesUnsafe,
    blockIfHostedImageUnsafe,
    scheduleAudioMediaCheck,
    resolveReferenceAudioProbeTarget,
    resolveLibraryCoverRel,
    toAbsoluteCoverUrl,
    formatConsoleTimestampCn,
    convertDbError,
    successResponse,
    errorResponse,
    POINTS_TYPE,
    generateMusic,
    checkGenerationStatus,
    isMinimaxMockAllowed,
    shopApi,
    bedAccessToken,
    wxMiniApps,
    contentSecurity,
    MALL_PRODUCTS_DATA,
    getMallProductByIdFromStore,
    mallImageUrl,
    getPromoCampaignsForScene,
    channelService,
    QRCODE_DIR,
    attachVoucherUiFlags,
    attachVoucherUiFlagsList,
    getMallClientConfig,
    exposeQrcodeIfEnabled,
    exposeQrcodeListIfEnabled,
    getMianjiaProducts,
    cardTemplates,
    musicAudioStore,
    normalizeLibraryAudioUrl,
    resolveUploadDiskPath,
    sendUploadFileByName,
    sendMusicCoverFile,
    sendMusicAudioFile,
    sendLibraryAudioFile,
    verifyWechatMsgSignature,
    mediaSecStore,
    isDev,
    isProd,
    NODE_ENV
} = ctx;

`;

Object.entries(grouped).forEach(([file, data]) => {
    const body = data.blocks.join('\n\n');
    const content = `${header}${body}\n\nmodule.exports = router;\n`;
    fs.writeFileSync(path.join(ROUTES_DIR, file), content);
    console.log('Wrote', file, data.blocks.length, 'routes', data.mount ? `mount ${data.mount}` : '');
});

console.log('Done. Total blocks:', blocks.length);
